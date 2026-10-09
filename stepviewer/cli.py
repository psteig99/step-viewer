"""Interface en ligne de commande.

    stepviewer view   piece.step [--material pet]
    stepviewer info   piece.step [--material pet] [--json out.json]
    stepviewer report piece.step [--material pet] [-o rapport.html]
    stepviewer export piece.step sortie.stl|.obj|.glb|.3mf  [--parts]
    stepviewer batch  dossier/ [-o synthese.csv] [--html] [--material pet]
    stepviewer fit    piece.step --carton 400x300x250 [--jeu 2] [--palette euro]
    stepviewer web [--reseau] [--port 8000] [--mot-de-passe secret]   (application web)
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
        raise argparse.ArgumentTypeError("format attendu : LxlxH en mm, ex. 400x300x250") from exc


def _ask_file() -> Path | None:
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return None
    root = tk.Tk()
    root.withdraw()
    f = filedialog.askopenfilename(title="Ouvrir un fichier STEP",
                                   filetypes=[("Fichiers STEP", "*.step *.stp *.STEP *.STP"), ("Tous", "*.*")])
    root.destroy()
    return Path(f) if f else None


def _load(args) -> tuple:
    path = Path(args.fichier) if getattr(args, "fichier", None) else _ask_file()
    if path is None:
        sys.exit("Aucun fichier sélectionné.")
    scene = load_step(path, tol_linear=args.tol)
    info = analyse(scene, material=args.material, density=args.density)
    return path, scene, info


# ----------------------------------------------------------------------------
def cmd_view(args) -> None:
    from .viewer import show
    path, scene, info = _load(args)
    print(text_report(info))
    show(scene, info, screenshot_dir=args.captures)


def cmd_info(args) -> None:
    path, scene, info = _load(args)
    print(text_report(info))
    if len(scene.geometry) > 1:
        hits = interference_check(scene)
        if hits:
            print(f"Chevauchements de boîtes englobantes ({len(hits)}) :")
            for a, b in hits[:10]:
                print(f"  - {a}  <->  {b}")
    if args.json:
        print(f"JSON -> {json_report(info, Path(args.json))}")


def cmd_report(args) -> None:
    if args.tol == 0.2:          # défaut plus léger pour un fichier HTML partageable
        args.tol = 0.5
    path, scene, info = _load(args)
    out = Path(args.output) if args.output else path.with_suffix(".html")
    html_report(info, scene, out, embed_3d=not args.no_3d)
    print(text_report(info))
    print(f"Rapport HTML -> {out}")


def cmd_export(args) -> None:
    path, scene, info = _load(args)
    if args.parts:
        outs = export_parts(scene, Path(args.sortie), fmt=args.format)
        print(f"{len(outs)} fichier(s) -> {Path(args.sortie)}")
    else:
        print(f"Exporté -> {export_scene(scene, args.sortie)}")


def cmd_batch(args) -> None:
    files = find_step_files(args.dossier, recursive=not args.no_recursive)
    if not files:
        sys.exit(f"Aucun fichier STEP dans {args.dossier}")
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
            print(f"ERREUR : {exc}")
    out = Path(args.output) if args.output else Path(args.dossier) / "synthese_step.csv"
    csv_report(infos, out)
    print(f"\n{len(infos)} fichier(s) analysé(s), {len(errors)} erreur(s). Synthèse CSV -> {out}")


def cmd_fit(args) -> None:
    path, scene, info = _load(args)
    unit = info.dimensions_orientees_mm if args.oriente else info.dimensions_mm
    print(text_report(info))
    if args.carton:
        r = fit_in_container(unit, args.carton, clearance=args.jeu, allow_rotation=not args.debout)
        o = " x ".join(f"{x:g}" for x in r.orientation_mm)
        print(f"\nColisage dans un carton {args.carton[0]:g} x {args.carton[1]:g} x {args.carton[2]:g} mm "
              f"(jeu {args.jeu} mm) :")
        print(f"  {r.quantite} unité(s)   ({r.par_axe[0]} x {r.par_axe[1]} x {r.par_axe[2]}, "
              f"unité orientée {o} mm)   occupation {r.taux_occupation_pct} %")
        if info.masse_g is not None:
            print(f"  Masse produit par carton : {r.quantite * info.masse_g / 1000:.2f} kg")
        if args.palette:
            p = fit_on_pallet(args.carton, args.palette, max_height=args.hauteur)
            print(f"  Palette {args.palette} (h max {args.hauteur:g} mm) : {p.quantite} carton(s) "
                  f"({p.par_axe[0]} x {p.par_axe[1]} x {p.par_axe[2]} couches) "
                  f"-> {p.quantite * r.quantite} unités / palette")
    elif args.palette:
        p = fit_on_pallet(unit, args.palette, max_height=args.hauteur)
        print(f"\nPalette {args.palette} : {p.quantite} unité(s) directes, occupation {p.taux_occupation_pct} %")


def cmd_web(args) -> None:
    from .server import run
    run(host="0.0.0.0" if args.reseau else "127.0.0.1", port=args.port, reload=args.dev, password=args.mot_de_passe)


def cmd_materials(args) -> None:
    print("Matériau          densité (g/cm³)")
    for k, v in sorted(MATERIALS.items()):
        print(f"  {k:<16} {v}")


# ----------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="stepviewer", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", action="version", version=f"stepviewer {__version__}")
    ap.add_argument("-v", "--verbose", action="store_true", help="journal détaillé")
    sub = ap.add_subparsers(dest="cmd")

    def common(p, file_required=False):
        p.add_argument("fichier", nargs=None if file_required else "?", help="fichier .step / .stp")
        p.add_argument("--material", "-m", help="matériau pour la masse (voir « materials »)")
        p.add_argument("--density", "-d", type=float, help="densité personnalisée en g/cm³")
        p.add_argument("--tol", type=float, default=0.2, help="finesse de maillage en mm (défaut 0.2)")

    p = sub.add_parser("view", help="ouvrir la visionneuse 3D")
    common(p)
    p.add_argument("--captures", help="dossier des captures d'écran (touche F)")
    p.set_defaults(func=cmd_view)

    p = sub.add_parser("info", help="rapport texte (sans fenêtre)")
    common(p)
    p.add_argument("--json", help="écrire aussi un JSON")
    p.set_defaults(func=cmd_info)

    p = sub.add_parser("report", help="rapport HTML autonome avec 3D intégrée")
    common(p)
    p.add_argument("-o", "--output", help="fichier .html de sortie")
    p.add_argument("--no-3d", action="store_true", help="sans visionneuse 3D (fichier plus léger)")
    p.set_defaults(func=cmd_report)

    p = sub.add_parser("export", help=f"exporter ({', '.join(SUPPORTED)})")
    common(p, file_required=True)
    p.add_argument("sortie", help="fichier de sortie, ou dossier avec --parts")
    p.add_argument("--parts", action="store_true", help="un fichier par pièce")
    p.add_argument("--format", default="stl", help="format avec --parts (défaut stl)")
    p.set_defaults(func=cmd_export)

    p = sub.add_parser("batch", help="analyser tous les STEP d'un dossier -> CSV")
    p.add_argument("dossier")
    p.add_argument("-o", "--output", help="CSV de synthèse")
    p.add_argument("--html", action="store_true", help="générer aussi un rapport HTML par fichier")
    p.add_argument("--no-recursive", action="store_true")
    p.add_argument("--material", "-m")
    p.add_argument("--density", "-d", type=float)
    p.add_argument("--tol", type=float, default=0.5)
    p.set_defaults(func=cmd_batch)

    p = sub.add_parser("fit", help="colisage : unités par carton / cartons par palette")
    common(p)
    p.add_argument("--carton", type=_dims, help="dimensions intérieures LxlxH en mm, ex. 400x300x250")
    p.add_argument("--jeu", type=float, default=0.0, help="jeu autour de chaque unité (mm)")
    p.add_argument("--debout", action="store_true", help="interdire la rotation de l'unité")
    p.add_argument("--oriente", action="store_true", help="utiliser l'encombrement orienté minimal")
    p.add_argument("--palette", choices=sorted(PALLETS), help="format de palette")
    p.add_argument("--hauteur", type=float, default=1800.0, help="hauteur palette max, palette comprise (mm)")
    p.set_defaults(func=cmd_fit)

    p = sub.add_parser("web", help="lancer l'application web")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reseau", action="store_true", help="accessible depuis les autres postes du réseau")
    p.add_argument("--dev", action="store_true", help="rechargement automatique (développement)")
    p.add_argument("--mot-de-passe", help="protéger l'accès par un mot de passe (n'importe quel identifiant)")
    p.set_defaults(func=cmd_web)

    p = sub.add_parser("materials", help="lister les matériaux connus")
    p.set_defaults(func=cmd_materials)
    return ap


def main(argv: list[str] | None = None) -> None:
    ap = build_parser()
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING,
                        format="%(levelname)s %(name)s: %(message)s")
    if args.cmd is None:
        # Double-clic / lancement sans argument : visionneuse avec boîte de dialogue
        args = ap.parse_args(["view"])
    try:
        args.func(args)
    except StepLoadError as exc:
        sys.exit(f"Erreur : {exc}")
    except ValueError as exc:
        sys.exit(f"Erreur : {exc}")
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
