"""Rapports : texte console, JSON, CSV et page HTML autonome avec 3D intégrée."""
from __future__ import annotations

import csv
import html
import json
from datetime import datetime
from pathlib import Path

import trimesh

from .analysis import ModelInfo


# ----------------------------------------------------------------------------
# Texte
# ----------------------------------------------------------------------------
def text_report(info: ModelInfo) -> str:
    L, l, h = info.dimensions_mm
    Lo, lo, ho = info.dimensions_orientees_mm
    lines = [
        "=" * 70,
        f"Fichier          : {info.fichier}",
        f"Pièces           : {info.pieces}   (triangles : {info.triangles:,})".replace(",", " "),
        f"Hors-tout        : {L} x {l} x {h} mm  (X x Y x Z)",
        f"Orienté (min)    : {Lo} x {lo} x {ho} mm",
        f"Vol. englobant   : {info.volume_englobant_cm3} cm³",
        f"Vol. matière     : {info.volume_matiere_cm3} cm³   (remplissage {info.taux_remplissage_pct} %)",
        f"Surface          : {info.surface_cm2} cm²",
    ]
    if info.masse_g is not None:
        lines.append(f"Masse estimée    : {info.masse_g} g   ({info.materiau}, {info.densite_g_cm3} g/cm³)")
    lines.append("-" * 70)
    for p in info.details:
        d = " x ".join(f"{x:g}" for x in p.dimensions_mm)
        v = f"{p.volume_cm3} cm³" if p.volume_cm3 is not None else "n/a"
        m = f"  {p.masse_g} g" if p.masse_g is not None else ""
        e = f"  ép.~{p.epaisseur_mm_estimee} mm" if p.epaisseur_mm_estimee else ""
        flag = "" if p.etanche else "  [non fermé]"
        lines.append(f"  - {p.nom[:28]:<28} {d:>24} mm  {v:>12}{m}{e}{flag}")
    if info.avertissements:
        lines.append("-" * 70)
        lines += [f"  ! {w}" for w in info.avertissements]
    lines.append("=" * 70)
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# JSON / CSV
# ----------------------------------------------------------------------------
def json_report(info: ModelInfo, out: Path) -> Path:
    out.write_text(json.dumps(info.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return out


CSV_FIELDS = ["fichier", "pieces", "L_mm", "l_mm", "h_mm", "Lo_mm", "lo_mm", "ho_mm",
              "volume_englobant_cm3", "volume_matiere_cm3", "taux_remplissage_pct",
              "surface_cm2", "materiau", "masse_g", "avertissements"]


def csv_rows(infos: list[ModelInfo]) -> list[dict]:
    rows = []
    for i in infos:
        rows.append({
            "fichier": i.fichier, "pieces": i.pieces,
            "L_mm": i.dimensions_mm[0], "l_mm": i.dimensions_mm[1], "h_mm": i.dimensions_mm[2],
            "Lo_mm": i.dimensions_orientees_mm[0], "lo_mm": i.dimensions_orientees_mm[1],
            "ho_mm": i.dimensions_orientees_mm[2],
            "volume_englobant_cm3": i.volume_englobant_cm3, "volume_matiere_cm3": i.volume_matiere_cm3,
            "taux_remplissage_pct": i.taux_remplissage_pct, "surface_cm2": i.surface_cm2,
            "materiau": i.materiau or "", "masse_g": i.masse_g if i.masse_g is not None else "",
            "avertissements": " | ".join(i.avertissements),
        })
    return rows


def csv_report(infos: list[ModelInfo], out: Path) -> Path:
    with out.open("w", newline="", encoding="utf-8-sig") as f:  # BOM : ouverture directe dans Excel
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, delimiter=";")
        w.writeheader()
        w.writerows(csv_rows(infos))
    return out


# ----------------------------------------------------------------------------
# HTML autonome (rapport + visionneuse 3D three.js, partageable par mail)
# ----------------------------------------------------------------------------
def _viewer_fragment(scene: trimesh.Scene) -> str:
    """Visionneuse 3D autonome (trimesh/three.js) encapsulée dans un iframe srcdoc."""
    import base64
    from trimesh.viewer.notebook import scene_to_html
    page = scene_to_html(scene)
    b64 = base64.b64encode(page.encode("utf-8")).decode("ascii")
    return (f'<iframe title="Vue 3D" style="width:100%;height:560px;border:1px solid #ddd;'
            f'border-radius:8px;background:#fff" src="data:text/html;base64,{b64}"></iframe>')


def html_report(info: ModelInfo, scene: trimesh.Scene | None, out: Path,
                embed_3d: bool = True) -> Path:
    e = html.escape
    L, l, h = info.dimensions_mm
    Lo, lo, ho = info.dimensions_orientees_mm

    kpis = [
        ("Hors-tout", f"{L:g} × {l:g} × {h:g} mm"),
        ("Encombrement orienté", f"{Lo:g} × {lo:g} × {ho:g} mm"),
        ("Volume matière", f"{info.volume_matiere_cm3:g} cm³"),
        ("Volume englobant", f"{info.volume_englobant_cm3:g} cm³"),
        ("Taux de remplissage", f"{info.taux_remplissage_pct:g} %"),
        ("Surface", f"{info.surface_cm2:g} cm²"),
    ]
    if info.masse_g is not None:
        kpis.append(("Masse estimée", f"{info.masse_g:g} g ({e(info.materiau or '')})"))

    kpi_html = "".join(
        f'<div class="kpi"><div class="k">{e(k)}</div><div class="v">{e(v)}</div></div>' for k, v in kpis)

    rows = ""
    for p in info.details:
        d = " × ".join(f"{x:g}" for x in p.dimensions_mm)
        rows += ("<tr>"
                 f"<td>{e(p.nom)}</td><td>{d}</td>"
                 f"<td>{p.volume_cm3 if p.volume_cm3 is not None else '—'}</td>"
                 f"<td>{p.surface_cm2}</td>"
                 f"<td>{p.masse_g if p.masse_g is not None else '—'}</td>"
                 f"<td>{p.epaisseur_mm_estimee if p.epaisseur_mm_estimee else '—'}</td>"
                 f"<td>{'oui' if p.etanche else '<span class=warn>non</span>'}</td>"
                 "</tr>")

    warn_html = ""
    if info.avertissements:
        warn_html = '<div class="alert"><b>Points d\'attention</b><ul>' + "".join(
            f"<li>{e(w)}</li>" for w in info.avertissements) + "</ul></div>"

    viewer = _viewer_fragment(scene) if (embed_3d and scene is not None) else ""

    page = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapport STEP – {e(info.fichier)}</title>
<style>
:root{{--ink:#1d2433;--muted:#5b6475;--line:#e3e7ee;--acc:#2a5db0;--bg:#f6f8fb}}
*{{box-sizing:border-box}}body{{margin:0;font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}}
.wrap{{max-width:1100px;margin:0 auto;padding:28px 20px 60px}}
h1{{font-size:24px;margin:0 0 4px}}.sub{{color:var(--muted);margin-bottom:22px}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:22px}}
.kpi{{background:#fff;border:1px solid var(--line);border-radius:10px;padding:14px 16px}}
.kpi .k{{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}}
.kpi .v{{font-size:20px;font-weight:600;margin-top:2px}}
.card{{background:#fff;border:1px solid var(--line);border-radius:10px;padding:18px;margin-bottom:22px}}
h2{{font-size:16px;margin:0 0 12px;color:var(--acc)}}
table{{width:100%;border-collapse:collapse;font-size:14px}}th,td{{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}}
th{{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase}}
.tbl{{overflow-x:auto}}.warn{{color:#b42318;font-weight:600}}
.alert{{background:#fff7e6;border:1px solid #f5d08a;border-radius:10px;padding:12px 16px;margin-bottom:22px}}
.alert ul{{margin:6px 0 0 18px}}footer{{color:var(--muted);font-size:12px;margin-top:30px}}
</style></head><body><div class="wrap">
<h1>{e(info.fichier)}</h1>
<div class="sub">Rapport d'analyse packaging · {info.pieces} pièce(s) · généré le {datetime.now():%d/%m/%Y %H:%M}</div>
<div class="kpis">{kpi_html}</div>
{warn_html}
{f'<div class="card"><h2>Vue 3D interactive</h2>{viewer}<div style="color:var(--muted);font-size:12px;margin-top:6px">Clic gauche : rotation · molette : zoom · clic droit : translation</div></div>' if viewer else ''}
<div class="card"><h2>Détail par pièce</h2><div class="tbl"><table>
<thead><tr><th>Pièce</th><th>Dimensions (mm)</th><th>Volume (cm³)</th><th>Surface (cm²)</th><th>Masse (g)</th><th>Ép. paroi est. (mm)</th><th>Fermé</th></tr></thead>
<tbody>{rows}</tbody></table></div></div>
<footer>Généré par stepviewer. Les volumes et masses sont calculés sur la tessellation du STEP ; l'épaisseur de paroi est une estimation (2·V/S).</footer>
</div></body></html>"""
    out.write_text(page, encoding="utf-8")
    return out
