# Version autonome (un seul fichier HTML)

`step-viewer.html` est la même application que l'interface web, mais **sans serveur** : la lecture du STEP est faite
par OpenCASCADE compilé en WebAssembly (`occt-import-js`), l'analyse et le colisage sont réécrits en JavaScript
(`src/engine.js`). Le fichier s'ouvre en double-clic, s'envoie par mail, se dépose sur un intranet ou SharePoint,
et aucune donnée ne quitte le navigateur.

Reconstruire après une modification de `src/` ou de `../stepviewer/static/index.html` / `app.css` :

```bash
cd standalone
npm install
npm run build      # produit step-viewer.html (~5 Mo)
```

Différences avec la version serveur : pas d'encombrement orienté minimal, rapport HTML avec capture d'écran au lieu de
la 3D intégrée, pas d'export 3MF. Lecture d'un STEP typique : 1 à 3 s sur un PC de bureau.

## Interface simple « Coupe + analyse IA »

`simple/coupe-step-ia.html` : trois étapes seulement — déposer le STEP, couper selon un angle libre (azimut,
inclinaison, position, côté), analyser la coupe avec Claude. L'analyse IA fonctionne quand la page est publiée
comme artefact claude.ai (capacité `sample` avec images : la page envoie la capture de la coupe, la vue entière
et les mesures, sur le compte de la personne qui l'utilise). Ouverte ailleurs, la page propose d'enregistrer la
capture pour la soumettre à la main. Reconstruire : `npm run build:simple`.

Structure de l'assemblage dans la page simple : l'arbre du STEP (`result.root` d'occt-import-js) est affiché avec
nœuds repliables, cases afficher/masquer par sous-ensemble, dimensions et volumes sommés, badges d'instances ;
sélection bidirectionnelle arbre ⇄ 3D avec cadrage ; survol des faces B-rep (`brep_faces`) ; regroupements
automatiques (couleur, nom, volume, contact) et renommage ; l'arbre indenté et les pièces masquées de chaque coupe
sont transmis à l'IA.
