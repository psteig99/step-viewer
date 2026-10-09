"""Geometry analysis for packaging: dimensions, volumes, estimated mass."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
import trimesh

from .loader import combined_mesh, oriented_extents

# Common densities for packaging materials (g/cm³)
MATERIALS: dict[str, float] = {
    "pet": 1.38,
    "rpet": 1.38,
    "hdpe": 0.95,
    "ldpe": 0.92,
    "pp": 0.90,
    "ps": 1.05,
    "pla": 1.24,
    "pvc": 1.40,
    "glass": 2.50,
    "aluminium": 2.70,
    "steel": 7.85,
    "tin_plate": 7.85,
    "cardboard": 0.70,       # compact cardboard
    "corrugated_cardboard": 0.15,
    "paper": 0.80,
    "wood": 0.60,
    "cork": 0.24,
    "pe_foam": 0.03,
    "pu_foam": 0.04,
}


@dataclass
class PartInfo:
    name: str
    triangles: int
    dimensions_mm: tuple[float, float, float]
    center_mm: tuple[float, float, float]
    volume_cm3: float | None
    surface_cm2: float
    watertight: bool
    mass_g: float | None = None
    wall_thickness_mm: float | None = None


@dataclass
class ModelInfo:
    filename: str
    parts: int
    triangles: int
    dimensions_mm: tuple[float, float, float]
    oriented_dimensions_mm: tuple[float, float, float]
    center_mm: tuple[float, float, float]
    bounding_volume_cm3: float
    material_volume_cm3: float
    surface_cm2: float
    fill_rate_pct: float
    material: str | None = None
    density_g_cm3: float | None = None
    mass_g: float | None = None
    warnings: list[str] = field(default_factory=list)
    details: list[PartInfo] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _r(x: float, n: int = 2) -> float:
    return round(float(x), n)


def _tuple(v) -> tuple[float, float, float]:
    return tuple(_r(x) for x in np.asarray(v, dtype=float))


def estimate_wall_thickness(mesh: trimesh.Trimesh) -> float | None:
    """Rough estimate of wall thickness: 2 × volume / surface area.

    Exact for a flat plate, reasonable for a thin-walled bottle or jar;
    meaningless for a solid part (returns None when the thickness exceeds
    20 % of the smallest dimension).
    """
    if not mesh.is_watertight or mesh.area <= 0:
        return None
    t = 2.0 * abs(mesh.volume) / mesh.area
    if t > 0.2 * mesh.extents.min():
        return None
    return _r(t)


def analyze(scene: trimesh.Scene, material: str | None = None,
            density: float | None = None) -> ModelInfo:
    """Computes all useful information for a packaging review."""
    if material and density is None:
        key = material.lower().replace("-", "_").replace(" ", "_")
        if key not in MATERIALS:
            raise ValueError(f"Unknown material: {material}. Choices: {', '.join(sorted(MATERIALS))}")
        density = MATERIALS[key]

    warnings: list[str] = []
    parts: list[PartInfo] = []
    vol_total = 0.0
    area_total = 0.0

    for name, geom in scene.geometry.items():
        watertight = bool(geom.is_watertight)
        vol = abs(float(geom.volume)) if watertight else None
        area = float(geom.area)
        area_total += area
        if vol is not None:
            vol_total += vol
        else:
            warnings.append(f'Part "{name}": open mesh, volume/mass cannot be computed.')
        parts.append(PartInfo(
            name=name,
            triangles=len(geom.faces),
            dimensions_mm=_tuple(geom.extents),
            center_mm=_tuple(geom.bounds.mean(axis=0)),
            volume_cm3=_r(vol / 1000.0) if vol is not None else None,
            surface_cm2=_r(area / 100.0),
            watertight=watertight,
            mass_g=_r(vol / 1000.0 * density, 1) if (vol is not None and density) else None,
            wall_thickness_mm=estimate_wall_thickness(geom),
        ))

    extents = np.asarray(scene.extents, dtype=float)
    try:
        obb_ext, _ = oriented_extents(scene)
    except Exception:  # noqa: BLE001
        obb_ext = extents
    bbox_vol = float(np.prod(extents))

    if extents.max() > 3000:
        warnings.append("Dimensions > 3 m: check STEP units (inches? metres?).")
    if extents.max() < 1:
        warnings.append("Dimensions < 1 mm: check STEP units.")
    if np.prod(np.sort(obb_ext)) < 0.9 * bbox_vol:
        warnings.append('The part is tilted in its frame: see "oriented dimensions".')

    return ModelInfo(
        filename=Path(scene.metadata.get("source", "")).name,
        parts=len(parts),
        triangles=sum(p.triangles for p in parts),
        dimensions_mm=_tuple(extents),
        oriented_dimensions_mm=_tuple(np.sort(obb_ext)[::-1]),
        center_mm=_tuple(scene.bounds.mean(axis=0)),
        bounding_volume_cm3=_r(bbox_vol / 1000.0),
        material_volume_cm3=_r(vol_total / 1000.0),
        surface_cm2=_r(area_total / 100.0),
        fill_rate_pct=_r(100.0 * vol_total / bbox_vol if bbox_vol else 0.0, 1),
        material=material,
        density_g_cm3=density,
        mass_g=_r(vol_total / 1000.0 * density, 1) if density else None,
        warnings=warnings,
        details=parts,
    )


# Backward-compatibility alias
analyse = analyze


def interference_check(scene: trimesh.Scene, max_pairs: int = 50) -> list[tuple[str, str]]:
    """Detects pairs of parts whose bounding boxes overlap.

    A quick first alert for spotting collisions between product, padding and
    sleeve in an assembly. Does not replace a proper interference-detection
    analysis.
    """
    names = list(scene.geometry)
    hits = []
    for i, a in enumerate(names):
        ba = scene.geometry[a].bounds
        for b in names[i + 1:]:
            bb = scene.geometry[b].bounds
            if np.all(ba[0] < bb[1]) and np.all(bb[0] < ba[1]):
                hits.append((a, b))
                if len(hits) >= max_pairs:
                    return hits
    return hits
