#!/usr/bin/env bash
cd "$(dirname "$0")/.."
source .venv/bin/activate
(sleep 2; xdg-open http://localhost:8000 2>/dev/null || open http://localhost:8000 2>/dev/null) &
stepviewer web --reseau --port 8000
