/**
 * analysis.js — AI analysis via POST /api/models/{id}/ai-analysis (SSE stream).
 * Replace the fetch URL to point at your own backend if needed.
 */
import { captureAll, cur, toast } from "./viewer.js";

const $ = (s) => document.querySelector(s);

/** Minimal markdown → HTML for the subset Claude typically outputs. */
function renderMarkdown(md) {
  return md
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")          // escape first
    .replace(/^#{1,3} (.+)$/gm, "<strong>$1</strong>")     // ## Heading
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")       // **bold**
    .replace(/^(\d+)\. /gm, "<br>$1. ")                    // 1. list items
    .replace(/\n{2,}/g, "<br><br>")                        // paragraphs
    .replace(/\n/g, "<br>");                                // line breaks
}

export async function runAiAnalysis(m) {
  const btn = $("#ai-btn"), out = $("#ai-output");
  btn.disabled = true; btn.textContent = "Analyzing…";
  out.hidden = false; out.textContent = "";

  const { views, sections } = captureAll(m);
  const images = [...views, ...sections].map(({ dataUrl }) => dataUrl);

  try {
    const res = await fetch(`/api/models/${m.payload.id}/ai-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, analysis: m.payload.analysis }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);

    // Stream SSE deltas as they arrive
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();                          // keep incomplete line
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") break outer;
        try {
          const { delta, error } = JSON.parse(payload);
          if (error) throw new Error(error);
          full += delta;
          out.innerHTML = renderMarkdown(full);
          out.scrollTop = out.scrollHeight;
        } catch { /* skip malformed chunks */ }
      }
    }
  } catch (err) {
    out.textContent = `Error: ${err.message}`;
    toast(err.message, true);
  } finally {
    btn.disabled = false; btn.textContent = "Analyze with AI";
  }
}

$("#ai-btn").addEventListener("click", () => { const m = cur(); if (m) runAiAnalysis(m); });
