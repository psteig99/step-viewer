import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

/* ------------------------------------------------------------------------ */
/*  État                                                                     */
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
/*  Scène three.js                                                           */
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
camera.up.set(0, 0, 1);                    // convention CAO : Z vers le haut
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
const INNER_COLOR = 0xc08a3e;   // ocre kraft : intérieur de la matière vu par la coupe
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
/*  Chargement de fichiers                                                   */
/* ------------------------------------------------------------------------ */
const isStep = (f) => /\.(step|stp)$/i.test(f.name);

async function handleFiles(files) {
  const list = [...files].filter(isStep);
  if (!list.length) return toast("Aucun fichier .step / .stp dans la sélection.", true);
  for (const f of list) await uploadFile(f);
}

async function uploadFile(file) {
  el.loading.hidden = false;
  el.loadingText.textContent = `Lecture de ${file.name} (${fmtBytes(file.size)})…`;
  try {
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/models", { method: "POST", body: fd });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `Erreur ${res.status}`);
    const payload = await res.json();
    el.loadingText.textContent = "Affichage de la pièce…";
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
  const byName = new Map(payload.analysis.details.map((d) => [d.nom, d]));
  const meshes = [];
  group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  meshes.forEach((o) => {
    const name = resolvePartName(o, byName);
    o.name = name;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    o.material = new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], metalness: 0.05, roughness: 0.55,
      flatShading: true, side: THREE.DoubleSide, clippingPlanes: [] });
    o.userData.index = i; o.userData.baseColor = o.material.color.getHex(); o.userData.basePos = o.position.clone();
    // Intérieur de la matière : faces arrière teintées, visibles seulement quand le plan de coupe ouvre la pièce.
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
  // trimesh nomme les nœuds d'après la pièce ; on remonte jusqu'à un nom connu.
  let o = mesh;
  while (o) { if (byName.has(o.name)) return o.name; o = o.parent; }
  return mesh.name || mesh.parent?.name || `piece_${byName.size}`;
}

/* ------------------------------------------------------------------------ */
/*  Affichage d'un modèle                                                    */
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
  // grille au sol (plan XY, sous la pièce)
  const step = niceStep(span / 8), n = Math.ceil((span * 2.5) / step);
  grid = new THREE.GridHelper(n * step, n, 0xb8c0ca, 0xd3d9e0);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(c.x, c.y, m.box.min.z - span * 0.002);
  grid.material.transparent = true; grid.material.opacity = 0.9;
  helpers.add(grid);
  // cotes hors-tout dessinées comme sur un plan
  m.dims = buildDimensions(m.box, span);
  helpers.add(m.dims);
  // plan de coupe
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
    for (const p of [a, b]) { // flèches en « tirets » 45°
      const s = p === a ? 1 : -1;
      segs.push(p, p.clone().addScaledVector(d, s * tick).addScaledVector(perp, tick * 0.6));
      segs.push(p, p.clone().addScaledVector(d, s * tick).addScaledVector(perp, -tick * 0.6));
    }
    const div = document.createElement("div"); div.className = "lbl dim"; div.textContent = label;
    const l = new CSS2DObject(div); l.position.copy(a.clone().add(b).multiplyScalar(0.5)); g.add(l);
  };
  const fx = (v) => `${fmt(v)} mm`;
  // L (X) : devant, au sol
  dim(V(min.x, min.y - off, min.z), V(max.x, min.y - off, min.z),
      [V(min.x, min.y, min.z), V(min.x, min.y - off - tick, min.z)], [V(max.x, min.y, min.z), V(max.x, min.y - off - tick, min.z)], fx(max.x - min.x));
  // l (Y) : à droite, au sol
  dim(V(max.x + off, min.y, min.z), V(max.x + off, max.y, min.z),
      [V(max.x, min.y, min.z), V(max.x + off + tick, min.y, min.z)], [V(max.x, max.y, min.z), V(max.x + off + tick, max.y, min.z)], fx(max.y - min.y));
  // h (Z) : coin arrière droit, la cote monte en s'éloignant du regard
  dim(V(max.x + off, max.y + off, min.z), V(max.x + off, max.y + off, max.z),
      [V(max.x, max.y, min.z), V(max.x + off + tick, max.y + off + tick, min.z)], [V(max.x, max.y, max.z), V(max.x + off + tick, max.y + off + tick, max.z)], fx(max.z - min.z));
  const geo = new THREE.BufferGeometry().setFromPoints(segs);
  g.add(new THREE.LineSegments(geo, mat));
  // arêtes de la boîte englobante, discrètes
  const bb = new THREE.Box3Helper(box, 0x1f4e9a); bb.material.transparent = true; bb.material.opacity = 0.35; g.add(bb);
  return g;
}

/* ------------------------------------------------------------------------ */
/*  Vues, drapeaux d'affichage                                                */
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
  if (state.flags.measure) hint("Mesure : cliquez deux points sur la pièce. Échap pour quitter."); else if (!state.flags.clip) hint(null);
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
  if (state.flags.clip) hint("Coupe : déplacez le curseur pour traverser la pièce. P pour quitter.");
}

/* ------------------------------------------------------------------------ */
/*  Mesure                                                                   */
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
/*  Panneau latéral                                                          */
/* ------------------------------------------------------------------------ */
function fillPanel(m) {
  const a = m.payload.analysis;
  $("#file-name").textContent = m.payload.name;
  $("#file-meta").textContent = `${fmtBytes(m.payload.size_bytes)} · ${a.pieces} pièce${a.pieces > 1 ? "s" : ""} · ${a.triangles.toLocaleString("fr-FR")} triangles`;

  const w = $("#warnings"); w.innerHTML = "";
  const warns = [...a.avertissements];
  if (m.payload.overlaps?.length) warns.push(`${m.payload.overlaps.length} chevauchement(s) d'encombrement entre pièces : ${m.payload.overlaps.slice(0, 4).map(([x, y]) => `${x} ↔ ${y}`).join(", ")}`);
  warns.forEach((t) => { const d = document.createElement("div"); d.className = "warn"; d.textContent = t; w.appendChild(d); });

  const [L, l, h] = a.dimensions_mm;
  $("#dims").innerHTML = [["X", L], ["Y", l], ["Z", h]].map(([ax, v]) => `<div class="dim-cell"><div class="axis">${ax}</div><div class="val">${fmt(v)}<small>mm</small></div></div>`).join("");
  const [Lo, lo, ho] = a.dimensions_orientees_mm;
  $("#dims-oriented").textContent = `Encombrement orienté minimal : ${fmt(Lo)} × ${fmt(lo)} × ${fmt(ho)} mm`;

  const sel = $("#material");
  sel.innerHTML = `<option value="">— aucun —</option>` + Object.entries(state.materials).map(([k, v]) => `<option value="${k}">${k} (${v})</option>`).join("");
  sel.value = m.material; $("#density").value = m.density;
  renderFacts(m);

  $("#parts-count").textContent = `(${a.pieces})`;
  const ul = $("#parts"); ul.innerHTML = "";
  a.details.forEach((p) => {
    const mesh = m.parts.get(p.nom), color = mesh ? `#${mesh.userData.baseColor.toString(16).padStart(6, "0")}` : "#999";
    const li = document.createElement("li"); li.className = "part" + (p.etanche ? "" : " open-mesh"); li.dataset.name = p.nom;
    li.innerHTML = `<input type="checkbox" ${mesh?.visible === false ? "" : "checked"} aria-label="Afficher ${p.nom}"><span class="sw" style="background:${color}"></span><span class="nm" title="${p.nom}">${p.nom}</span><span class="dm">${p.dimensions_mm.map(fmt).join(" × ")}</span>`;
    li.querySelector("input").addEventListener("change", (e) => { if (mesh) mesh.visible = e.target.checked; });
    li.querySelector(".nm").addEventListener("click", () => focusPart(p.nom, m, false));
    ul.appendChild(li);
  });

  renderCompareSelect(m);
  const pal = $("#fit-pallet"); if (!pal.options.length) pal.innerHTML = Object.keys(state.pallets).map((k) => `<option ${k === "euro" ? "selected" : ""}>${k}</option>`).join("");
  computeFit();
  renderDownloads(m);
}

function renderFacts(m) {
  const a = m.payload.analysis, dens = density(m);
  const mass = dens && a.volume_matiere_cm3 ? a.volume_matiere_cm3 * dens : null;
  const rows = [
    ["Volume matière", `${fmt(a.volume_matiere_cm3)} cm³`],
    ["Volume englobant", `${fmt(a.volume_englobant_cm3)} cm³`],
    ["Taux de remplissage", `${fmt(a.taux_remplissage_pct, 1)} %`],
    ["Surface", `${fmt(a.surface_cm2)} cm²`],
    ["Masse estimée", mass != null ? `${fmt(mass, 1)} g` : "—"],
  ];
  const thick = a.details.map((d) => d.epaisseur_mm_estimee).filter(Boolean);
  if (thick.length) rows.push(["Épaisseur de paroi estimée", `${thick.map((t) => fmt(t)).join(" / ")} mm`]);
  $("#facts").innerHTML = rows.map(([k, v], i) => `<dt>${k}</dt><dd class="${i === 4 ? "strong" : ""}">${v}</dd>`).join("");
  m.mass_g = mass;
}

function density(m) { const d = parseFloat(m.density); if (d > 0) return d; return state.materials[m.material] || null; }

function focusPart(name, m, fromViewport) {
  document.querySelectorAll(".part").forEach((li) => li.classList.toggle("focus", li.dataset.name === name));
  m.parts.forEach((mesh, n) => mesh.material.emissive.setHex(n === name ? 0x333333 : 0x000000));
  const li = document.querySelector(`.part[data-name="${CSS.escape(name)}"]`);
  if (fromViewport) li?.scrollIntoView({ block: "nearest" });
  const d = m.payload.analysis.details.find((p) => p.nom === name);
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
    if (!res.ok) throw new Error((await res.json()).detail || "Calcul impossible");
    const r = await res.json(), c = r.carton, p = r.pallet;
    $("#fit-result").innerHTML = `
      <div class="fit-cell"><div class="k">Unités par carton</div><div class="v">${c.quantite} <small>${c.par_axe.join(" × ")}</small></div></div>
      <div class="fit-cell"><div class="k">Occupation du carton</div><div class="v">${fmt(c.taux_occupation_pct, 1)} %</div></div>
      <div class="fit-cell"><div class="k">Cartons par palette</div><div class="v">${p.quantite} <small>${p.par_axe.join(" × ")}</small></div></div>
      <div class="fit-cell"><div class="k">Unités par palette</div><div class="v">${r.units_per_pallet.toLocaleString("fr-FR")}</div></div>
      <div class="fit-note">Unité posée en ${c.orientation_mm.map(fmt).join(" × ")} mm${r.mass_per_carton_kg ? ` · ${r.mass_per_carton_kg} kg de produit par carton, ${r.mass_per_pallet_kg} kg par palette` : ""}.</div>`;
  } catch (err) { $("#fit-result").innerHTML = `<div class="fit-note">${err.message}</div>`; }
}

function renderDownloads(m) {
  const q = m.material ? `?material=${encodeURIComponent(m.material)}` : (parseFloat(m.density) > 0 ? `?density=${m.density}` : "");
  const base = `/api/models/${m.payload.id}`;
  const items = [["Rapport HTML (3D intégrée)", `${base}/report.html${q}`], ["Analyse JSON", `${base}/analysis.json${q}`],
    ...["stl", "obj", "glb", "3mf"].map((e) => [e.toUpperCase(), `${base}/export.${e}`])];
  $("#downloads").innerHTML = items.map(([t, u]) => `<a class="dl" href="${u}" download>${t}</a>`).join("");
}

/* ------------------------------------------------------------------------ */
/*  Comparaison de deux révisions                                             */
/* ------------------------------------------------------------------------ */
function renderCompareSelect(m) {
  const block = $("#compare-block"), sel = $("#compare");
  const others = [...state.models.values()].filter((x) => x.payload.id !== m.payload.id);
  block.hidden = others.length === 0;
  sel.innerHTML = `<option value="">— aucune —</option>` + others.map((x) => `<option value="${x.payload.id}">${x.payload.name}</option>`).join("");
  sel.value = others.some((x) => x.payload.id === m.compareWith) ? m.compareWith : "";
  applyCompare(m);
}

function applyCompare(m) {
  compareRoot.clear();
  const ref = m.compareWith ? state.models.get(m.compareWith) : null;
  const out = $("#compare-result");
  if (!ref) { out.innerHTML = ""; return; }
  // Superposition fantôme de la référence
  const ghost = ref.group.clone(true);
  ghost.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name.endsWith("__inner")) { o.visible = false; return; }
    o.material = new THREE.MeshStandardMaterial({ color: 0xd1495b, transparent: true, opacity: 0.38, depthWrite: false,
      flatShading: true, side: THREE.DoubleSide, clippingPlanes: state.flags.clip ? [state.clip.plane] : [] });
  });
  compareRoot.add(ghost);
  // Tableau des écarts
  const a = m.payload.analysis, b = ref.payload.analysis;
  const rows = [
    ["X (mm)", a.dimensions_mm[0], b.dimensions_mm[0]], ["Y (mm)", a.dimensions_mm[1], b.dimensions_mm[1]], ["Z (mm)", a.dimensions_mm[2], b.dimensions_mm[2]],
    ["Volume matière (cm³)", a.volume_matiere_cm3, b.volume_matiere_cm3], ["Surface (cm²)", a.surface_cm2, b.surface_cm2], ["Pièces", a.pieces, b.pieces],
  ];
  const cell = (v, r) => { const d = v - r, cls = Math.abs(d) < 0.005 ? "" : d > 0 ? " plus" : " minus"; return `<td class="delta${cls}">${d > 0 ? "+" : ""}${fmt(d)}</td>`; };
  out.innerHTML = `<table><tr><th></th><td>${m.payload.name.length > 18 ? "actuel" : m.payload.name}</td><td>référence</td><td>écart</td></tr>` +
    rows.map(([k, v, r]) => `<tr><th>${k}</th><td>${fmt(v)}</td><td>${fmt(r)}</td>${cell(v, r)}</td></tr>`).join("") + `</table>
    <div class="compare-legend"><i style="background:#3b6fb6"></i>actuel &nbsp; <i style="background:#d1495b;opacity:.6"></i>référence en superposition</div>`;
}

/* ------------------------------------------------------------------------ */
/*  Onglets des fichiers ouverts                                              */
/* ------------------------------------------------------------------------ */
function addTab(payload) {
  const b = document.createElement("div"); b.className = "model-tab"; b.dataset.id = payload.id; b.setAttribute("role", "button"); b.tabIndex = 0;
  b.innerHTML = `<span title="${payload.name}">${payload.name}</span><button class="x" title="Fermer" aria-label="Fermer ${payload.name}">×</button>`;
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
/*  Capture                                                                  */
/* ------------------------------------------------------------------------ */
function screenshot() {
  const m = cur(); if (!m) return;
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.href = renderer.domElement.toDataURL("image/png");
  a.download = `${m.payload.name.replace(/\.(step|stp)$/i, "")}_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  a.click(); toast("Capture enregistrée (les étiquettes de cotes ne sont pas incluses).");
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
/*  Utilitaires                                                              */
/* ------------------------------------------------------------------------ */
function cur() { return state.current ? state.models.get(state.current) : null; }
function fmt(v, d = 2) { return Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d }); }
function fmtBytes(b) { return b < 1048576 ? `${(b / 1024).toFixed(0)} Ko` : `${(b / 1048576).toFixed(1)} Mo`; }
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
