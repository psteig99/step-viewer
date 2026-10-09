"""Load STEP files into a flattened trimesh scene, in millimetres.

Reading goes through `cascadio` (OpenCASCADE kernel packaged for pip), which
tessellates the STEP into GLB. trimesh reloads that GLB; coordinates are then
in metres (glTF convention) and are converted to millimetres.
"""
from __future__ import annotations

import hashlib
import logging
import tempfile
from pathlib import Path

import numpy as np
import trimesh

log = logging.getLogger(__name__)

MM_PER_M = 1000.0
STEP_SUFFIXES = {".step", ".stp"}
_CACHE_DIR = Path(tempfile.gettempdir()) / "stepviewer-cache"


class StepLoadError(RuntimeError):
    """Error reading a STEP file."""


def _cache_key(path: Path, tol_linear: float, tol_angular: float) -> Path:
    st = path.stat()
    h = hashlib.sha1(f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}|{tol_linear}|{tol_angular}".encode()).hexdigest()
    return _CACHE_DIR / f"{h}.glb"


def step_to_glb(path: Path, tol_linear: float = 0.2, tol_angular: float = 0.3, use_cache: bool = True) -> Path:
    """Converts a STEP to GLB (cached in the temp directory).

    tol_linear: chord deviation in mm (smaller = finer, heavier).
    tol_angular: angular deviation in radians.
    """
    import cascadio  # late import: clearer error message

    glb = _cache_key(path, tol_linear, tol_angular)
    if use_cache and glb.exists():
        log.debug("GLB cached: %s", glb)
        return glb
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    log.info("Tessellating %s (tol %.3f mm / %.2f rad)", path.name, tol_linear, tol_angular)
    # cascadio works in metres: convert tolerance
    cascadio.step_to_glb(str(path), str(glb), tol_linear=tol_linear / MM_PER_M, tol_angular=tol_angular)
    return glb


def load_step(path: str | Path, tol_linear: float = 0.2, tol_angular: float = 0.3,
              use_cache: bool = True) -> trimesh.Scene:
    """Loads a .step/.stp and returns a flattened trimesh scene, in mm.

    Each part (solid) becomes an independent geometry, already positioned in
    the global frame, with welded vertices and consistent normals.
    """
    path = Path(path)
    if not path.exists():
        raise StepLoadError(f"File not found: {path}")
    if path.suffix.lower() not in STEP_SUFFIXES:
        log.warning("Unusual extension %s for a STEP file, attempting to read.", path.suffix)

    try:
        glb = step_to_glb(path, tol_linear, tol_angular, use_cache)
        raw = trimesh.load(str(glb), force="scene")
    except ImportError as exc:
        raise StepLoadError("Missing dependency: pip install cascadio trimesh") from exc
    except Exception as exc:  # noqa: BLE001
        raise StepLoadError(f"Cannot read {path.name}: {exc}") from exc

    if raw.is_empty:
        raise StepLoadError(f"{path.name} contains no usable geometry.")

    flat = trimesh.Scene()
    used: dict[str, int] = {}
    for node in raw.graph.nodes_geometry:
        transform, geom_name = raw.graph[node]
        mesh = raw.geometry[geom_name]
        if not isinstance(mesh, trimesh.Trimesh) or mesh.is_empty:
            continue
        mesh = mesh.copy()
        mesh.apply_transform(transform)
        mesh.apply_scale(MM_PER_M)
        mesh.merge_vertices()
        mesh.update_faces(mesh.nondegenerate_faces())
        mesh.fix_normals()

        name = _clean_name(node)
        used[name] = used.get(name, 0) + 1
        if used[name] > 1:
            name = f"{name}_{used[name]}"
        flat.add_geometry(mesh, node_name=name, geom_name=name)

    if flat.is_empty:
        raise StepLoadError(f"{path.name}: no meshed solid found.")

    flat.metadata["source"] = str(path)
    log.info("%s: %d part(s), %d triangles", path.name, len(flat.geometry),
             sum(len(g.faces) for g in flat.geometry.values()))
    return flat


def _clean_name(name: str) -> str:
    """Makes a part name readable (STEP files often contain raw IDs)."""
    name = name.replace("/", "_").strip()
    if not name or name.startswith("world") or name.startswith("geometry_"):
        return "part"
    return name[:60]


def find_step_files(folder: str | Path, recursive: bool = True) -> list[Path]:
    """Lists STEP files in a folder."""
    folder = Path(folder)
    pattern = "**/*" if recursive else "*"
    return sorted(p for p in folder.glob(pattern) if p.suffix.lower() in STEP_SUFFIXES)


def combined_mesh(scene: trimesh.Scene) -> trimesh.Trimesh:
    """Merges all parts into a single mesh (for STL, global calculations)."""
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    return trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0].copy()


def oriented_extents(scene: trimesh.Scene) -> tuple[np.ndarray, np.ndarray]:
    """Dimensions of the *oriented* (minimal) bounding box and its matrix.

    Useful when the part is modelled at an angle: gives the true footprint.
    """
    mesh = combined_mesh(scene)
    obb = mesh.bounding_box_oriented
    return np.asarray(obb.primitive.extents), np.asarray(obb.primitive.transform)
