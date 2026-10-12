"""Reports: console text, JSON, CSV and standalone HTML page with embedded 3D."""
from __future__ import annotations

import csv
import html
import json
from datetime import datetime
from pathlib import Path

import trimesh

from .analysis import ModelInfo


# ----------------------------------------------------------------------------
# Text
# ----------------------------------------------------------------------------
def text_report(info: ModelInfo) -> str:
    L, l, h = info.dimensions_mm
    Lo, lo, ho = info.oriented_dimensions_mm
    lines = [
        "=" * 70,
        f"File             : {info.filename}",
        f"Parts            : {info.parts}   (triangles: {info.triangles:,})".replace(",", " "),
        f"Overall dims     : {L} x {l} x {h} mm  (X x Y x Z)",
        f"Oriented (min)   : {Lo} x {lo} x {ho} mm",
        f"Bounding vol.    : {info.bounding_volume_cm3} cm³",
        f"Material vol.    : {info.material_volume_cm3} cm³   (fill {info.fill_rate_pct} %)",
        f"Surface area     : {info.surface_cm2} cm²",
    ]
    if info.mass_g is not None:
        lines.append(f"Est. mass        : {info.mass_g} g   ({info.material}, {info.density_g_cm3} g/cm³)")
    lines.append("-" * 70)
    for p in info.details:
        d = " x ".join(f"{x:g}" for x in p.dimensions_mm)
        v = f"{p.volume_cm3} cm³" if p.volume_cm3 is not None else "n/a"
        m = f"  {p.mass_g} g" if p.mass_g is not None else ""
        e = f"  wall~{p.wall_thickness_mm} mm" if p.wall_thickness_mm else ""
        flag = "" if p.watertight else "  [not closed]"
        lines.append(f"  - {p.name[:28]:<28} {d:>24} mm  {v:>12}{m}{e}{flag}")
    if info.warnings:
        lines.append("-" * 70)
        lines += [f"  ! {w}" for w in info.warnings]
    lines.append("=" * 70)
    return "\n".join(lines)


# ----------------------------------------------------------------------------
# JSON / CSV
# ----------------------------------------------------------------------------
def json_report(info: ModelInfo, out: Path) -> Path:
    out.write_text(json.dumps(info.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
    return out


CSV_FIELDS = ["filename", "parts", "L_mm", "l_mm", "h_mm", "Lo_mm", "lo_mm", "ho_mm",
              "bounding_volume_cm3", "material_volume_cm3", "fill_rate_pct",
              "surface_cm2", "material", "mass_g", "warnings"]


def csv_rows(infos: list[ModelInfo]) -> list[dict]:
    rows = []
    for i in infos:
        rows.append({
            "filename": i.filename, "parts": i.parts,
            "L_mm": i.dimensions_mm[0], "l_mm": i.dimensions_mm[1], "h_mm": i.dimensions_mm[2],
            "Lo_mm": i.oriented_dimensions_mm[0], "lo_mm": i.oriented_dimensions_mm[1],
            "ho_mm": i.oriented_dimensions_mm[2],
            "bounding_volume_cm3": i.bounding_volume_cm3, "material_volume_cm3": i.material_volume_cm3,
            "fill_rate_pct": i.fill_rate_pct, "surface_cm2": i.surface_cm2,
            "material": i.material or "", "mass_g": i.mass_g if i.mass_g is not None else "",
            "warnings": " | ".join(i.warnings),
        })
    return rows


def csv_report(infos: list[ModelInfo], out: Path) -> Path:
    """Write a multi-row CSV summary of *infos* to *out*.

    The file is encoded as UTF-8 with BOM (``utf-8-sig``) so that Excel
    opens it directly without a text-import wizard, and uses ``;`` as the
    delimiter, which is the European spreadsheet convention.
    """
    with out.open("w", newline="", encoding="utf-8-sig") as f:  # BOM for direct Excel open
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS, delimiter=";")
        w.writeheader()
        w.writerows(csv_rows(infos))
    return out


# ----------------------------------------------------------------------------
# Standalone HTML (report + 3D viewer three.js, shareable by email)
# ----------------------------------------------------------------------------
def _viewer_fragment(scene: trimesh.Scene) -> str:
    """Return an iframe that hosts the trimesh built-in notebook 3D viewer.

    Uses ``trimesh.viewer.notebook.scene_to_html`` (three.js-based) to render
    a self-contained HTML page, then base64-encodes it into an iframe ``src``
    so the viewer is fully embedded with no external dependencies.
    """
    import base64
    from trimesh.viewer.notebook import scene_to_html
    page = scene_to_html(scene)
    b64 = base64.b64encode(page.encode("utf-8")).decode("ascii")
    return (f'<iframe title="3D View" style="width:100%;height:560px;border:1px solid #ddd;'
            f'border-radius:8px;background:#fff" src="data:text/html;base64,{b64}"></iframe>')


def html_report(info: ModelInfo, scene: trimesh.Scene | None, out: Path,
                embed_3d: bool = True) -> Path:
    """Generate a standalone HTML report and write it to *out*.

    Page layout: a KPI tile grid (one card per metric, CSS grid auto-fit),
    an optional warnings banner, an iframe holding the embedded 3D viewer
    (see :func:`_viewer_fragment`), and a scrollable part-detail table.
    Everything is inlined — no external assets — so the file is shareable
    by email or network drive.
    """
    e = html.escape
    L, l, h = info.dimensions_mm
    Lo, lo, ho = info.oriented_dimensions_mm

    kpis = [
        ("Overall dims", f"{L:g} × {l:g} × {h:g} mm"),
        ("Oriented dims", f"{Lo:g} × {lo:g} × {ho:g} mm"),
        ("Material vol.", f"{info.material_volume_cm3:g} cm³"),
        ("Bounding vol.", f"{info.bounding_volume_cm3:g} cm³"),
        ("Fill rate", f"{info.fill_rate_pct:g} %"),
        ("Surface area", f"{info.surface_cm2:g} cm²"),
    ]
    if info.mass_g is not None:
        kpis.append(("Est. mass", f"{info.mass_g:g} g ({e(info.material or '')})"))

    kpi_html = "".join(
        f'<div class="kpi"><div class="k">{e(k)}</div><div class="v">{e(v)}</div></div>' for k, v in kpis)

    rows = ""
    for p in info.details:
        d = " × ".join(f"{x:g}" for x in p.dimensions_mm)
        rows += ("<tr>"
                 f"<td>{e(p.name)}</td><td>{d}</td>"
                 f"<td>{p.volume_cm3 if p.volume_cm3 is not None else '—'}</td>"
                 f"<td>{p.surface_cm2}</td>"
                 f"<td>{p.mass_g if p.mass_g is not None else '—'}</td>"
                 f"<td>{p.wall_thickness_mm if p.wall_thickness_mm else '—'}</td>"
                 f"<td>{'yes' if p.watertight else '<span class=warn>no</span>'}</td>"
                 "</tr>")

    warn_html = ""
    if info.warnings:
        warn_html = '<div class="alert"><b>Warnings</b><ul>' + "".join(
            f"<li>{e(w)}</li>" for w in info.warnings) + "</ul></div>"

    viewer = _viewer_fragment(scene) if (embed_3d and scene is not None) else ""

    page = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>STEP Report – {e(info.filename)}</title>
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
<h1>{e(info.filename)}</h1>
<div class="sub">Packaging analysis report · {info.parts} part(s) · generated on {datetime.now():%d/%m/%Y %H:%M}</div>
<div class="kpis">{kpi_html}</div>
{warn_html}
{f'<div class="card"><h2>Interactive 3D view</h2>{viewer}<div style="color:var(--muted);font-size:12px;margin-top:6px">Left click: rotation · scroll wheel: zoom · right click: pan</div></div>' if viewer else ''}
<div class="card"><h2>Part details</h2><div class="tbl"><table>
<thead><tr><th>Part</th><th>Dimensions (mm)</th><th>Volume (cm³)</th><th>Surface (cm²)</th><th>Mass (g)</th><th>Est. wall (mm)</th><th>Closed</th></tr></thead>
<tbody>{rows}</tbody></table></div></div>
<footer>Generated by stepviewer. Volumes and masses are calculated from the STEP tessellation; wall thickness is an estimate (2·V/S).</footer>
</div></body></html>"""
    out.write_text(page, encoding="utf-8")
    return out
