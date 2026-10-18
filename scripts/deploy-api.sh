#!/usr/bin/env bash
# Deploy the portfolio API (space/server.py) to Modal. Needs `modal setup` once.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build-kb.mjs
cp src/content/generated/embeddings.json space/embeddings.json
cp src/content/generated/kb.json space/kb.json
modal deploy space/modal_app.py
