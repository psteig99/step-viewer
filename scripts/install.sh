#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -e ".[web,dev]"
echo "Installation terminée. Lancez scripts/stepviewer.sh (visionneuse) ou scripts/web.sh (application web)."
