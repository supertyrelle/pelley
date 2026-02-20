#!/usr/bin/env bash
# Usage: pelley-server [project-path]
# Starts the pelley platform server for the given project directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM_DIR="$(dirname "$SCRIPT_DIR")"

PROJECT_PATH="${1:-$(pwd)}"
export PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

# Check if built
if [ -d "$PLATFORM_DIR/.output" ]; then
  exec node "$PLATFORM_DIR/.output/server/index.mjs"
else
  echo "Platform not built. Run 'npm run build' in $PLATFORM_DIR first."
  echo "Or use 'npm run dev' for development mode."
  exit 1
fi
