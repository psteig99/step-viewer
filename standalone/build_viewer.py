import base64, pathlib

WASM_GZ = pathlib.Path("/tmp/claude-501/occt.wasm.gz").read_bytes()
WASM_B64 = base64.b64encode(WASM_GZ).decode()

OCCT_JS  = pathlib.Path("/tmp/claude-501/occt.js").read_text()

HTML = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>STEP Viewer</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap">
<style>
:root{{
  --bench:#e9ecef;--paper:#f7f8fa;--ink:#1b2430;--ink-2:#5a6472;
  --rule:#cfd5dc;--cyan:#1f4e9a;--cyan-s:#dbe5f5;
  --kraft:#c08a3e;--kraft-s:#f3e6cf;--alert:#b42318;
  --font:"Public Sans","Segoe UI",system-ui,sans-serif;
  --r:6px;--topbar:52px;--panel:360px;
}}
@media(prefers-color-scheme:dark){{
  :root{{--bench:#23282e;--paper:#1b1f24;--ink:#e8ecf1;--ink-2:#9aa5b3;--rule:#343b44;
    --cyan:#7fa8ea;--cyan-s:#233553;--kraft:#d9a558;--kraft-s:#3d3120;--alert:#ff8a80;}}
}}
*{{box-sizing:border-box;}}
html,body{{height:100%;margin:0;}}
body{{font:14px/1.45 var(--font);color:var(--ink);background:var(--bench);overflow:hidden;}}
button,input,select{{font:inherit;color:inherit;}}
button{{cursor:pointer;}}
:focus-visible{{outline:2px solid var(--kraft);outline-offset:2px;}}

.topbar{{height:var(--topbar);display:flex;align-items:center;gap:16px;padding:0 16px;
  background:var(--paper);border-bottom:1px solid var(--rule);}}
.brand{{display:flex;align-items:center;gap:8px;font-weight:600;white-space:nowrap;}}
.models{{flex:1;display:flex;gap:6px;overflow-x:auto;scrollbar-width:thin;}}
.model-tab{{display:flex;align-items:center;gap:8px;padding:5px 8px 5px 12px;
  border:1px solid var(--rule);border-radius:999px;background:transparent;white-space:nowrap;max-width:240px;font-size:13px;}}
.model-tab.active{{border-color:var(--kraft);background:var(--kraft-s);}}
.model-tab .x{{border:0;background:none;padding:0 3px;color:var(--ink-2);line-height:1;}}
.model-tab .x:hover{{color:var(--alert);}}
.topbar select{{padding:5px 8px;border:1px solid var(--rule);border-radius:var(--r);background:var(--bench);font-size:13px;}}
.btn{{padding:7px 14px;border:1px solid var(--cyan);border-radius:var(--r);background:var(--cyan);color:#fff;}}
.btn:hover{{filter:brightness(1.1);}}
.btn:disabled{{opacity:.5;cursor:default;filter:none;}}
.btn-outline{{background:transparent;color:var(--cyan);}}
.btn-outline:hover:not(:disabled){{background:var(--cyan-s);}}
.btn-full{{width:100%;text-align:center;}}

.layout{{display:grid;grid-template-columns:1fr var(--panel);height:calc(100% - var(--topbar));}}
.stage{{position:relative;overflow:hidden;background:#d0d6de;}}
.viewport{{position:absolute;inset:0;}}

.drop{{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  z-index:5;background:var(--bench);transition:background .15s;}}
.drop.over{{background:var(--cyan-s);}}
.drop[hidden]{{display:none;}}
.drop-inner{{text-align:center;padding:40px;max-width:480px;}}
.drop-icon{{width:72px;height:72px;color:var(--ink-2);margin-bottom:20px;}}
.drop h1{{font-size:20px;font-weight:600;margin:0 0 10px;}}
.drop p{{color:var(--ink-2);margin:6px 0;font-size:13.5px;}}
.wasm-status{{margin-top:16px;display:flex;align-items:center;gap:8px;justify-content:center;font-size:12.5px;}}
.wasm-dot{{width:10px;height:10px;border-radius:50%;flex-shrink:0;}}
.wasm-dot.loading{{background:var(--ink-2);animation:pulse 1.2s ease-in-out infinite;}}
.wasm-dot.ready{{background:#6aa84f;}}
@keyframes pulse{{0%,100%{{opacity:.4;}}50%{{opacity:1;}}}}
.link{{border:0;background:none;padding:0;color:var(--cyan);text-decoration:underline;cursor:pointer;font:inherit;}}

.loading{{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:14px;z-index:6;background:rgba(232,236,241,.88);backdrop-filter:blur(4px);}}
.loading[hidden]{{display:none;}}
.spinner{{width:36px;height:36px;border:3px solid var(--rule);border-top-color:var(--cyan);
  border-radius:50%;animation:spin .7s linear infinite;}}
@keyframes spin{{to{{transform:rotate(360deg);}}}}

.toolbar{{position:absolute;left:12px;top:12px;display:flex;flex-wrap:wrap;gap:8px;z-index:3;}}
.toolbar[hidden]{{display:none;}}
.tool-group{{display:flex;background:var(--paper);border:1px solid var(--rule);border-radius:var(--r);
  overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07);}}
.tool{{padding:6px 11px;border:0;border-right:1px solid var(--rule);background:transparent;font-size:13px;}}
.tool:last-child{{border-right:0;}}
.tool:hover{{background:var(--cyan-s);}}
.tool[aria-pressed="true"]{{background:var(--kraft-s);box-shadow:inset 0 -2px 0 var(--kraft);}}
.tool.range{{display:flex;align-items:center;gap:8px;}}
.tool.range input{{width:80px;accent-color:var(--kraft);}}

.clip-panel{{position:absolute;left:12px;bottom:14px;display:flex;align-items:center;gap:10px;z-index:3;
  padding:8px 10px;background:var(--paper);border:1px solid var(--rule);border-radius:var(--r);
  box-shadow:0 1px 3px rgba(0,0,0,.07);}}
.clip-panel[hidden]{{display:none;}}
.clip-panel input[type=range]{{width:200px;accent-color:var(--cyan);}}
.seg{{display:flex;border:1px solid var(--rule);border-radius:var(--r);overflow:hidden;}}
.seg-btn{{padding:4px 10px;border:0;background:transparent;font-size:13px;cursor:pointer;}}
.seg .seg-btn+.seg-btn{{border-left:1px solid var(--rule);}}
.seg-btn[aria-pressed="true"]{{background:var(--kraft-s);box-shadow:inset 0 -2px 0 var(--kraft);}}
#clip-flip{{border:1px solid var(--rule);border-radius:var(--r);}}
.clip-value{{color:var(--ink-2);font-size:13px;min-width:90px;}}

.hint{{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);z-index:3;
  padding:6px 14px;background:var(--ink);color:var(--paper);border-radius:999px;font-size:12.5px;white-space:nowrap;}}
.hint[hidden]{{display:none;}}
.clip-panel:not([hidden])~.hint{{bottom:60px;}}

.lbl{{font:12px/1 var(--font);padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none;}}
.lbl.dim{{color:var(--cyan);background:rgba(233,236,239,.9);font-weight:600;}}

.panel{{background:var(--paper);border-left:1px solid var(--rule);overflow-y:auto;scrollbar-width:thin;}}
.panel-empty{{height:100%;display:flex;align-items:center;justify-content:center;
  color:var(--ink-2);text-align:center;padding:24px;font-size:13px;line-height:1.6;}}
.panel-head{{padding:16px 18px 12px;border-bottom:1px solid var(--rule);}}
.file-name{{font-weight:600;font-size:15px;word-break:break-all;}}
.file-meta{{color:var(--ink-2);font-size:12.5px;margin-top:2px;}}
.block{{padding:14px 18px;border-bottom:1px solid var(--rule);}}
.block h2{{font-size:13px;font-weight:600;color:var(--ink-2);margin:0 0 10px;}}

.dims{{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}}
.dim-cell{{padding:8px 10px;border:1px solid var(--rule);border-radius:var(--r);}}
.dim-cell .axis{{font-size:11px;color:var(--ink-2);}}
.dim-cell .val{{font-size:20px;font-weight:600;letter-spacing:-.01em;}}
.dim-cell .val small{{font-size:11px;font-weight:400;color:var(--ink-2);margin-left:2px;}}
.dims-note{{margin-top:8px;color:var(--ink-2);font-size:12.5px;}}

.view-grid{{display:grid;grid-template-columns:1fr 1fr;gap:6px;}}
.section-grid{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;}}
.view-thumb{{position:relative;border:1px solid var(--rule);border-radius:var(--r);
  overflow:hidden;cursor:pointer;background:var(--bench);}}
.view-thumb img{{width:100%;display:block;}}
.view-thumb:hover{{border-color:var(--kraft);}}
.view-lbl{{position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:11px;font-weight:600;
  color:#fff;background:rgba(0,0,0,.4);padding:2px 4px;}}

.ai-output{{margin-top:10px;padding:10px 12px;background:var(--bench);border:1px solid var(--rule);
  border-radius:var(--r);font:13px/1.55 var(--font);word-break:break-word;max-height:320px;overflow-y:auto;}}
.ai-output[hidden]{{display:none;}}

.parts{{list-style:none;margin:0;padding:0;max-height:260px;overflow-y:auto;scrollbar-width:thin;}}
.part{{display:grid;grid-template-columns:auto 10px 1fr auto auto;align-items:center;gap:6px;padding:4px 4px;border-radius:var(--r);}}
.part:hover{{background:var(--cyan-s);}}
.part.focus{{background:var(--kraft-s);}}
.part input{{accent-color:var(--kraft);}}
.part .sw{{width:10px;height:10px;border-radius:2px;flex-shrink:0;}}
.part .nm{{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;font-size:13px;}}
.part .nm-input{{flex:1;min-width:0;padding:1px 4px;border:1px solid var(--kraft);border-radius:3px;
  background:var(--bench);color:var(--ink);font:13px var(--font);outline:none;}}
.part .edit-btn{{border:0;background:none;padding:1px 3px;color:var(--ink-2);font-size:13px;cursor:pointer;
  opacity:0;transition:opacity .1s;line-height:1;border-radius:3px;flex-shrink:0;}}
.part:hover .edit-btn{{opacity:1;}}
.part .edit-btn:hover{{background:var(--kraft-s);color:var(--kraft);}}

.annot-popup{{position:fixed;z-index:30;width:220px;background:var(--paper);border:1px solid var(--rule);
  border-radius:var(--r);box-shadow:0 4px 16px rgba(0,0,0,.15);padding:10px;display:flex;flex-direction:column;gap:8px;}}
.annot-popup[hidden]{{display:none;}}
.annot-input{{width:100%;padding:6px 8px;border:1px solid var(--rule);border-radius:var(--r);
  background:var(--bench);color:var(--ink);font:inherit;}}
.annot-popup-btns{{display:flex;gap:6px;}}
.annot-cancel{{border:0;background:none;color:var(--ink-2);cursor:pointer;font:inherit;}}
.annot-cancel:hover{{color:var(--alert);}}
.annot-ok{{flex:1;padding:5px 10px;}}
.annot-lbl{{display:flex;align-items:center;gap:5px;background:var(--paper);border:1px solid var(--kraft);
  border-radius:12px;padding:3px 8px 3px 4px;font:600 11.5px var(--font);white-space:nowrap;
  pointer-events:none;transform:translateY(-18px);box-shadow:0 2px 6px rgba(0,0,0,.15);}}
.annot-num{{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;
  border-radius:50%;background:var(--kraft);color:#fff;font-size:10px;font-weight:700;flex-shrink:0;}}
.annot-txt{{color:var(--ink);max-width:180px;overflow:hidden;text-overflow:ellipsis;}}
.annot-list{{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;}}
.annot-item{{display:grid;grid-template-columns:20px 1fr auto;align-items:center;gap:8px;padding:5px 4px;border-radius:var(--r);}}
.annot-item:hover{{background:var(--cyan-s);}}
.annot-item-txt{{font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}}
.annot-del{{border:0;background:none;color:var(--ink-2);font-size:16px;line-height:1;cursor:pointer;padding:0 2px;}}
.annot-del:hover{{color:var(--alert);}}

.shortcuts p{{margin:0 0 4px;color:var(--ink-2);font-size:12.5px;}}

.toast{{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:40;
  padding:10px 16px;background:var(--ink);color:var(--paper);border-radius:var(--r);
  max-width:min(90vw,560px);font-size:13.5px;}}
.toast.error{{background:var(--alert);}}
.toast[hidden]{{display:none;}}

@media(max-width:900px){{
  .layout{{grid-template-rows:55vh 1fr;grid-template-columns:1fr;}}
  .panel{{border-left:0;border-top:1px solid var(--rule);}}
  .tool.range{{display:none;}}
}}
</style>
</head>
<body>

<header class="topbar">
  <div class="brand">
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 3 29 9.5v13L16 29 3 22.5v-13z" fill="#c08a3e"/>
      <path d="M16 3v26M3 9.5l13 6.5 13-6.5" stroke="#fff" stroke-width="2" fill="none"/>
    </svg>
    STEP Viewer
  </div>
  <nav class="models" id="models" aria-label="Fichiers ouverts"></nav>
  <div style="display:flex;align-items:center;gap:10px">
    <select id="quality" title="Qualité du maillage">
      <option value="0.5">Draft</option>
      <option value="0.3" selected>Normal</option>
      <option value="0.1">High</option>
    </select>
    <button class="btn" id="btn-open" type="button">Open file…</button>
    <input type="file" id="file-input" accept=".step,.stp,.STEP,.STP" hidden>
  </div>
</header>

<main class="layout">
  <section class="stage" id="stage">
    <div class="viewport" id="viewport"></div>

    <div class="drop" id="drop">
      <div class="drop-inner">
        <svg class="drop-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M32 6 56 18v28L32 58 8 46V18z"/>
          <path d="M32 6v52M8 18l24 12 24-12"/>
          <path d="M32 28v12m-6-5 6 5 6-5" stroke="#c08a3e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <h1>Dépose un fichier STEP ici</h1>
        <p>Glisse un <b>.step</b> ou <b>.stp</b> depuis ton explorateur,<br>ou <button class="link" id="btn-browse">parcourir</button>.</p>
        <p style="font-size:12px;margin-top:12px">Parsing 100 % dans le navigateur via WebAssembly — aucun serveur.</p>
        <div class="wasm-status" id="wasm-status">
          <span class="wasm-dot loading" id="wasm-dot"></span>
          <span id="wasm-label">Initialisation du parser WASM…</span>
        </div>
      </div>
    </div>

    <div class="loading" id="loading" hidden>
      <div class="spinner" aria-hidden="true"></div>
      <div id="loading-text">Chargement…</div>
    </div>

    <div class="toolbar" id="toolbar" hidden>
      <div class="tool-group" role="group" aria-label="Vues">
        <button class="tool" data-view="iso"   title="Isométrique (I)">Iso</button>
        <button class="tool" data-view="top"   title="Dessus (X)">Top</button>
        <button class="tool" data-view="front" title="Face (Y)">Front</button>
        <button class="tool" data-view="side"  title="Côté (Z)">Side</button>
        <button class="tool" data-action="fit" title="Recadrer (R)">Fit</button>
      </div>
      <div class="tool-group" role="group" aria-label="Affichage">
        <button class="tool toggle" data-toggle="dims"  aria-pressed="true"  title="Cotes (B)">Dims</button>
        <button class="tool toggle" data-toggle="alpha" aria-pressed="false" title="Transparence (T)">Transparency</button>
      </div>
      <div class="tool-group" role="group" aria-label="Outils">
        <button class="tool toggle" data-toggle="annotate" aria-pressed="false" title="Annotations (N)">Notes</button>
        <button class="tool toggle" data-toggle="clip"     aria-pressed="false" title="Section (P)">Section</button>
        <button class="tool" data-action="shot" title="Capture (F)">Screenshot</button>
      </div>
    </div>

    <div class="clip-panel" id="clip-panel" hidden>
      <div class="seg" role="group" aria-label="Axe de coupe">
        <button class="seg-btn" data-axis="x" aria-pressed="true">X</button>
        <button class="seg-btn" data-axis="y" aria-pressed="false">Y</button>
        <button class="seg-btn" data-axis="z" aria-pressed="false">Z</button>
      </div>
      <input type="range" id="clip-pos" min="0" max="1" step="0.002" value="0.5">
      <button class="seg-btn" id="clip-flip">Flip</button>
      <span class="clip-value" id="clip-value"></span>
    </div>

    <div class="hint" id="hint" hidden></div>
  </section>

  <aside class="panel" id="panel">
    <div class="panel-empty" id="panel-empty">
      Dépose un fichier STEP pour visualiser le modèle 3D.
    </div>
    <div id="panel-content" hidden>
      <div class="panel-head">
        <div class="file-name" id="file-name"></div>
        <div class="file-meta" id="file-meta"></div>
      </div>
      <section class="block">
        <h2>Vues standard</h2>
        <div class="view-grid" id="view-grid"></div>
      </section>
      <section class="block">
        <h2>Coupes</h2>
        <div class="section-grid" id="section-grid"></div>
      </section>
      <section class="block" id="annotations-block" hidden>
        <h2>Annotations</h2>
        <ul class="annot-list" id="annot-list"></ul>
      </section>
      <section class="block">
        <h2>Analyse IA</h2>
        <button class="btn btn-full" id="ai-btn" type="button">Analyser avec Claude</button>
        <div class="ai-output" id="ai-output" hidden></div>
      </section>
      <section class="block">
        <h2>Dimensions</h2>
        <div class="dims" id="dims"></div>
        <div class="dims-note" id="dims-note"></div>
      </section>
      <section class="block">
        <h2>Maillages <span id="parts-count" style="font-weight:400"></span>
          <span style="font-size:11px;font-weight:400;color:var(--ink-2);margin-left:6px">dbl-clic pour renommer</span>
        </h2>
        <div style="margin-bottom:8px;position:relative;">
          <input type="search" id="parts-search" placeholder="Filtrer…"
            style="width:100%;padding:5px 8px 5px 28px;border:1px solid var(--rule);border-radius:var(--r);background:var(--bench);color:var(--ink);font:13px var(--font);">
          <svg style="position:absolute;left:8px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--ink-2)" width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="m14 14 4 4"/></svg>
        </div>
        <ul class="parts" id="parts-list"></ul>
      </section>
      <section class="block shortcuts">
        <h2>Raccourcis</h2>
        <p>I X Y Z vues · R recadrer · T transparence · B cotes · N notes · P section · F capture · Esc quitter</p>
        <p>Souris : drag = tourner · scroll = zoom · clic droit = déplacer</p>
        <p>Maillages : dbl-clic pour renommer · clic en mode Notes pour annoter</p>
      </section>
    </div>
  </aside>
</main>

<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<div class="annot-popup" id="annot-popup" hidden>
  <input class="annot-input" id="annot-input" type="text" placeholder="Note…" maxlength="140">
  <div class="annot-popup-btns">
    <button class="btn annot-ok" id="annot-ok" type="button">Ajouter</button>
    <button class="annot-cancel" id="annot-cancel" type="button">Annuler</button>
  </div>
</div>

<!-- OCCT-import-js Emscripten glue (embarqué) -->
<script>
{OCCT_JS}
</script>

<script type="importmap">
{{"imports":{{"three":"https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/"}}}}
</script>

<script type="module">
import * as THREE from "three";
import {{ OrbitControls }}   from "three/addons/controls/OrbitControls.js";
import {{ CSS2DRenderer, CSS2DObject }} from "three/addons/renderers/CSS2DRenderer.js";

/* ---- Capabilities ---- */
let sampleApi = null, downloadsApi = null;
(async () => {{
  [sampleApi, downloadsApi] = await Promise.all([
    window.claude?.use("sample"),
    window.claude?.use("downloads"),
  ]);
}})();

/* ---- WASM embarqué (gzip+base64) ---- */
const WASM_GZ_B64 = "{WASM_B64}";

async function decodeWasm(b64gz) {{
  const bin = atob(b64gz);
  const gz  = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) gz[i] = bin.charCodeAt(i);
  const ds  = new DecompressionStream("gzip");
  const w   = ds.writable.getWriter(); w.write(gz); w.close();
  const r   = ds.readable.getReader();
  const chunks = [];
  for (;;) {{ const {{done,value}} = await r.read(); if (done) break; chunks.push(value); }}
  const len = chunks.reduce((s,c) => s+c.length, 0);
  const out = new Uint8Array(len); let off = 0;
  for (const c of chunks) {{ out.set(c, off); off += c.length; }}
  return out.buffer;
}}

let occt = null;
(async () => {{
  try {{
    const wasmBinary = await decodeWasm(WASM_GZ_B64);
    occt = await window.occtimportjs({{ wasmBinary }});
    document.getElementById("wasm-dot").className   = "wasm-dot ready";
    document.getElementById("wasm-label").textContent = "Parser STEP prêt ✓";
    document.getElementById("wasm-label").style.color  = "#6aa84f";
  }} catch(e) {{
    console.error("OCCT init:", e);
    document.getElementById("wasm-dot").style.background = "var(--alert)";
    document.getElementById("wasm-label").textContent = "Erreur parser : " + e.message;
    document.getElementById("wasm-label").style.color  = "var(--alert)";
  }}
}})();

/* ---- Renderer ---- */
const viewport = document.getElementById("viewport");
const renderer = new THREE.WebGLRenderer({{ antialias:true, preserveDrawingBuffer:true }});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.localClippingEnabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewport.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.style.cssText = "position:absolute;inset:0;pointer-events:none;";
viewport.appendChild(labelRenderer.domElement);

const scene   = new THREE.Scene();
scene.background = new THREE.Color(0xd0d6de);
const camera  = new THREE.PerspectiveCamera(40, 1, 0.1, 1e6);
camera.up.set(0,0,1);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.mouseButtons = {{ LEFT:THREE.MOUSE.ROTATE, MIDDLE:THREE.MOUSE.DOLLY, RIGHT:THREE.MOUSE.PAN }};

scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.1));
const key  = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1,-1.2,1.8); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-1.5,1,0.6); scene.add(fill);

const modelRoot  = new THREE.Group(); scene.add(modelRoot);
const helperRoot = new THREE.Group(); scene.add(helperRoot);
const annotRoot  = new THREE.Group(); scene.add(annotRoot);

/* ---- State ---- */
const PALETTE = [0x3b6fb6,0x6aa84f,0xd1495b,0xec8f2a,0x6d7a8a,0x9b59b6,0x1abc9c,0xe67e22,0x2c3e50,0xc0392b,0x8e44ad,0x16a085];
const flags  = {{ dims:true,wire:false,alpha:false,grid:false,annotate:false,clip:false }};
const clip   = {{ axis:"x",pos:0.5,flip:false,plane:new THREE.Plane(new THREE.Vector3(-1,0,0),0) }};
const BOX    = new THREE.Box3();
const CENTER = new THREE.Vector3(), SIZE = new THREE.Vector3();
let meshes = [], basePosWorld = [], modelName = "", totalTris = 0;
let grid = null, dimGroup = null;

/* ---- Load STEP ---- */
async function loadFile(file) {{
  document.getElementById("drop").hidden    = true;
  document.getElementById("loading").hidden = false;
  document.getElementById("loading-text").textContent = "Chargement de " + file.name + "…";
  try {{
    if (!occt) {{
      document.getElementById("loading-text").textContent = "Attente du parser WASM…";
      await new Promise((res,rej) => {{
        const t0 = Date.now();
        const p  = () => occt ? res() : Date.now()-t0>15000 ? rej(new Error("WASM non prêt")) : setTimeout(p,200);
        p();
      }});
    }}
    document.getElementById("loading-text").textContent = "Parsing STEP…";
    const buf    = await file.arrayBuffer();
    const result = occt.ReadStepFile(new Uint8Array(buf), null);
    if (!result.success) throw new Error("Échec du parsing STEP");
    const root = new THREE.Group();
    result.meshes.forEach((m, i) => {{
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
      if (m.attributes.normal)
        geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
      else geo.computeVertexNormals();
      if (m.index) geo.setIndex(new THREE.Uint32BufferAttribute(m.index.array, 1));
      const col = m.color ? new THREE.Color(m.color[0],m.color[1],m.color[2]) : new THREE.Color(PALETTE[i%PALETTE.length]);
      const mat = new THREE.MeshStandardMaterial({{
        color:col, metalness:0.05, roughness:0.55, flatShading:true,
        side:THREE.DoubleSide, clippingPlanes:[],
      }});
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = m.name || ("Part " + (i+1));
      mesh.userData.baseColor = col.getHex();
      root.add(mesh);
    }});
    registerModel(root, file.name);
  }} catch(err) {{
    console.error(err);
    toast("Erreur : " + err.message, true);
    document.getElementById("drop").hidden    = false;
    document.getElementById("loading").hidden = true;
  }}
}}

/* ---- Register model ---- */
function registerModel(root, fileName) {{
  while (modelRoot.children.length) modelRoot.remove(modelRoot.children[0]);
  clearAnnotations();
  meshes = []; basePosWorld = []; totalTris = 0; modelName = fileName;
  let i = 0;
  root.traverse(o => {{
    if (!o.isMesh) return;
    const idx = o.geometry.index;
    totalTris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
    meshes.push(o); i++;
  }});
  modelRoot.add(root);
  modelRoot.updateMatrixWorld(true);
  BOX.setFromObject(modelRoot); BOX.getCenter(CENTER); BOX.getSize(SIZE);
  basePosWorld = meshes.map(m => {{ const v=new THREE.Vector3(); m.getWorldPosition(v); return v; }});
  buildGrid(); buildDimLabels(); fitView();
  camera.near = SIZE.length()/1000; camera.far = SIZE.length()*100;
  camera.updateProjectionMatrix();
  document.getElementById("loading").hidden     = true;
  document.getElementById("toolbar").hidden     = false;
  document.getElementById("panel-empty").hidden = true;
  document.getElementById("panel-content").hidden = false;
  document.getElementById("ai-output").hidden   = true;
  flags.annotate = false; flags.clip = false;
  populateInfo(fileName); populatePartsList(); applyFlags();
  if ("requestIdleCallback" in window) requestIdleCallback(populateThumbnails, {{timeout:2000}});
  else setTimeout(populateThumbnails, 300);
}}

/* ---- Grid + dim labels ---- */
function buildGrid() {{
  if (grid) helperRoot.remove(grid);
  const span = Math.max(SIZE.x,SIZE.y,SIZE.z);
  const step = Math.pow(10, Math.floor(Math.log10(Math.max(span/10,1))));
  const n    = Math.ceil(span*2.5/step);
  grid = new THREE.GridHelper(n*step, Math.min(n,200), 0xb8c0ca, 0xd3d9e0);
  grid.rotation.x = Math.PI/2;
  grid.position.set(CENTER.x, CENTER.y, BOX.min.z - SIZE.length()*0.003);
  grid.material.transparent=true; grid.material.opacity=0.9; grid.visible=flags.grid;
  helperRoot.add(grid);
}}

function buildDimLabels() {{
  if (dimGroup) helperRoot.remove(dimGroup);
  dimGroup = new THREE.Group(); helperRoot.add(dimGroup);
  const off = SIZE.length()*0.07;
  const {{min,max}} = BOX;
  const V = (x,y,z) => new THREE.Vector3(x,y,z);
  const addLabel = (pos,text) => {{
    const div = document.createElement("div"); div.className="lbl dim"; div.textContent=text;
    const o = new CSS2DObject(div); o.position.copy(pos); dimGroup.add(o);
  }};
  const pts = [];
  pts.push(V(min.x,min.y-off,min.z),V(max.x,min.y-off,min.z));
  addLabel(V((min.x+max.x)/2,min.y-off,min.z), (max.x-min.x).toFixed(1)+" mm");
  pts.push(V(max.x+off,min.y,min.z),V(max.x+off,max.y,min.z));
  addLabel(V(max.x+off,(min.y+max.y)/2,min.z), (max.y-min.y).toFixed(1)+" mm");
  pts.push(V(max.x+off,max.y+off,min.z),V(max.x+off,max.y+off,max.z));
  addLabel(V(max.x+off,max.y+off,(min.z+max.z)/2), (max.z-min.z).toFixed(1)+" mm");
  dimGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({{color:0x1f4e9a}})));
  const bbox = new THREE.Box3Helper(BOX,0x1f4e9a);
  bbox.material.transparent=true; bbox.material.opacity=0.2; dimGroup.add(bbox);
  dimGroup.visible = flags.dims;
}}

/* ---- Attach renameable mesh label ---- */
function startRename(li, mesh, span) {{
  const input = document.createElement("input");
  input.className = "nm-input"; input.value = mesh.name;
  span.replaceWith(input); input.select();
  // hide edit btn while editing
  const eb = li.querySelector(".edit-btn"); if(eb) eb.style.opacity="0";
  const commit = () => {{ mesh.name = input.value.trim() || mesh.name; attachNm(li, mesh); }};
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", e => {{
    if (e.key==="Enter") {{ e.preventDefault(); commit(); }}
    if (e.key==="Escape") {{ input.replaceWith(span); if(eb) eb.style.opacity=""; }}
  }});
}}
function attachNm(li, mesh) {{
  const existing = li.querySelector(".nm,.nm-input,.edit-btn");
  // Remove old nm, nm-input, edit-btn
  li.querySelectorAll(".nm,.nm-input,.edit-btn").forEach(el=>el.remove());
  const span = document.createElement("span");
  span.className = "nm"; span.title = "Clic = zoomer · Dbl-clic = renommer"; span.textContent = mesh.name;
  li.appendChild(span);
  const editBtn = document.createElement("button");
  editBtn.className = "edit-btn"; editBtn.textContent = "✏"; editBtn.title = "Renommer";
  li.appendChild(editBtn);
  span.addEventListener("click", e => {{
    if (e.detail >= 2) return; // let dblclick handle
    if (flags.annotate) {{
      const b = new THREE.Box3().setFromObject(mesh);
      const c = new THREE.Vector3(); b.getCenter(c);
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc  = c.clone().project(camera);
      showAnnotPopup((ndc.x*.5+.5)*rect.width+rect.left, (-ndc.y*.5+.5)*rect.height+rect.top, c);
      return;
    }}
    flyToMeshes([mesh]);
  }});
  span.addEventListener("dblclick", () => startRename(li, mesh, span));
  editBtn.addEventListener("click", e => {{ e.stopPropagation(); startRename(li, mesh, span); }});
}}

/* ---- Info panel ---- */
function populateInfo(fileName) {{
  document.getElementById("file-name").textContent = fileName;
  document.getElementById("file-meta").textContent =
    meshes.length+" maillage"+(meshes.length>1?"s":"")+" · "+Math.round(totalTris).toLocaleString()+" triangles";
  document.getElementById("dims").innerHTML = `
    <div class="dim-cell"><div class="axis">X</div><div class="val">${{SIZE.x.toFixed(1)}}<small>mm</small></div></div>
    <div class="dim-cell"><div class="axis">Y</div><div class="val">${{SIZE.y.toFixed(1)}}<small>mm</small></div></div>
    <div class="dim-cell"><div class="axis">Z</div><div class="val">${{SIZE.z.toFixed(1)}}<small>mm</small></div></div>`;
  document.getElementById("dims-note").textContent =
    "Enveloppe : "+SIZE.x.toFixed(1)+" × "+SIZE.y.toFixed(1)+" × "+SIZE.z.toFixed(1)+" mm";
  document.getElementById("models").innerHTML =
    `<div class="model-tab active"><span title="${{esc(fileName)}}">${{esc(shortName(fileName))}}</span>
     <button class="x" title="Fermer">×</button></div>`;
  document.getElementById("models").querySelector(".x").addEventListener("click", closeModel);
}}

/* ---- Tree builder (recursive, unlimited depth) ---- */
function buildTree(meshList) {{
  // node: {{ label, meshes:[], children:{{}} }}
  const root = {{ label:"root", meshes:[], children:{{}} }};
  meshList.forEach(mesh => {{
    const segments = (mesh.name||"—").split(":");
    let node = root;
    segments.forEach((seg, si) => {{
      if (si === segments.length-1) {{
        node.meshes.push(mesh);
      }} else {{
        if (!node.children[seg]) node.children[seg] = {{ label:seg, meshes:[], children:{{}} }};
        node = node.children[seg];
      }}
    }});
  }});
  return root;
}}

function allMeshesIn(node) {{
  const out = [...node.meshes];
  Object.values(node.children).forEach(c => out.push(...allMeshesIn(c)));
  return out;
}}


function firstColor(node) {{
  if (node.meshes.length) return "#"+node.meshes[0].userData.baseColor.toString(16).padStart(6,"0");
  for (const c of Object.values(node.children)) {{ const col=firstColor(c); if(col) return col; }}
  return null;
}}

function flyToMeshes(meshList) {{
  if (!meshList.length) return;
  const box = new THREE.Box3();
  meshList.forEach(m => box.expandByObject(m));
  const center = new THREE.Vector3(); box.getCenter(center);
  const size   = new THREE.Vector3(); box.getSize(size);
  const r = size.length() / Math.tan(THREE.MathUtils.degToRad(camera.fov/2)) * 0.65;
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(center).addScaledVector(dir, r);
  controls.target.copy(center); controls.update();
}}

function flashMeshes(meshList, on) {{
  meshList.forEach(m => {{ if (m.material?.emissive) m.material.emissive.setHex(on ? 0x223344 : 0); }});
}}

function renderTreeNode(node, parentUl, depth, pathPrefix) {{
  // Children groups
  Object.entries(node.children).forEach(([label, child]) => {{
    const childMeshes = allMeshesIn(child);
    const li  = document.createElement("li"); li.style.listStyle="none";
    li.dataset.names = childMeshes.map(m=>m.name.toLowerCase()).join("|");
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:5px;padding:3px 2px;cursor:pointer;"+
      "padding-left:"+(depth*14+2)+"px;border-radius:4px;user-select:none;";
    hdr.addEventListener("mouseover", ()=>{{ hdr.style.background="var(--cyan-s)"; flashMeshes(childMeshes,true); }});
    hdr.addEventListener("mouseout",  ()=>{{ hdr.style.background=""; flashMeshes(childMeshes,false); }});
    const arrow = document.createElement("span");
    arrow.setAttribute("data-arrow","1");
    arrow.textContent="▾"; arrow.style.cssText="font-size:9px;color:var(--ink-2);flex-shrink:0;transition:transform .15s;width:10px;text-align:center;pointer-events:none;";
    const cb = document.createElement("input"); cb.type="checkbox"; cb.checked=true; cb.style.cssText="accent-color:var(--kraft);flex-shrink:0;";
    const col = firstColor(child);
    const sw = document.createElement("span");
    sw.style.cssText="width:8px;height:8px;border-radius:2px;flex-shrink:0;background:"+(col||"transparent")+";opacity:.7;";
    const lbl = document.createElement("span"); lbl.textContent=label;
    lbl.style.cssText="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;";
    lbl.title = (pathPrefix?pathPrefix+":":"")+label;
    const meta = document.createElement("span");
    meta.textContent=childMeshes.length;
    meta.style.cssText="font-size:11px;color:var(--ink-2);white-space:nowrap;";
    hdr.append(arrow, cb, sw, lbl, meta);
    const body = document.createElement("ul"); body.style.cssText="list-style:none;margin:0;padding:0;border-left:1px solid var(--rule);margin-left:"+(depth*14+8)+"px;";
    let open=true;
    hdr.addEventListener("click", e => {{
      if (e.target===cb) return;
      if (e.target===lbl && e.detail===2) {{ flyToMeshes(childMeshes); return; }}
      if (e.target===lbl) return; // single click on label: do nothing (dblclick flies)
      open=!open; body.hidden=!open;
      arrow.style.transform=open?"":"rotate(-90deg)";
    }});
    lbl.title = "Dbl-clic pour zoomer · "+ lbl.title;
    cb.addEventListener("change", e => {{
      childMeshes.forEach(m => {{ m.visible=e.target.checked; }});
      body.querySelectorAll("input[type=checkbox]").forEach(x=>{{x.checked=e.target.checked;}});
    }});
    const childPath = pathPrefix ? pathPrefix+":"+label : label;
    renderTreeNode(child, body, 0, childPath);
    li.append(hdr, body);
    parentUl.appendChild(li);
  }});
  // Leaf meshes — show only last segment of name
  node.meshes.forEach(mesh => {{
    const segments = (mesh.name||"").split(":");
    const leafLabel = segments[segments.length-1];
    appendMeshRow(parentUl, mesh, depth*14, leafLabel !== mesh.name ? leafLabel : null);
  }});
}}

function populatePartsList() {{
  const ul = document.getElementById("parts-list");
  ul.innerHTML = "";
  document.getElementById("parts-count").textContent = "("+meshes.length+")";
  const tree = buildTree(meshes);
  const hasGroups = Object.keys(tree.children).length > 0;

  // Controls bar: collapse/expand all + search wire-up
  const searchInput = document.getElementById("parts-search");
  searchInput.value = "";
  searchInput.oninput = () => {{
    const q = searchInput.value.trim().toLowerCase();
    ul.querySelectorAll("li.part").forEach(li => {{
      const nm = li.querySelector(".nm,.nm-input");
      const txt = (nm?.textContent||nm?.value||"").toLowerCase();
      const full = (li.dataset.fullName||"").toLowerCase();
      li.hidden = q && !txt.includes(q) && !full.includes(q);
    }});
    ul.querySelectorAll("li[data-names]").forEach(li => {{
      li.hidden = q && !li.dataset.names.includes(q);
    }});
  }};

  if (hasGroups) {{
    const bar = document.createElement("div");
    bar.style.cssText="display:flex;gap:8px;margin-bottom:6px;";
    const btnAll = (label, state) => {{
      const b = document.createElement("button");
      b.textContent=label; b.style.cssText="font:12px var(--font);border:1px solid var(--rule);border-radius:4px;padding:2px 8px;background:transparent;cursor:pointer;color:var(--ink-2);";
      b.addEventListener("click", () => {{
        ul.querySelectorAll("li > ul").forEach(u => {{ u.hidden=state; }});
        ul.querySelectorAll("[data-arrow]").forEach(a => {{ a.style.transform=state?"rotate(-90deg)":""; }});
      }});
      return b;
    }};
    bar.append(btnAll("Tout replier", true), btnAll("Tout déplier", false));
    ul.before(bar);
  }}

  if (!hasGroups) {{
    meshes.forEach(m => appendMeshRow(ul, m, 0, null));
  }} else {{
    renderTreeNode(tree, ul, 0, "");
  }}
}}

function appendMeshRow(parent, mesh, paddingLeft, leafLabel) {{
  const col = "#"+mesh.userData.baseColor.toString(16).padStart(6,"0");
  const li  = document.createElement("li"); li.className="part";
  li.style.cssText="padding-left:"+(paddingLeft+4)+"px;grid-template-columns:auto 10px 1fr auto;";
  li.dataset.fullName = mesh.name.toLowerCase();
  li.innerHTML = `<input type="checkbox" checked><span class="sw" style="background:${{col}};cursor:pointer;border:1px solid transparent;" title="Changer la couleur"></span>`;
  li.querySelector("input").addEventListener("change", e => {{ mesh.visible=e.target.checked; }});
  // Hover = highlight in 3D
  li.addEventListener("mouseenter", () => {{ if (mesh.material?.emissive) mesh.material.emissive.setHex(0x223344); }});
  li.addEventListener("mouseleave", () => {{ if (mesh.material?.emissive) mesh.material.emissive.setHex(0); }});
  // Swatch click = color picker
  li.querySelector(".sw").addEventListener("click", e => {{
    e.stopPropagation();
    const picker = document.createElement("input"); picker.type="color";
    picker.value = "#"+mesh.userData.baseColor.toString(16).padStart(6,"0");
    picker.style.cssText="position:fixed;opacity:0;width:0;height:0;";
    document.body.appendChild(picker);
    picker.addEventListener("input", () => {{
      const hex = parseInt(picker.value.slice(1),16);
      mesh.userData.baseColor = hex;
      if (mesh.material?.color) mesh.material.color.setHex(hex);
      e.target.style.background = picker.value;
    }});
    picker.addEventListener("change", () => picker.remove());
    picker.click();
  }});
  if (leafLabel && leafLabel !== mesh.name) {{
    const nm = document.createElement("span"); nm.className="nm";
    nm.textContent=leafLabel; nm.title="Clic = zoomer · Dbl-clic = renommer · ("+mesh.name+")";
    nm.addEventListener("click", e => {{
      if (e.detail >= 2) return;
      if (flags.annotate) {{
        const b2=new THREE.Box3().setFromObject(mesh), c2=new THREE.Vector3(); b2.getCenter(c2);
        const rect=renderer.domElement.getBoundingClientRect(), ndc=c2.clone().project(camera);
        showAnnotPopup((ndc.x*.5+.5)*rect.width+rect.left,(-ndc.y*.5+.5)*rect.height+rect.top,c2);
      }} else {{ flyToMeshes([mesh]); }}
    }});
    const doRename = () => {{
      const inp=document.createElement("input"); inp.className="nm-input"; inp.value=mesh.name;
      nm.replaceWith(inp); inp.select();
      const commit=()=>{{ mesh.name=inp.value.trim()||mesh.name; nm.textContent=mesh.name.split(":").pop(); nm.title=mesh.name; li.dataset.fullName=mesh.name.toLowerCase(); inp.replaceWith(nm); }};
      inp.addEventListener("blur",commit);
      inp.addEventListener("keydown",e=>{{ if(e.key==="Enter"){{e.preventDefault();commit();}} if(e.key==="Escape") inp.replaceWith(nm); }});
    }};
    nm.addEventListener("dblclick", doRename);
    li.appendChild(nm);
    const editBtn=document.createElement("button"); editBtn.className="edit-btn"; editBtn.textContent="✏"; editBtn.title="Renommer";
    editBtn.addEventListener("click", e=>{{ e.stopPropagation(); doRename(); }});
    li.appendChild(editBtn);
  }} else {{
    attachNm(li, mesh);
  }}
  parent.appendChild(li);
}}

function closeModel() {{
  while (modelRoot.children.length) modelRoot.remove(modelRoot.children[0]);
  meshes=[]; basePosWorld=[]; clearAnnotations();
  document.getElementById("models").innerHTML="";
  document.getElementById("toolbar").hidden=true;
  document.getElementById("clip-panel").hidden=true;
  document.getElementById("panel-content").hidden=true;
  document.getElementById("panel-empty").hidden=false;
  document.getElementById("drop").hidden=false;
  flags.annotate=false; flags.clip=false; applyFlags();
}}

/* ---- Thumbnails ---- */
const VIEWS=[
  {{key:"iso",label:"Iso",dir:[1,-1,0.8]}},
  {{key:"top",label:"Top",dir:[0,0,1]}},
  {{key:"front",label:"Front",dir:[0,-1,0]}},
  {{key:"side",label:"Right",dir:[1,0,0]}},
];
function captureThumb(dir) {{
  const r = SIZE.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  camera.position.copy(CENTER).addScaledVector(new THREE.Vector3(...dir).normalize(),r);
  controls.target.copy(CENTER); controls.update(); camera.updateProjectionMatrix();
  renderer.render(scene,camera);
  return renderer.domElement.toDataURL("image/jpeg",0.75);
}}
function populateThumbnails() {{
  if (!meshes.length) return;
  const savedCam=camera.position.clone(), savedTarget=controls.target.clone();
  const dimWas=dimGroup?.visible;
  if (dimGroup) dimGroup.visible=false;
  if (grid) grid.visible=false;
  const vg=document.getElementById("view-grid"); vg.innerHTML="";
  VIEWS.forEach(({{key,label,dir}}) => {{
    const url=captureThumb(dir);
    const div=document.createElement("div"); div.className="view-thumb";
    const img=document.createElement("img"); img.src=url; img.alt=label;
    const sp=document.createElement("span"); sp.className="view-lbl"; sp.textContent=label;
    div.append(img,sp); div.addEventListener("click",()=>setView(key)); vg.appendChild(div);
  }});
  const sg=document.getElementById("section-grid"); sg.innerHTML="";
  ["x","y","z"].forEach(axis => {{
    const prev={{axis:clip.axis,pos:clip.pos,flip:clip.flip,clipOn:flags.clip}};
    clip.axis=axis; clip.pos=0.5; clip.flip=false; flags.clip=true;
    updateClip(); applyFlags();
    const url=captureThumb([1,-1,0.8]);
    clip.axis=prev.axis; clip.pos=prev.pos; clip.flip=prev.flip; flags.clip=prev.clipOn;
    updateClip(); applyFlags();
    const div=document.createElement("div"); div.className="view-thumb";
    const img=document.createElement("img"); img.src=url; img.alt="Coupe "+axis.toUpperCase();
    const sp=document.createElement("span"); sp.className="view-lbl"; sp.textContent="Coupe "+axis.toUpperCase();
    div.append(img,sp);
    div.addEventListener("click",()=>{{
      setView("iso"); clip.axis=axis; clip.pos=0.5; clip.flip=false; flags.clip=true;
      document.getElementById("clip-pos").value="0.5"; updateClip(); applyFlags();
    }});
    sg.appendChild(div);
  }});
  if (dimGroup) dimGroup.visible=dimWas;
  if (grid) grid.visible=flags.grid;
  camera.position.copy(savedCam); controls.target.copy(savedTarget); controls.update();
}}

/* ---- Camera ---- */
function fitView() {{
  const r=SIZE.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  camera.position.copy(CENTER).addScaledVector(new THREE.Vector3(1,-1,0.8).normalize(),r);
  controls.target.copy(CENTER); controls.update();
}}
function setView(name) {{
  const r=SIZE.length()/Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.65;
  const dir={{iso:[1,-1,0.8],top:[0,0,1],front:[0,-1,0],side:[1,0,0]}}[name]||[1,-1,0.8];
  camera.position.copy(CENTER).addScaledVector(new THREE.Vector3(...dir).normalize(),r);
  controls.target.copy(CENTER); controls.update();
}}

/* ---- applyFlags ---- */
function applyFlags() {{
  const {{wire,alpha,clip:doClip}} = flags;
  const planes = doClip ? [clip.plane] : [];
  meshes.forEach(mesh => {{
    if (!mesh.material) return;
    const mat=mesh.material;
    mat.wireframe=wire; mat.transparent=alpha; mat.opacity=alpha?.32:1;
    mat.depthWrite=!alpha; mat.clippingPlanes=planes;
    mat.side=doClip&&!alpha?THREE.FrontSide:THREE.DoubleSide; mat.needsUpdate=true;
  }});
  if (dimGroup) dimGroup.visible=flags.dims;
  if (grid) grid.visible=flags.grid;
  document.getElementById("clip-panel").hidden=!flags.clip;
  document.querySelectorAll("[data-toggle]").forEach(b=>b.setAttribute("aria-pressed",String(!!flags[b.dataset.toggle])));
  viewport.style.cursor=flags.annotate?"cell":"";
  if (flags.annotate) hint("Clique pour épingler une note. N pour quitter.");
  else if (!flags.clip) hint(null);
}}

/* ---- Section cut ---- */
function updateClip() {{
  const a=clip.axis;
  const n=new THREE.Vector3(a==="x"?1:0,a==="y"?1:0,a==="z"?1:0);
  if (!clip.flip) n.negate();
  const pos=BOX.min[a]+(BOX.max[a]-BOX.min[a])*clip.pos;
  clip.plane.normal.copy(n); clip.plane.constant=clip.flip?-pos:pos;
  document.getElementById("clip-value").textContent=a.toUpperCase()+" = "+pos.toFixed(1)+" mm";
  if (flags.clip) hint("Section : glisser le curseur. P pour quitter.");
}}
updateClip();

/* ---- Explode ---- */
function setExplode(v) {{
  meshes.forEach((mesh,i) => {{
    const off=basePosWorld[i].clone().sub(CENTER).multiplyScalar(v);
    mesh.position.copy(basePosWorld[i]).add(off);
  }});
}}

/* ---- Annotations ---- */
const annotations=[]; let annotNextId=1, annotPending=null, downXY=null;
const raycaster=new THREE.Raycaster();
const popup=document.getElementById("annot-popup");
const popupInput=document.getElementById("annot-input");
function clearAnnotations() {{
  annotations.forEach(a => {{ annotRoot.remove(a.dot); annotRoot.remove(a.lbl); }});
  annotations.length=0;
  document.getElementById("annotations-block").hidden=true;
}}
function showAnnotPopup(sx,sy,point) {{
  annotPending=point;
  popup.style.left=Math.min(sx+14,window.innerWidth-234)+"px";
  popup.style.top=Math.max(sy-42,8)+"px";
  popup.hidden=false; popupInput.value="";
  requestAnimationFrame(()=>popupInput.focus());
}}
function hideAnnotPopup() {{ popup.hidden=true; annotPending=null; }}
document.getElementById("annot-ok").addEventListener("click", confirmAnnot);
document.getElementById("annot-cancel").addEventListener("click", hideAnnotPopup);
popupInput.addEventListener("keydown", e => {{
  if (e.key==="Enter") {{ e.preventDefault(); confirmAnnot(); }}
  if (e.key==="Escape") hideAnnotPopup();
}});
document.addEventListener("pointerdown", e => {{
  if (!popup.hidden && !popup.contains(e.target)) hideAnnotPopup();
}}, {{capture:true}});
function confirmAnnot() {{
  const text=(popupInput.value||"").trim();
  if (!text||!annotPending) {{ hideAnnotPopup(); return; }}
  const num=annotations.length+1;
  const dot=new THREE.Mesh(
    new THREE.SphereGeometry(SIZE.length()*0.008,12,10),
    new THREE.MeshBasicMaterial({{color:0xc08a3e,depthTest:false}})
  );
  dot.position.copy(annotPending); dot.renderOrder=12; annotRoot.add(dot);
  const el=document.createElement("div"); el.className="annot-lbl";
  el.innerHTML=`<span class="annot-num">${{num}}</span><span class="annot-txt">${{esc(text)}}</span>`;
  const lbl=new CSS2DObject(el); lbl.position.copy(annotPending); annotRoot.add(lbl);
  const id=annotNextId++;
  annotations.push({{id,num,point:annotPending.clone(),text,dot,lbl}});
  refreshAnnotPanel(); hideAnnotPopup();
}}
function removeAnnotation(id) {{
  const i=annotations.findIndex(a=>a.id===id); if (i<0) return;
  const [a]=annotations.splice(i,1);
  annotRoot.remove(a.dot); annotRoot.remove(a.lbl);
  annotations.forEach((x,j)=>{{ const n=x.lbl.element.querySelector(".annot-num"); if(n) n.textContent=j+1; }});
  refreshAnnotPanel();
}}
function refreshAnnotPanel() {{
  const block=document.getElementById("annotations-block");
  const ul=document.getElementById("annot-list");
  block.hidden=annotations.length===0;
  ul.innerHTML=annotations.map((a,i)=>
    `<li class="annot-item"><span class="annot-num">${{i+1}}</span>
     <span class="annot-item-txt">${{esc(a.text)}}</span>
     <button class="annot-del" data-id="${{a.id}}">×</button></li>`).join("");
  ul.querySelectorAll(".annot-del").forEach(b=>b.addEventListener("click",()=>removeAnnotation(+b.dataset.id)));
}}
renderer.domElement.addEventListener("pointerdown", e=>{{ downXY=[e.clientX,e.clientY]; }});
renderer.domElement.addEventListener("pointerup",   e=>{{
  if (!downXY||Math.hypot(e.clientX-downXY[0],e.clientY-downXY[1])>4||e.button!==0) return;
  if (!flags.annotate||!meshes.length) return;
  const rect=renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((e.clientX-rect.left)/rect.width)*2-1,
    -((e.clientY-rect.top)/rect.height)*2+1
  ),camera);
  const hits=raycaster.intersectObjects(meshes,true);
  if (hits.length) showAnnotPopup(e.clientX,e.clientY,hits[0].point);
}});

/* ---- AI Analysis ---- */
let aiRunning=false;
document.getElementById("ai-btn").addEventListener("click", async ()=>{{
  if (aiRunning||!meshes.length) return;
  if (!sampleApi) {{ toast("Claude non disponible dans cet environnement.", true); return; }}
  aiRunning=true;
  const btn=document.getElementById("ai-btn");
  const out=document.getElementById("ai-output");
  btn.disabled=true; btn.textContent="Analyse en cours…";
  out.hidden=false; out.innerHTML=`<em style="color:var(--ink-2)">Analyse…</em>`;
  const names=meshes.map((m,i)=>m.name||("Mesh "+(i+1))).slice(0,20).join(", ");
  const prompt=`Tu es un ingénieur mécanique senior. Analyse cette pièce ou assemblage 3D :
Fichier : ${{modelName}}
Maillages : ${{meshes.length}} — Noms : ${{names}}
Enveloppe : ${{SIZE.x.toFixed(1)}} × ${{SIZE.y.toFixed(1)}} × ${{SIZE.z.toFixed(1)}} mm
Triangles : ${{Math.round(totalTris).toLocaleString()}}
Fournis une analyse technique concise (max 250 mots) : description, observations structurelles, fabrication, améliorations.
Réponds en français avec **gras** pour les titres de sections.`;
  try {{
    let fullText="";
    await sampleApi(prompt, {{ onText({{text}}) {{ fullText=text; out.innerHTML=renderMd(text); out.scrollTop=out.scrollHeight; }} }});
    out.innerHTML=renderMd(fullText);
  }} catch(err) {{
    out.innerHTML=`<span style="color:var(--alert)">Erreur : ${{esc(String(err.message||err))}}</span>`;
  }}
  btn.disabled=false; btn.textContent="Analyser avec Claude"; aiRunning=false;
}});

/* ---- Screenshot ---- */
async function screenshot() {{
  renderer.render(scene,camera);
  const ts=new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
  const name=(shortName(modelName)||"model")+"_"+ts+".png";
  if (downloadsApi) {{
    await new Promise(res=>renderer.domElement.toBlob(async blob=>{{
      try {{ await downloadsApi.save({{filename:name,data:blob}}); }} catch{{}}
      res();
    }},"image/png"));
  }} else {{
    const a=document.createElement("a"); a.href=renderer.domElement.toDataURL("image/png");
    a.download=name; a.click();
  }}
  toast("Screenshot enregistré.");
}}

/* ---- Toolbar events ---- */
function toggle(flag) {{ flags[flag]=!flags[flag]; if(flag==="clip"&&flags.clip) updateClip(); applyFlags(); }}
document.getElementById("toolbar").addEventListener("click",e=>{{
  const b=e.target.closest("button"); if (!b) return;
  if (b.dataset.view) setView(b.dataset.view);
  if (b.dataset.action==="fit") fitView();
  if (b.dataset.action==="shot") screenshot();
  if (b.dataset.toggle) toggle(b.dataset.toggle);
}});
document.getElementById("clip-pos").addEventListener("input",e=>{{ clip.pos=+e.target.value; updateClip(); }});
document.getElementById("clip-flip").addEventListener("click",()=>{{ clip.flip=!clip.flip; updateClip(); }});
document.querySelectorAll("[data-axis]").forEach(b=>b.addEventListener("click",()=>{{
  clip.axis=b.dataset.axis;
  document.querySelectorAll("[data-axis]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));
  updateClip();
}}));

/* ---- Keyboard ---- */
document.addEventListener("keydown",e=>{{
  if (e.target.matches("input,select,textarea")||!meshes.length) return;
  ({{i:()=>setView("iso"),x:()=>setView("top"),y:()=>setView("front"),z:()=>setView("side"),
    r:fitView,w:()=>toggle("wire"),t:()=>toggle("alpha"),b:()=>toggle("dims"),
    n:()=>toggle("annotate"),p:()=>toggle("clip"),f:screenshot,
    escape:()=>{{if(flags.annotate)toggle("annotate");else if(flags.clip)toggle("clip");hideAnnotPopup();}},
  }}[e.key.toLowerCase()]||(() => {{}}))();
}});

/* ---- File drop ---- */
const dropEl=document.getElementById("drop");
const fileInput=document.getElementById("file-input");
dropEl.addEventListener("dragover",e=>{{ e.preventDefault(); dropEl.classList.add("over"); }});
dropEl.addEventListener("dragleave",()=>dropEl.classList.remove("over"));
dropEl.addEventListener("drop",e=>{{ e.preventDefault(); dropEl.classList.remove("over"); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); }});
document.addEventListener("dragover",e=>e.preventDefault());
document.addEventListener("drop",e=>{{ e.preventDefault(); if(e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); }});
document.getElementById("btn-open").addEventListener("click",()=>fileInput.click());
document.getElementById("btn-browse").addEventListener("click",()=>fileInput.click());
fileInput.addEventListener("change",()=>{{ if(fileInput.files[0]) {{ loadFile(fileInput.files[0]); fileInput.value=""; }} }});

/* ---- Resize ---- */
function resize() {{
  const w=viewport.clientWidth, h=viewport.clientHeight;
  if (!w||!h) return;
  renderer.setSize(w,h); labelRenderer.setSize(w,h);
  camera.aspect=w/h; camera.updateProjectionMatrix();
}}
new ResizeObserver(resize).observe(viewport); resize();

/* ---- Loop ---- */
(function loop() {{ requestAnimationFrame(loop); controls.update(); renderer.render(scene,camera); labelRenderer.render(scene,camera); }})();

/* ---- Utilities ---- */
let toastTimer;
function toast(msg,error=false) {{
  const el=document.getElementById("toast");
  el.textContent=msg; el.className="toast"+(error?" error":""); el.hidden=false;
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{{el.hidden=true;}},error?7000:3500);
}}
function hint(text) {{ const el=document.getElementById("hint"); el.hidden=!text; el.textContent=text||""; }}
function esc(s) {{ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }}
function shortName(n) {{ return n?n.replace(/\\.[^.]+$/,"").slice(0,40):""; }}
function renderMd(md) {{
  return esc(md).replace(/\\*\\*(.+?)\\*\\*/g,"<strong>$1</strong>").replace(/\\n{{2,}}/g,"<br><br>").replace(/\\n/g,"<br>");
}}
</script>
</body>
</html>'''

out = pathlib.Path("/tmp/claude-501/viewer-final.html")
out.write_text(HTML)
size = out.stat().st_size
print(f"Fichier généré : {size:,} octets ({size/1024/1024:.1f} MB)")
