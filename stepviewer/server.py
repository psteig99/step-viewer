"""Web server: API + interface (drag-and-drop, 3D viewer, analysis).

Launch: stepviewer web [--port 8000] [--network]
        uvicorn stepviewer.server:app --reload       (development)
"""
from __future__ import annotations

import asyncio
import base64
import json
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
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .analysis import MATERIALS, ModelInfo, analyse, interference_check
from .export import SUPPORTED, export_scene
from .loader import StepLoadError, load_step
from .report import html_report, json_report

log = logging.getLogger("stepviewer.server")
STATIC = Path(__file__).with_name("static")
MAX_UPLOAD_MB = 500
MODEL_TTL_S = 6 * 3600       # models are purged after 6 h of inactivity
DEFAULT_TOL = 0.3            # web mesh tolerance (mm)


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
    """In-memory registry of uploaded models with TTL-based eviction.

    Lifecycle:
      1. **Upload** — ``add()`` saves the raw STEP bytes, tessellates the file,
         runs the analysis, and registers a :class:`StoredModel` keyed by a
         random 12-char hex ID.
      2. **Access** — ``get()`` refreshes the model's ``touched`` timestamp,
         keeping it alive as long as the session is active.
      3. **Purge** — ``purge()`` is called after every upload and removes any
         model whose ``touched`` time is older than ``MODEL_TTL_S`` (6 h),
         deleting the associated temp folder from disk.
    """

    def __init__(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="stepviewer-web-"))
        self.models: dict[str, StoredModel] = {}
        self.lock = threading.Lock()

    def add(self, upload_name: str, data: bytes, tol: float) -> StoredModel:
        mid = uuid.uuid4().hex[:12]
        folder = self.root / mid
        folder.mkdir()
        safe = Path(upload_name).name or "model.step"
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
        with self.lock:
            m = self.models.get(mid)
            if m is None:
                raise HTTPException(404, "Model not found or expired: re-upload the file.")
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
    """Password protection (HTTP Basic) when STEPVIEWER_PASSWORD is set."""

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
            return Response("Password required.", status_code=401,
                            headers={"WWW-Authenticate": 'Basic realm="STEP Viewer"'})
        return await call_next(request)


app.add_middleware(BasicAuth)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


# ----------------------------------------------------------------------------
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def index() -> HTMLResponse:
    return HTMLResponse((STATIC / "index.html").read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "version": __version__, "models": len(store.models)}


@app.get("/api/materials")
def materials() -> dict:
    return {"materials": MATERIALS}


@app.post("/api/models")
async def upload(file: UploadFile = File(...), tol: float = Query(DEFAULT_TOL, ge=0.02, le=5.0)) -> JSONResponse:
    name = file.filename or "model.step"
    if Path(name).suffix.lower() not in {".step", ".stp"}:
        raise HTTPException(415, f"'{name}' is not a STEP file (.step / .stp).")
    data = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File too large (max {MAX_UPLOAD_MB} MB).")
    if not data:
        raise HTTPException(400, "Empty file.")
    try:
        m = await asyncio.get_running_loop().run_in_executor(None, store.add, name, data, tol)
    except StepLoadError as exc:
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        log.exception("Failed to read %s", name)
        raise HTTPException(500, f"Internal error while reading: {exc}") from exc
    return JSONResponse(_payload(m))


def _payload(m: StoredModel) -> dict:
    """Build the JSON response body for a stored model."""
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
        raise HTTPException(400, f"Format .{ext} not supported ({', '.join(SUPPORTED)}).")
    with store.lock:
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
    out = html_report(info, m.scene, m.folder / "report.html")
    return FileResponse(out, media_type="text/html", filename=f"{Path(m.name).stem}_report.html")


@app.get("/api/models/{mid}/analysis.json")
def model_json(mid: str, material: str | None = None, density: float | None = None) -> FileResponse:
    m = store.get(mid)
    try:
        info = analyse(m.scene, material=material, density=density) if (material or density) else m.info
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    out = json_report(info, m.folder / "analysis.json")
    return FileResponse(out, media_type="application/json", filename=f"{Path(m.name).stem}_analysis.json")


class AiAnalysisRequest(BaseModel):
    images: list[str]       # base64 data-URIs (JPEG)
    analysis: dict


@app.post("/api/models/{mid}/ai-analysis")
async def model_ai_analysis(mid: str, req: AiAnalysisRequest):
    """Stream a Claude engineering analysis of the 7 auto-captured views.

    Requires ANTHROPIC_API_KEY. Returns a text/event-stream of JSON deltas:
      data: {"delta": "..."}\n\n  — streamed text chunks
      data: [DONE]\n\n           — end of stream
      data: {"error": "..."}\n\n — on failure
    """
    store.get(mid)
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise HTTPException(503, "AI analysis not configured — set ANTHROPIC_API_KEY.")
    try:
        from anthropic import AsyncAnthropic  # optional dep: pip install anthropic
    except ImportError:
        raise HTTPException(503, "anthropic not installed: pip install anthropic")

    a = req.analysis
    dims = a.get("dimensions_mm", [])
    summary = (
        f"File: {a.get('filename','?')}. "
        f"Parts: {a.get('parts','?')}. "
        f"Dims: {' × '.join(str(round(v,1)) for v in dims)} mm. "
        f"Material vol: {a.get('material_volume_cm3','?')} cm³. "
        f"Fill rate: {a.get('fill_rate_pct','?')}%. "
        f"Warnings: {'; '.join(a.get('warnings', [])) or 'none'}."
    )
    content: list[dict] = [{"type": "text", "text":
        f"You are a packaging engineer reviewing a 3D STEP part.\n"
        f"I am sending 5 standard views (Iso, Top, Front, Right, Back) + 3 section cuts (X, Y, Z).\n"
        f"Data: {summary}\n\n"
        f"Provide a concise analysis covering these 4 points — no Recommendations section:\n"
        f"1. Overall geometry and shape\n"
        f"2. Symmetry and notable features\n"
        f"3. What the cuts reveal (wall thickness, hollows, internal structure)\n"
        f"4. Manufacturing / packaging considerations\n\n"
        f"End with one summary sentence."}]
    for uri in req.images:
        if "," not in uri:
            continue
        _, b64 = uri.split(",", 1)
        content.append({"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": b64}})

    async def stream():
        try:
            client = AsyncAnthropic(api_key=api_key)
            async with client.messages.stream(
                model="claude-sonnet-5-5",
                max_tokens=1024,
                messages=[{"role": "user", "content": content}],
            ) as s:
                async for text in s.text_stream:
                    yield f"data: {json.dumps({'delta': text})}\n\n"
        except Exception as exc:
            log.exception("AI analysis failed")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.delete("/api/models/{mid}")
def model_delete(mid: str) -> dict:
    m = store.get(mid)
    with store.lock:
        store.models.pop(mid, None)
    shutil.rmtree(m.folder, ignore_errors=True)
    return {"deleted": mid}


def run(host: str = "127.0.0.1", port: int = 8000, reload: bool = False, password: str | None = None) -> None:
    import uvicorn
    if password:
        os.environ["STEPVIEWER_PASSWORD"] = password
    protected = "  (password protected)" if os.environ.get("STEPVIEWER_PASSWORD") else ""
    print(f"\n  STEP Viewer  ->  http://{'localhost' if host == '127.0.0.1' else host}:{port}{protected}\n")
    uvicorn.run("stepviewer.server:app", host=host, port=port, reload=reload, log_level="info")
