import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import occtimportjs from "occt-import-js";
import { analysePart, analyseModel, weldVertices } from "./engine.js";

const PALETTE = [0x3b6fb6, 0x6aa84f, 0x8e63b5, 0xec8f2a, 0x30a5b8, 0x7f7f7f, 0xc9a227, 0x1f8a70, 0xb85c38, 0xd1495b];
const INNER = 0xc08a3e;
const $ = (s) => document.querySelector(s);
const el = {
  viewport: $("#viewport"), drop: $("#drop"), loading: $("#loading"), loadingText: $("#loading-text"), views: $("#views"), hint: $("#hint"),
  fileInput: $("#file-input"), toast: $("#toast"), cutOn: $("#cut-on"), az: $("#az"), el: $("#el"), pos: $("#pos"),
  azOut: $("#az-out"), elOut: $("#el-out"), posOut: $("#pos-out"), showPlane: $("#show-plane"),
  answer: $("#answer"), aiQ: $("#ai-q"), btnAi: $("#btn-ai"), btnStop: $("#btn-stop"), follow: $("#follow"), aiFollow: $("#ai-follow"), aiNote: $("#ai-note"),
};
const state = { model: null, cut: { on: false, az: 0, el: 0, pos: 0.5, flip: false }, plane: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0), turns: [], ctl: null, cuts: [], activeCut: null };

/* ---------------- STEP reader (embedded WebAssembly) ---------------- */
let occtPromise = null;
function getOcct() {
  if (occtPromise) return occtPromise;
  occtPromise = (async () => {
    const b64 = document.getElementById("occt-wasm").textContent.trim();
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    if (typeof DecompressionStream === "undefined") throw new Error("Browser too old: requires Chrome/Edge 80+, Firefox 113+ or Safari 16.4+.");
    const wasmBinary = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    return occtimportjs({ wasmBinary });
  })();
  occtPromise.catch(() => { occtPromise = null; });
  return occtPromise;
}

async function parseStep(file) {
  el.loadingText.textContent = "Initializing STEP reader…";
  const occt = await getOcct();
  el.loadingText.textContent = `Reading ${file.name}…`;
  await new Promise((r) => setTimeout(r, 30));
  const buf = new Uint8Array(await file.arrayBuffer());
  const res = occt.ReadStepFile(buf, { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.001, angularDeflection: 0.3 });
  if (!res.success || !res.meshes.length) throw new Error(`${file.name}: unreadable STEP file or no solid.`);
  const used = new Map(), parts = [], group = new THREE.Group(), meshes = [];
  res.meshes.forEach((m, i) => {
    const baseName = (m.name || "part").slice(0, 60);
    let name = baseName;
    used.set(name, (used.get(name) || 0) + 1); if (used.get(name) > 1) name = `${name}_${used.get(name)}`;
    const pos = new Float32Array(m.attributes.position.array), idx = new Uint32Array(m.index.array);
    const w = weldVertices(pos, idx); const pa = analysePart(name, w.pos, w.idx); parts.push(pa);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    if (m.attributes.normal) geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(m.attributes.normal.array), 3)); else geo.computeVertexNormals();
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const stepColor = m.color ? new THREE.Color(m.color[0], m.color[1], m.color[2]) : null;
    const color = stepColor ? stepColor.getHex() : PALETTE[i % PALETTE.length];
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.55, side: THREE.DoubleSide, clippingPlanes: [] }));
    const inner = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: INNER, roughness: 0.9, side: THREE.BackSide, clippingPlanes: [] }));
    inner.visible = false; mesh.add(inner); mesh.userData.inner = inner; mesh.name = name;
    mesh.userData.meshIndex = i; mesh.userData.baseName = baseName; mesh.userData.instanceIndex = used.get(baseName); mesh.userData.baseColor = color; mesh.userData.stepColor = !!stepColor;
    mesh.userData.faces = (m.brep_faces || []).map((f) => ({ first: f.first, last: f.last }));
    mesh.userData.signature = `${baseName}|${idx.length}|${Math.round(pa.surface_cm2 * 100)}`;
    mesh.userData.analysis = pa;
    group.add(mesh); meshes.push(mesh);
  });
  return { analysis: analyseModel(file.name, parts), group, meshes, root: res.root };
}

/* ---------------- assembly tree ---------------- */
let nodeSeq = 0;
function makeNode(name, kind) { return { id: `n${++nodeSeq}`, name, kind, children: [], mesh: null, parent: null, open: true }; }

function buildTreeFromStep(root, meshes) {
  // Original STEP tree: assemblies -> sub-assemblies -> parts (one leaf per mesh).
  const seen = new Set();
  const build = (n, depth) => {
    const node = makeNode((n.name || (depth === 0 ? "Assembly" : "Group")).slice(0, 60), "assembly");
    (n.meshes || []).forEach((mi) => { const mesh = meshes[mi]; if (!mesh || seen.has(mi)) return; seen.add(mi); node.children.push(leafFor(mesh, node)); });
    (n.children || []).forEach((c) => { const child = build(c, depth + 1); if (child.children.length) { child.parent = node; node.children.push(child); } });
    return node;
  };
  let tree = build(root, 0);
  meshes.forEach((mesh, mi) => { if (!seen.has(mi)) tree.children.push(leafFor(mesh, tree)); });
  // Hoist empty levels (unnamed root containing a single assembly)
  while (tree.children.length === 1 && tree.children[0].kind === "assembly") { tree = tree.children[0]; tree.parent = null; }
  return tree;
}
function leafFor(mesh, parent) { const n = makeNode(mesh.name, "part"); n.mesh = mesh; n.parent = parent; mesh.userData.node = n; return n; }

function groupMeshes(meshes, mode) {
  // Automatic groupings for poorly-structured STEP files.
  const root = makeNode(state.model.name.replace(/\.(step|stp)$/i, ""), "assembly");
  const groups = new Map();
  const keyOf = (mesh) => {
    const a = mesh.userData.analysis;
    if (mode === "color") return `#${mesh.userData.baseColor.toString(16).padStart(6, "0")}`;
    if (mode === "name") { const n = mesh.userData.baseName; const m = n.match(/^([A-Za-z]+)/); return m ? m[1] : n.split(/[-_ .]/)[0] || n; }
    if (mode === "volume") { const vmax = Math.max(...meshes.map((x) => x.userData.analysis.volume_cm3 || 0)) || 1; const v = (a.volume_cm3 || 0) / vmax; return v > 0.1 ? "Main parts (>10% of largest volume)" : v > 0.01 ? "Medium parts (1 to 10%)" : "Small parts (<1%)"; }
    if (mode === "contact") { const big = state.model.biggest; if (mesh === big) return "Main part"; const b = big.userData.analysis, c = a; const touch = [0, 1, 2].every((k) => c.min[k] <= b.max[k] + 0.5 && b.min[k] <= c.max[k] + 0.5); return touch ? "In contact with main part" : "Not in contact with main part"; }
    return "Parts";
  };
  meshes.forEach((mesh) => { const k = keyOf(mesh); if (!groups.has(k)) { const g = makeNode(k, "assembly"); g.parent = root; groups.set(k, g); root.children.push(g); } groups.get(k).children.push(leafFor(mesh, groups.get(k))); });
  if (mode === "color") root.children.forEach((g) => { const first = g.children[0].mesh; g.name = `Colour ${g.name}${first.userData.stepColor ? "" : " (assigned)"}`; g.color = first.userData.baseColor; });
  root.children.sort((a, b) => aggregate(b).volume - aggregate(a).volume);
  return root;
}

function aggregate(node) {
  if (node.kind === "part") { const a = node.mesh.userData.analysis; return { min: a.min, max: a.max, volume: a.volume_cm3 || 0, count: 1, closed: a.watertight }; }
  const acc = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], volume: 0, count: 0, closed: true };
  node.children.forEach((c) => { const r = aggregate(c); for (let k = 0; k < 3; k++) { acc.min[k] = Math.min(acc.min[k], r.min[k]); acc.max[k] = Math.max(acc.max[k], r.max[k]); } acc.volume += r.volume; acc.count += r.count; acc.closed = acc.closed && r.closed; });
  return acc;
}
function nodeDims(node) { const a = aggregate(node); return [0, 1, 2].map((k) => a.max[k] - a.min[k]); }
function displayName(node) {
  if (node.kind !== "part") return state.model.renames[node.name] || node.name;
  const u = node.mesh.userData;
  return state.model.renames[node.mesh.name] || (u.instanceIndex > 1 ? `${u.baseName} #${u.instanceIndex}` : u.baseName);
}
function nodePath(node) { const p = []; for (let n = node; n; n = n.parent) p.unshift(displayName(n)); return p.join(" > "); }
function partsOf(node, out = []) { if (node.kind === "part") out.push(node.mesh); node.children.forEach((c) => partsOf(c, out)); return out; }
function nodeVisible(node) { const ps = partsOf(node); return ps.every((m) => m.visible) ? true : ps.some((m) => m.visible) ? "mixed" : false; }

function rebuildTree(mode) {
  const m = state.model; m.treeMode = mode;
  m.tree = mode === "file" ? buildTreeFromStep(m.root, m.meshes) : groupMeshes(m.meshes, mode);
  renderTree();
}

function renderTree() {
  const m = state.model, ul = $("#tree"); ul.innerHTML = "";
  const instances = new Map(); m.meshes.forEach((x) => instances.set(x.userData.signature, (instances.get(x.userData.signature) || 0) + 1));
  const render = (node, depth, parentUl) => {
    const li = document.createElement("li"); li.className = `tnode ${node.kind}` + (node === m.selected ? " selected" : ""); li.dataset.id = node.id;
    const agg = aggregate(node), d = [0, 1, 2].map((k) => agg.max[k] - agg.min[k]);
    const vis = nodeVisible(node);
    const badge = node.kind === "part" && instances.get(node.mesh.userData.signature) > 1 ? `<span class="inst" title="Part instantiated ${instances.get(node.mesh.userData.signature)} times">×${instances.get(node.mesh.userData.signature)}</span>` : "";
    const sw = node.kind === "part" ? `<span class="sw" style="background:#${node.mesh.userData.baseColor.toString(16).padStart(6, "0")}"></span>` : node.color != null ? `<span class="sw" style="background:#${node.color.toString(16).padStart(6, "0")}"></span>` : "";
    const caret = node.kind === "assembly" ? `<button class="caret" aria-label="${node.open ? "Collapse" : "Expand"}">${node.open ? "▾" : "▸"}</button>` : `<span class="caret"></span>`;
    li.innerHTML = `<div class="trow" style="padding-left:${depth * 14}px">${caret}<input type="checkbox" ${vis === true ? "checked" : ""} aria-label="Show ${esc(displayName(node))}">${sw}<span class="tname" title="Double-click to rename">${esc(displayName(node))}</span>${badge}<span class="tmeta">${node.kind === "assembly" ? `${agg.count} pt · ` : ""}${d.map((x) => fmt(x, 1)).join(" × ")}${agg.volume ? ` · ${fmt(agg.volume, 1)} cm³` : ""}${agg.closed ? "" : " · open"}</span></div>`;
    const cb = li.querySelector("input"); cb.indeterminate = vis === "mixed";
    cb.addEventListener("change", (e) => { partsOf(node).forEach((x) => { x.visible = e.target.checked; }); renderTree(); });
    li.querySelector(".caret").addEventListener?.("click", (e) => { if (node.kind === "assembly") { node.open = !node.open; renderTree(); } e.stopPropagation(); });
    li.querySelector(".tname").addEventListener("click", () => selectNode(node, true));
    li.querySelector(".tname").addEventListener("dblclick", () => renameNode(node));
    parentUl.appendChild(li);
    if (node.kind === "assembly" && node.open) { const sub = document.createElement("ul"); sub.className = "tchildren"; li.appendChild(sub); node.children.forEach((c) => render(c, depth + 1, sub)); }
  };
  render(m.tree, 0, ul);
}

function renameNode(node) {
  const current = displayName(node), name = prompt("New name:", current);
  if (name === null) return; const key = node.kind === "part" ? node.mesh.name : node.name;
  if (name.trim() && name.trim() !== node.name) state.model.renames[key] = name.trim(); else delete state.model.renames[key];
  persistRenames(); renderTree();
}
function persistRenames() { try { localStorage.setItem(`renames:${state.model.name}`, JSON.stringify(state.model.renames)); } catch { /* ignore */ } }
function loadRenames(name) { try { return JSON.parse(localStorage.getItem(`renames:${name}`) || "{}"); } catch { return {}; } }

function selectNode(node, frame) {
  const m = state.model; m.selected = node;
  const parts = new Set(partsOf(node));
  m.meshes.forEach((x) => x.material.emissive.setHex(parts.has(x) ? 0x3a3a3a : 0));
  for (let n = node.parent; n; n = n.parent) n.open = true;
  renderTree();
  document.querySelector(`.tnode[data-id="${node.id}"] .trow`)?.scrollIntoView({ block: "nearest" });
  const d = nodeDims(node), agg = aggregate(node);
  hint(`${nodePath(node)} — ${d.map((x) => fmt(x, 1)).join(" × ")} mm${agg.volume ? ` · ${fmt(agg.volume, 1)} cm³` : ""}`);
  if (frame) {
    const box = new THREE.Box3(new THREE.Vector3(...agg.min), new THREE.Vector3(...agg.max));
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z, 1) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.8 + size.length() * 0.3;
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(c).addScaledVector(dir, r); controls.target.copy(c); controls.update();
  }
}
function clearSelection() { const m = state.model; if (!m) return; m.selected = null; m.meshes.forEach((x) => x.material.emissive.setHex(0)); renderTree(); if (!state.cut.on) hint(null); }

/* ---------------- hover: B-rep face identification ---------------- */
const faceHighlight = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.55, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide, clippingPlanes: [] }));
faceHighlight.visible = false; faceHighlight.renderOrder = 5;
const faceLabelDiv = document.createElement("div"); faceLabelDiv.className = "lbl face";
const faceLabel = new CSS2DObject(faceLabelDiv); faceLabel.visible = false;
let hover = { mesh: null, face: -1 };
function faceOf(mesh, triIndex) { const faces = mesh.userData.faces; for (let i = 0; i < faces.length; i++) if (triIndex >= faces.at(i).first && triIndex <= faces.at(i).last) return i; return -1; }
function showFace(mesh, fi, point) {
  const f = mesh.userData.faces[fi]; const idx = mesh.geometry.index.array.subarray(f.first * 3, (f.last + 1) * 3);
  const g = faceHighlight.geometry; g.setAttribute("position", mesh.geometry.getAttribute("position")); g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1)); g.computeBoundingSphere();
  faceHighlight.position.copy(mesh.position); faceHighlight.visible = true; faceHighlight.material.clippingPlanes = state.cut.on ? [state.plane] : [];
  faceLabelDiv.textContent = `${displayName(mesh.userData.node)} · face no. ${fi + 1}/${mesh.userData.faces.length}`; faceLabel.position.copy(point); faceLabel.visible = true;
  hover = { mesh, face: fi };
}
function hideFace() { if (!faceHighlight.visible) return; faceHighlight.visible = false; faceLabel.visible = false; hover = { mesh: null, face: -1 }; }
/* ---------------- scene ---------------- */
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.localClippingEnabled = true; renderer.outputColorSpace = THREE.SRGBColorSpace;
el.viewport.appendChild(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
el.viewport.appendChild(labelRenderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000); camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, -1.2, 1.8); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5, 1, 0.6); scene.add(fill);
const modelRoot = new THREE.Group(), helpers = new THREE.Group(); scene.add(modelRoot, helpers, faceHighlight, faceLabel);
let planeHelper = null, grid = null, dims = null;
function resize() { const w = el.viewport.clientWidth, h = el.viewport.clientHeight; if (!w || !h) return; renderer.setSize(w, h); labelRenderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(el.viewport); resize();
(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); labelRenderer.render(scene, camera); })();

/* ---------------- loading ---------------- */
async function handleFiles(files) {
  const f = [...files].find((x) => /\.(step|stp)$/i.test(x.name));
  if (!f) return toast("Drop a .step or .stp file.", true);
  el.loading.hidden = false;
  try {
    const { analysis, group, meshes, root } = await parseStep(f);
    if (state.model) { modelRoot.clear(); helpers.clear(); state.model.meshes.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); }
    group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(group);
    state.model = { name: f.name, size: f.size, analysis, group, meshes, box, root, renames: loadRenames(f.name), selected: null, treeMode: "file" };
    state.model.biggest = meshes.reduce((a, b) => ((b.userData.analysis.volume_cm3 || 0) > (a.userData.analysis.volume_cm3 || 0) ? b : a), meshes[0]);
    hideFace();
    state.turns = []; el.answer.hidden = true; el.follow.hidden = true;
    state.cuts = loadCuts(f.name); state.activeCut = null; renderCuts();
    modelRoot.add(group); buildHelpers(); fillFile(); $("#tree-mode").value = "file"; rebuildTree("file"); applyCut(); setView("iso");
    el.drop.classList.add("minimised"); el.views.hidden = false; el.btnAi.disabled = !sampleFn;
    $("#step-file").classList.add("done"); $("#step-cut").classList.remove("disabled"); $("#step-cut").classList.add("active"); $("#step-ai").classList.remove("disabled");
    resize();
  } catch (err) { toast(err.message || String(err), true); console.error(err); }
  finally { el.loading.hidden = true; }
}

function buildHelpers() {
  const m = state.model, size = m.box.getSize(new THREE.Vector3()), c = m.box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z) || 1, step = niceStep(span / 8), n = Math.ceil((span * 2.5) / step);
  grid = new THREE.GridHelper(n * step, n, 0xb8c0ca, 0xd3d9e0); grid.rotation.x = Math.PI / 2; grid.position.set(c.x, c.y, m.box.min.z - span * 0.002);
  grid.material.transparent = true; grid.material.opacity = 0.9; helpers.add(grid);
  dims = buildDimensions(m.box, span); helpers.add(dims);
  const diag = size.length();
  planeHelper = new THREE.Mesh(new THREE.PlaneGeometry(diag * 1.05, diag * 1.05), new THREE.MeshBasicMaterial({ color: 0xc08a3e, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
  const edge = new THREE.LineSegments(new THREE.EdgesGeometry(planeHelper.geometry), new THREE.LineBasicMaterial({ color: 0xc08a3e, transparent: true, opacity: 0.7 }));
  planeHelper.add(edge); planeHelper.visible = false; helpers.add(planeHelper);
  camera.near = span / 500; camera.far = span * 50; camera.updateProjectionMatrix();
}
function niceStep(x) { const p = 10 ** Math.floor(Math.log10(x)), r = x / p; return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p; }
function buildDimensions(box, span) {
  const g = new THREE.Group(), off = span * 0.08, tick = span * 0.012, { min, max } = box, V = (x, y, z) => new THREE.Vector3(x, y, z), segs = [];
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

function fillFile() {
  const m = state.model, a = m.analysis;
  $("#file-name").textContent = m.name;
  $("#file-meta").textContent = `${(m.size / 1024).toFixed(0)} KB · ${a.parts} part${a.parts > 1 ? "s" : ""} · material volume ${fmt(a.material_volume_cm3)} cm³`;
  $("#dims").innerHTML = ["X", "Y", "Z"].map((ax, i) => `<div class="dim-cell"><div class="axis">${ax}</div><div class="val">${fmt(a.dimensions_mm[i])}<small>mm</small></div></div>`).join("");
  $("#warnings").innerHTML = a.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("");
}

/* ---------------- mouse: face hover, click = selection ---------------- */
const raycaster = new THREE.Raycaster(); let downPos = null;
function pick(e) {
  const m = state.model; if (!m) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(m.meshes.filter((x) => x.visible), false).filter((h) => !state.cut.on || state.plane.distanceToPoint(h.point) >= -1e-6);
  return hits[0] || null;
}
renderer.domElement.addEventListener("pointermove", (e) => {
  if (downPos) return; const h = pick(e);
  if (!h) { hideFace(); return; }
  const fi = faceOf(h.object, h.faceIndex);
  if (fi < 0) { hideFace(); return; }
  if (hover.mesh !== h.object || hover.face !== fi) showFace(h.object, fi, h.point); else faceLabel.position.copy(h.point);
});
renderer.domElement.addEventListener("pointerleave", hideFace);
renderer.domElement.addEventListener("pointerdown", (e) => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  const moved = !downPos || Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 4; downPos = null;
  if (moved || e.button !== 0) return;
  const h = pick(e);
  if (!h) { clearSelection(); return; }
  const fi = faceOf(h.object, h.faceIndex);
  selectNode(h.object.userData.node, false);
  if (fi >= 0) { state.model.selectedFace = { mesh: h.object, face: fi }; hint(`${nodePath(h.object.userData.node)} · face no. ${fi + 1} — ${h.object.userData.analysis.dimensions_mm.map((x) => fmt(x, 1)).join(" × ")} mm`); }
});

/* ---------------- free-angle section ---------------- */
function cutNormal() {
  const az = THREE.MathUtils.degToRad(state.cut.az), e = THREE.MathUtils.degToRad(state.cut.el);
  return new THREE.Vector3(Math.cos(e) * Math.cos(az), Math.cos(e) * Math.sin(az), Math.sin(e));
}
function cutRange(n) {
  const b = state.model.box; let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 8; i++) { const p = new THREE.Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z); const d = p.dot(n); lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return [lo, hi];
}
function applyCut() {
  if (!state.model) return;
  const n = cutNormal(), [lo, hi] = cutRange(n), d = lo + (hi - lo) * state.cut.pos;
  // We keep the side n·p <= d (or the reverse)
  state.plane.normal.copy(state.cut.flip ? n : n.clone().negate());
  state.plane.constant = state.cut.flip ? -d : d;
  const planes = state.cut.on ? [state.plane] : [];
  state.model.meshes.forEach((mesh) => {
    mesh.material.clippingPlanes = planes; mesh.material.side = state.cut.on ? THREE.FrontSide : THREE.DoubleSide; mesh.material.needsUpdate = true;
    mesh.userData.inner.visible = state.cut.on; mesh.userData.inner.material.clippingPlanes = planes; mesh.userData.inner.material.needsUpdate = true;
  });
  if (planeHelper) {
    planeHelper.visible = state.cut.on && el.showPlane.checked;
    const c = state.model.box.getCenter(new THREE.Vector3());
    planeHelper.position.copy(c).addScaledVector(n, d - c.dot(n));
    planeHelper.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  }
  el.azOut.textContent = `${state.cut.az}°`; el.elOut.textContent = `${state.cut.el}°`; el.posOut.textContent = `${Math.round(state.cut.pos * 100)} % (${fmt(d)} mm)`;
  el.cutOn.checked = state.cut.on;
  if (state.activeCut !== null && !sameCut(state.cuts[state.activeCut])) { state.activeCut = null; renderCuts(); }
  document.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(presetFor() === b.dataset.preset)));
  hint(state.cut.on ? `Section: azimuth ${state.cut.az}°, elevation ${state.cut.el}°, position ${Math.round(state.cut.pos * 100)} %` : null);
}
function presetFor() { const { az, el: e } = state.cut; if (e === 90 || e === -90) return "z"; if (e === 0 && (az === 0 || az === 180)) return "x"; if (e === 0 && (az === 90 || az === 270)) return "y"; return null; }
function setView(name) {
  const m = state.model; if (!m) return;
  const c = m.box.getCenter(new THREE.Vector3()), size = m.box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.75 + size.length() * 0.3;
  let dir;
  if (name === "normal") { dir = cutNormal(); if (state.cut.flip) dir.negate(); } // from the removed side, facing the section
  else dir = new THREE.Vector3(...({ iso: [1, -1, 0.8], top: [0, 0, 1], front: [0, -1, 0], side: [1, 0, 0] }[name] || [1, -1, 0.8])).normalize();
  camera.position.copy(c).addScaledVector(dir, r); controls.target.copy(c); controls.update();
}

/* ---------------- saved sections ---------------- */
const storeKey = (name) => `sections:${name}`;
function loadCuts(name) { try { const v = localStorage.getItem(storeKey(name)); return v ? JSON.parse(v).map((c) => ({ include: true, ...c })) : []; } catch { return []; } }
function persistCuts() { try { localStorage.setItem(storeKey(state.model.name), JSON.stringify(state.cuts.map(({ include, ...c }) => c))); } catch { /* storage unavailable: the list lives in memory */ } }
function sameCut(c) { return c && c.az === state.cut.az && c.el === state.cut.el && Math.abs(c.pos - state.cut.pos) < 1e-6 && c.flip === state.cut.flip; }
function cutLabel(c) { return `azimuth ${c.az}° · elevation ${c.el}° · ${Math.round(c.pos * 100)} %${c.flip ? " · flipped" : ""}`; }

function saveCut(name) {
  const c = { name, az: state.cut.az, el: state.cut.el, pos: state.cut.pos, flip: state.cut.flip,
    camera: { p: camera.position.toArray(), t: controls.target.toArray() }, hidden: state.model.meshes.filter((x) => !x.visible).map((x) => x.name), include: true };
  const i = state.cuts.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) state.cuts[i] = c; else state.cuts.push(c);
  state.activeCut = i >= 0 ? i : state.cuts.length - 1; state.cut.on = true;
  persistCuts(); renderCuts(); applyCut(); toast(`Section "${name}" saved.`);
}
function restoreCut(i, moveCamera = true) {
  const c = state.cuts[i]; if (!c) return;
  Object.assign(state.cut, { on: true, az: c.az, el: c.el, pos: c.pos, flip: c.flip });
  el.az.value = c.az; el.el.value = c.el; el.pos.value = c.pos; state.activeCut = i;
  if (moveCamera && c.camera) { camera.position.fromArray(c.camera.p); controls.target.fromArray(c.camera.t); controls.update(); }
  if (c.hidden) { state.model.meshes.forEach((x) => { x.visible = !c.hidden.includes(x.name); }); renderTree(); }
  applyCut(); renderCuts();
}
function deleteCut(i) { state.cuts.splice(i, 1); if (state.activeCut === i) state.activeCut = null; else if (state.activeCut > i) state.activeCut--; persistCuts(); renderCuts(); }
function renderCuts() {
  const ul = $("#cuts"); ul.innerHTML = "";
  state.cuts.forEach((c, i) => {
    const li = document.createElement("li"); li.className = "cut" + (state.activeCut === i ? " active" : "");
    li.innerHTML = `<span class="num-badge">${i + 1}</span><span class="name" title="Recall this section">${esc(c.name)}</span>
      <input type="checkbox" ${c.include ? "checked" : ""} title="Include in series analysis" aria-label="Include ${esc(c.name)} in analysis">
      <button class="act del" title="Delete" aria-label="Delete ${esc(c.name)}">×</button><span class="params">${cutLabel(c)}</span>`;
    li.querySelector(".name").addEventListener("click", () => restoreCut(i));
    li.querySelector(".params").addEventListener("click", () => restoreCut(i));
    li.querySelector("input").addEventListener("change", (e) => { c.include = e.target.checked; updateSeriesButton(); });
    li.querySelector(".del").addEventListener("click", () => deleteCut(i));
    ul.appendChild(li);
  });
  updateSeriesButton();
}
function updateSeriesButton() {
  const n = state.cuts.filter((c) => c.include).length, b = $("#btn-ai-series");
  b.hidden = n === 0 || !sampleFn; b.textContent = `Analyse series (${n} section${n > 1 ? "s" : ""})`; b.disabled = !state.model;
}
$("#save-form").addEventListener("submit", (e) => {
  e.preventDefault(); const name = $("#save-name").value.trim(); if (!name) return;
  if (!state.cut.on) { state.cut.on = true; applyCut(); }
  saveCut(name); $("#save-name").value = "";
});

/* ---------------- AI ---------------- */
let sampleFn = null, imageLimits = null;
(async () => {
  try {
    if (!window.claude?.use) throw new Error("outside claude.ai");
    sampleFn = await window.claude.use("sample");
    if (!sampleFn) throw new Error("unavailable");
    imageLimits = (await sampleFn.limits().catch(() => null))?.images || null;
    if (!imageLimits) el.aiNote.textContent = "Sends the measurements and section description (images unavailable in this view).";
    el.btnAi.disabled = !state.model; updateSeriesButton();
  } catch { $("#ai-unavailable").hidden = false; $("#ai-box").hidden = true; }
})();

async function captureBlob(withCut) {
  const prev = state.cut.on; state.cut.on = withCut; applyCut();
  const helpersVisible = planeHelper?.visible; if (planeHelper) planeHelper.visible = false; hideFace();
  renderer.render(scene, camera);
  const blob = await new Promise((r) => renderer.domElement.toBlob(r, "image/png"));
  state.cut.on = prev; applyCut(); if (planeHelper) planeHelper.visible = helpersVisible;
  return blob;
}

function contextText(seriesMode = false) {
  const m = state.model, a = m.analysis, n = cutNormal(), [lo, hi] = cutRange(n);
  const parts = treeText();
  const hiddenNow = m.meshes.filter((x) => !x.visible).map((x) => displayName(x.userData.node));
  const sel = m.selected ? `Element selected by user: ${nodePath(m.selected)}${m.selectedFace && m.selected === m.selectedFace.mesh.userData.node ? ` (face no. ${m.selectedFace.face + 1})` : ""}.` : "";
  const cut = state.cut.on
    ? `Active section plane: normal (azimuth ${state.cut.az}°, elevation ${state.cut.el}°) = (${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)}), position ${Math.round(state.cut.pos * 100)} % of range (${fmt(lo)} → ${fmt(hi)} mm), ${state.cut.flip ? "positive" : "negative"} side kept. In the image, the cut material appears ochre/orange, outer surfaces in blue.`
    : "No active section: the part is shown in full.";
  return `You are a senior packaging engineer. Analyse a part from a CAD STEP file, read and meshed in the browser.
File: ${m.name}
Overall X × Y × Z: ${a.dimensions_mm.join(" × ")} mm
Material volume: ${a.material_volume_cm3} cm³ · bounding volume: ${a.bounding_volume_cm3} cm³ · fill rate: ${a.fill_rate_pct} % · surface: ${a.surface_cm2} cm²
Assembly structure (${a.parts} parts, tree "${{ file: "STEP file", color: "by colour", name: "by name", volume: "by volume", contact: "by contact" }[m.treeMode]}", dimensions X × Y × Z) — refer to parts by these names:
${parts}
${hiddenNow.length ? `Parts hidden in current view: ${hiddenNow.join(", ")}.` : ""}
${sel}
${a.warnings.length ? "Alerts: " + a.warnings.join(" | ") : ""}
${cut}
${seriesMode ? "" : imageLimits ? "Attached images: 1) current view with section, 2) same view without section. Blue dimension labels are not in the images." : "No images attached: reason from the data."}
Respond in English, in a structured and concise way (short headings, brief sentences), distinguishing what you observe from what you assume. If information is missing to conclude, say so and suggest the section or measurement to make.`;
}

async function captureSeries() {
  const saved = { cut: { ...state.cut }, p: camera.position.clone(), t: controls.target.clone(), active: state.activeCut, vis: state.model.meshes.map((x) => x.visible) };
  const out = [];
  for (const c of state.cuts.filter((x) => x.include)) {
    Object.assign(state.cut, { on: true, az: c.az, el: c.el, pos: c.pos, flip: c.flip }); applyCut();
    if (c.camera) { camera.position.fromArray(c.camera.p); controls.target.fromArray(c.camera.t); } else setView("normal");
    if (c.hidden) state.model.meshes.forEach((x) => { x.visible = !c.hidden.includes(x.name); });
    controls.update(); camera.updateMatrixWorld();
    out.push({ cut: c, blob: await captureBlob(true) });
  }
  Object.assign(state.cut, saved.cut); camera.position.copy(saved.p); controls.target.copy(saved.t); controls.update(); state.activeCut = saved.active;
  state.model.meshes.forEach((x, i) => { x.visible = saved.vis[i]; }); renderTree(); applyCut(); renderCuts();
  return out;
}

function treeText() {
  const m = state.model, lines = [];
  const instances = new Map(); m.meshes.forEach((x) => instances.set(x.userData.signature, (instances.get(x.userData.signature) || 0) + 1));
  const walk = (node, depth) => {
    const agg = aggregate(node), d = [0, 1, 2].map((k) => fmt(agg.max[k] - agg.min[k], 1)).join(" × ");
    const inst = node.kind === "part" && instances.get(node.mesh.userData.signature) > 1 ? ` [instantiated ×${instances.get(node.mesh.userData.signature)}]` : "";
    const extra = node.kind === "part" ? `${node.mesh.visible ? "" : " [hidden]"}${node.mesh.userData.analysis.wall_thickness_mm ? `, wall ~${node.mesh.userData.analysis.wall_thickness_mm} mm` : ""}${node.mesh.userData.analysis.watertight ? "" : ", open mesh"}, colour #${node.mesh.userData.baseColor.toString(16).padStart(6, "0")}${node.mesh.userData.stepColor ? "" : " (assigned)"}, ${node.mesh.userData.faces.length} faces` : ` (${agg.count} parts)`;
    lines.push(`${"  ".repeat(depth)}- ${displayName(node)}${inst} : ${d} mm${agg.volume ? `, ${fmt(agg.volume, 1)} cm³` : ""}${extra}`);
    node.children.forEach((c) => walk(c, depth + 1));
  };
  walk(m.tree, 0);
  return lines.slice(0, 120).join("\n") + (lines.length > 120 ? `\n  … (${lines.length - 120} lines omitted)` : "");
}

function seriesText(series) {
  const lines = series.map(({ cut: c }, i) => { const n = normalOf(c), [lo, hi] = cutRange(n);
    const hidden = c.hidden?.length ? ` Parts hidden in this image: ${c.hidden.map((h) => state.model.renames[h] || h).join(", ")}.` : "";
    return `Image ${i + 1} — section "${c.name}": normal (azimuth ${c.az}°, elevation ${c.el}°) = (${n.x.toFixed(3)}, ${n.y.toFixed(3)}, ${n.z.toFixed(3)}), position ${Math.round(c.pos * 100)} % of range (${fmt(lo)} → ${fmt(hi)} mm), ${c.flip ? "positive" : "negative"} side kept.${hidden}`; });
  return `Series of ${series.length} sections saved by the user, one image per section, in order:\n${lines.join("\n")}\nIn each image, the cut material appears ochre/orange and outer surfaces in blue. Analyse each section, then provide an overall synthesis of the part (wall thickness consistency, risk areas, recommendations), citing sections by name.`;
}
function normalOf(c) { const az = THREE.MathUtils.degToRad(c.az), e = THREE.MathUtils.degToRad(c.el); return new THREE.Vector3(Math.cos(e) * Math.cos(az), Math.cos(e) * Math.sin(az), Math.sin(e)); }

async function askAI(question, isFollowUp, series = null) {
  if (!sampleFn || !state.model) return;
  state.ctl?.abort(); state.ctl = new AbortController();
  el.btnAi.disabled = true; el.btnStop.hidden = false; el.answer.hidden = false; el.answer.className = "answer thinking"; el.answer.textContent = "Preparing screenshots…";
  try {
    const images = []; let extra = "";
    if (series) {
      let shots = await captureSeries();
      if (imageLimits && shots.length > imageLimits.maxCount) { toast(`Image limit of ${imageLimits.maxCount}: only the first ${imageLimits.maxCount} sections are sent.`); shots = shots.slice(0, imageLimits.maxCount); }
      if (imageLimits) images.push(...shots.map((x) => x.blob));
      extra = "\n\n" + seriesText(shots);
    } else if (imageLimits && !isFollowUp) { images.push(await captureBlob(state.cut.on)); if (state.cut.on && imageLimits.maxCount >= 2) images.push(await captureBlob(false)); }
    el.answer.textContent = "Analysis in progress…";
    if (!isFollowUp) state.turns = [{ role: "user", content: `${contextText(!!series)}${extra}\n\nInstruction: ${question}` }];
    else state.turns.push({ role: "user", content: question });
    const opts = { cache: false, signal: state.ctl.signal, onText: ({ text }) => { el.answer.className = "answer"; el.answer.textContent = text; el.answer.scrollTop = el.answer.scrollHeight; } };
    if (images.length) opts.images = images;
    const { text, truncated } = await sampleFn(state.turns, opts);
    state.turns.push({ role: "assistant", content: text });
    if (truncated) toast("Response cut off: ask a more focused question.");
    el.follow.hidden = false; el.aiFollow.focus();
  } catch (e) {
    if (e.code === "cancelled") { el.answer.textContent = e.text || "Analysis stopped."; }
    else {
      el.answer.className = "answer error";
      const msg = { not_granted: "You have not authorised this page to use Claude.", rate_limited: "Too many requests right now: try again in a few minutes.", image_rejected: "Image rejected: reduce the window size and try again.", refused: "Claude declined this request: rephrase the prompt.", prompt_too_large: "Too much data: the part has too many sub-parts." }[e.code] || `Analysis failed (${e.code || "error"}).`;
      el.answer.textContent = (e.text ? e.text + "\n\n" : "") + msg;
      if (e.code === "not_granted" || e.code === "sampling_disabled") { sampleFn = null; $("#ai-unavailable").hidden = false; $("#ai-box").hidden = true; }
    }
  } finally { el.btnAi.disabled = !sampleFn; el.btnStop.hidden = true; state.ctl = null; updateSeriesButton(); }
}

/* ---------------- events ---------------- */
["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); document.body.classList.add("dragging"); }));
let dlt; document.addEventListener("dragleave", (e) => { e.preventDefault(); clearTimeout(dlt); dlt = setTimeout(() => document.body.classList.remove("dragging"), 80); });
document.addEventListener("drop", (e) => { e.preventDefault(); document.body.classList.remove("dragging"); handleFiles(e.dataTransfer.files); });
$("#btn-open").addEventListener("click", () => el.fileInput.click()); $("#btn-browse").addEventListener("click", () => el.fileInput.click());
el.drop.addEventListener("click", (e) => { if (!el.drop.classList.contains("minimised") && e.target === el.drop) el.fileInput.click(); });
el.fileInput.addEventListener("change", () => { handleFiles(el.fileInput.files); el.fileInput.value = ""; });
el.views.addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
el.cutOn.addEventListener("change", () => { state.cut.on = el.cutOn.checked; applyCut(); });
el.az.addEventListener("input", () => { state.cut.az = +el.az.value; state.cut.on = true; applyCut(); });
el.el.addEventListener("input", () => { state.cut.el = +el.el.value; state.cut.on = true; applyCut(); });
el.pos.addEventListener("input", () => { state.cut.pos = +el.pos.value; state.cut.on = true; applyCut(); });
el.showPlane.addEventListener("change", applyCut);
$("#flip").addEventListener("click", () => { state.cut.flip = !state.cut.flip; state.cut.on = true; applyCut(); });
document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
  const p = { x: [0, 0], y: [90, 0], z: [0, 90] }[b.dataset.preset]; state.cut.az = p[0]; state.cut.el = p[1]; el.az.value = p[0]; el.el.value = p[1]; state.cut.on = true; applyCut();
}));
el.btnAi.addEventListener("click", () => askAI(el.aiQ.value.trim() || "Analyse this section.", false));
$("#btn-ai-series").addEventListener("click", () => askAI(el.aiQ.value.trim() || "Analyse this series of sections.", false, true));
$("#btn-follow").addEventListener("click", () => { const q = el.aiFollow.value.trim(); if (!q) return; el.aiFollow.value = ""; askAI(q, true); });
el.aiFollow.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-follow").click(); });
el.btnStop.addEventListener("click", () => state.ctl?.abort());
$("#btn-shot").addEventListener("click", async () => { if (!state.model) return toast("Open a file first.", true); const b = await captureBlob(state.cut.on); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `${state.model.name.replace(/\.(step|stp)$/i, "")}_section.png`; a.click(); });
$("#tree-mode").addEventListener("change", (e) => { if (state.model) rebuildTree(e.target.value); });
document.addEventListener("keydown", (e) => { if (e.target.matches("input, textarea, select")) return; const k = e.key.toLowerCase(); if (k === "escape") clearSelection(); if (k === "p") { state.cut.on = !state.cut.on; applyCut(); } if (k === "i") setView("iso"); if (k === "n") setView("normal"); if (/^[1-9]$/.test(k)) restoreCut(+k - 1); });

/* ---------------- utilities ---------------- */
function fmt(v, d = 2) { return Number(v).toLocaleString("en-US", { maximumFractionDigits: d }); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function hint(t) { el.hint.hidden = !t; el.hint.textContent = t || ""; }
let tt; function toast(msg, err) { el.toast.textContent = msg; el.toast.className = "toast" + (err ? " error" : ""); el.toast.hidden = false; clearTimeout(tt); tt = setTimeout(() => (el.toast.hidden = true), err ? 8000 : 3500); }
$("#step-cut").classList.add("disabled"); $("#step-ai").classList.add("disabled");
setTimeout(() => getOcct().catch((e) => toast(e.message, true)), 300);
