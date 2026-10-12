/**
 * annotations.js — Click on the 3D part to pin a text note at a 3D point.
 * Toggle with the "Notes" toolbar button or the N key.
 * Notes persist in localStorage, keyed per model id.
 */
import { cur, state, scene, camera, renderer, toast, onModelLoad } from "./viewer.js";
import * as THREE from "three";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

const $ = (s) => document.querySelector(s);

/* ---- Annotation group (cleared on model switch) -------------------------- */
const annotRoot = new THREE.Group();
scene.add(annotRoot);

/* ---- Per-model store: id → [{ id, point, text, dot, label }] ------------ */
const store = new Map();
let nextId = 1;

/* ---- Floating input popup ------------------------------------------------ */
const popup = document.createElement("div");
popup.className = "annot-popup";
popup.hidden = true;
popup.innerHTML = `
  <input class="annot-input" type="text" placeholder="Add a note…" maxlength="140">
  <div class="annot-popup-btns">
    <button class="btn annot-ok" type="button">Add</button>
    <button class="annot-cancel" type="button">Cancel</button>
  </div>`;
document.body.appendChild(popup);

const popupInput = popup.querySelector(".annot-input");
let pendingPoint = null;

function showPopup(sx, sy) {
  const w = 220, margin = 8;
  popup.style.left = `${Math.min(sx + 14, window.innerWidth  - w - margin)}px`;
  popup.style.top  = `${Math.max(sy - 42, margin)}px`;
  popup.hidden = false;
  popupInput.value = "";
  requestAnimationFrame(() => popupInput.focus());
}
function hidePopup() { popup.hidden = true; pendingPoint = null; }

popup.querySelector(".annot-ok").addEventListener("click", confirmAnnotation);
popup.querySelector(".annot-cancel").addEventListener("click", hidePopup);
popupInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); confirmAnnotation(); }
  if (e.key === "Escape") hidePopup();
});
// Dismiss on click outside
document.addEventListener("pointerdown", (e) => {
  if (!popup.hidden && !popup.contains(e.target)) hidePopup();
}, { capture: true });

function confirmAnnotation() {
  const text = popupInput.value.trim();
  if (!text || !pendingPoint) { hidePopup(); return; }
  const m = cur(); if (!m) { hidePopup(); return; }
  addAnnotation(m, pendingPoint.clone(), text);
  hidePopup();
}

/* ---- Raycaster (own listener — does not interfere with viewer.js) -------- */
const raycaster = new THREE.Raycaster();
let downXY = null;

renderer.domElement.addEventListener("pointerdown", (e) => { downXY = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!state.flags.annotate || !downXY) return;
  if (Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4 || e.button !== 0) return;
  const m = cur(); if (!m) return;

  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1,
  ), camera);

  const hits = raycaster.intersectObjects([...m.parts.values()].filter(p => p.visible), false);
  if (!hits.length) return;

  pendingPoint = hits[0].point;
  showPopup(e.clientX, e.clientY);
});

/* ---- Create / remove annotations ---------------------------------------- */
function addAnnotation(m, point, text) {
  if (!store.has(m.payload.id)) store.set(m.payload.id, []);
  const list = store.get(m.payload.id);
  const id = nextId++;
  const num = list.length + 1;

  const span = m.box.getSize(new THREE.Vector3()).length();

  // Ochre sphere at the hit point
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(span * 0.006, 14, 10),
    new THREE.MeshBasicMaterial({ color: 0xc08a3e, depthTest: false }),
  );
  dot.position.copy(point); dot.renderOrder = 12; annotRoot.add(dot);

  // CSS2D label floating above the dot
  const el = document.createElement("div");
  el.className = "annot-lbl"; el.dataset.annotId = id;
  el.innerHTML = `<span class="annot-num">${num}</span><span class="annot-txt">${esc(text)}</span>`;
  const label = new CSS2DObject(el);
  label.position.copy(point);
  annotRoot.add(label);

  list.push({ id, point, text, dot, label });
  persist(m.payload.id);
  refreshPanel(m.payload.id);
}

function removeAnnotation(modelId, id) {
  const list = store.get(modelId); if (!list) return;
  const i = list.findIndex(a => a.id === id); if (i < 0) return;
  const [a] = list.splice(i, 1);
  annotRoot.remove(a.dot); a.dot.geometry.dispose(); a.dot.material.dispose();
  annotRoot.remove(a.label);
  // Renumber remaining labels
  list.forEach((a, j) => {
    const n = a.label.element.querySelector(".annot-num");
    if (n) n.textContent = j + 1;
  });
  persist(modelId);
  refreshPanel(modelId);
}

/* ---- Side panel ---------------------------------------------------------- */
function refreshPanel(modelId) {
  const list = store.get(modelId) || [];
  const block = $("#annotations-block"), ul = $("#annot-list");
  block.hidden = list.length === 0;
  ul.innerHTML = list.map((a, i) => `
    <li class="annot-item">
      <span class="annot-num">${i + 1}</span>
      <span class="annot-item-txt">${esc(a.text)}</span>
      <button class="annot-del" data-id="${a.id}" title="Delete">×</button>
    </li>`).join("");
  ul.querySelectorAll(".annot-del").forEach(btn =>
    btn.addEventListener("click", () => removeAnnotation(modelId, +btn.dataset.id)));
}

/* ---- Persistence --------------------------------------------------------- */
function persist(modelId) {
  try {
    const list = store.get(modelId) || [];
    localStorage.setItem(`sv-annot-${modelId}`, JSON.stringify(
      list.map(({ id, point, text }) => ({ id, point: point.toArray(), text }))
    ));
  } catch {}
}

function restore(m) {
  try {
    const raw = localStorage.getItem(`sv-annot-${m.payload.id}`); if (!raw) return;
    for (const { id, point, text } of JSON.parse(raw)) {
      nextId = Math.max(nextId, id + 1);
      addAnnotation(m, new THREE.Vector3(...point), text);
    }
  } catch {}
}

/* ---- Model lifecycle ----------------------------------------------------- */
onModelLoad((m) => {
  // Clear previous model's 3D objects (store entries are kept per id)
  annotRoot.clear();
  // Restore or init panel for this model
  refreshPanel(m.payload.id);
  restore(m);
});

/* ---- Keyboard shortcut: N ------------------------------------------------ */
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  if (e.key.toLowerCase() !== "n") return;
  e.preventDefault();
  state.flags.annotate = !state.flags.annotate;
  $("[data-toggle='annotate']")?.setAttribute("aria-pressed", String(state.flags.annotate));
  if (!state.flags.annotate) hidePopup();
});

/* ---- Utility ------------------------------------------------------------- */
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
