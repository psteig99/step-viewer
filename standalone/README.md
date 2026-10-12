# Standalone version (single HTML file)

`step-viewer.html` is the same application as the web interface, but **without a server**: STEP reading is handled
by OpenCASCADE compiled to WebAssembly (`occt-import-js`), and the analysis and packaging calculations are
rewritten in JavaScript (`src/engine.js`). The file opens with a double-click, can be emailed, dropped on an
intranet or SharePoint, and no data leaves the browser.

Rebuild after modifying `src/` or `../stepviewer/static/index.html` / `app.css`:

```bash
cd standalone
npm install
npm run build      # produces step-viewer.html (~5 MB)
```

Differences from the server version: no minimum oriented bounding box, HTML report with screenshot instead of
embedded 3D, no 3MF export. Reading a typical STEP file: 1 to 3 s on a desktop PC.

## Simple interface "Section + AI analysis"

`simple/coupe-step-ia.html`: three steps only — drop the STEP, section it at a free angle (azimuth,
elevation, position, side), analyse the section with Claude. AI analysis works when the page is published
as a claude.ai artifact (the `sample` capability with images: the page sends the section screenshot, the full view
and the measurements, charged to the account of the person using it). Opened elsewhere, the page offers to save
the screenshot for manual submission. Rebuild: `npm run build:simple`.

Assembly structure in the simple page: the STEP tree (`result.root` from occt-import-js) is displayed with
collapsible nodes, show/hide checkboxes by sub-assembly, summed dimensions and volumes, instance badges;
bidirectional tree ⇄ 3D selection with framing; B-rep face hover (`brep_faces`); automatic groupings
(colour, name, volume, contact) and renaming; the indented tree and hidden parts of each section are
passed to the AI.
