"""stepviewer - loading, analysis and visualisation of STEP files for packaging."""
from .loader import load_step
from .analysis import analyze, analyse, MATERIALS

__version__ = "1.0.0"
__all__ = ["load_step", "analyze", "analyse", "MATERIALS", "__version__"]
