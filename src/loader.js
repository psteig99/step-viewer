// WASM loading + STEP file parsing.
// Depends on: state.js, viewport.js (registerModel called after parse).

// WASM_GZ_B64 is injected by build_viewer.py as a const before this block.

async function decodeWasm(b64gz) {
  const bin = atob(b64gz);
  const gz  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const ds = new DecompressionStream("gzip");
  const w  = ds.writable.getWriter(); w.write(gz); w.close();
  const r  = ds.readable.getReader();
  const chunks = [];
  for (;;) { const {done,value} = await r.read(); if (done) break; chunks.push(value); }
  const len = chunks.reduce((s,c) => s+c.length, 0);
  const out = new Uint8Array(len); let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out.buffer;
}

let occt = null;
(async () => {
  try {
    const wasmBinary = await decodeWasm(WASM_GZ_B64);
    occt = await window.occtimportjs({ wasmBinary });
    document.getElementById("wasm-dot").className    = "wasm-dot ready";
    document.getElementById("wasm-label").textContent = "Parser STEP prêt ✓";
    document.getElementById("wasm-label").style.color  = "#6aa84f";
  } catch(e) {
    console.error("OCCT init:", e);
    document.getElementById("wasm-dot").style.background = "var(--alert)";
    document.getElementById("wasm-label").textContent = "Erreur parser : " + e.message;
    document.getElementById("wasm-label").style.color  = "var(--alert)";
  }
})();

async function loadFile(file) {
  document.getElementById("drop").hidden    = true;
  document.getElementById("loading").hidden = false;
  document.getElementById("loading-text").textContent = "Chargement de " + file.name + "…";
  try {
    if (!occt) {
      document.getElementById("loading-text").textContent = "Attente du parser WASM…";
      await new Promise((res,rej) => {
        const t0 = Date.now();
        const p  = () => occt ? res() : Date.now()-t0>15000 ? rej(new Error("WASM non prêt")) : setTimeout(p,200);
        p();
      });
    }
    document.getElementById("loading-text").textContent = "Parsing STEP…";
    const buf    = await file.arrayBuffer();
    const result = occt.ReadStepFile(new Uint8Array(buf), null);
    if (!result.success) throw new Error("Échec du parsing STEP");
    const root = new THREE.Group();
    result.meshes.forEach((m, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal)
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      else geo.computeVertexNormals();
      if (m.index) geo.setIndex(new THREE.Uint32BufferAttribute(m.index.array, 1));
      const col = m.color ? new THREE.Color(m.color[0],m.color[1],m.color[2]) : new THREE.Color(PALETTE[i%PALETTE.length]);
      const mat = new THREE.MeshStandardMaterial({
        color:col, metalness:0.05, roughness:0.55, flatShading:true,
        side:THREE.DoubleSide, clippingPlanes:[],
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = m.name || ("Part " + (i+1));
      mesh.userData.baseColor = col.getHex();
      root.add(mesh);
    });
    registerModel(root, file.name);
  } catch(err) {
    console.error(err);
    toast("Erreur : " + err.message, true);
    document.getElementById("drop").hidden    = false;
    document.getElementById("loading").hidden = true;
  }
}
