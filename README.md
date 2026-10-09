# STEP Viewer

![tests](https://github.com/psteig99/step-viewer/actions/workflows/tests.yml/badge.svg)

Open, inspect and analyse CAD **STEP** files for packaging work, without a CAD licence: 3D viewer with dimension
lines, section cuts at any angle, wall-thickness estimate, mass per material, carton/pallet packing, assembly tree,
exports, and a Claude-powered page that analyses saved section views. Runs as a Python CLI, a shared web server,
or a single HTML file. Full French documentation follows.

![architecture](docs/architecture.png)

---


Application **web** de lecture, visualisation et analyse de fichiers CAD **STEP** (.step / .stp) pour les équipes packaging :
dépôt par cliquer-glisser, visionneuse 3D dans le navigateur avec cotes dessinées sur la pièce, mesure, coupe,
vue éclatée, volume et masse estimée par matériau, colisage carton / palette, exports et rapports partageables.
S'y ajoutent une ligne de commande (traitement par lot, rapports) et une visionneuse de bureau.

Aucune licence CAO ni conda : le noyau OpenCASCADE est embarqué via `cascadio` (pip). Le navigateur n'a besoin
d'aucun accès internet (three.js est livré avec l'application) : fonctionne sur un intranet fermé.

## Deux façons de l'utiliser

| | Version autonome | Version serveur |
|---|---|---|
| Fichier | `standalone/step-viewer.html` (double-clic, mail, intranet) | `stepviewer web` sur un poste ou serveur |
| Installation | aucune | Python + `pip install` |
| Lecture STEP | dans le navigateur (WebAssembly) | sur le serveur (plus rapide sur gros assemblages) |
| Données | ne quittent jamais le navigateur | restent sur votre serveur |
| En plus | — | encombrement orienté, 3MF, rapport avec 3D intégrée, API REST, traitement par lot |

Pour démarrer tout de suite : ouvrir `standalone/step-viewer.html` et déposer un STEP.

## Application web (version serveur)

```bash
# Windows : double-cliquer scripts\web.bat   |   macOS / Linux : ./scripts/web.sh
# ou : stepviewer web --reseau
```
Puis ouvrir http://localhost:8000 (ou http://ip-du-poste:8000 depuis un autre PC du réseau).

1. **Déposer** un ou plusieurs fichiers .step / .stp sur la page (glisser-déposer, bouton « Ouvrir », ou coller).
2. La pièce s'affiche en 3D avec ses **cotes hors-tout** dessinées comme sur un plan ; les fichiers ouverts
   apparaissent en onglets dans la barre du haut.
3. Barre d'outils : vues (iso, dessus, face, côté), filaire, transparence, grille, **mesurer** (deux clics → distance et
   dX/dY/dZ), **coupe** (plan X/Y/Z glissable, inversable ; la matière tranchée apparaît en ocre pour lire les
   épaisseurs), **éclaté**, **capture PNG**.
4. Panneau de droite : encombrement (et encombrement orienté minimal), volumes, **masse** selon le matériau choisi,
   liste des pièces (afficher/masquer, cliquer pour mettre en évidence), **colisage** carton et palette en direct,
   téléchargements (rapport HTML avec 3D intégrée, JSON, STL, OBJ, GLB, 3MF).
5. **Comparer deux révisions** : ouvrez les deux fichiers, puis dans « Comparer avec une autre révision » choisissez la
   référence ; elle se superpose en rouge translucide à la pièce courante et un tableau donne les écarts de cotes,
   de volume et de surface.

Protection par mot de passe (recommandée dès que l'outil est accessible à plusieurs postes) :
`stepviewer web --reseau --mot-de-passe secret` ou variable d'environnement `STEPVIEWER_PASSWORD`. Le navigateur
demande alors le mot de passe (l'identifiant est libre).

Raccourcis clavier : I X Y Z vues · R recadrer · W filaire · T transparence · B cotes · M mesurer · P coupe · F capture · Échap.

API REST documentée sur http://localhost:8000/api/docs (upload, analyse, exports, colisage) pour brancher
d'autres outils. Les fichiers restent sur le serveur, dans un dossier temporaire purgé après 6 h d'inactivité.

Déploiement sur un serveur interne : `uvicorn stepviewer.server:app --host 0.0.0.0 --port 8000`
(derrière un reverse proxy HTTPS si besoin ; définir `STEPVIEWER_PASSWORD` pour exiger un mot de passe).

## Installation (une fois)

```bash
# Windows : double-cliquer scripts\install.bat
# macOS / Linux :
./scripts/install.sh
```
Prérequis : Python 3.10+ (https://www.python.org, cocher « Add to PATH » sous Windows).

Installation manuelle : `pip install -e ".[web,dev]"` dans le dossier.

## Utilisation rapide

| Besoin | Commande |
|---|---|
| Ouvrir la visionneuse (boîte de dialogue) | `stepviewer` ou `scripts\stepviewer.bat` |
| Visualiser un fichier | `stepviewer view piece.step -m pet` |
| Rapport texte seul | `stepviewer info piece.step -m hdpe --json piece.json` |
| Rapport HTML autonome avec 3D (à envoyer par mail) | `stepviewer report piece.step -m pet` |
| Export STL / OBJ / GLB / 3MF | `stepviewer export piece.step piece.stl` (`--parts` : un fichier par pièce) |
| Analyser un dossier entier → CSV Excel | `stepviewer batch dossier_step/ --html -m pet` |
| Colisage : unités par carton et cartons par palette | `stepviewer fit piece.step --carton 400x300x250 --jeu 2 --palette euro -m pet` |
| Application web pour l'équipe | `stepviewer web --reseau` puis http://ip-du-poste:8000 |
| Matériaux connus | `stepviewer materials` |

Options communes : `-m/--material` (pet, hdpe, pp, verre, carton, aluminium…), `-d/--density` (g/cm³ libre),
`--tol` (finesse de maillage en mm, défaut 0.2 ; 0.5 pour des fichiers plus légers).

## Visionneuse de bureau (optionnelle) – raccourcis

| Touche | Action |
|---|---|
| W / S | filaire / surfaces |
| T | transparence (voir le produit dans son étui) |
| B / O | boîte englobante / boîte englobante **orientée** minimale |
| X Y Z / I / R | vues dessus, face, côté / isométrique / recadrer |
| E / D / A | éclaté + / – / annuler |
| M puis clic **droit** sur 2 points | mesure : distance et dX dY dZ en mm (C : effacer) |
| P / N | plan de coupe / changer l'axe de coupe |
| 1…9 / 0 | isoler une pièce / tout afficher |
| F | capture d'écran PNG haute résolution |
| H / Q | aide / quitter |

Souris : clic gauche rotation, molette zoom, clic milieu (ou Maj + gauche) translation.

## Ce que calcule l'analyse

- **Hors-tout** X × Y × Z dans le repère du fichier, et **encombrement orienté** (boîte minimale) si la pièce est modélisée de travers.
- **Volume matière** (maillage fermé requis — signalé sinon), **volume englobant**, **taux de remplissage**, **surface**.
- **Masse estimée** = volume × densité du matériau choisi (table modifiable dans `stepviewer/analysis.py`).
- **Épaisseur de paroi estimée** (2·V/S) pour les corps creux : bouteilles, pots, étuis.
- **Alertes** : unité suspecte (pouces / mètres), pièce inclinée, maillage ouvert, chevauchement de pièces dans un assemblage.
- **Colisage** : meilleure orientation parmi les 6, jeu réglable, option « debout » (pas de rotation), palettes euro / iso / US / demi-euro.

## Structure du projet

```
stepviewer/
  loader.py     lecture STEP -> maillages mm (cache, nettoyage)
  analysis.py   dimensions, volumes, masse, épaisseur, matériaux
  fit.py        colisage carton / palette
  report.py     rapports texte, JSON, CSV, HTML + 3D intégrée
  export.py     STL / OBJ / GLB / 3MF / PLY
  server.py     serveur web FastAPI (API + interface)
  static/       interface web : index.html, app.js, app.css, three.js embarqué
  viewer.py     visionneuse 3D de bureau (pyvista)
  cli.py        ligne de commande
tests/          pytest (python -m pytest)
samples/        fichier d'exemple
scripts/        installation et lancement Windows / macOS / Linux
```

## Limites connues

- Lecture par tessellation : pas d'arbre de construction ni d'édition de la géométrie ; les cotes sont celles du maillage (précision = `--tol`).
- Les unités sont supposées en millimètres après conversion ; une alerte s'affiche si les dimensions semblent incohérentes.
- L'estimation d'épaisseur est globale par pièce ; pour une cartographie fine, utiliser le plan de coupe + la mesure.
- Le colisage est un calcul en grille mono-orientation (pré-dimensionnement), sans prise en compte des formes réelles.
- L'authentification web est un mot de passe unique partagé (HTTP Basic) : suffisant en interne, à mettre derrière
  HTTPS si l'outil sort du réseau local.

## Documentation technique

Voir [docs/TECHNICAL.md](docs/TECHNICAL.md) (en anglais) : lecture STEP, moteur d'analyse, serveur, visionneuse, version navigateur, page coupe + IA, arbre d'assemblage, tests.

## Tests

```bash
python -m pytest                 # moteur, rapports, API web
cd tests/ui && npm install && npm test   # interface dans un Chromium headless (serveur lancé sur le port 8765)
```
