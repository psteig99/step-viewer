import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { OBJExporter } from "three/examples/jsm/exporters/OBJExporter.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import occtimportjs from "occt-import-js";
import { MATERIALS, PALLETS, analysePart, analyseModel, weldVertices, fitInContainer, fitOnPallet } from "./engine.js";

/* ------------------------------------------------------------------------ */
/*  État                                                                     */
/* ------------------------------------------------------------------------ */
const PALETTE = [0x3b6fb6, 0xd1495b, 0x6aa84f, 0x8e63b5, 0xec8f2a, 0x30a5b8, 0x7f7f7f, 0xc9a227, 0x1f8a70, 0xb85c38];
const INNER_COLOR = 0xc08a3e;
const state = {
  models: new Map(), current: null, seq: 0,
  flags: { dims: true, wire: false, alpha: false, grid: true, measure: false, clip: false },
  clip: { axis: "x", flip: false, pos: 0.5, plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0) },
  measure: { points: [], objects: [] }, explode: 0, quality: 0.001,
};
const $ = (s) => document.querySelector(s);
const el = {
  layout: $("#layout"), viewport: $("#viewport"), drop: $("#drop"), loading: $("#loading"), loadingText: $("#loading-text"),
  toolbar: $("#toolbar"), clipPanel: $("#clip-panel"), clipPos: $("#clip-pos"), clipValue: $("#clip-value"), hud: $("#measure-hud"),
  hint: $("#hint"), panel: $("#panel"), models: $("#models"), fileInput: $("#file-input"), toast: $("#toast"), explode: $("#explode"),
};

/* ------------------------------------------------------------------------ */
/*  Lecteur STEP (OpenCASCADE / WebAssembly, embarqué dans la page)          */
/* ------------------------------------------------------------------------ */
let occtPromise = null;
function getOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = (async () => {
    el.loadingText.textContent = "Initialisation du lecteur STEP (première fois seulement)…";
    const b64 = document.getElementById("occt-wasm").textContent.trim();
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (typeof DecompressionStream === "undefined") throw new Error("Navigateur trop ancien : il faut Chrome 80+, Edge 80+, Firefox 113+ ou Safari 16.4+.");
    const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
    const wasmBinary = await new Response(stream).arrayBuffer();
    return occtimportjs({ wasmBinary });
  })();
  occtPromise.catch(() => { occtPromise = null; });
  return occtPromise;
}

async function parseStep(file) {
  const occt = await getOcct();
  el.loadingText.textContent = `Lecture de ${file.name} (${fmtBytes(file.size)})…`;
  await new Promise((r) => setTimeout(r, 30)); // laisse le navigateur afficher le message
  const buf = new Uint8Array(await file.arrayBuffer());
  const t0 = performance.now();
  const res = occt.ReadStepFile(buf, { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: state.quality, angularDeflection: 0.3 });
  if (!res.success || !res.meshes.length) throw new Error(`${file.name} : fichier STEP illisible ou sans solide.`);
  const used = new Map(), parts = [], group = new THREE.Group(), partMeshes = new Map();
  res.meshes.forEach((m, i) => {
    let name = (m.name || "piece").replace(/\//g, "_").slice(0, 60);
    used.set(name, (used.get(name) || 0) + 1);
    if (used.get(name) > 1) name = `${name}_${used.get(name)}`;
    const pos = new Float32Array(m.attributes.position.array), idx = new Uint32Array(m.index.array);
    const welded = weldVertices(pos, idx);
    parts.push(analysePart(name, welded.pos, welded.idx));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (m.attributes.normal) geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(m.attributes.normal.array), 3));
    else geo.computeVertexNormals();
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide, clippingPlanes: [] }));
    mesh.name = name; mesh.userData.index = i; mesh.userData.baseColor = PALETTE[i % PALETTE.length]; mesh.userData.basePos = new THREE.Vector3();
    const inner = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: INNER_COLOR, roughness: 0.9, metalness: 0, side: THREE.BackSide, clippingPlanes: [] }));
    inner.name = `${name}__inner`; inner.visible = false; mesh.add(inner); mesh.userData.inner = inner;
    group.add(mesh); partMeshes.set(name, mesh);
  });
  const analysis = analyseModel(file.name, parts);
  analysis.temps_lecture_ms = Math.round(performance.now() - t0);
  return { analysis, group, parts: partMeshes };
}

/* ------------------------------------------------------------------------ */
/*  Scène three.js                                                           */
/* ------------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
el.viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
el.viewport.appendChild(labelRenderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, -1.2, 1.8); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5, 1, 0.6); scene.add(fill);
const modelRoot = new THREE.Group(), helpers = new THREE.Group(), measureRoot = new THREE.Group(), compareRoot = new THREE.Group();
scene.add(modelRoot, helpers, measureRoot, compareRoot);
let grid = null;

function resize() {
  const w = el.viewport.clientWidth, h = el.viewport.clientHeight; if (!w || !h) return;
  renderer.setSize(w, h); labelRenderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(el.viewport); resize();
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera); })();

/* ------------------------------------------------------------------------ */
/*  Chargement                                                               */
/* ------------------------------------------------------------------------ */
const isStep = (f) => /\.(step|stp)$/i.test(f.name);
async function handleFiles(files) {
  const list = [...files].filter(isStep);
  if (!list.length) return toast("Aucun fichier .step / .stp dans la sélection.", true);
  el.loading.hidden = false;
  try {
    for (const f of list) {
      const { analysis, group, parts } = await parseStep(f);
      const id = `m${++state.seq}`;
      group.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(group), centers = new Map();
      parts.forEach((m, n) => centers.set(n, new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3())));
      state.models.set(id, { id, name: f.name, size: f.size, analysis, group, parts, box, centers, material: "", density: "", compareWith: null });
      addTab(id, f.name); showModel(id);
    }
  } catch (err) { toast(err.message || String(err), true); console.error(err); }
  finally { el.loading.hidden = true; }
}

/* ------------------------------------------------------------------------ */
/*  Affichage d'un modèle                                                    */
/* ------------------------------------------------------------------------ */
function showModel(id) {
  const m = state.models.get(id); if (!m) return;
  clearMeasure(); modelRoot.clear(); helpers.clear(); compareRoot.clear();
  state.current = id; modelRoot.add(m.group);
  buildHelpers(m); applyFlags(); setExplode(parseFloat(el.explode.value));
  el.drop.classList.add("minimised"); el.toolbar.hidden = false; el.panel.hidden = false; el.layout.classList.remove("no-panel");
  document.querySelectorAll(".model-tab").forEach((t) => t.classList.toggle("active", t.dataset.id === id));
  fillPanel(m); setView("iso"); resize();
}

function buildHelpers(m) {
  const size = m.box.getSize(new THREE.Vector3()), c = m.box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1;
  const step = niceStep(span / 8), n = Math.ceil((span * 2.5) / step);
  grid = new THREE.GridHelper(n * step, n, 0xb8c0ca, 0xd3d9e0);
  grid.rotation.x = Math.PI / 2; grid.position.set(c.x, c.y, m.box.min.z - span * 0.002);
  grid.material.transparent = true; grid.material.opacity = 0.9; helpers.add(grid);
  m.dims = buildDimensions(m.box, span); helpers.add(m.dims);
  state.clip.plane.constant = 0; updateClip();
  camera.near = span / 500; camera.far = span * 50; camera.updateProjectionMatrix();
}
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)), r = x / p; return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p; }

function buildDimensions(box, span) {
  const g = new THREE.Group(), off = span * 0.08, tick = span * 0.012;
  const { min, max } = box, V = (x, y, z) => new THREE.Vector3(x, y, z), segs = [];
  const dim = (a, b, e1, e2, label) => {
    segs.push(a, b, e1[0], e1[1], e2[0], e2[1]);
    const d = b.clone().sub(a).normalize(), perp = Math.abs(d.z) > 0.9 ? V(1, 0, 0) : V(0, 0, 1);
    for (const p of [a, b]) { const s = p === a ? 1 : -1; segs.push(p, p.clone().addScaledVector(d, s * tick).addScaledVector(perp, tick * 0.6)); segs.push(p, p.clone().addScaledVector(d, s * tick).addScaledVector(perp, -tick * 0.6)); }
    const div = document.createElement("div"); div.className = "lbl dim"; div.textContent = label;
    const l = new CSS2DObject(div); l.position.copy(a.clone().add(b).multiplyScalar(0.5)); g.add(l);
  };
  const fx = (v) => `${fmt(v)} mm`;
  dim(V(min.x, min.y - off, min.z), V(max.x, min.y - off, min.z), [V(min.x, min.y, min.z), V(min.x, min.y - off - tick, min.z)], [V(max.x, min.y, min.z), V(max.x, min.y - off - tick, min.z)], fx(max.x - min.x));
  dim(V(max.x + off, min.y, min.z), V(max.x + off, max.y, min.z), [V(max.x, min.y, min.z), V(max.x + off + tick, min.y, min.z)], [V(max.x, max.y, min.z), V(max.x + off + tick, max.y, min.z)], fx(max.y - min.y));
  dim(V(max.x + off, max.y + off, min.z), V(max.x + off, max.y + off, max.z), [V(max.x, max.y, min.z), V(max.x + off + tick, max.y + off + tick, min.z)], [V(max.x, max.y, max.z), V(max.x + off + tick, max.y + off + tick, max.z)], fx(max.z - min.z));
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({ color: 0x1f4e9a })));
  const bb = new THREE.Box3Helper(box, 0x1f4e9a); bb.material.transparent = true; bb.material.opacity = 0.35; g.add(bb);
  return g;
}

/* ------------------------------------------------------------------------ */
/*  Vues, drapeaux                                                           */
/* ------------------------------------------------------------------------ */
function setView(name) {
  const m = cur(); if (!m) return;
  const c = m.box.getCenter(new THREE.Vector3()), size = m.box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.75 + size.length() * 0.3;
  const dir = { iso: [1, -1, 0.8], top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0] }[name] || [1, -1, 0.8];
  camera.position.copy(c).addScaledVector(new THREE.Vector3(...dir).normalize(), r);
  controls.target.copy(c); controls.update();
}

function applyFlags() {
  const m = cur(); if (!m) return;
  m.dims.visible = state.flags.dims; if (grid) grid.visible = state.flags.grid;
  const planes = state.flags.clip ? [state.clip.plane] : [];
  m.parts.forEach((mesh) => {
    const mat = mesh.material, inner = mesh.userData.inner;
    mat.wireframe = state.flags.wire; mat.transparent = state.flags.alpha; mat.opacity = state.flags.alpha ? 0.35 : 1; mat.depthWrite = !state.flags.alpha;
    mat.clippingPlanes = planes; mat.side = state.flags.clip && !state.flags.alpha ? THREE.FrontSide : THREE.DoubleSide; mat.needsUpdate = true;
    inner.visible = state.flags.clip && !state.flags.wire && !state.flags.alpha; inner.material.clippingPlanes = planes; inner.material.needsUpdate = true;
  });
  compareRoot.traverse((o) => { if (o.isMesh) { o.material.clippingPlanes = planes; o.material.needsUpdate = true; } });
  el.viewport.classList.toggle("measuring", state.flags.measure);
  el.clipPanel.hidden = !state.flags.clip;
  document.querySelectorAll("[data-toggle]").forEach((b) => b.setAttribute("aria-pressed", String(!!state.flags[b.dataset.toggle])));
  if (state.flags.measure) hint("Mesure : cliquez deux points sur la pièce. Échap pour quitter."); else if (!state.flags.clip) hint(null);
}

function setExplode(v) {
  state.explode = v; const m = cur(); if (!m) return;
  const c = m.box.getCenter(new THREE.Vector3());
  m.parts.forEach((mesh, name) => { mesh.position.copy(mesh.userData.basePos).add(m.centers.get(name).clone().sub(c).multiplyScalar(v)); });
}

function updateClip() {
  const m = cur(); if (!m) return;
  const a = state.clip.axis, n = new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0);
  if (!state.clip.flip) n.negate();
  const lo = m.box.min[a], hi = m.box.max[a], pos = lo + (hi - lo) * state.clip.pos;
  state.clip.plane.normal.copy(n); state.clip.plane.constant = state.clip.flip ? -pos : pos;
  el.clipValue.textContent = `${a.toUpperCase()} = ${fmt(pos)} mm`;
  if (state.flags.clip) hint("Coupe : déplacez le curseur pour traverser la pièce. P pour quitter.");
}

/* ------------------------------------------------------------------------ */
/*  Mesure & sélection                                                       */
/* ------------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster(); let downPos = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4 || e.button !== 0) return;
  const m = cur(); if (!m) return;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
  const hits = raycaster.intersectObjects([...m.parts.values()].filter((p) => p.visible), false).filter((h) => !state.flags.clip || state.clip.plane.distanceToPoint(h.point) >= -1e-6);
  if (!hits.length) return;
  if (state.flags.measure) addMeasurePoint(hits[0].point, m); else focusPart(hits[0].object.name, m, true);
});

function addMeasurePoint(p, m) {
  const span = m.box.getSize(new THREE.Vector3()).length();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(span * 0.004, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb42318, depthTest: false }));
  dot.position.copy(p); dot.renderOrder = 10; measureRoot.add(dot); state.measure.objects.push(dot); state.measure.points.push(p.clone());
  if (state.measure.points.length === 2) {
    const [a, b] = state.measure.points;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xb42318, depthTest: false }));
    line.renderOrder = 10; measureRoot.add(line); state.measure.objects.push(line);
    const d = a.distanceTo(b), dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), dz = Math.abs(a.z - b.z);
    const div = document.createElement("div"); div.className = "lbl measure"; div.textContent = `${fmt(d)} mm`;
    const lbl = new CSS2DObject(div); lbl.position.copy(a.clone().add(b).multiplyScalar(0.5)); measureRoot.add(lbl); state.measure.objects.push(lbl);
    el.hud.hidden = false; el.hud.textContent = `Distance ${fmt(d)} mm\ndX ${fmt(dx)}  dY ${fmt(dy)}  dZ ${fmt(dz)} mm`;
    state.measure.points = [];
  }
}
function clearMeasure() { state.measure.objects.forEach((o) => { measureRoot.remove(o); o.geometry?.dispose?.(); }); state.measure.objects = []; state.measure.points = []; el.hud.hidden = true; }

function focusPart(name, m, fromViewport) {
  document.querySelectorAll(".part").forEach((li) => li.classList.toggle("focus", li.dataset.name === name));
  m.parts.forEach((mesh, n) => mesh.material.emissive.setHex(n === name ? 0x333333 : 0));
  if (fromViewport) document.querySelector(`.part[data-name="${CSS.escape(name)}"]`)?.scrollIntoView({ block: "nearest" });
  const d = m.analysis.details.find((p) => p.nom === name);
  if (d) hint(`${name} : ${d.dimensions_mm.map(fmt).join(" × ")} mm${d.volume_cm3 != null ? ` · ${fmt(d.volume_cm3)} cm³` : ""}`);
  clearTimeout(focusPart.t); focusPart.t = setTimeout(() => { m.parts.forEach((mesh) => mesh.material.emissive.setHex(0)); document.querySelectorAll(".part.focus").forEach((x) => x.classList.remove("focus")); if (!state.flags.measure && !state.flags.clip) hint(null); }, 2500);
}

/* ------------------------------------------------------------------------ */
/*  Panneau                                                                  */
/* ------------------------------------------------------------------------ */
function fillPanel(m) {
  const a = m.analysis;
  $("#file-name").textContent = m.name;
  $("#file-meta").textContent = `${fmtBytes(m.size)} · ${a.pieces} pièce${a.pieces > 1 ? "s" : ""} · ${a.triangles.toLocaleString("fr-FR")} triangles · lu en ${(a.temps_lecture_ms / 1000).toFixed(1)} s`;
  const w = $("#warnings"); w.innerHTML = "";
  const warns = [...a.avertissements];
  if (a.overlaps.length) warns.push(`${a.overlaps.length} chevauchement(s) d'encombrement entre pièces : ${a.overlaps.slice(0, 4).map(([x, y]) => `${x} ↔ ${y}`).join(", ")}`);
  warns.forEach((t) => { const d = document.createElement("div"); d.className = "warn"; d.textContent = t; w.appendChild(d); });
  const [L, l, h] = a.dimensions_mm;
  $("#dims").innerHTML = [["X", L], ["Y", l], ["Z", h]].map(([ax, v]) => `<div class="dim-cell"><div class="axis">${ax}</div><div class="val">${fmt(v)}<small>mm</small></div></div>`).join("");
  const sel = $("#material");
  sel.innerHTML = `<option value="">— aucun —</option>` + Object.entries(MATERIALS).map(([k, v]) => `<option value="${k}">${k} (${v})</option>`).join("");
  sel.value = m.material; $("#density").value = m.density;
  renderFacts(m);
  $("#parts-count").textContent = `(${a.pieces})`;
  const ul = $("#parts"); ul.innerHTML = "";
  a.details.forEach((p) => {
    const mesh = m.parts.get(p.nom), color = `#${mesh.userData.baseColor.toString(16).padStart(6, "0")}`;
    const li = document.createElement("li"); li.className = "part" + (p.etanche ? "" : " open-mesh"); li.dataset.name = p.nom;
    li.innerHTML = `<input type="checkbox" ${mesh.visible ? "checked" : ""} aria-label="Afficher ${p.nom}"><span class="sw" style="background:${color}"></span><span class="nm" title="${p.nom}">${p.nom}</span><span class="dm">${p.dimensions_mm.map(fmt).join(" × ")}</span>`;
    li.querySelector("input").addEventListener("change", (e) => { mesh.visible = e.target.checked; });
    li.querySelector(".nm").addEventListener("click", () => focusPart(p.nom, m, false));
    ul.appendChild(li);
  });
  renderCompareSelect(m);
  const pal = $("#fit-pallet"); if (!pal.options.length) pal.innerHTML = Object.keys(PALLETS).map((k) => `<option ${k === "euro" ? "selected" : ""}>${k}</option>`).join("");
  computeFit();
}

function renderFacts(m) {
  const a = m.analysis, dens = density(m), mass = dens && a.volume_matiere_cm3 ? a.volume_matiere_cm3 * dens : null;
  const rows = [["Volume matière", `${fmt(a.volume_matiere_cm3)} cm³`], ["Volume englobant", `${fmt(a.volume_englobant_cm3)} cm³`], ["Taux de remplissage", `${fmt(a.taux_remplissage_pct, 1)} %`], ["Surface", `${fmt(a.surface_cm2)} cm²`], ["Masse estimée", mass != null ? `${fmt(mass, 1)} g` : "—"]];
  const thick = a.details.map((d) => d.epaisseur_mm_estimee).filter(Boolean);
  if (thick.length) rows.push(["Épaisseur de paroi estimée", `${thick.map((t) => fmt(t)).join(" / ")} mm`]);
  $("#facts").innerHTML = rows.map(([k, v], i) => `<dt>${k}</dt><dd class="${i === 4 ? "strong" : ""}">${v}</dd>`).join("");
  m.mass_g = mass;
}
function density(m) { const d = parseFloat(m.density); if (d > 0) return d; return MATERIALS[m.material] || null; }

function computeFit() {
  const m = cur(); if (!m) return;
  try {
    const carton = [$("#fit-L"), $("#fit-l"), $("#fit-h")].map((i) => parseFloat(i.value) || 1);
    const c = fitInContainer(m.analysis.dimensions_mm, carton, parseFloat($("#fit-jeu").value) || 0, $("#fit-rot").checked);
    const p = fitOnPallet(carton, $("#fit-pallet").value || "euro", parseFloat($("#fit-hmax").value) || 1800);
    const upp = p.quantite * c.quantite;
    const mass = m.mass_g ? ` · ${fmt((c.quantite * m.mass_g) / 1000)} kg de produit par carton, ${fmt((upp * m.mass_g) / 1000, 1)} kg par palette` : "";
    $("#fit-result").innerHTML = `
      <div class="fit-cell"><div class="k">Unités par carton</div><div class="v">${c.quantite} <small>${c.par_axe.join(" × ")}</small></div></div>
      <div class="fit-cell"><div class="k">Occupation du carton</div><div class="v">${fmt(c.taux_occupation_pct, 1)} %</div></div>
      <div class="fit-cell"><div class="k">Cartons par palette</div><div class="v">${p.quantite} <small>${p.par_axe.join(" × ")}</small></div></div>
      <div class="fit-cell"><div class="k">Unités par palette</div><div class="v">${upp.toLocaleString("fr-FR")}</div></div>
      <div class="fit-note">Unité posée en ${c.orientation_mm.map(fmt).join(" × ")} mm${mass}.</div>`;
  } catch (err) { $("#fit-result").innerHTML = `<div class="fit-note">${err.message}</div>`; }
}

/* ------------------------------------------------------------------------ */
/*  Comparaison                                                              */
/* ------------------------------------------------------------------------ */
function renderCompareSelect(m) {
  const block = $("#compare-block"), sel = $("#compare");
  const others = [...state.models.values()].filter((x) => x.id !== m.id);
  block.hidden = others.length === 0;
  sel.innerHTML = `<option value="">— aucune —</option>` + others.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
  sel.value = others.some((x) => x.id === m.compareWith) ? m.compareWith : "";
  applyCompare(m);
}
function applyCompare(m) {
  compareRoot.clear();
  const ref = m.compareWith ? state.models.get(m.compareWith) : null, out = $("#compare-result");
  if (!ref) { out.innerHTML = ""; return; }
  const ghost = ref.group.clone(true);
  ghost.traverse((o) => { if (!o.isMesh) return; if (o.name.endsWith("__inner")) { o.visible = false; return; }
    o.material = new THREE.MeshStandardMaterial({ color: 0xd1495b, transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: state.flags.clip ? [state.clip.plane] : [] }); });
  compareRoot.add(ghost);
  const a = m.analysis, b = ref.analysis;
  const rows = [["X (mm)", a.dimensions_mm[0], b.dimensions_mm[0]], ["Y (mm)", a.dimensions_mm[1], b.dimensions_mm[1]], ["Z (mm)", a.dimensions_mm[2], b.dimensions_mm[2]], ["Volume matière (cm³)", a.volume_matiere_cm3, b.volume_matiere_cm3], ["Surface (cm²)", a.surface_cm2, b.surface_cm2], ["Pièces", a.pieces, b.pieces]];
  const cell = (v, r) => { const d = v - r, cls = Math.abs(d) < 0.005 ? "" : d > 0 ? " plus" : " minus"; return `<td class="delta${cls}">${d > 0 ? "+" : ""}${fmt(d)}</td>`; };
  out.innerHTML = `<table><tr><th></th><td>actuel</td><td>référence</td><td>écart</td></tr>` + rows.map(([k, v, r]) => `<tr><th>${k}</th><td>${fmt(v)}</td><td>${fmt(r)}</td>${cell(v, r)}</tr>`).join("") +
    `</table><div class="compare-legend"><i style="background:#3b6fb6"></i>actuel &nbsp; <i style="background:#d1495b;opacity:.6"></i>référence en superposition</div>`;
}

/* ------------------------------------------------------------------------ */
/*  Onglets                                                                  */
/* ------------------------------------------------------------------------ */
function addTab(id, name) {
  const b = document.createElement("div"); b.className = "model-tab"; b.dataset.id = id; b.setAttribute("role", "button"); b.tabIndex = 0;
  b.innerHTML = `<span title="${name}">${name}</span><button class="x" title="Fermer" aria-label="Fermer ${name}">×</button>`;
  b.addEventListener("click", (e) => { if (e.target.classList.contains("x")) closeModel(id); else showModel(id); });
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showModel(id); } });
  el.models.appendChild(b);
}
function closeModel(id) {
  const m = state.models.get(id); if (!m) return;
  m.parts.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); mesh.userData.inner?.material.dispose(); });
  state.models.delete(id); state.models.forEach((x) => { if (x.compareWith === id) x.compareWith = null; });
  document.querySelector(`.model-tab[data-id="${id}"]`)?.remove();
  if (state.current === id) {
    const next = [...state.models.keys()].pop();
    if (next) showModel(next);
    else { modelRoot.clear(); helpers.clear(); compareRoot.clear(); clearMeasure(); state.current = null; el.drop.classList.remove("minimised"); el.toolbar.hidden = true; el.panel.hidden = true; el.layout.classList.add("no-panel"); hint(null); resize(); }
  }
}

/* ------------------------------------------------------------------------ */
/*  Exports (tout se fait dans le navigateur)                                */
/* ------------------------------------------------------------------------ */
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
function exportGroup(m) { const g = new THREE.Group(); m.parts.forEach((mesh) => { const c = new THREE.Mesh(mesh.geometry, new THREE.MeshStandardMaterial({ color: mesh.userData.baseColor })); c.name = mesh.name; g.add(c); }); return g; }
const stem = (m) => m.name.replace(/\.(step|stp)$/i, "");

async function exportAs(kind) {
  const m = cur(); if (!m) return;
  const g = exportGroup(m);
  if (kind === "stl") download(new Blob([new STLExporter().parse(g, { binary: true })], { type: "model/stl" }), `${stem(m)}.stl`);
  else if (kind === "obj") download(new Blob([new OBJExporter().parse(g)], { type: "text/plain" }), `${stem(m)}.obj`);
  else if (kind === "glb") new GLTFExporter().parse(g, (buf) => download(new Blob([buf], { type: "model/gltf-binary" }), `${stem(m)}.glb`), (e) => toast(String(e), true), { binary: true });
  else if (kind === "json") download(new Blob([JSON.stringify({ ...m.analysis, materiau: m.material || null, densite_g_cm3: density(m), masse_g: m.mass_g ?? null }, null, 2)], { type: "application/json" }), `${stem(m)}_analyse.json`);
  else if (kind === "png") screenshot();
  else if (kind === "html") download(new Blob([buildReport(m)], { type: "text/html" }), `${stem(m)}_rapport.html`);
}

function screenshot() {
  const m = cur(); if (!m) return;
  renderer.render(scene, camera);
  const a = document.createElement("a"); a.href = renderer.domElement.toDataURL("image/png");
  a.download = `${stem(m)}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`; a.click();
  toast("Capture enregistrée (les étiquettes de cotes ne sont pas incluses).");
}

function buildReport(m) {
  const a = m.analysis, e = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  renderer.render(scene, camera); const img = renderer.domElement.toDataURL("image/png");
  const kpi = [["Hors-tout", `${a.dimensions_mm.map(fmt).join(" × ")} mm`], ["Volume matière", `${fmt(a.volume_matiere_cm3)} cm³`], ["Volume englobant", `${fmt(a.volume_englobant_cm3)} cm³`], ["Taux de remplissage", `${fmt(a.taux_remplissage_pct, 1)} %`], ["Surface", `${fmt(a.surface_cm2)} cm²`]];
  if (m.mass_g != null) kpi.push(["Masse estimée", `${fmt(m.mass_g, 1)} g (${e(m.material || `${m.density} g/cm³`)})`]);
  const rows = a.details.map((p) => `<tr><td>${e(p.nom)}</td><td>${p.dimensions_mm.map(fmt).join(" × ")}</td><td>${p.volume_cm3 ?? "—"}</td><td>${p.surface_cm2}</td><td>${p.epaisseur_mm_estimee ?? "—"}</td><td>${p.etanche ? "oui" : "<b style=color:#b42318>non</b>"}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport – ${e(m.name)}</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#1b2430;margin:0;background:#f6f8fb}.w{max-width:1000px;margin:0 auto;padding:28px 20px}h1{font-size:22px;margin:0 0 4px}.s{color:#5b6475;margin-bottom:20px}.k{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:20px}.k div{background:#fff;border:1px solid #e3e7ee;border-radius:8px;padding:12px 14px}.k b{display:block;font-size:19px}.k span{font-size:12px;color:#5b6475}img{max-width:100%;border:1px solid #e3e7ee;border-radius:8px;background:#fff}table{width:100%;border-collapse:collapse;font-size:14px;margin-top:20px;background:#fff}th,td{padding:8px 10px;border-bottom:1px solid #e3e7ee;text-align:left}th{color:#5b6475;font-size:12px}.a{background:#fff7e6;border:1px solid #f5d08a;border-radius:8px;padding:10px 14px;margin-bottom:16px}</style></head><body><div class="w">
<h1>${e(m.name)}</h1><div class="s">Rapport d'analyse packaging · ${a.pieces} pièce(s) · ${new Date().toLocaleString("fr-FR")}</div>
<div class="k">${kpi.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join("")}</div>
${a.avertissements.length ? `<div class="a"><b>Points d'attention</b><ul>${a.avertissements.map((x) => `<li>${e(x)}</li>`).join("")}</ul></div>` : ""}
<img src="${img}" alt="Vue 3D">
<table><thead><tr><th>Pièce</th><th>Dimensions (mm)</th><th>Volume (cm³)</th><th>Surface (cm²)</th><th>Ép. paroi est. (mm)</th><th>Fermé</th></tr></thead><tbody>${rows}</tbody></table>
<p style="color:#5b6475;font-size:12px;margin-top:24px">Généré par STEP Viewer. Volumes et masses calculés sur la tessellation du STEP ; épaisseur de paroi estimée par 2·V/S.</p></div></body></html>`;
}

/* ------------------------------------------------------------------------ */
/*  Événements                                                               */
/* ------------------------------------------------------------------------ */
["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); document.body.classList.add("dragging"); }));
let dragLeaveTimer;
document.addEventListener("dragleave", (e) => { e.preventDefault(); clearTimeout(dragLeaveTimer); dragLeaveTimer = setTimeout(() => document.body.classList.remove("dragging"), 80); });
document.addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("dragging"); handleFiles(e.dataTransfer.files); });
$("#btn-open").addEventListener("click", () => el.fileInput.click());
$("#btn-browse").addEventListener("click", () => el.fileInput.click());
el.drop.addEventListener("click", (e) => { if (!el.drop.classList.contains("minimised") && e.target === el.drop) el.fileInput.click(); });
el.fileInput.addEventListener("change", () => { handleFiles(el.fileInput.files); el.fileInput.value = ""; });
document.addEventListener("paste", (e) => { if (e.clipboardData?.files?.length) handleFiles(e.clipboardData.files); });
el.toolbar.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.view) setView(b.dataset.view); if (b.dataset.action === "fit") setView("iso"); if (b.dataset.action === "shot") screenshot(); if (b.dataset.toggle) toggle(b.dataset.toggle);
});
function toggle(flag) {
  state.flags[flag] = !state.flags[flag];
  if (flag === "measure" && state.flags.measure) state.flags.clip = false;
  if (flag === "clip" && state.flags.clip) { state.flags.measure = false; updateClip(); }
  if (flag === "measure" && !state.flags.measure) clearMeasure();
  applyFlags();
}
el.explode.addEventListener("input", (e) => setExplode(parseFloat(e.target.value)));
el.clipPos.addEventListener("input", (e) => { state.clip.pos = parseFloat(e.target.value); updateClip(); });
$("#clip-flip").addEventListener("click", () => { state.clip.flip = !state.clip.flip; updateClip(); });
el.clipPanel.querySelectorAll("[data-axis]").forEach((b) => b.addEventListener("click", () => { state.clip.axis = b.dataset.axis; el.clipPanel.querySelectorAll("[data-axis]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); updateClip(); }));
$("#compare").addEventListener("change", (e) => { const m = cur(); if (!m) return; m.compareWith = e.target.value || null; applyCompare(m); });
$("#material").addEventListener("change", (e) => { const m = cur(); if (!m) return; m.material = e.target.value; m.density = ""; $("#density").value = ""; renderFacts(m); computeFit(); });
$("#density").addEventListener("input", (e) => { const m = cur(); if (!m) return; m.density = e.target.value; if (m.density) { m.material = ""; $("#material").value = ""; } renderFacts(m); computeFit(); });
["#fit-L", "#fit-l", "#fit-h", "#fit-jeu", "#fit-rot", "#fit-pallet", "#fit-hmax"].forEach((s) => $(s).addEventListener("input", debounce(computeFit, 200)));
$("#downloads").addEventListener("click", (e) => { const b = e.target.closest("[data-export]"); if (b) exportAs(b.dataset.export); });
$("#quality").addEventListener("change", (e) => { state.quality = parseFloat(e.target.value); toast("La finesse s'appliquera aux prochains fichiers ouverts."); });
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  const k = e.key.toLowerCase();
  const map = { i: () => setView("iso"), x: () => setView("top"), y: () => setView("front"), z: () => setView("side"), r: () => setView("iso"), w: () => toggle("wire"), t: () => toggle("alpha"), b: () => toggle("dims"), m: () => toggle("measure"), p: () => toggle("clip"), f: screenshot, escape: () => { if (state.flags.measure) toggle("measure"); if (state.flags.clip) toggle("clip"); } };
  if (map[k]) { e.preventDefault(); map[k](); }
});

/* ------------------------------------------------------------------------ */
function cur() { return state.current ? state.models.get(state.current) : null; }
function fmt(v, d = 2) { return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }); }
function fmtBytes(b) { return b < 1048576 ? `${(b / 1024).toFixed(0)} Ko` : `${(b / 1048576).toFixed(1)} Mo`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function hint(text) { el.hint.hidden = !text; el.hint.textContent = text || ""; }
let toastTimer;
function toast(msg, error = false) { el.toast.textContent = msg; el.toast.className = "toast" + (error ? " error" : ""); el.toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.toast.hidden = true), error ? 8000 : 3500); }
el.layout.classList.add("no-panel");
// Pré-initialise le lecteur en arrière-plan pour que le premier fichier s'ouvre vite.
setTimeout(() => { getOcct().catch((e) => toast(e.message, true)); }, 400);
