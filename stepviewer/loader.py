"""Chargement de fichiers STEP -> scène trimesh aplatie, en millimètres.

La lecture passe par `cascadio` (noyau OpenCASCADE empaqueté pour pip), qui
tessellise le STEP en GLB. trimesh relit ce GLB ; les coordonnées sont alors en
mètres (convention glTF), on les remet en millimètres.
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
    """Erreur de lecture d'un fichier STEP."""


def _cache_key(path: Path, tol_linear: float, tol_angular: float) -> Path:
    st = path.stat()
    h = hashlib.sha1(f"{path.resolve()}|{st.st_size}|{st.st_mtime_ns}|{tol_linear}|{tol_angular}".encode()).hexdigest()
    return _CACHE_DIR / f"{h}.glb"


def step_to_glb(path: Path, tol_linear: float = 0.2, tol_angular: float = 0.3, use_cache: bool = True) -> Path:
    """Convertit un STEP en GLB (mis en cache dans le dossier temporaire).

    tol_linear : écart de corde en mm (plus petit = plus fin, plus lourd).
    tol_angular : écart angulaire en radians.
    """
    import cascadio  # import tardif : message d'erreur plus clair

    glb = _cache_key(path, tol_linear, tol_angular)
    if use_cache and glb.exists():
        log.debug("GLB en cache : %s", glb)
        return glb
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    log.info("Tessellation de %s (tol %.3f mm / %.2f rad)", path.name, tol_linear, tol_angular)
    # cascadio travaille en mètres : conversion de la tolérance
    cascadio.step_to_glb(str(path), str(glb), tol_linear=tol_linear / MM_PER_M, tol_angular=tol_angular)
    return glb


def load_step(path: str | Path, tol_linear: float = 0.2, tol_angular: float = 0.3,
              use_cache: bool = True) -> trimesh.Scene:
    """Charge un .step/.stp et renvoie une scène trimesh aplatie, en mm.

    Chaque pièce (solide) devient une géométrie indépendante, déjà positionnée
    dans le repère global, avec sommets soudés et normales cohérentes.
    """
    path = Path(path)
    if not path.exists():
        raise StepLoadError(f"Fichier introuvable : {path}")
    if path.suffix.lower() not in STEP_SUFFIXES:
        log.warning("Extension %s inhabituelle pour un STEP, tentative de lecture.", path.suffix)

    try:
        glb = step_to_glb(path, tol_linear, tol_angular, use_cache)
        raw = trimesh.load(str(glb), force="scene")
    except ImportError as exc:
        raise StepLoadError("Dépendance manquante : pip install cascadio trimesh") from exc
    except Exception as exc:  # noqa: BLE001
        raise StepLoadError(f"Impossible de lire {path.name} : {exc}") from exc

    if raw.is_empty:
        raise StepLoadError(f"{path.name} ne contient aucune géométrie exploitable.")

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
        raise StepLoadError(f"{path.name} : aucun solide maillé trouvé.")

    flat.metadata["source"] = str(path)
    log.info("%s : %d pièce(s), %d triangles", path.name, len(flat.geometry),
             sum(len(g.faces) for g in flat.geometry.values()))
    return flat


def _clean_name(name: str) -> str:
    """Rend le nom d'une pièce lisible (les STEP contiennent souvent des IDs)."""
    name = name.replace("/", "_").strip()
    if not name or name.startswith("world") or name.startswith("geometry_"):
        return "piece"
    return name[:60]


def find_step_files(folder: str | Path, recursive: bool = True) -> list[Path]:
    """Liste les fichiers STEP d'un dossier."""
    folder = Path(folder)
    pattern = "**/*" if recursive else "*"
    return sorted(p for p in folder.glob(pattern) if p.suffix.lower() in STEP_SUFFIXES)


def combined_mesh(scene: trimesh.Scene) -> trimesh.Trimesh:
    """Fusionne toutes les pièces en un seul maillage (pour STL, calculs globaux)."""
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    return trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0].copy()


def oriented_extents(scene: trimesh.Scene) -> tuple[np.ndarray, np.ndarray]:
    """Dimensions de la boîte englobante *orientée* (minimale) et sa matrice.

    Utile quand la pièce est modélisée de travers : donne le vrai encombrement.
    """
    mesh = combined_mesh(scene)
    obb = mesh.bounding_box_oriented
    return np.asarray(obb.primitive.extents), np.asarray(obb.primitive.transform)
