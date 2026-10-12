/**
 * capture.js — Auto-generates view + section-cut thumbnails after each model load.
 * Imports captureAll so all 8 captures share a single camera save/restore pass.
 */
import { captureAll, onModelLoad, setView, updateClip, applyFlags, state } from "./viewer.js";

const $ = (s) => document.querySelector(s);

export function populateThumbnails(m) {
  const { views, sections } = captureAll(m);

  const vg = $("#view-grid");
  vg.innerHTML = "";
  views.forEach(({ key, label, dataUrl }) => {
    const div = thumb(label, dataUrl);
    div.addEventListener("click", () => setView(key));
    vg.appendChild(div);
  });
  $("#views-block").hidden = false;

  const sg = $("#section-grid");
  sg.innerHTML = "";
  sections.forEach(({ axis, label, dataUrl }) => {
    const div = thumb(label, dataUrl);
    div.addEventListener("click", () => {
      setView("iso");
      state.clip.axis = axis; state.clip.pos = 0.5; state.clip.flip = false;
      if (!state.flags.clip) { state.flags.clip = true; state.flags.measure = false; }
      updateClip(); applyFlags();
    });
    sg.appendChild(div);
  });
  $("#sections-block").hidden = false;
  $("#export-views-btn").hidden = false;
}

function thumb(label, dataUrl) {
  const div = document.createElement("div");
  div.className = "view-thumb"; div.title = label;
  const img = document.createElement("img"); img.src = dataUrl; img.alt = label;
  const span = document.createElement("span"); span.className = "view-lbl"; span.textContent = label;
  div.append(img, span);
  return div;
}

// Also export legacy names so analysis.js / export.js still work
export { populateThumbnails as populateViewThumbnails, populateThumbnails as populateSectionThumbnails };

onModelLoad((m) => {
  const run = () => populateThumbnails(m);
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 100);
});
