"""Simple packing calculation: how many units fit in a carton / on a pallet.

Algorithm: grid stacking, all 6 orientations of the unit are tested and the
best is kept. This is the classic pre-sizing method; it does not mix
orientations within the same box.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from itertools import permutations

import numpy as np

# Common pallet formats (L × W mm)
PALLETS: dict[str, tuple[float, float]] = {
    "euro": (1200, 800),
    "iso": (1200, 1000),
    "us": (1219, 1016),
    "demi_euro": (800, 600),
}


@dataclass
class FitResult:
    unit_mm: tuple[float, float, float]
    container_mm: tuple[float, float, float]
    clearance_mm: float
    orientation_mm: tuple[float, float, float]
    per_axis: tuple[int, int, int]
    quantity: int
    fill_rate_pct: float
    wasted_space_mm: tuple[float, float, float]

    def to_dict(self) -> dict:
        return asdict(self)


def fit_in_container(unit: tuple[float, float, float], container: tuple[float, float, float],
                     clearance: float = 0.0, allow_rotation: bool = True) -> FitResult:
    """Maximum number of units (bounding box) in a container.

    unit, container: dimensions in mm.
    clearance: gap added around each unit (mm), e.g. 1–2 mm for a carton.
    allow_rotation: if False, the unit keeps its orientation (e.g. bottle standing up).
    """
    unit = np.asarray(unit, dtype=float) + clearance
    cont = np.asarray(container, dtype=float)
    if np.any(unit <= 0) or np.any(cont <= 0):
        raise ValueError("Invalid dimensions")

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
        unit_mm=tuple(round(float(x), 2) for x in unit - clearance),
        container_mm=tuple(round(float(x), 2) for x in cont),
        clearance_mm=clearance,
        orientation_mm=tuple(round(float(x), 2) for x in u - clearance),
        per_axis=tuple(int(c) for c in counts),
        quantity=qty,
        fill_rate_pct=round(100.0 * used_vol / float(np.prod(cont)), 1),
        wasted_space_mm=tuple(round(float(x), 2) for x in cont - counts * u),
    )


def fit_on_pallet(carton: tuple[float, float, float], pallet: str | tuple[float, float] = "euro",
                  max_height: float = 1800.0, pallet_height: float = 144.0) -> FitResult:
    """Number of cartons on a pallet (total height limited)."""
    L, l = PALLETS[pallet] if isinstance(pallet, str) else pallet
    return fit_in_container(carton, (L, l, max_height - pallet_height))
