/**
 * export.js — Downloads all auto-captured views as a ZIP file.
 *
 * Uses JSZip (loaded on demand from CDN). Standard browser download;
 * no server round-trip needed.
 */
import { captureAll, cur, toast } from "./viewer.js";

const $ = (s) => document.querySelector(s);

// Pre-warm JSZip — awaiting the same Promise multiple times returns the cached result
const jszipReady = import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");

export async function exportViews(m) {
  const btn = $("#export-views-btn");
  btn.disabled = true; btn.textContent = "Building ZIP…";
  try {
    const { default: JSZip } = await jszipReady;
    const zip = new JSZip();
    const stem = m.payload.name.replace(/\.(step|stp)$/i, "");
    const folder = zip.folder(stem + "_views");

    const { views, sections } = captureAll(m);
    const all = [
      ...views.map(({ label, dataUrl }) => ({ filename: label, dataUrl })),
      ...sections.map(({ label, dataUrl }) => ({ filename: label, dataUrl })),
    ];

    all.forEach(({ filename, dataUrl }, i) => {
      const num = String(i + 1).padStart(2, "0");
      const name = `${num}_${filename.toLowerCase().replace(/\s+/g, "_")}.jpg`;
      folder.file(name, dataUrl.split(",")[1], { base64: true });
    });

    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${stem}_views.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`${all.length} views exported.`);
  } catch (err) {
    toast(`Export failed: ${err.message}`, true);
  } finally {
    btn.disabled = false; btn.textContent = "↓ Export views (ZIP)";
  }
}

/* Auto-register button */
$("#export-views-btn").addEventListener("click", () => { const m = cur(); if (m) exportViews(m); });
