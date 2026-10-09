"""Tests for the web API."""
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from stepviewer.server import app  # noqa: E402

SAMPLE = Path(__file__).resolve().parents[1] / "samples" / "featuretype.step"
client = TestClient(app)


def test_index_and_static():
    assert client.get("/").status_code == 200
    assert "Drop" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
    assert client.get("/static/vendor/three/three.module.js").status_code == 200


def test_materials():
    d = client.get("/api/materials").json()
    assert "pet" in d["materials"] and "euro" in d["pallets"]


def test_upload_flow():
    with SAMPLE.open("rb") as f:
        r = client.post("/api/models", files={"file": (SAMPLE.name, f, "application/octet-stream")})
    assert r.status_code == 200, r.text
    d = r.json()
    mid = d["id"]
    assert d["analysis"]["dimensions_mm"][0] == pytest.approx(127.0, abs=0.1)
    assert client.get(d["glb_url"]).status_code == 200
    assert client.get(f"/api/models/{mid}").status_code == 200
    assert client.get(f"/api/models/{mid}/export.stl").status_code == 200
    assert client.get(f"/api/models/{mid}/export.xyz").status_code == 400
    rep = client.get(f"/api/models/{mid}/report.html?material=pet")
    assert rep.status_code == 200 and b"Mass" in rep.content
    assert client.get(f"/api/models/{mid}/analysis.json?material=kryptonite").status_code == 400
    assert client.delete(f"/api/models/{mid}").status_code == 200
    assert client.get(f"/api/models/{mid}").status_code == 404


def test_upload_rejects_non_step():
    r = client.post("/api/models", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert r.status_code == 415


def test_fit():
    r = client.post("/api/fit", json={"unit": [100, 50, 30], "carton": [400, 300, 250], "clearance": 0, "mass_g": 100})
    assert r.status_code == 200
    d = r.json()
    assert d["carton"]["quantity"] >= 192 and d["units_per_pallet"] > 0 and d["mass_per_carton_kg"] > 0
    assert client.post("/api/fit", json={"unit": [100, 50, 30], "carton": [400, 300, 250], "pallet": "mars"}).status_code == 400


def test_password(monkeypatch):
    import base64
    from stepviewer import server
    monkeypatch.setattr(server, "PASSWORD", "secret")
    c = TestClient(server.app)
    assert c.get("/").status_code == 401
    assert c.get("/api/health").status_code == 200
    ok = {"Authorization": "Basic " + base64.b64encode(b"x:secret").decode()}
    assert c.get("/", headers=ok).status_code == 200
    bad = {"Authorization": "Basic " + base64.b64encode(b"x:nope").decode()}
    assert c.get("/", headers=bad).status_code == 401
