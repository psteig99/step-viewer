"""Command-line interface.

    stepviewer view   piece.step [--material pet]
    stepviewer info   piece.step [--material pet] [--json out.json]
    stepviewer report piece.step [--material pet] [-o report.html]
    stepviewer export piece.step output.stl|.obj|.glb|.3mf  [--parts]
    stepviewer batch  folder/ [-o summary.csv] [--html] [--material pet]
    stepviewer fit    piece.step --box 400x300x250 [--clearance 2] [--palette euro]
    stepviewer web [--network] [--port 8000] [--password secret]   (web application)
    stepviewer materials
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import __version__
from .analysis import MATERIALS, analyse, interference_check
from .export import SUPPORTED, export_parts, export_scene
from .fit import PALLETS, fit_in_container, fit_on_pallet
from .loader import StepLoadError, find_step_files, load_step
from .report import csv_report, html_report, json_report, text_report

log = logging.getLogger("stepviewer")


def _dims(text: str) -> tuple[float, float, float]:
    try:
        a, b, c = (float(x) for x in text.lower().replace(",", ".").split("x"))
        return a, b, c
    except ValueError as exc:
        raise argparse.ArgumentTypeError("expected format: LxWxH in mm, e.g. 400x300x250") from exc


def _ask_file() -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None
    root = tk.Tk()
    root.withdraw()
    f = filedialog.askopenfilename(title="Open a STEP file",
                                   filetypes=[("STEP files", "*.step *.stp *.STEP *.STP"), ("All", "*.*")])
    root.destroy()
    return Path(f) if f else None


def _load(args) -> tuple:
    path = Path(args.file) if getattr(args, "file", None) else _ask_file()
    if path is None:
        sys.exit("No file selected.")
    scene = load_step(path, tol_linear=args.tol)
    info = analyse(scene, material=args.material, density=args.density)
    return path, scene, info


# ----------------------------------------------------------------------------
def cmd_view(args) -> None:
    from .viewer import show
    path, scene, info = _load(args)
    print(text_report(info))
    show(scene, info, screenshot_dir=args.screenshots)


def cmd_info(args) -> None:
    path, scene, info = _load(args)
    print(text_report(info))
    if len(scene.geometry) > 1:
        hits = interference_check(scene)
        if hits:
            print(f"Bounding box overlaps ({len(hits)}):")
            for a, b in hits[:10]:
                print(f"  - {a}  <->  {b}")
    if args.json:
        print(f"JSON -> {json_report(info, Path(args.json))}")


def cmd_report(args) -> None:
    if args.tol == 0.2:          # lighter default for a shareable HTML file
        args.tol = 0.5
    path, scene, info = _load(args)
    out = Path(args.output) if args.output else path.with_suffix(".html")
    html_report(info, scene, out, embed_3d=not args.no_3d)
    print(text_report(info))
    print(f"HTML report -> {out}")


def cmd_export(args) -> None:
    path, scene, info = _load(args)
    if args.parts:
        outs = export_parts(scene, Path(args.output_file), fmt=args.format)
        print(f"{len(outs)} file(s) -> {Path(args.output_file)}")
    else:
        print(f"Exported -> {export_scene(scene, args.output_file)}")


def cmd_batch(args) -> None:
    files = find_step_files(args.folder, recursive=not args.no_recursive)
    if not files:
        sys.exit(f"No STEP files found in {args.folder}")
    infos, errors = [], []
    for i, f in enumerate(files, 1):
        print(f"[{i}/{len(files)}] {f.name} ...", end=" ", flush=True)
        try:
            scene = load_step(f, tol_linear=args.tol)
            info = analyse(scene, material=args.material, density=args.density)
            infos.append(info)
            L, l, h = info.dimensions_mm
            print(f"{L:g} x {l:g} x {h:g} mm")
            if args.html:
                html_report(info, scene, f.with_suffix(".html"))
        except StepLoadError as exc:
            errors.append((f, str(exc)))
            print(f"ERROR: {exc}")
    out = Path(args.output) if args.output else Path(args.folder) / "step_summary.csv"
    csv_report(infos, out)
    print(f"\n{len(infos)} file(s) analysed, {len(errors)} error(s). CSV summary -> {out}")


def cmd_fit(args) -> None:
    path, scene, info = _load(args)
    unit = info.oriented_dimensions_mm if args.oriented else info.dimensions_mm
    print(text_report(info))
    if args.box:
        r = fit_in_container(unit, args.box, clearance=args.clearance, allow_rotation=not args.upright)
        o = " x ".join(f"{x:g}" for x in r.orientation_mm)
        print(f"\nPacking in a box {args.box[0]:g} x {args.box[1]:g} x {args.box[2]:g} mm "
              f"(clearance {args.clearance} mm):")
        print(f"  {r.quantity} unit(s)   ({r.per_axis[0]} x {r.per_axis[1]} x {r.per_axis[2]}, "
              f"oriented unit {o} mm)   fill {r.fill_rate_pct} %")
        if info.mass_g is not None:
            print(f"  Product mass per box: {r.quantity * info.mass_g / 1000:.2f} kg")
        if args.palette:
            p = fit_on_pallet(args.box, args.palette, max_height=args.max_height)
            print(f"  Pallet {args.palette} (max h {args.max_height:g} mm): {p.quantity} box(es) "
                  f"({p.per_axis[0]} x {p.per_axis[1]} x {p.per_axis[2]} layers) "
                  f"-> {p.quantity * r.quantity} units / pallet")
    elif args.palette:
        p = fit_on_pallet(unit, args.palette, max_height=args.max_height)
        print(f"\nPallet {args.palette}: {p.quantity} direct unit(s), fill {p.fill_rate_pct} %")


def cmd_web(args) -> None:
    from .server import run
    run(host="0.0.0.0" if args.network else "127.0.0.1", port=args.port, reload=args.dev, password=args.password)


def cmd_materials(args) -> None:
    print("Material           density (g/cm³)")
    for k, v in sorted(MATERIALS.items()):
        print(f"  {k:<16} {v}")


# ----------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="stepviewer", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", action="version", version=f"stepviewer {__version__}")
    ap.add_argument("-v", "--verbose", action="store_true", help="verbose logging")
    sub = ap.add_subparsers(dest="cmd")

    def common(p, file_required=False):
        p.add_argument("file", nargs=None if file_required else "?", help=".step / .stp file")
        p.add_argument("--material", "-m", help="material for mass estimation (see 'materials')")
        p.add_argument("--density", "-d", type=float, help="custom density in g/cm³")
        p.add_argument("--tol", type=float, default=0.2, help="mesh tolerance in mm (default 0.2)")

    p = sub.add_parser("view", help="open the 3D viewer")
    common(p)
    p.add_argument("--screenshots", help="screenshot folder (press F)")
    p.set_defaults(func=cmd_view)

    p = sub.add_parser("info", help="text report (no window)")
    common(p)
    p.add_argument("--json", help="also write a JSON file")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("report", help="standalone HTML report with embedded 3D")
    common(p)
    p.add_argument("-o", "--output", help="output .html file")
    p.add_argument("--no-3d", action="store_true", help="without 3D viewer (smaller file)")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("export", help=f"export ({', '.join(SUPPORTED)})")
    common(p, file_required=True)
    p.add_argument("output_file", help="output file, or folder with --parts")
    p.add_argument("--parts", action="store_true", help="one file per part")
    p.add_argument("--format", default="stl", help="format with --parts (default stl)")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("batch", help="analyse all STEP files in a folder -> CSV")
    p.add_argument("folder")
    p.add_argument("-o", "--output", help="summary CSV")
    p.add_argument("--html", action="store_true", help="also generate an HTML report per file")
    p.add_argument("--no-recursive", action="store_true")
    p.add_argument("--material", "-m")
    p.add_argument("--density", "-d", type=float)
    p.add_argument("--tol", type=float, default=0.5)
    p.set_defaults(func=cmd_batch)

    p = sub.add_parser("fit", help="packing: units per box / boxes per pallet")
    common(p)
    p.add_argument("--box", type=_dims, help="inner dimensions LxWxH in mm, e.g. 400x300x250")
    p.add_argument("--clearance", type=float, default=0.0, help="clearance around each unit (mm)")
    p.add_argument("--upright", action="store_true", help="forbid rotation of the unit")
    p.add_argument("--oriented", action="store_true", help="use the minimal oriented footprint")
    p.add_argument("--palette", choices=sorted(PALLETS), help="pallet format")
    p.add_argument("--max-height", type=float, default=1800.0, help="max pallet height including pallet (mm)")
    p.set_defaults(func=cmd_fit)

    p = sub.add_parser("web", help="launch the web application")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--network", action="store_true", help="accessible from other machines on the network")
    p.add_argument("--dev", action="store_true", help="auto-reload (development)")
    p.add_argument("--password", help="protect access with a password (any username)")
    p.set_defaults(func=cmd_web)

    p = sub.add_parser("materials", help="list known materials")
    p.set_defaults(func=cmd_materials)
    return ap


def main(argv: list[str] | None = None) -> None:
    ap = build_parser()
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    if args.cmd is None:
        # Double-click / launched without arguments: viewer with file dialog
        args = ap.parse_args(["view"])
    try:
        args.func(args)
    except StepLoadError as exc:
        sys.exit(f"Error: {exc}")
    except ValueError as exc:
        sys.exit(f"Error: {exc}")
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
