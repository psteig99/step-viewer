"""Desktop 3D viewer (pyvista / VTK).

Shortcuts:
    W / S   wireframe / surfaces        T   transparency (see inside)
    B       bounding box                O   oriented bounding box (minimal)
    X Y Z   top view / front / side     I   isometric view       R  fit
    E / D   explode + / -               A   reset explode
    M       measure mode (right-click on 2 points)     C  clear measurements
    P       clip plane                  N   clip plane axis (X -> Y -> Z)
    1..9    isolate part n° / 0 show all
    F       PNG screenshot              H   help      Q  quit
Mouse: left click rotation · scroll wheel zoom · middle click / Shift+left pan
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path

import numpy as np
import trimesh

from .analysis import ModelInfo
from .loader import oriented_extents

log = logging.getLogger(__name__)

PALETTE = ["#3b6fb6", "#d1495b", "#6aa84f", "#8e63b5", "#ec8f2a", "#30a5b8",
           "#7f7f7f", "#c9a227", "#1f8a70", "#b85c38"]

HELP = __doc__.split("Shortcuts:", 1)[1].strip()


def show(scene: trimesh.Scene, info: ModelInfo, title: str = "STEP Viewer",
         screenshot_dir: str | Path | None = None, off_screen: bool = False) -> None:
    try:
        import pyvista as pv
    except ImportError as exc:  # pragma: no cover
        raise SystemExit("pyvista is not installed: pip install pyvista") from exc

    pv.global_theme.allow_empty_mesh = True
    pl = pv.Plotter(title=f"{title} – {info.filename}", window_size=(1400, 880), off_screen=off_screen)
    pl.set_background("#ffffff", top="#dde5ee")
    pl.enable_anti_aliasing("fxaa")

    L, l, h = info.dimensions_mm
    size = max(L, l, h) or 1.0
    names = list(scene.geometry)
    centre = np.asarray(scene.bounds.mean(axis=0))

    # ---- parts -----------------------------------------------------------
    actors, meshes, centres = [], [], []
    for i, name in enumerate(names):
        geom = scene.geometry[name]
        faces = np.hstack([np.full((len(geom.faces), 1), 3), geom.faces]).ravel()
        mesh = pv.PolyData(np.asarray(geom.vertices, dtype=float), faces)
        actor = pl.add_mesh(mesh, color=PALETTE[i % len(PALETTE)], smooth_shading=True,
                            specular=0.35, specular_power=20, label=f"{i + 1}. {name[:36]}")
        actors.append(actor)
        meshes.append(mesh)
        centres.append(np.asarray(geom.bounds.mean(axis=0)))

    # ---- bounding boxes ------------------------------------------------
    bbox_actor = pl.add_mesh(pv.Box(bounds=scene.bounds.T.ravel()), style="wireframe",
                             color="#222222", line_width=1.5, opacity=0.6)
    obb_actor = None
    try:
        obb_ext, obb_tf = oriented_extents(scene)
        obb = pv.Box(bounds=(-obb_ext[0] / 2, obb_ext[0] / 2, -obb_ext[1] / 2, obb_ext[1] / 2,
                             -obb_ext[2] / 2, obb_ext[2] / 2)).transform(obb_tf, inplace=False)
        obb_actor = pl.add_mesh(obb, style="wireframe", color="#d1495b", line_width=1.5)
        obb_actor.SetVisibility(False)
    except Exception as exc:  # noqa: BLE001
        log.debug("OBB unavailable: %s", exc)

    # ---- text labels -----------------------------------------------------------
    mass = f"   Mass: {info.mass_g} g ({info.material})" if info.mass_g is not None else ""
    pl.add_text(f"{info.filename}\nOverall dims: {L:g} × {l:g} × {h:g} mm\n"
                f"Parts: {info.parts}   Material vol.: {info.material_volume_cm3} cm³{mass}",
                position="upper_left", font_size=11, color="#111111")
    status = pl.add_text("H: help", position="lower_left", font_size=9, color="#444444")
    measure_text = pl.add_text("", position="upper_right", font_size=11, color="#b00000")
    help_actor = pl.add_text(HELP, position="lower_right", font_size=9, color="#111111")
    help_actor.SetVisibility(False)

    pl.add_axes(xlabel="X", ylabel="Y", zlabel="Z")
    pl.show_bounds(grid="back", location="outer", xtitle="X (mm)", ytitle="Y (mm)", ztitle="Z (mm)",
                   color="#555555", font_size=9)
    if len(actors) > 1:
        pl.add_legend(bcolor="white", size=(0.24, min(0.03 * len(actors), 0.5)), loc="center right")

    state = {"bbox": True, "obb": False, "measure": False, "clip": False, "clip_axis": 0,
             "explode": 0.0, "alpha": 1.0, "pts": [], "marks": [], "clip_actor": None, "help": False}

    def set_status(msg: str) -> None:
        status.SetText(0, msg)
        pl.render()

    # ---- representation ----------------------------------------------------
    def set_repr(mode: str) -> None:
        for a in actors:
            getattr(a.GetProperty(), f"SetRepresentationTo{mode}")()
        set_status(f"Display: {mode.lower()}")

    def toggle_alpha() -> None:
        state["alpha"] = {1.0: 0.35, 0.35: 1.0}[state["alpha"]]
        for a in actors:
            a.GetProperty().SetOpacity(state["alpha"])
        set_status("Transparency " + ("on" if state["alpha"] < 1 else "off"))

    def toggle_bbox() -> None:
        state["bbox"] = not state["bbox"]
        bbox_actor.SetVisibility(state["bbox"])
        pl.render()

    def toggle_obb() -> None:
        if obb_actor is None:
            return
        state["obb"] = not state["obb"]
        obb_actor.SetVisibility(state["obb"])
        Lo, lo, ho = info.oriented_dimensions_mm
        set_status(f"Oriented dims: {Lo:g} × {lo:g} × {ho:g} mm" if state["obb"] else "")

    # ---- explode -----------------------------------------------------------
    def explode(delta: float) -> None:
        state["explode"] = max(0.0, state["explode"] + delta)
        for a, c in zip(actors, centres):
            offset = (c - centre) * state["explode"]
            a.SetPosition(*offset)
        set_status(f"Explode: {state['explode']:.1f}" if state["explode"] else "")

    def reset_explode() -> None:
        state["explode"] = 0.0
        for a in actors:
            a.SetPosition(0, 0, 0)
        set_status("")

    # ---- part isolation -------------------------------------------
    def isolate(idx: int | None) -> None:
        for i, a in enumerate(actors):
            a.SetVisibility(idx is None or i == idx)
        if idx is None:
            set_status("All parts shown")
        else:
            p = info.details[idx]
            d = " × ".join(f"{x:g}" for x in p.dimensions_mm)
            set_status(f"Part {idx + 1}: {p.name}   {d} mm   "
                       f"{'%s cm³' % p.volume_cm3 if p.volume_cm3 is not None else ''}")

    # ---- measure -----------------------------------------------------------
    def on_pick(point) -> None:
        if not state["measure"]:
            return
        p = np.asarray(point, dtype=float)
        state["pts"].append(p)
        state["marks"].append(pl.add_mesh(pv.Sphere(radius=size * 0.006, center=p), color="red"))
        if len(state["pts"]) == 2:
            p1, p2 = state["pts"]
            dist = float(np.linalg.norm(p2 - p1))
            dx, dy, dz = np.abs(p2 - p1)
            state["marks"].append(pl.add_mesh(pv.Line(p1, p2), color="red", line_width=3))
            state["marks"].append(pl.add_point_labels(
                [(p1 + p2) / 2], [f"{dist:.2f} mm"], font_size=14, text_color="#b00000",
                shape_color="white", always_visible=True))
            measure_text.SetText(3, f"Distance: {dist:.2f} mm\ndX {dx:.2f}  dY {dy:.2f}  dZ {dz:.2f} mm")
            state["pts"] = []
        pl.render()

    pl.enable_surface_point_picking(callback=on_pick, show_message=False, show_point=False,
                                    picker="cell", left_clicking=False)

    def toggle_measure() -> None:
        state["measure"] = not state["measure"]
        measure_text.SetText(3, "MEASURE MODE: right-click on 2 points" if state["measure"] else "")
        pl.render()

    def clear_measure() -> None:
        for m in state["marks"]:
            pl.remove_actor(m)
        state["marks"].clear()
        state["pts"].clear()
        measure_text.SetText(3, "MEASURE MODE: right-click on 2 points" if state["measure"] else "")
        pl.render()

    # ---- clip plane -------------------------------------------------------
    combined = pv.MultiBlock(meshes).combine()

    def _enable_clip() -> None:
        axis = "xyz"[state["clip_axis"]]
        for a in actors:
            a.SetVisibility(False)
        state["clip_actor"] = pl.add_mesh_clip_plane(combined, normal=axis, color="#3b6fb6",
                                                     smooth_shading=True, invert=False)
        set_status(f"Clip plane {axis.upper()} – drag the arrow, N: change axis")

    def _disable_clip() -> None:
        pl.clear_plane_widgets()
        if state["clip_actor"] is not None:
            pl.remove_actor(state["clip_actor"])
            state["clip_actor"] = None
        for a in actors:
            a.SetVisibility(True)
        set_status("")

    def toggle_clip() -> None:
        state["clip"] = not state["clip"]
        _enable_clip() if state["clip"] else _disable_clip()

    def next_clip_axis() -> None:
        state["clip_axis"] = (state["clip_axis"] + 1) % 3
        if state["clip"]:
            _disable_clip()
            state["clip"] = True
            _enable_clip()

    # ---- screenshot -------------------------------------------------------
    def screenshot() -> None:
        folder = Path(screenshot_dir) if screenshot_dir else Path.cwd()
        folder.mkdir(parents=True, exist_ok=True)
        out = folder / f"{Path(info.filename).stem}_{datetime.now():%Y%m%d_%H%M%S}.png"
        pl.screenshot(str(out), transparent_background=False, scale=2)
        set_status(f"Screenshot saved: {out}")

    def toggle_help() -> None:
        state["help"] = not state["help"]
        help_actor.SetVisibility(state["help"])
        pl.render()

    # ---- key bindings ----------------------------------------------------
    keys = {
        "w": lambda: set_repr("Wireframe"), "s": lambda: set_repr("Surface"), "t": toggle_alpha,
        "b": toggle_bbox, "o": toggle_obb,
        "x": lambda: (pl.view_xy(), pl.render()), "y": lambda: (pl.view_xz(), pl.render()),
        "z": lambda: (pl.view_yz(), pl.render()), "i": lambda: (pl.view_isometric(), pl.render()),
        "r": lambda: (pl.reset_camera(), pl.render()),
        "e": lambda: explode(0.25), "d": lambda: explode(-0.25), "a": reset_explode,
        "m": toggle_measure, "c": clear_measure, "p": toggle_clip, "n": next_clip_axis,
        "f": screenshot, "h": toggle_help, "0": lambda: isolate(None),
    }
    for k, fn in keys.items():
        pl.add_key_event(k, fn)
    for n in range(1, min(9, len(actors)) + 1):
        pl.add_key_event(str(n), lambda n=n: isolate(n - 1))

    pl.view_isometric()
    if off_screen:
        pl.show(auto_close=False)
        pl.close()
    else:
        pl.show()
