// Three.js renderer, camera, lights, scene groups, grid, dimensions, section cut, render loop.
// Depends on: state.js

const viewport = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({ antialias:true, preserveDrawingBuffer:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;";
viewport.appendChild(labelRenderer.domElement);

const scene    = new THREE.Scene();
scene.background = new THREE.Color(0xd0d6de);
const camera   = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.mouseButtons = { LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.PAN };

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.1));
const key  = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1,-1.2,1.8); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5,1,0.6); scene.add(fill);

const modelRoot  = new THREE.Group(); scene.add(modelRoot);
const helperRoot = new THREE.Group(); scene.add(helperRoot);
const annotRoot  = new THREE.Group(); scene.add(annotRoot);

// ---- Grid ----
function buildGrid() {
  if (grid) helperRoot.remove(grid);
  const span = Math.max(SIZE.x, SIZE.y, SIZE.z);
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(span/10, 1))));
  const n    = Math.ceil(span*2.5/step);
  grid = new THREE.GridHelper(n*step, Math.min(n,200), 0xb8c0ca, 0xd3d9e0);
  grid.rotation.x = Math.PI/2;
  grid.position.set(CENTER.x, CENTER.y, BOX.min.z - SIZE.length()*0.003);
  grid.material.transparent = true; grid.material.opacity = 0.9; grid.visible = flags.grid;
  helperRoot.add(grid);
}

// ---- Dimension labels ----
function buildDimLabels() {
  if (dimGroup) helperRoot.remove(dimGroup);
  dimGroup = new THREE.Group(); helperRoot.add(dimGroup);
  const off = SIZE.length()*0.07;
  const {min, max} = BOX;
  const V = (x,y,z) => new THREE.Vector3(x,y,z);
  const addLabel = (pos, text) => {
    const div = document.createElement("div"); div.className="lbl dim"; div.textContent=text;
    const o = new CSS2DObject(div); o.position.copy(pos); dimGroup.add(o);
  };
  const pts = [];
  pts.push(V(min.x,min.y-off,min.z), V(max.x,min.y-off,min.z));
  addLabel(V((min.x+max.x)/2, min.y-off, min.z), (max.x-min.x).toFixed(1)+" mm");
  pts.push(V(max.x+off,min.y,min.z), V(max.x+off,max.y,min.z));
  addLabel(V(max.x+off, (min.y+max.y)/2, min.z), (max.y-min.y).toFixed(1)+" mm");
  pts.push(V(max.x+off,max.y+off,min.z), V(max.x+off,max.y+off,max.z));
  addLabel(V(max.x+off, max.y+off, (min.z+max.z)/2), (max.z-min.z).toFixed(1)+" mm");
  dimGroup.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({color:0x1f4e9a})
  ));
  const bbox = new THREE.Box3Helper(BOX, 0x1f4e9a);
  bbox.material.transparent = true; bbox.material.opacity = 0.2; dimGroup.add(bbox);
  dimGroup.visible = flags.dims;
}

// ---- Camera helpers ----
function fitView() {
  const r = SIZE.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  camera.position.copy(CENTER).addScaledVector(new THREE.Vector3(1,-1,0.8).normalize(), r);
  controls.target.copy(CENTER); controls.update();
}
function setView(name) {
  const r   = SIZE.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  const dir = {iso:[1,-1,0.8], top:[0,0,1], front:[0,-1,0], side:[1,0,0]}[name] || [1,-1,0.8];
  camera.position.copy(CENTER).addScaledVector(new THREE.Vector3(...dir).normalize(), r);
  controls.target.copy(CENTER); controls.update();
}
function flyToMeshes(meshList) {
  if (!meshList.length) return;
  const box = new THREE.Box3();
  meshList.forEach(m => box.expandByObject(m));
  const center = new THREE.Vector3(); box.getCenter(center);
  const size   = new THREE.Vector3(); box.getSize(size);
  const r   = size.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(center).addScaledVector(dir, r);
  controls.target.copy(center); controls.update();
}
function flashMeshes(meshList, on) {
  meshList.forEach(m => { if (m.material?.emissive) m.material.emissive.setHex(on ? 0x223344 : 0); });
}

// ---- Flags / materials ----
function applyFlags() {
  const {wire, alpha, clip:doClip} = flags;
  const planes = doClip ? [clip.plane] : [];
  meshes.forEach(mesh => {
    if (!mesh.material) return;
    const mat = mesh.material;
    mat.wireframe = wire; mat.transparent = alpha; mat.opacity = alpha ? .32 : 1;
    mat.depthWrite = !alpha; mat.clippingPlanes = planes;
    mat.side = doClip && !alpha ? THREE.FrontSide : THREE.DoubleSide; mat.needsUpdate = true;
  });
  if (dimGroup) dimGroup.visible = flags.dims;
  if (grid) grid.visible = flags.grid;
  document.getElementById("clip-panel").hidden = !flags.clip;
  document.querySelectorAll("[data-toggle]").forEach(b => b.setAttribute("aria-pressed", String(!!flags[b.dataset.toggle])));
  viewport.style.cursor = flags.annotate ? "cell" : "";
  if (flags.annotate) hint("Clique pour épingler une note. N pour quitter.");
  else if (!flags.clip) hint(null);
}

// ---- Section cut ----
function updateClip() {
  const a = clip.axis;
  const n = new THREE.Vector3(a==="x"?1:0, a==="y"?1:0, a==="z"?1:0);
  if (!clip.flip) n.negate();
  const pos = BOX.min[a] + (BOX.max[a]-BOX.min[a])*clip.pos;
  clip.plane.normal.copy(n); clip.plane.constant = clip.flip ? -pos : pos;
  document.getElementById("clip-value").textContent = a.toUpperCase()+" = "+pos.toFixed(1)+" mm";
  if (flags.clip) hint("Section : glisser le curseur. P pour quitter.");
}

// ---- Register model (called by loader after parsing) ----
function registerModel(root, fileName) {
  while (modelRoot.children.length) modelRoot.remove(modelRoot.children[0]);
  clearAnnotations();
  meshes = []; basePosWorld = []; totalTris = 0; modelName = fileName;
  root.traverse(o => {
    if (!o.isMesh) return;
    const idx = o.geometry.index;
    totalTris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
    meshes.push(o);
  });
  modelRoot.add(root);
  modelRoot.updateMatrixWorld(true);
  BOX.setFromObject(modelRoot); BOX.getCenter(CENTER); BOX.getSize(SIZE);
  basePosWorld = meshes.map(m => { const v=new THREE.Vector3(); m.getWorldPosition(v); return v; });
  buildGrid(); buildDimLabels(); fitView();
  camera.near = SIZE.length()/1000; camera.far = SIZE.length()*100;
  camera.updateProjectionMatrix();
  document.getElementById("loading").hidden      = true;
  document.getElementById("toolbar").hidden      = false;
  document.getElementById("panel-empty").hidden  = true;
  document.getElementById("panel-content").hidden = false;
  document.getElementById("ai-output").hidden    = true;
  flags.annotate = false; flags.clip = false;
  populateInfo(fileName); populatePartsList(); applyFlags();
  if ("requestIdleCallback" in window) requestIdleCallback(populateThumbnails, {timeout:2000});
  else setTimeout(populateThumbnails, 300);
}

// ---- Resize + render loop ----
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h); labelRenderer.setSize(w, h);
  camera.aspect = w/h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport); resize();

(function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
})();
