import base64
from pathlib import Path
here = Path(__file__).parent
html = (here/'template.html').read_text()
html = html.replace('/*__CSS__*/', (here/'style.css').read_text())
html = html.replace('/*__JS__*/', (here/'bundle.js').read_text())
html = html.replace('/*__WASM__*/', base64.b64encode((here.parent/'occt.wasm.gz').read_bytes()).decode())
(here/'coupe-step-ia.html').write_text(html)
print(round(len(html)/1e6,2), 'Mo')
