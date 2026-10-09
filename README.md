# STEP Viewer

![tests](https://github.com/psteig99/step-viewer/actions/workflows/tests.yml/badge.svg)

Open, inspect and analyse CAD **STEP** files for packaging work, without a CAD licence: 3D viewer with dimension
lines, section cuts at any angle, wall-thickness estimate, mass per material, carton/pallet packing, assembly tree,
exports, and a Claude-powered page that analyses saved section views. Runs as a Python CLI, a shared web server,
or a single HTML file. Full documentation follows.

![architecture](docs/architecture.png)

---

**Web application** for reading, viewing and analysing CAD **STEP** (.step / .stp) files for packaging teams:
drag-and-drop upload, 3D viewer in the browser with dimensions drawn on the part, measurement, section cut,
exploded view, estimated volume and mass by material, carton/pallet packing, shareable exports and reports.
Also includes a command line (batch processing, reports) and a desktop viewer.

No CAD licence or conda required: the OpenCASCADE kernel is bundled via `cascadio` (pip). The browser needs
no internet access (three.js is bundled with the application): works on a closed intranet.

## Two ways to use it

| | Standalone version | Server version |
|---|---|---|
| File | `standalone/step-viewer.html` (double-click, email, intranet) | `stepviewer web` on a workstation or server |
| Installation | none | Python + `pip install` |
| STEP reading | in the browser (WebAssembly) | on the server (faster for large assemblies) |
| Data | never leaves the browser | stays on your server |
| Extra | — | oriented footprint, 3MF, report with embedded 3D, REST API, batch processing |

To get started immediately: open `standalone/step-viewer.html` and drop a STEP file onto it.

## Web application (server version)

```bash
# Windows: double-click scripts\web.bat   |   macOS / Linux: ./scripts/web.sh
# or: stepviewer web --reseau
```
Then open http://localhost:8000 (or http://machine-ip:8000 from another PC on the network).

1. **Drop** one or more .step / .stp files onto the page (drag-and-drop, "Open" button, or paste).
2. The part is displayed in 3D with its **overall dimensions** drawn as on a technical drawing; open files
   appear as tabs in the top bar.
3. Toolbar: views (iso, top, front, side), wireframe, transparency, grid, **measure** (two clicks → distance and
   dX/dY/dZ), **section cut** (X/Y/Z plane, slidable, invertible; cut material appears in ochre to read wall thicknesses),
   **exploded view**, **PNG capture**.
4. Right panel: footprint (and minimal oriented footprint), volumes, **mass** based on the chosen material,
   parts list (show/hide, click to highlight), **carton and pallet packing** live,
   downloads (HTML report with embedded 3D, JSON, STL, OBJ, GLB, 3MF).
5. **Compare two revisions**: open both files, then under "Compare with another revision" choose the reference;
   it is overlaid in translucent red on the current part and a table shows the dimension, volume and surface differences.

Password protection (recommended when the tool is accessible to multiple workstations):
`stepviewer web --reseau --mot-de-passe secret` or environment variable `STEPVIEWER_PASSWORD`. The browser
then prompts for the password (the username is free).

Keyboard shortcuts: I X Y Z views · R re-fit · W wireframe · T transparency · B dimensions · M measure · P section cut · F capture · Esc.

REST API documented at http://localhost:8000/api/docs (upload, analysis, exports, packing) to connect
other tools. Files remain on the server in a temporary folder purged after 6 h of inactivity.

Deployment on an internal server: `uvicorn stepviewer.server:app --host 0.0.0.0 --port 8000`
(behind an HTTPS reverse proxy if needed; set `STEPVIEWER_PASSWORD` to require a password).

## Installation (once)

```bash
# Windows: double-click scripts\install.bat
# macOS / Linux:
./scripts/install.sh
```
Prerequisite: Python 3.10+ (https://www.python.org, check "Add to PATH" on Windows).

Manual installation: `pip install -e ".[web,dev]"` in the project folder.

## Quick reference

| Need | Command |
|---|---|
| Open the viewer (file dialog) | `stepviewer` or `scripts\stepviewer.bat` |
| View a file | `stepviewer view piece.step -m pet` |
| Text report only | `stepviewer info piece.step -m hdpe --json piece.json` |
| Standalone HTML report with embedded 3D (to send by email) | `stepviewer report piece.step -m pet` |
| Export STL / OBJ / GLB / 3MF | `stepviewer export piece.step piece.stl` (`--parts`: one file per part) |
| Analyse an entire folder → Excel CSV | `stepviewer batch dossier_step/ --html -m pet` |
| Packing: units per carton and cartons per pallet | `stepviewer fit piece.step --carton 400x300x250 --jeu 2 --palette euro -m pet` |
| Web application for the team | `stepviewer web --reseau` then http://machine-ip:8000 |
| Known materials | `stepviewer materials` |

Common options: `-m/--material` (pet, hdpe, pp, glass, cardboard, aluminium…), `-d/--density` (free g/cm³),
`--tol` (mesh fineness in mm, default 0.2; 0.5 for lighter files).

## Desktop viewer (optional) – keyboard shortcuts

| Key | Action |
|---|---|
| W / S | wireframe / surfaces |
| T | transparency (see the product inside its packaging) |
| B / O | bounding box / minimal **oriented** bounding box |
| X Y Z / I / R | top, front, side views / isometric / re-fit |
| E / D / A | exploded + / – / cancel |
| M then **right-click** on 2 points | measurement: distance and dX dY dZ in mm (C: clear) |
| P / N | section plane / change section axis |
| 1…9 / 0 | isolate a part / show all |
| F | high-resolution PNG screenshot |
| H / Q | help / quit |

Mouse: left-click rotate, scroll wheel zoom, middle-click (or Shift + left) pan.

## What the analysis computes

- **Overall dims** X × Y × Z in the file coordinate system, and **oriented footprint** (minimal bounding box) if the part is modelled at an angle.
- **Material volume** (closed mesh required — flagged otherwise), **bounding volume**, **fill rate**, **surface area**.
- **Est. mass** = volume × density of the chosen material (table editable in `stepviewer/analysis.py`).
- **Estimated wall thickness** (2·V/S) for hollow bodies: bottles, jars, cases.
- **Warnings**: suspicious unit (inches / metres), tilted part, open mesh, overlapping parts in an assembly.
- **Packing**: best orientation among 6, adjustable clearance, "upright only" option (no rotation), euro / iso / US / half-euro pallets.

## Project structure

```
stepviewer/
  loader.py     STEP reading -> mm meshes (cache, cleanup)
  analysis.py   dimensions, volumes, mass, wall thickness, materials
  fit.py        carton / pallet packing
  report.py     text, JSON, CSV, HTML + embedded 3D reports
  export.py     STL / OBJ / GLB / 3MF / PLY
  server.py     FastAPI web server (API + interface)
  static/       web interface: index.html, app.js, app.css, bundled three.js
  viewer.py     desktop 3D viewer (pyvista)
  cli.py        command line
tests/          pytest (python -m pytest)
samples/        sample file
scripts/        installation and launch scripts for Windows / macOS / Linux
```

## Known limitations

- Reading by tessellation: no construction tree or geometry editing; dimensions are those of the mesh (precision = `--tol`).
- Units are assumed to be millimetres after conversion; a warning is shown if dimensions seem inconsistent.
- The wall thickness estimate is global per part; for a detailed map, use the section plane + measurement.
- Packing is a single-orientation grid calculation (pre-sizing), without accounting for actual part shapes.
- Web authentication is a single shared password (HTTP Basic): sufficient internally, put behind
  HTTPS if the tool leaves the local network.

## Technical documentation

See [docs/TECHNICAL.md](docs/TECHNICAL.md): STEP reading, analysis engine, server, viewer, browser version, section cut + AI, assembly tree, tests.

## Tests

```bash
python -m pytest                 # engine, reports, web API
cd tests/ui && npm install && npm test   # interface in a headless Chromium (server started on port 8765)
```
