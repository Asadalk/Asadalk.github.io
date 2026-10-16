#!/usr/bin/env bash
# Deploy space/ to the owner's Hugging Face Space (Docker, free CPU tier).
# Needs `hf auth login` once. Usage: scripts/deploy-space.sh [space-name]
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:-portfolio-api}"
USER_NAME="$(hf auth whoami | head -1 | sed -E 's/^(user[:=] *)//I')"
REPO="$USER_NAME/$NAME"
cp src/content/generated/embeddings.json space/embeddings.json
hf repos create "$REPO" --type space --sdk docker --exist-ok >/dev/null
hf upload "$REPO" space . --repo-type space --commit-message "Deploy from portfolio $(git rev-parse --short HEAD)"
echo "Space: https://huggingface.co/spaces/$REPO"
echo "API:   https://${USER_NAME,,}-${NAME}.hf.space"
