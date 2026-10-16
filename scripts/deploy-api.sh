#!/usr/bin/env bash
# Deploy the portfolio API (space/server.py) to Modal. Needs `modal setup` once.
set -euo pipefail
cd "$(dirname "$0")/.."
cp src/content/generated/embeddings.json space/embeddings.json
modal deploy space/modal_app.py
