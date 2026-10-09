import base64, re
from pathlib import Path
SRC = Path(__file__).resolve().parents[1] / 'stepviewer' / 'static'
css = (SRC/'app.css').read_text()
html = (SRC/'index.html').read_text()
js = Path('bundle.js').read_text()
wasm = base64.b64encode(Path('occt.wasm.gz').read_bytes()).decode()

# Adaptations de la page
css = css.replace('@media (prefers-color-scheme: dark) {\n  :root {', '@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {')
css += '''
:root[data-theme="dark"] { --bench: #23282e; --paper: #1b1f24; --ink: #e8ecf1; --ink-2: #9aa5b3; --rule: #343b44;
  --cyan: #7fa8ea; --cyan-soft: #233553; --kraft: #d9a558; --kraft-soft: #3d3120; --alert: #ff8a80; --alert-soft: #3b2020; }
:root { box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
html { scroll-padding-top: env(safe-area-inset-top, 0px); }
.toast { bottom: calc(22px + env(safe-area-inset-bottom, 0px)); }
'''
html = html.replace('<link rel="stylesheet" href="/static/app.css">', '<style>\n' + css + '\n</style>')
html = re.sub(r'<script type="importmap">.*?</script>\n', '', html, flags=re.S)
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">',
                    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
html = html.replace('<p class="drop-hint">La pièce est lue sur ce serveur, puis affichée ici avec ses cotes. Rien n\'est envoyé ailleurs.</p>',
                    '<p class="drop-hint">Tout se passe dans votre navigateur : le fichier n\'est envoyé sur aucun serveur.</p>')
html = html.replace('''      <div class="downloads" id="downloads"></div>''','''      <div class="downloads" id="downloads">
        <button class="dl" data-export="html">Rapport HTML</button>
        <button class="dl" data-export="json">Analyse JSON</button>
        <button class="dl" data-export="stl">STL</button>
        <button class="dl" data-export="obj">OBJ</button>
        <button class="dl" data-export="glb">GLB</button>
        <button class="dl" data-export="png">Capture PNG</button>
      </div>
      <div class="field-row">
        <label for="quality">Finesse de lecture</label>
        <select id="quality">
          <option value="0.002">rapide</option>
          <option value="0.001" selected>normale</option>
          <option value="0.0004">fine</option>
        </select>
      </div>''')
html = html.replace('<script type="module" src="/static/app.js"></script>',
    '<script type="text/plain" id="occt-wasm">' + wasm + '</script>\n<script>\n' + js + '\n</script>')
# tokens de thème : fond explicite déjà présent ; CSS2D/measure ok.
html = html.replace('<title>STEP Viewer – packaging</title>', '<title>STEP Viewer – packaging</title>\n<meta name="description" content="Visionneuse de fichiers CAD STEP pour le packaging, entièrement dans le navigateur.">')
Path('step-viewer.html').write_text(html)
print(len(html)/1e6, 'Mo')
