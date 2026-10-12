# STEP Viewer

A fully standalone STEP file viewer — one HTML file, no server, no install.

Drop `step-viewer.html` in a browser tab, send it by email, or embed it via `<iframe>`.  
Everything runs in the browser: parsing, rendering, AI analysis. Nothing leaves the device.

## Features

- STEP parsing via OpenCASCADE / WebAssembly (`occt-import-js@0.0.14`, embedded)
- Recursive assembly tree from mesh names, unlimited depth
- Collapse / expand · search / filter
- Hover → highlight in 3D · click → camera fly-to · double-click group → fit
- Inline rename (hover ✏ or double-click) · click swatch to change mesh color
- Section cut (X / Y / Z), transparency, bounding-box dimensions
- AI analysis (claude.ai `sample` capability) · PNG screenshot

## Use

Open `step-viewer.html` directly in any modern browser.

## Rebuild

Requires `occt.wasm.gz` and `occt.js` next to `build_viewer.py` (see the docstring in that file for how to extract them from the npm package).

```bash
python3 build_viewer.py   # writes step-viewer.html (~6.4 MB)
```

## License

MIT
