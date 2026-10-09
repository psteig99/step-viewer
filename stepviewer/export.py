"""Export de la géométrie vers des formats maillés."""
from __future__ import annotations

from pathlib import Path

import trimesh

from .loader import combined_mesh

SINGLE_MESH_FORMATS = {"stl", "ply", "off"}
SCENE_FORMATS = {"glb", "gltf", "obj", "3mf", "dae"}
SUPPORTED = sorted(SINGLE_MESH_FORMATS | SCENE_FORMATS)


def export_scene(scene: trimesh.Scene, out: str | Path) -> Path:
    """Exporte la scène. Le format est déduit de l'extension.

    STL/PLY/OFF ne gèrent qu'un maillage : les pièces sont fusionnées.
    GLB/OBJ/3MF conservent les pièces séparées (et leurs noms).
    """
    out = Path(out)
    ext = out.suffix.lower().lstrip(".")
    if ext not in SUPPORTED:
        raise ValueError(f"Format .{ext} non géré. Formats : {', '.join(SUPPORTED)}")
    out.parent.mkdir(parents=True, exist_ok=True)
    if ext in SINGLE_MESH_FORMATS:
        combined_mesh(scene).export(str(out))
    else:
        scene.export(str(out))
    return out


def export_parts(scene: trimesh.Scene, folder: str | Path, fmt: str = "stl") -> list[Path]:
    """Exporte chaque pièce dans un fichier séparé."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    outs = []
    for name, geom in scene.geometry.items():
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in name)
        p = folder / f"{safe}.{fmt}"
        geom.export(str(p))
        outs.append(p)
    return outs
