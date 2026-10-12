# Standalone version (single HTML file)

`step-viewer.html` (~6.4 MB) is a fully self-contained STEP viewer — no server, no install.
Drop it in a browser tab, on SharePoint, or send it by email. Nothing leaves the browser.

**Features:**
- STEP parsing via OpenCASCADE compiled to WebAssembly (`occt-import-js@0.0.14`, embedded)
- Recursive assembly tree inferred from mesh names (`:` separator), unlimited depth
- Collapse/expand all · search/filter by name
- Hover a row → highlight in 3D · click → camera fly-to · double-click group → fit group
- ✏ inline rename on every mesh (hover to reveal button, or double-click the name)
- Click a color swatch → native color picker, updates the mesh live
- Section cut (X/Y/Z), transparency, dimension readout
- AI analysis via `sample` capability (claude.ai artifact only)
- PNG screenshot download

## Rebuild `step-viewer.html`

The build script (`build_viewer.py`) embeds the WASM binary directly into the HTML so no network
fetch is needed at runtime. You need to supply the two WASM files once:

```bash
cd standalone

# 1. Get the WASM files from occt-import-js@0.0.14
npm pack occt-import-js@0.0.14
tar xf occt-import-js-0.0.14.tgz
cp package/dist/occt-import-js.wasm occt.wasm
gzip -k occt.wasm          # → occt.wasm.gz (~4.8 MB compressed)
cp package/dist/occt-import-js.js occt.js

# 2. Build
python3 build_viewer.py    # → step-viewer.html (~6.4 MB)
```

`occt.wasm.gz` and `occt.js` are not committed (see `.gitignore`) — they are build-time inputs only.

## Simple interface "Section + AI analysis"

`simple/coupe-step-ia.html`: drop a STEP, section it at a free angle (azimuth, elevation, position,
side), analyse the section with Claude. AI analysis works when the page is published as a claude.ai
artifact (the `sample` capability with images). Rebuild: `npm install && npm run build:simple`.
