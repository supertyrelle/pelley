#!/usr/bin/env bash
# Usage: pelley-init [project-path]
#
# Initializes pelley platform support in a project directory.
# Creates .pelley/ directory with empty database and default config.
# Optionally initializes .beads/ if not present.

set -euo pipefail

PROJECT_PATH="${1:-$(pwd)}"
PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

# Validate it's a git repo
if [ ! -d "$PROJECT_PATH/.git" ]; then
  echo "Error: $PROJECT_PATH is not a git repository."
  echo "pelley requires a git repository. Run 'git init' first."
  exit 1
fi

echo "Initializing pelley in: $PROJECT_PATH"

# Create .pelley directory
mkdir -p "$PROJECT_PATH/.pelley"
echo "  Created .pelley/"

# Create empty models.json if it doesn't exist
if [ ! -f "$PROJECT_PATH/.pelley/models.json" ]; then
  echo '{}' > "$PROJECT_PATH/.pelley/models.json"
  echo "  Created .pelley/models.json"
fi

# Initialize .beads if not present and bd CLI is available
if [ ! -d "$PROJECT_PATH/.beads" ]; then
  if command -v bd &>/dev/null; then
    (cd "$PROJECT_PATH" && bd init 2>/dev/null) && echo "  Initialized .beads/" || echo "  Skipped .beads/ (bd init failed)"
  else
    echo "  Skipped .beads/ (bd CLI not found)"
  fi
else
  echo "  .beads/ already exists"
fi

# Add .pelley/ to .gitignore if not already there
GITIGNORE="$PROJECT_PATH/.gitignore"
if [ -f "$GITIGNORE" ]; then
  if ! grep -q '^\.pelley/' "$GITIGNORE" 2>/dev/null; then
    echo '.pelley/' >> "$GITIGNORE"
    echo "  Added .pelley/ to .gitignore"
  fi
else
  echo '.pelley/' > "$GITIGNORE"
  echo "  Created .gitignore with .pelley/"
fi

echo ""
echo "Done! Start the platform with:"
echo "  PROJECT_PATH=$PROJECT_PATH npm run dev"
echo ""
echo "Or for production:"
echo "  pelley-server $PROJECT_PATH"
