"""Serveur web : API + interface (cliquer-glisser, visionneuse 3D, analyse, colisage).

Lancement : stepviewer web [--port 8000] [--reseau]
            uvicorn stepviewer.server:app --reload       (développement)
"""
from __future__ import annotations

import base64
import logging
import os
import secrets
import shutil
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .analysis import MATERIALS, ModelInfo, analyse, interference_check
from .export import SUPPORTED, export_scene
from .fit import PALLETS, fit_in_container, fit_on_pallet
from .loader import StepLoadError, load_step
from .report import html_report, json_report

log = logging.getLogger("stepviewer.server")
STATIC = Path(__file__).with_name("static")
MAX_UPLOAD_MB = 500
MODEL_TTL_S = 6 * 3600       # les modèles sont oubliés après 6 h d'inactivité
DEFAULT_TOL = 0.3            # finesse de maillage web (mm)


@dataclass
class StoredModel:
    id: str
    name: str
    folder: Path
    step: Path
    scene: object
    info: ModelInfo
    glb: Path
    created: float = field(default_factory=time.time)
    touched: float = field(default_factory=time.time)
    exports: dict[str, Path] = field(default_factory=dict)


class Store:
    def __init__(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="stepviewer-web-"))
        self.models: dict[str, StoredModel] = {}
        self.lock = threading.Lock()

    def add(self, upload_name: str, data: bytes, tol: float) -> StoredModel:
        mid = uuid.uuid4().hex[:12]
        folder = self.root / mid
        folder.mkdir()
        safe = Path(upload_name).name or "modele.step"
        step = folder / safe
        step.write_bytes(data)
        scene = load_step(step, tol_linear=tol)
        info = analyse(scene)
        glb = export_scene(scene, folder / "model.glb")
        m = StoredModel(mid, safe, folder, step, scene, info, glb)
        with self.lock:
            self.models[mid] = m
        self.purge()
        return m

    def get(self, mid: str) -> StoredModel:
        m = self.models.get(mid)
        if m is None:
            raise HTTPException(404, "Modèle inconnu ou expiré : rechargez le fichier.")
        m.touched = time.time()
        return m

    def purge(self) -> None:
        now = time.time()
        with self.lock:
            dead = [k for k, m in self.models.items() if now - m.touched > MODEL_TTL_S]
            for k in dead:
                shutil.rmtree(self.models[k].folder, ignore_errors=True)
                del self.models[k]


store = Store()
app = FastAPI(title="STEP Viewer", version=__version__, docs_url="/api/docs", redoc_url=None)
PASSWORD = os.environ.get("STEPVIEWER_PASSWORD", "")


class BasicAuth(BaseHTTPMiddleware):
    """Protection par mot de passe (HTTP Basic) si STEPVIEWER_PASSWORD est défini."""

    async def dispatch(self, request, call_next):
        if not PASSWORD or request.url.path == "/api/health":
            return await call_next(request)
        header = request.headers.get("authorization", "")
        ok = False
        if header.startswith("Basic "):
            try:
                _, _, pwd = base64.b64decode(header[6:]).decode("utf-8").partition(":")
                ok = secrets.compare_digest(pwd, PASSWORD)
            except Exception:  # noqa: BLE001
                ok = False
        if not ok:
            return Response("Mot de passe requis.", status_code=401,
                            headers={"WWW-Authenticate": 'Basic realm="STEP Viewer"'})
        return await call_next(request)


app.add_middleware(BasicAuth)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


# ----------------------------------------------------------------------------
class FitRequest(BaseModel):
    unit: tuple[float, float, float]
    carton: tuple[float, float, float] = Field(..., description="dimensions intérieures L, l, h en mm")
    clearance: float = 0.0
    allow_rotation: bool = True
    pallet: str | None = "euro"
    max_height: float = 1800.0
    mass_g: float | None = None


# ----------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC / "index.html").read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": __version__, "models": len(store.models)}


@app.get("/api/materials")
def materials() -> dict:
    return {"materials": MATERIALS, "pallets": PALLETS}


@app.post("/api/models")
async def upload(file: UploadFile = File(...), tol: float = Query(DEFAULT_TOL, ge=0.02, le=5.0)) -> JSONResponse:
    name = file.filename or "modele.step"
    if Path(name).suffix.lower() not in {".step", ".stp"}:
        raise HTTPException(415, f"« {name} » n'est pas un fichier STEP (.step / .stp).")
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Fichier trop volumineux (max {MAX_UPLOAD_MB} Mo).")
    if not data:
        raise HTTPException(400, "Fichier vide.")
    try:
        m = store.add(name, data, tol)
    except StepLoadError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Échec de lecture de %s", name)
        raise HTTPException(500, f"Erreur interne pendant la lecture : {exc}") from exc
    return JSONResponse(_payload(m))


def _payload(m: StoredModel) -> dict:
    d = m.info.to_dict()
    hits = interference_check(m.scene) if len(m.scene.geometry) > 1 else []
    return {
        "id": m.id,
        "name": m.name,
        "glb_url": f"/api/models/{m.id}/model.glb",
        "size_bytes": m.step.stat().st_size,
        "analysis": d,
        "overlaps": hits,
        "exports": sorted(SUPPORTED),
    }


@app.get("/api/models/{mid}")
def model(mid: str) -> dict:
    return _payload(store.get(mid))


@app.get("/api/models/{mid}/model.glb")
def model_glb(mid: str) -> FileResponse:
    m = store.get(mid)
    return FileResponse(m.glb, media_type="model/gltf-binary", filename=f"{Path(m.name).stem}.glb")


@app.get("/api/models/{mid}/export.{ext}")
def model_export(mid: str, ext: str) -> FileResponse:
    m = store.get(mid)
    ext = ext.lower()
    if ext not in SUPPORTED:
        raise HTTPException(400, f"Format .{ext} non géré ({', '.join(SUPPORTED)}).")
    if ext not in m.exports:
        m.exports[ext] = export_scene(m.scene, m.folder / f"export.{ext}")
    return FileResponse(m.exports[ext], filename=f"{Path(m.name).stem}.{ext}")


@app.get("/api/models/{mid}/report.html")
def model_report(mid: str, material: str | None = None, density: float | None = None) -> FileResponse:
    m = store.get(mid)
    try:
        info = analyse(m.scene, material=material, density=density) if (material or density) else m.info
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    out = html_report(info, m.scene, m.folder / "rapport.html")
    return FileResponse(out, media_type="text/html", filename=f"{Path(m.name).stem}_rapport.html")


@app.get("/api/models/{mid}/analysis.json")
def model_json(mid: str, material: str | None = None, density: float | None = None) -> FileResponse:
    m = store.get(mid)
    try:
        info = analyse(m.scene, material=material, density=density) if (material or density) else m.info
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    out = json_report(info, m.folder / "analyse.json")
    return FileResponse(out, media_type="application/json", filename=f"{Path(m.name).stem}_analyse.json")


@app.delete("/api/models/{mid}")
def model_delete(mid: str) -> dict:
    m = store.get(mid)
    with store.lock:
        store.models.pop(mid, None)
    shutil.rmtree(m.folder, ignore_errors=True)
    return {"deleted": mid}


@app.post("/api/fit")
def fit(req: FitRequest) -> dict:
    try:
        carton = fit_in_container(req.unit, req.carton, clearance=req.clearance, allow_rotation=req.allow_rotation)
        out: dict = {"carton": carton.to_dict()}
        if req.pallet:
            pal = fit_on_pallet(req.carton, req.pallet, max_height=req.max_height)
            out["pallet"] = pal.to_dict()
            out["units_per_pallet"] = pal.quantite * carton.quantite
        if req.mass_g:
            out["mass_per_carton_kg"] = round(carton.quantite * req.mass_g / 1000, 2)
            if req.pallet:
                out["mass_per_pallet_kg"] = round(out["units_per_pallet"] * req.mass_g / 1000, 1)
        return out
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc


def run(host: str = "127.0.0.1", port: int = 8000, reload: bool = False, password: str | None = None) -> None:
    import uvicorn
    if password:
        os.environ["STEPVIEWER_PASSWORD"] = password
    protected = "  (protégé par mot de passe)" if os.environ.get("STEPVIEWER_PASSWORD") else ""
    print(f"\n  STEP Viewer  ->  http://{'localhost' if host == '127.0.0.1' else host}:{port}{protected}\n")
    uvicorn.run("stepviewer.server:app", host=host, port=port, reload=reload, log_level="info")
