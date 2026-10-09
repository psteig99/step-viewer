import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* ------------------------------------------------------------------------ */
/*  State                                                                    */
/* ------------------------------------------------------------------------ */
const PALETTE = [0x3b6fb6, 0xd1495b, 0x6aa84f, 0x8e63b5, 0xec8f2a, 0x30a5b8, 0x7f7f7f, 0xc9a227, 0x1f8a70, 0xb85c38];
const state = {
  models: new Map(),          // id -> { payload, group, parts: Map(name -> mesh), box, dims }
  current: null,
  materials: {}, pallets: {},
  flags: { dims: true, wire: false, alpha: false, grid: true, measure: false, clip: false },
  clip: { axis: "x", flip: false, pos: 0.5, plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0) },
  measure: { points: [], objects: [] },
  explode: 0,
};

const $ = (s) => document.querySelector(s);
const el = {
  layout: $("#layout"), stage: $("#stage"), viewport: $("#viewport"), drop: $("#drop"), loading: $("#loading"),
  loadingText: $("#loading-text"), toolbar: $("#toolbar"), clipPanel: $("#clip-panel"), clipPos: $("#clip-pos"),
  clipValue: $("#clip-value"), hud: $("#measure-hud"), hint: $("#hint"), panel: $("#panel"), models: $("#models"),
  fileInput: $("#file-input"), toast: $("#toast"), explode: $("#explode"),
};

/* ------------------------------------------------------------------------ */
/*  three.js scene                                                           */
/* ------------------------------------------------------------------------ */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
el.viewport.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.position = "absolute";
labelRenderer.domElement.style.inset = "0";
labelRenderer.domElement.style.pointerEvents = "none";
el.viewport.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
camera.up.set(0, 0, 1);                    // CAD convention: Z up
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, -1.2, 1.8); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5, 1, 0.6); scene.add(fill);
const modelRoot = new THREE.Group(); scene.add(modelRoot);
const helpers = new THREE.Group(); scene.add(helpers);
const measureRoot = new THREE.Group(); scene.add(measureRoot);
const compareRoot = new THREE.Group(); scene.add(compareRoot);
const INNER_COLOR = 0xc08a3e;   // kraft ochre: material interior visible through section cut
let grid = null;

function resize() {
  const w = el.viewport.clientWidth, h = el.viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(el.viewport);
resize();
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera); })();

/* ------------------------------------------------------------------------ */
/*  File loading                                                             */
/* ------------------------------------------------------------------------ */
const isStep = (f) => /\.(step|stp)$/i.test(f.name);

async function handleFiles(files) {
  const list = [...files].filter(isStep);
  if (!list.length) return toast("No .step / .stp file in selection.", true);
  for (const f of list) await uploadFile(f);
}

async function uploadFile(file) {
  el.loading.hidden = false;
  el.loadingText.textContent = `Reading ${file.name} (${fmtBytes(file.size)})…`;
  try {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/models", { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Error ${res.status}`);
    const payload = await res.json();
    el.loadingText.textContent = "Displaying part…";
    const gltf = await new GLTFLoader().loadAsync(payload.glb_url);
    registerModel(payload, gltf.scene);
    showModel(payload.id);
  } catch (err) {
    toast(err.message || String(err), true);
  } finally {
    el.loading.hidden = true;
  }
}

function registerModel(payload, group) {
  const parts = new Map();
  let i = 0;
  const byName = new Map(payload.analysis.details.map((d) => [d.name, d]));
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  meshes.forEach((o) => {
    const name = resolvePartName(o, byName);
    o.name = name;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    o.material = new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], metalness: 0.05, roughness: 0.55,
      flatShading: true, side: THREE.DoubleSide, clippingPlanes: [] });
    o.userData.index = i; o.userData.baseColor = o.material.color.getHex(); o.userData.basePos = o.position.clone();
    // Material interior: back-face tinted, visible only when section plane opens the part.
    const inner = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ color: INNER_COLOR, roughness: 0.9, metalness: 0,
      flatShading: true, side: THREE.BackSide, clippingPlanes: [] }));
    inner.name = `${name}__inner`; inner.visible = false; o.add(inner); o.userData.inner = inner;
    parts.set(name, o); i++;
  });
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  const centers = new Map();
  parts.forEach((m, n) => { const b = new THREE.Box3().setFromObject(m); centers.set(n, b.getCenter(new THREE.Vector3())); });
  state.models.set(payload.id, { payload, group, parts, box, centers, material: "", density: "", compareWith: null });
  addTab(payload);
}

function resolvePartName(mesh, byName) {
  // trimesh names nodes after the part; walk up until a known name is found.
  let o = mesh;
  while (o) { if (byName.has(o.name)) return o.name; o = o.parent; }
  return mesh.name || mesh.parent?.name || `piece_${byName.size}`;
}

/* ------------------------------------------------------------------------ */
/*  Model display                                                            */
/* ------------------------------------------------------------------------ */
function showModel(id) {
  const m = state.models.get(id);
  if (!m) return;
  clearMeasure();
  modelRoot.clear(); helpers.clear(); compareRoot.clear();
  state.current = id;
  modelRoot.add(m.group);
  buildHelpers(m);
  applyFlags();
  setExplode(parseFloat(el.explode.value));
  el.drop.classList.add("minimised");
  el.toolbar.hidden = false; el.panel.hidden = false; el.layout.classList.remove("no-panel");
  document.querySelectorAll(".model-tab").forEach((t) => t.classList.toggle("active", t.dataset.id === id));
  fillPanel(m);
  setView("iso");
  resize();
}

function buildHelpers(m) {
  const size = m.box.getSize(new THREE.Vector3()), c = m.box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1;
  // floor grid (XY plane, below the part)
  const step = niceStep(span / 8), n = Math.ceil((span * 2.5) / step);
  grid = new THREE.GridHelper(n * step, n, 0xb8c0ca, 0xd3d9e0);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(c.x, c.y, m.box.min.z - span * 0.002);
  grid.material.transparent = true; grid.material.opacity = 0.9;
  helpers.add(grid);
  // overall dimensions drawn like a technical drawing
  m.dims = buildDimensions(m.box, span);
  helpers.add(m.dims);
  // section plane
  state.clip.plane.constant = 0;
  updateClip();
  camera.near = span / 500; camera.far = span * 50; camera.updateProjectionMatrix();
}

function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x))); const r = x / p; return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p; }

function buildDimensions(box, span) {
  const g = new THREE.Group();
  const off = span * 0.08, tick = span * 0.012;
  const mat = new THREE.LineBasicMaterial({ color: 0x1f4e9a });
  const { min, max } = box;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const segs = [];
  const dim = (a, b, ext1, ext2, label) => {
    segs.push(a, b, ext1[0], ext1[1], ext2[0], ext2[1]);
    const d = b.clone().sub(a).normalize(), perp = Math.abs(d.z) > 0.9 ? V(1, 0, 0) : V(0, 0, 1);
    for (const p of [a, b]) { // arrow "dash" at 45°
      const s = p === a ? 1 : -1;
      segs.push(p, p.clone().addScaledVector(d, s * tick).addScaledVector(perp, tick * 0.6));
      segs.push(p, p.clone().addScaledVector(d, s * tick).addScaledVector(perp, -tick * 0.6));
    }
    const div = document.createElement("div"); div.className = "lbl dim"; div.textContent = label;
    const l = new CSS2DObject(div); l.position.copy(a.clone().add(b).multiplyScalar(0.5)); g.add(l);
  };
  const fx = (v) => `${fmt(v)} mm`;
  // L (X): front, at floor
  dim(V(min.x, min.y - off, min.z), V(max.x, min.y - off, min.z),
      [V(min.x, min.y, min.z), V(min.x, min.y - off - tick, min.z)], [V(max.x, min.y, min.z), V(max.x, min.y - off - tick, min.z)], fx(max.x - min.x));
  // W (Y): right, at floor
  dim(V(max.x + off, min.y, min.z), V(max.x + off, max.y, min.z),
      [V(max.x, min.y, min.z), V(max.x + off + tick, min.y, min.z)], [V(max.x, max.y, min.z), V(max.x + off + tick, max.y, min.z)], fx(max.y - min.y));
  // H (Z): rear right corner
  dim(V(max.x + off, max.y + off, min.z), V(max.x + off, max.y + off, max.z),
      [V(max.x, max.y, min.z), V(max.x + off + tick, max.y + off + tick, min.z)], [V(max.x, max.y, max.z), V(max.x + off + tick, max.y + off + tick, max.z)], fx(max.z - min.z));
  const geo = new THREE.BufferGeometry().setFromPoints(segs);
  g.add(new THREE.LineSegments(geo, mat));
  // bounding box edges, subtle
  const bb = new THREE.Box3Helper(box, 0x1f4e9a); bb.material.transparent = true; bb.material.opacity = 0.35; g.add(bb);
  return g;
}

/* ------------------------------------------------------------------------ */
/*  Views and display flags                                                  */
/* ------------------------------------------------------------------------ */
function setView(name) {
  const m = cur(); if (!m) return;
  const c = m.box.getCenter(new THREE.Vector3()), size = m.box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.75 + size.length() * 0.3;
  const dir = { iso: [1, -1, 0.8], top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0] }[name] || [1, -1, 0.8];
  const d = new THREE.Vector3(...dir).normalize();
  camera.position.copy(c).addScaledVector(d, r);
  controls.target.copy(c); controls.update();
}

function applyFlags() {
  const m = cur(); if (!m) return;
  m.dims.visible = state.flags.dims;
  if (grid) grid.visible = state.flags.grid;
  m.parts.forEach((mesh) => {
    const mat = mesh.material, inner = mesh.userData.inner;
    mat.wireframe = state.flags.wire;
    mat.transparent = state.flags.alpha; mat.opacity = state.flags.alpha ? 0.35 : 1; mat.depthWrite = !state.flags.alpha;
    mat.clippingPlanes = state.flags.clip ? [state.clip.plane] : [];
    mat.side = state.flags.clip && !state.flags.alpha ? THREE.FrontSide : THREE.DoubleSide;
    mat.needsUpdate = true;
    inner.visible = state.flags.clip && !state.flags.wire && !state.flags.alpha;
    inner.material.clippingPlanes = state.flags.clip ? [state.clip.plane] : [];
    inner.material.needsUpdate = true;
  });
  compareRoot.traverse((o) => { if (o.isMesh) { o.material.clippingPlanes = state.flags.clip ? [state.clip.plane] : []; o.material.needsUpdate = true; } });
  el.viewport.classList.toggle("measuring", state.flags.measure);
  el.clipPanel.hidden = !state.flags.clip;
  document.querySelectorAll("[data-toggle]").forEach((b) => b.setAttribute("aria-pressed", String(!!state.flags[b.dataset.toggle])));
  if (state.flags.measure) hint("Measure: click two points on the part. Esc to exit."); else if (!state.flags.clip) hint(null);
}

function setExplode(v) {
  state.explode = v;
  const m = cur(); if (!m) return;
  const c = m.box.getCenter(new THREE.Vector3());
  m.parts.forEach((mesh, name) => {
    const off = m.centers.get(name).clone().sub(c).multiplyScalar(v);
    off.applyQuaternion(mesh.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    mesh.position.copy(mesh.userData.basePos).add(off);
  });
}

function updateClip() {
  const m = cur(); if (!m) return;
  const a = state.clip.axis, n = new THREE.Vector3(a === "x" ? 1 : 0, a === "y" ? 1 : 0, a === "z" ? 1 : 0);
  if (!state.clip.flip) n.negate();
  const lo = m.box.min[a], hi = m.box.max[a], pos = lo + (hi - lo) * state.clip.pos;
  state.clip.plane.normal.copy(n);
  state.clip.plane.constant = state.clip.flip ? -pos : pos;
  el.clipValue.textContent = `${a.toUpperCase()} = ${fmt(pos)} mm`;
  if (state.flags.clip) hint("Section: move the slider to cut through the part. P to exit.");
}

/* ------------------------------------------------------------------------ */
/*  Measure                                                                  */
/* ------------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
let downPos = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4 || e.button !== 0) return;
  const m = cur(); if (!m) return;
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const visible = [...m.parts.values()].filter((p) => p.visible);
  const hits = raycaster.intersectObjects(visible, false).filter((h) => !state.flags.clip || state.clip.plane.distanceToPoint(h.point) >= -1e-6);
  if (!hits.length) return;
  if (state.flags.measure) addMeasurePoint(hits[0].point, m);
  else focusPart(hits[0].object.name, m, true);
});

function addMeasurePoint(p, m) {
  const span = m.box.getSize(new THREE.Vector3()).length();
  const dot = new THREE.Mesh(new THREE.SphereGeometry(span * 0.004, 16, 12), new THREE.MeshBasicMaterial({ color: 0xb42318, depthTest: false }));
  dot.position.copy(p); dot.renderOrder = 10; measureRoot.add(dot); state.measure.objects.push(dot);
  state.measure.points.push(p.clone());
  if (state.measure.points.length === 2) {
    const [a, b] = state.measure.points;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xb42318, depthTest: false }));
    line.renderOrder = 10; measureRoot.add(line); state.measure.objects.push(line);
    const d = a.distanceTo(b), dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y), dz = Math.abs(a.z - b.z);
    const div = document.createElement("div"); div.className = "lbl measure"; div.textContent = `${fmt(d)} mm`;
    const lbl = new CSS2DObject(div); lbl.position.copy(a.clone().add(b).multiplyScalar(0.5)); measureRoot.add(lbl); state.measure.objects.push(lbl);
    el.hud.hidden = false;
    el.hud.textContent = `Distance ${fmt(d)} mm\ndX ${fmt(dx)}  dY ${fmt(dy)}  dZ ${fmt(dz)} mm`;
    state.measure.points = [];
  }
}

function clearMeasure() {
  state.measure.objects.forEach((o) => { measureRoot.remove(o); o.geometry?.dispose?.(); });
  state.measure.objects = []; state.measure.points = []; el.hud.hidden = true;
}

/* ------------------------------------------------------------------------ */
/*  Side panel                                                               */
/* ------------------------------------------------------------------------ */
function fillPanel(m) {
  const a = m.payload.analysis;
  $("#file-name").textContent = m.payload.name;
  $("#file-meta").textContent = `${fmtBytes(m.payload.size_bytes)} · ${a.parts} part${a.parts > 1 ? "s" : ""} · ${a.triangles.toLocaleString("en-US")} triangles`;

  const w = $("#warnings"); w.innerHTML = "";
  const warns = [...a.warnings];
  if (m.payload.overlaps?.length) warns.push(`${m.payload.overlaps.length} bounding box overlap(s) between parts: ${m.payload.overlaps.slice(0, 4).map(([x, y]) => `${x} ↔ ${y}`).join(", ")}`);
  warns.forEach((t) => { const d = document.createElement("div"); d.className = "warn"; d.textContent = t; w.appendChild(d); });

  const [L, l, h] = a.dimensions_mm;
  $("#dims").innerHTML = [["X", L], ["Y", l], ["Z", h]].map(([ax, v]) => `<div class="dim-cell"><div class="axis">${ax}</div><div class="val">${fmt(v)}<small>mm</small></div></div>`).join("");
  const [Lo, lo, ho] = a.oriented_dimensions_mm;
  $("#dims-oriented").textContent = `Minimum oriented dims: ${fmt(Lo)} × ${fmt(lo)} × ${fmt(ho)} mm`;

  const sel = $("#material");
  sel.innerHTML = `<option value="">— none —</option>` + Object.entries(state.materials).map(([k, v]) => `<option value="${k}">${k} (${v})</option>`).join("");
  sel.value = m.material; $("#density").value = m.density;
  renderFacts(m);

  $("#parts-count").textContent = `(${a.parts})`;
  const ul = $("#parts"); ul.innerHTML = "";
  a.details.forEach((p) => {
    const mesh = m.parts.get(p.name), color = mesh ? `#${mesh.userData.baseColor.toString(16).padStart(6, "0")}` : "#999";
    const li = document.createElement("li"); li.className = "part" + (p.watertight ? "" : " open-mesh"); li.dataset.name = p.name;
    li.innerHTML = `<input type="checkbox" ${mesh?.visible === false ? "" : "checked"} aria-label="Show ${p.name}"><span class="sw" style="background:${color}"></span><span class="nm" title="${p.name}">${p.name}</span><span class="dm">${p.dimensions_mm.map(fmt).join(" × ")}</span>`;
    li.querySelector("input").addEventListener("change", (e) => { if (mesh) mesh.visible = e.target.checked; });
    li.querySelector(".nm").addEventListener("click", () => focusPart(p.name, m, false));
    ul.appendChild(li);
  });

  renderCompareSelect(m);
  const pal = $("#fit-pallet"); if (!pal.options.length) pal.innerHTML = Object.keys(state.pallets).map((k) => `<option ${k === "euro" ? "selected" : ""}>${k}</option>`).join("");
  computeFit();
  renderDownloads(m);
}

function renderFacts(m) {
  const a = m.payload.analysis, dens = density(m);
  const mass = dens && a.material_volume_cm3 ? a.material_volume_cm3 * dens : null;
  const rows = [
    ["Material vol.", `${fmt(a.material_volume_cm3)} cm³`],
    ["Bounding vol.", `${fmt(a.bounding_volume_cm3)} cm³`],
    ["Fill rate", `${fmt(a.fill_rate_pct, 1)} %`],
    ["Surface area", `${fmt(a.surface_cm2)} cm²`],
    ["Est. mass", mass != null ? `${fmt(mass, 1)} g` : "—"],
  ];
  const thick = a.details.map((d) => d.wall_thickness_mm).filter(Boolean);
  if (thick.length) rows.push(["Est. wall thickness", `${thick.map((t) => fmt(t)).join(" / ")} mm`]);
  $("#facts").innerHTML = rows.map(([k, v], i) => `<dt>${k}</dt><dd class="${i === 4 ? "strong" : ""}">${v}</dd>`).join("");
  m.mass_g = mass;
}

function density(m) { const d = parseFloat(m.density); if (d > 0) return d; return state.materials[m.material] || null; }

function focusPart(name, m, fromViewport) {
  document.querySelectorAll(".part").forEach((li) => li.classList.toggle("focus", li.dataset.name === name));
  m.parts.forEach((mesh, n) => mesh.material.emissive.setHex(n === name ? 0x333333 : 0x000000));
  const li = document.querySelector(`.part[data-name="${CSS.escape(name)}"]`);
  if (fromViewport) li?.scrollIntoView({ block: "nearest" });
  const d = m.payload.analysis.details.find((p) => p.name === name);
  if (d) hint(`${name} : ${d.dimensions_mm.map(fmt).join(" × ")} mm${d.volume_cm3 != null ? ` · ${fmt(d.volume_cm3)} cm³` : ""}`);
  clearTimeout(focusPart.t); focusPart.t = setTimeout(() => { m.parts.forEach((mesh) => mesh.material.emissive.setHex(0)); document.querySelectorAll(".part.focus").forEach((x) => x.classList.remove("focus")); if (!state.flags.measure && !state.flags.clip) hint(null); }, 2500);
}

async function computeFit() {
  const m = cur(); if (!m) return;
  const a = m.payload.analysis;
  const body = {
    unit: a.dimensions_mm,
    carton: [$("#fit-L"), $("#fit-l"), $("#fit-h")].map((i) => parseFloat(i.value) || 1),
    clearance: parseFloat($("#fit-jeu").value) || 0,
    allow_rotation: $("#fit-rot").checked,
    pallet: $("#fit-pallet").value || "euro",
    max_height: parseFloat($("#fit-hmax").value) || 1800,
    mass_g: m.mass_g || null,
  };
  try {
    const res = await fetch("/api/fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error((await res.json()).detail || "Calculation failed");
    const r = await res.json(), c = r.carton, p = r.pallet;
    $("#fit-result").innerHTML = `
      <div class="fit-cell"><div class="k">Units per box</div><div class="v">${c.quantity} <small>${c.per_axis.join(" × ")}</small></div></div>
      <div class="fit-cell"><div class="k">Box fill rate</div><div class="v">${fmt(c.fill_rate_pct, 1)} %</div></div>
      <div class="fit-cell"><div class="k">Boxes per pallet</div><div class="v">${p.quantity} <small>${p.per_axis.join(" × ")}</small></div></div>
      <div class="fit-cell"><div class="k">Units per pallet</div><div class="v">${r.units_per_pallet.toLocaleString("en-US")}</div></div>
      <div class="fit-note">Unit placed as ${c.orientation_mm.map(fmt).join(" × ")} mm${r.mass_per_carton_kg ? ` · ${r.mass_per_carton_kg} kg of product per box, ${r.mass_per_pallet_kg} kg per pallet` : ""}.</div>`;
  } catch (err) { $("#fit-result").innerHTML = `<div class="fit-note">${err.message}</div>`; }
}

function renderDownloads(m) {
  const q = m.material ? `?material=${encodeURIComponent(m.material)}` : (parseFloat(m.density) > 0 ? `?density=${m.density}` : "");
  const base = `/api/models/${m.payload.id}`;
  const items = [["HTML report (embedded 3D)", `${base}/report.html${q}`], ["JSON analysis", `${base}/analysis.json${q}`],
    ...["stl", "obj", "glb", "3mf"].map((e) => [e.toUpperCase(), `${base}/export.${e}`])];
  $("#downloads").innerHTML = items.map(([t, u]) => `<a class="dl" href="${u}" download>${t}</a>`).join("");
}

/* ------------------------------------------------------------------------ */
/*  Revision comparison                                                      */
/* ------------------------------------------------------------------------ */
function renderCompareSelect(m) {
  const block = $("#compare-block"), sel = $("#compare");
  const others = [...state.models.values()].filter((x) => x.payload.id !== m.payload.id);
  block.hidden = others.length === 0;
  sel.innerHTML = `<option value="">— none —</option>` + others.map((x) => `<option value="${x.payload.id}">${x.payload.name}</option>`).join("");
  sel.value = others.some((x) => x.payload.id === m.compareWith) ? m.compareWith : "";
  applyCompare(m);
}

function applyCompare(m) {
  compareRoot.clear();
  const ref = m.compareWith ? state.models.get(m.compareWith) : null;
  const out = $("#compare-result");
  if (!ref) { out.innerHTML = ""; return; }
  // Ghost overlay of the reference
  const ghost = ref.group.clone(true);
  ghost.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.endsWith("__inner")) { o.visible = false; return; }
    o.material = new THREE.MeshStandardMaterial({ color: 0xd1495b, transparent: true, opacity: 0.38, depthWrite: false,
      flatShading: true, side: THREE.DoubleSide, clippingPlanes: state.flags.clip ? [state.clip.plane] : [] });
  });
  compareRoot.add(ghost);
  // Delta table
  const a = m.payload.analysis, b = ref.payload.analysis;
  const rows = [
    ["X (mm)", a.dimensions_mm[0], b.dimensions_mm[0]], ["Y (mm)", a.dimensions_mm[1], b.dimensions_mm[1]], ["Z (mm)", a.dimensions_mm[2], b.dimensions_mm[2]],
    ["Material vol. (cm³)", a.material_volume_cm3, b.material_volume_cm3], ["Surface area (cm²)", a.surface_cm2, b.surface_cm2], ["Parts", a.parts, b.parts],
  ];
  const cell = (v, r) => { const d = v - r, cls = Math.abs(d) < 0.005 ? "" : d > 0 ? " plus" : " minus"; return `<td class="delta${cls}">${d > 0 ? "+" : ""}${fmt(d)}</td>`; };
  out.innerHTML = `<table><tr><th></th><td>${m.payload.name.length > 18 ? "current" : m.payload.name}</td><td>reference</td><td>delta</td></tr>` +
    rows.map(([k, v, r]) => `<tr><th>${k}</th><td>${fmt(v)}</td><td>${fmt(r)}</td>${cell(v, r)}</td></tr>`).join("") + `</table>
    <div class="compare-legend"><i style="background:#3b6fb6"></i>current &nbsp; <i style="background:#d1495b;opacity:.6"></i>reference overlay</div>`;
}

/* ------------------------------------------------------------------------ */
/*  Open file tabs                                                           */
/* ------------------------------------------------------------------------ */
function addTab(payload) {
  const b = document.createElement("div"); b.className = "model-tab"; b.dataset.id = payload.id; b.setAttribute("role", "button"); b.tabIndex = 0;
  b.innerHTML = `<span title="${payload.name}">${payload.name}</span><button class="x" title="Close" aria-label="Close ${payload.name}">×</button>`;
  b.addEventListener("click", (e) => { if (e.target.classList.contains("x")) closeModel(payload.id); else showModel(payload.id); });
  b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showModel(payload.id); } });
  el.models.appendChild(b);
}

async function closeModel(id) {
  const m = state.models.get(id); if (!m) return;
  fetch(`/api/models/${id}`, { method: "DELETE" }).catch(() => {});
  m.parts.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); mesh.userData.inner?.material.dispose(); });
  state.models.delete(id);
  state.models.forEach((x) => { if (x.compareWith === id) x.compareWith = null; });
  document.querySelector(`.model-tab[data-id="${id}"]`)?.remove();
  if (state.current === id) {
    const next = [...state.models.keys()].pop();
    if (next) showModel(next);
    else { modelRoot.clear(); helpers.clear(); compareRoot.clear(); clearMeasure(); state.current = null; el.drop.classList.remove("minimised"); el.toolbar.hidden = true; el.panel.hidden = true; el.layout.classList.add("no-panel"); hint(null); resize(); }
  }
}

/* ------------------------------------------------------------------------ */
/*  Screenshot                                                               */
/* ------------------------------------------------------------------------ */
function screenshot() {
  const m = cur(); if (!m) return;
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.href = renderer.domElement.toDataURL("image/png");
  a.download = `${m.payload.name.replace(/\.(step|stp)$/i, "")}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  a.click(); toast("Screenshot saved (dimension labels not included).");
}

/* ------------------------------------------------------------------------ */
/*  Events                                                                   */
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
  if (b.dataset.view) setView(b.dataset.view);
  if (b.dataset.action === "fit") setView("iso");
  if (b.dataset.action === "shot") screenshot();
  if (b.dataset.toggle) toggle(b.dataset.toggle);
});
function toggle(flag) {
  state.flags[flag] = !state.flags[flag];
  if (flag === "measure" && state.flags.measure) { state.flags.clip = false; }
  if (flag === "clip" && state.flags.clip) { state.flags.measure = false; updateClip(); }
  if (flag === "measure" && !state.flags.measure) clearMeasure();
  applyFlags();
}
el.explode.addEventListener("input", (e) => setExplode(parseFloat(e.target.value)));
el.clipPos.addEventListener("input", (e) => { state.clip.pos = parseFloat(e.target.value); updateClip(); });
$("#clip-flip").addEventListener("click", () => { state.clip.flip = !state.clip.flip; updateClip(); });
el.clipPanel.querySelectorAll("[data-axis]").forEach((b) => b.addEventListener("click", () => {
  state.clip.axis = b.dataset.axis; el.clipPanel.querySelectorAll("[data-axis]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); updateClip();
}));

$("#compare").addEventListener("change", (e) => { const m = cur(); if (!m) return; m.compareWith = e.target.value || null; applyCompare(m); });
$("#material").addEventListener("change", (e) => { const m = cur(); if (!m) return; m.material = e.target.value; m.density = ""; $("#density").value = ""; renderFacts(m); computeFit(); renderDownloads(m); });
$("#density").addEventListener("input", (e) => { const m = cur(); if (!m) return; m.density = e.target.value; if (m.density) { m.material = ""; $("#material").value = ""; } renderFacts(m); computeFit(); renderDownloads(m); });
["#fit-L", "#fit-l", "#fit-h", "#fit-jeu", "#fit-rot", "#fit-pallet", "#fit-hmax"].forEach((s) => $(s).addEventListener("input", debounce(computeFit, 250)));

document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea")) return;
  const k = e.key.toLowerCase();
  const map = { i: () => setView("iso"), x: () => setView("top"), y: () => setView("front"), z: () => setView("side"), r: () => setView("iso"),
    w: () => toggle("wire"), t: () => toggle("alpha"), b: () => toggle("dims"), m: () => toggle("measure"), p: () => toggle("clip"), f: screenshot,
    escape: () => { if (state.flags.measure) toggle("measure"); if (state.flags.clip) toggle("clip"); } };
  if (map[k]) { e.preventDefault(); map[k](); }
});

/* ------------------------------------------------------------------------ */
/*  Utilities                                                                */
/* ------------------------------------------------------------------------ */
function cur() { return state.current ? state.models.get(state.current) : null; }
function fmt(v, d = 2) { return Number(v).toLocaleString("en-US", { maximumFractionDigits: d }); }
function fmtBytes(b) { return b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function hint(text) { el.hint.hidden = !text; el.hint.textContent = text || ""; }
let toastTimer;
function toast(msg, error = false) {
  el.toast.textContent = msg; el.toast.className = "toast" + (error ? " error" : ""); el.toast.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.toast.hidden = true), error ? 7000 : 3500);
}

/* ------------------------------------------------------------------------ */
fetch("/api/materials").then((r) => r.json()).then((d) => { state.materials = d.materials; state.pallets = d.pallets; }).catch(() => {});
el.layout.classList.add("no-panel");
