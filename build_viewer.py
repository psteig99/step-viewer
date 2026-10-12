"""
Build script for step-viewer.html (standalone, no server).

Source files (edit these):
  src/style.css        styles
  src/state.js         shared state / constants
  src/loader.js        WASM decompression + STEP parsing
  src/viewport.js      Three.js renderer, camera, lights, section cut, render loop
  src/tree.js          recursive assembly tree, rename, color picker
  src/annotations.js   3D-anchored annotation pins
  src/panel.js         right panel, thumbnails, AI analysis, screenshot
  src/events.js        toolbar, keyboard shortcuts, file drop, utilities

Build-time inputs — place next to this script before running:
  occt.wasm.gz         gzip-compressed WASM from occt-import-js@0.0.14
  occt.js              Emscripten JS glue from the same package

Quick way to get them:
  npm pack occt-import-js@0.0.14
  tar xf occt-import-js-0.0.14.tgz
  cp package/dist/occt-import-js.wasm occt.wasm
  gzip -k occt.wasm          # → occt.wasm.gz (~4.8 MB compressed)
  cp package/dist/occt-import-js.js occt.js

Then run:
  python3 build_viewer.py    # → step-viewer.html (~6.4 MB)
"""
import base64, pathlib, sys

HERE = pathlib.Path(__file__).parent

def need(name):
    p = HERE / name
    if not p.exists():
        sys.exit(f"Missing: {p}\nSee the docstring at the top of this script.")
    return p

def src(name):
    return (HERE / "src" / name).read_text(encoding="utf-8")

WASM_B64 = base64.b64encode(need("occt.wasm.gz").read_bytes()).decode()
OCCT_JS  = need("occt.js").read_text(encoding="utf-8")

CSS = src("style.css")

# JS modules concatenated in dependency order.
# WASM_GZ_B64 const is injected first so loader.js can reference it.
JS = "\n".join([
    f'const WASM_GZ_B64 = "{WASM_B64}";',
    src("state.js"),
    src("viewport.js"),    # defines renderer, camera, scene — needed by all below
    src("tree.js"),        # depends on state, viewport
    src("annotations.js"), # depends on state, viewport
    src("panel.js"),       # depends on state, viewport, annotations
    src("events.js"),      # depends on all above
    src("loader.js"),      # calls registerModel (defined in viewport.js)
    "updateClip();",       # initialize clip plane display
])

HTML = """\
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>STEP Viewer</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap">
<style>
__CSS__
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
        <p style="font-size:12px;margin-top:12px">Parsing 100 % dans le navigateur via WebAssembly — aucun serveur.</p>
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
        <p>Souris : drag = tourner · scroll = zoom · clic droit = déplacer</p>
        <p>Maillages : dbl-clic pour renommer · clic en mode Notes pour annoter</p>
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

<!-- OCCT-import-js Emscripten glue (embedded) -->
<script>
__OCCT_JS__
</script>

<script type="importmap">
{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/"}}
</script>

<script type="module">
import * as THREE from "three";
import { OrbitControls }   from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";

__JS__
</script>
</body>
</html>"""

HTML = (HTML
    .replace("__CSS__",     CSS)
    .replace("__OCCT_JS__", OCCT_JS)
    .replace("__JS__",      JS))

out  = HERE / "step-viewer.html"
out.write_text(HTML, encoding="utf-8")
size = out.stat().st_size
print(f"Written: {out}  ({size/1024/1024:.1f} MB)")
