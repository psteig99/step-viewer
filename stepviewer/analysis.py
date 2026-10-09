"""Analyse géométrique orientée packaging : dimensions, volumes, masse estimée."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
import trimesh

from .loader import combined_mesh, oriented_extents

# Densités usuelles des matériaux d'emballage (g/cm³)
MATERIALS: dict[str, float] = {
    "pet": 1.38,
    "rpet": 1.38,
    "hdpe": 0.95,
    "ldpe": 0.92,
    "pp": 0.90,
    "ps": 1.05,
    "pla": 1.24,
    "pvc": 1.40,
    "verre": 2.50,
    "aluminium": 2.70,
    "acier": 7.85,
    "fer_blanc": 7.85,
    "carton": 0.70,       # carton compact
    "carton_ondule": 0.15,
    "papier": 0.80,
    "bois": 0.60,
    "liege": 0.24,
    "mousse_pe": 0.03,
    "mousse_pu": 0.04,
}


@dataclass
class PartInfo:
    nom: str
    triangles: int
    dimensions_mm: tuple[float, float, float]
    centre_mm: tuple[float, float, float]
    volume_cm3: float | None
    surface_cm2: float
    etanche: bool
    masse_g: float | None = None
    epaisseur_mm_estimee: float | None = None


@dataclass
class ModelInfo:
    fichier: str
    pieces: int
    triangles: int
    dimensions_mm: tuple[float, float, float]
    dimensions_orientees_mm: tuple[float, float, float]
    centre_mm: tuple[float, float, float]
    volume_englobant_cm3: float
    volume_matiere_cm3: float
    surface_cm2: float
    taux_remplissage_pct: float
    materiau: str | None = None
    densite_g_cm3: float | None = None
    masse_g: float | None = None
    avertissements: list[str] = field(default_factory=list)
    details: list[PartInfo] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _r(x: float, n: int = 2) -> float:
    return round(float(x), n)


def _tuple(v) -> tuple[float, float, float]:
    return tuple(_r(x) for x in np.asarray(v, dtype=float))


def estimate_wall_thickness(mesh: trimesh.Trimesh) -> float | None:
    """Estimation grossière de l'épaisseur de paroi : 2 x volume / surface.

    Exacte pour une plaque, raisonnable pour une bouteille ou un pot à paroi
    mince ; sans signification pour une pièce massive (renvoie alors None si
    l'épaisseur dépasse 20 % de la plus petite dimension).
    """
    if not mesh.is_watertight or mesh.area <= 0:
        return None
    t = 2.0 * abs(mesh.volume) / mesh.area
    if t > 0.2 * mesh.extents.min():
        return None
    return _r(t)


def analyse(scene: trimesh.Scene, material: str | None = None,
            density: float | None = None) -> ModelInfo:
    """Calcule toutes les informations utiles pour une revue packaging."""
    if material and density is None:
        key = material.lower().replace("-", "_").replace(" ", "_")
        if key not in MATERIALS:
            raise ValueError(f"Matériau inconnu : {material}. Choix : {', '.join(sorted(MATERIALS))}")
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
            warnings.append(f"Pièce « {name} » : maillage non fermé, volume/masse non calculables.")
        parts.append(PartInfo(
            nom=name,
            triangles=len(geom.faces),
            dimensions_mm=_tuple(geom.extents),
            centre_mm=_tuple(geom.bounds.mean(axis=0)),
            volume_cm3=_r(vol / 1000.0) if vol is not None else None,
            surface_cm2=_r(area / 100.0),
            etanche=watertight,
            masse_g=_r(vol / 1000.0 * density, 1) if (vol is not None and density) else None,
            epaisseur_mm_estimee=estimate_wall_thickness(geom),
        ))

    extents = np.asarray(scene.extents, dtype=float)
    try:
        obb_ext, _ = oriented_extents(scene)
    except Exception:  # noqa: BLE001
        obb_ext = extents
    bbox_vol = float(np.prod(extents))

    if extents.max() > 3000:
        warnings.append("Dimensions > 3 m : vérifier l'unité du STEP (pouces ? mètres ?).")
    if extents.max() < 1:
        warnings.append("Dimensions < 1 mm : vérifier l'unité du STEP.")
    if np.prod(np.sort(obb_ext)) < 0.9 * bbox_vol:
        warnings.append("La pièce est inclinée dans son repère : voir « dimensions orientées ».")

    return ModelInfo(
        fichier=Path(scene.metadata.get("source", "")).name,
        pieces=len(parts),
        triangles=sum(p.triangles for p in parts),
        dimensions_mm=_tuple(extents),
        dimensions_orientees_mm=_tuple(np.sort(obb_ext)[::-1]),
        centre_mm=_tuple(scene.bounds.mean(axis=0)),
        volume_englobant_cm3=_r(bbox_vol / 1000.0),
        volume_matiere_cm3=_r(vol_total / 1000.0),
        surface_cm2=_r(area_total / 100.0),
        taux_remplissage_pct=_r(100.0 * vol_total / bbox_vol if bbox_vol else 0.0, 1),
        materiau=material,
        densite_g_cm3=density,
        masse_g=_r(vol_total / 1000.0 * density, 1) if density else None,
        avertissements=warnings,
        details=parts,
    )


def interference_check(scene: trimesh.Scene, max_pairs: int = 50) -> list[tuple[str, str]]:
    """Détecte les paires de pièces dont les boîtes englobantes se chevauchent.

    Première alerte rapide pour repérer des collisions entre produit, calage et
    étui dans un assemblage. Ne remplace pas une vraie détection d'interférence.
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
