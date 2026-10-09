"""Colisage simple : combien d'unités tiennent dans un carton / sur une palette.

Algorithme : empilement en grille, les 6 orientations de l'unité sont testées
et la meilleure est retenue. C'est la méthode classique de pré-dimensionnement ;
elle ne fait pas de mélange d'orientations dans un même colis.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from itertools import permutations

import numpy as np

# Formats de palettes courants (L x l mm)
PALLETS: dict[str, tuple[float, float]] = {
    "euro": (1200, 800),
    "iso": (1200, 1000),
    "us": (1219, 1016),
    "demi_euro": (800, 600),
}


@dataclass
class FitResult:
    unite_mm: tuple[float, float, float]
    conteneur_mm: tuple[float, float, float]
    jeu_mm: float
    orientation_mm: tuple[float, float, float]
    par_axe: tuple[int, int, int]
    quantite: int
    taux_occupation_pct: float
    espace_perdu_mm: tuple[float, float, float]

    def to_dict(self) -> dict:
        return asdict(self)


def fit_in_container(unit: tuple[float, float, float], container: tuple[float, float, float],
                     clearance: float = 0.0, allow_rotation: bool = True) -> FitResult:
    """Nombre maximal d'unités (boîte englobante) dans un conteneur.

    unit, container : dimensions en mm.
    clearance : jeu ajouté autour de chaque unité (mm), ex. 1 à 2 mm pour un étui.
    allow_rotation : si False, l'unité garde son orientation (ex. bouteille debout).
    """
    unit = np.asarray(unit, dtype=float) + clearance
    cont = np.asarray(container, dtype=float)
    if np.any(unit <= 0) or np.any(cont <= 0):
        raise ValueError("Dimensions invalides")

    orientations = set(permutations(range(3))) if allow_rotation else {(0, 1, 2)}
    best = None
    for perm in orientations:
        u = unit[list(perm)]
        counts = np.floor(cont / u).astype(int)
        qty = int(np.prod(counts))
        if best is None or qty > best[0]:
            best = (qty, u, counts)

    qty, u, counts = best
    used_vol = qty * float(np.prod(u))
    return FitResult(
        unite_mm=tuple(round(float(x), 2) for x in unit - clearance),
        conteneur_mm=tuple(round(float(x), 2) for x in cont),
        jeu_mm=clearance,
        orientation_mm=tuple(round(float(x), 2) for x in u - clearance),
        par_axe=tuple(int(c) for c in counts),
        quantite=qty,
        taux_occupation_pct=round(100.0 * used_vol / float(np.prod(cont)), 1),
        espace_perdu_mm=tuple(round(float(x), 2) for x in cont - counts * u),
    )


def fit_on_pallet(carton: tuple[float, float, float], pallet: str | tuple[float, float] = "euro",
                  max_height: float = 1800.0, pallet_height: float = 144.0) -> FitResult:
    """Nombre de cartons sur une palette (hauteur totale limitée)."""
    L, l = PALLETS[pallet] if isinstance(pallet, str) else pallet
    return fit_in_container(carton, (L, l, max_height - pallet_height))
