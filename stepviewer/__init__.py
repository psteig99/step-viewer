"""stepviewer - lecture, analyse et visualisation de fichiers STEP pour le packaging."""
from .loader import load_step
from .analysis import analyse, MATERIALS
from .fit import fit_in_container

__version__ = "1.0.0"
__all__ = ["load_step", "analyse", "MATERIALS", "fit_in_container", "__version__"]
