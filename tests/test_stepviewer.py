"""Tests: loading, analysis, packing, reports, export, CLI."""
from pathlib import Path

import pytest

from stepviewer import analyse, fit_in_container, load_step
from stepviewer.export import export_scene
from stepviewer.fit import fit_on_pallet
from stepviewer.loader import StepLoadError
from stepviewer.report import csv_report, html_report, json_report, text_report

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "featuretype.step"


@pytest.fixture(scope="module")
def scene():
    return load_step(SAMPLE)


@pytest.fixture(scope="module")
def info(scene):
    return analyse(scene, material="pet")


def test_load_dimensions_mm(scene):
    L, l, h = scene.extents
    assert abs(L - 127.0) < 0.1 and abs(l - 63.5) < 0.1 and abs(h - 34.925) < 0.1


def test_analysis(info):
    assert info.parts == 1
    assert info.details[0].watertight
    assert 150 < info.material_volume_cm3 < 250
    assert info.mass_g == pytest.approx(info.material_volume_cm3 * 1.38, rel=1e-2)
    assert 0 < info.fill_rate_pct <= 100


def test_unknown_material(scene):
    with pytest.raises(ValueError):
        analyse(scene, material="kryptonite")


def test_missing_file():
    with pytest.raises(StepLoadError):
        load_step("doesnotexist.step")


def test_fit():
    r = fit_in_container((100, 50, 30), (400, 300, 250), clearance=0)
    assert r.quantity == 4 * 6 * 8 or r.quantity >= 192
    r2 = fit_in_container((100, 50, 30), (400, 300, 250), clearance=2, allow_rotation=False)
    assert r2.per_axis == (3, 5, 7)
    p = fit_on_pallet((400, 300, 250), "euro", max_height=1800)
    assert p.quantity == 3 * 2 * 6 or p.quantity >= 36


def test_reports(scene, info, tmp_path):
    assert "Overall dims" in text_report(info)
    j = json_report(info, tmp_path / "r.json")
    assert '"dimensions_mm"' in j.read_text(encoding="utf-8")
    c = csv_report([info], tmp_path / "r.csv")
    assert "L_mm" in c.read_text(encoding="utf-8-sig")
    h = html_report(info, scene, tmp_path / "r.html")
    assert "<iframe" in h.read_text(encoding="utf-8")


def test_export(scene, tmp_path):
    for ext in ("stl", "obj", "glb"):
        out = export_scene(scene, tmp_path / f"p.{ext}")
        assert out.stat().st_size > 1000
    with pytest.raises(ValueError):
        export_scene(scene, tmp_path / "p.xyz")


def test_cli_info(capsys):
    from stepviewer.cli import main
    main(["info", str(SAMPLE), "-m", "hdpe"])
    assert "Est. mass" in capsys.readouterr().out


def test_viewer_offscreen(scene, info):
    pytest.importorskip("pyvista")
    import pyvista as pv
    pv.OFF_SCREEN = True
    from stepviewer.viewer import show
    show(scene, info, off_screen=True)
