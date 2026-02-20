#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${PELLEY_URL:-http://localhost:3000}"
API="$BASE_URL/api/models"

# --- helpers ----------------------------------------------------------------

die() { echo "error: $*" >&2; exit 1; }

has_jq() { command -v jq >/dev/null 2>&1; }

# Pretty-print JSON if jq is available, otherwise cat through.
pp() {
  if has_jq; then
    jq '.'
  else
    cat
  fi
}

# Compact JSON query via jq; falls back to raw output.
jqf() {
  if has_jq; then
    jq -r "$1"
  else
    cat
  fi
}

# HTTP GET, returns body. Exits 1 on curl failure.
get() {
  local url="$1"
  local resp
  resp=$(curl -sfS "$url" 2>&1) || die "request failed: $url — $resp"
  echo "$resp"
}

# HTTP POST with JSON body.
post() {
  local url="$1" body="${2:-{}}"
  local resp
  resp=$(curl -sfS -X POST -H 'Content-Type: application/json' -d "$body" "$url" 2>&1) \
    || die "request failed: $url — $resp"
  echo "$resp"
}

# HTTP PUT with JSON body.
put() {
  local url="$1" body="$2"
  local resp
  resp=$(curl -sfS -X PUT -H 'Content-Type: application/json' -d "$body" "$url" 2>&1) \
    || die "request failed: $url — $resp"
  echo "$resp"
}

# --- subcommands ------------------------------------------------------------

cmd_list() {
  local provider=""
  for arg in "$@"; do
    case "$arg" in
      --provider=*) provider="${arg#--provider=}" ;;
      *) die "unknown flag: $arg" ;;
    esac
  done

  if [ -n "$provider" ]; then
    echo "Models for provider: $provider"
    echo "---"
    get "$API?provider=$provider" | pp
  else
    echo "Providers"
    echo "---"
    get "$API/providers" | pp
    echo ""
    echo "All models"
    echo "---"
    get "$API" | pp
  fi
}

cmd_status() {
  echo "Providers"
  echo "---"
  get "$API/providers" | jqf '
    .[] | "\(.id): \(if .isAvailable then "available" else "unavailable" end)"
  '

  echo ""
  echo "Ollama"
  echo "---"
  get "$API/ollama/status" | pp

  echo ""
  echo "Local server"
  echo "---"
  get "$API/local-server/status" | pp
}

cmd_pull() {
  local model="${1:-}"
  [ -z "$model" ] && die "usage: models pull <name>"

  echo "Pulling $model ..."
  curl -sfSN -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"$model\"}" \
    "$API/ollama/pull" | while IFS= read -r line; do
      if has_jq; then
        echo "$line" | jq -r '
          if .error then "error: \(.error)"
          elif .status == "error" then "error: \(.error // "unknown")"
          elif .completed and .total then
            "\(.status) \(.completed)/\(.total)"
          else
            .status // .
          end
        ' 2>/dev/null || echo "$line"
      else
        echo "$line"
      fi
    done
}

cmd_ollama_url() {
  local url="${1:-}"
  if [ -z "$url" ]; then
    get "$API/ollama/base-url" | pp
  else
    put "$API/ollama/base-url" "{\"url\":\"$url\"}" | pp
  fi
}

cmd_connect() {
  local url="${1:-}"
  [ -z "$url" ] && die "usage: models connect <url>"
  post "$API/local-server/connect" "{\"url\":\"$url\"}" | pp
}

cmd_disconnect() {
  post "$API/local-server/disconnect" | pp
}

cmd_route() {
  local session_id="${1:-}"
  [ -z "$session_id" ] && die "usage: models route <sessionId> [provider model]"

  local provider="${2:-}"
  local model="${3:-}"

  if [ -z "$provider" ]; then
    get "$API/route/$session_id" | pp
  else
    [ -z "$model" ] && die "usage: models route <sessionId> <provider> <model>"
    post "$API/route" "{\"sessionId\":\"$session_id\",\"route\":{\"provider\":\"$provider\",\"model\":\"$model\"}}" | pp
  fi
}

cmd_help() {
  cat <<'EOF'
models — CLI for Pelley model management

Usage: models <command> [options]

Commands:
  list [--provider=<id>]              List providers and models
  status                              Show provider availability and server status
  pull <name>                         Pull an Ollama model (streams progress)
  ollama-url [url]                    Get or set Ollama base URL
  connect <url>                       Connect to a local OpenAI-compatible server
  disconnect                          Disconnect local server
  route <sessionId> [provider model]  Get or set model route for a session

Environment:
  PELLEY_URL   Base URL of the platform server (default: http://localhost:3000)

Examples:
  models list
  models list --provider=ollama
  models status
  models pull llama3.2
  models ollama-url http://localhost:11434
  models connect http://localhost:8080/v1
  models disconnect
  models route my-session openai gpt-4o
  models route my-session

Requires: curl. Optional: jq (for pretty output).
EOF
}

# --- main -------------------------------------------------------------------

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  list)        cmd_list "$@" ;;
  status)      cmd_status "$@" ;;
  pull)        cmd_pull "$@" ;;
  ollama-url)  cmd_ollama_url "$@" ;;
  connect)     cmd_connect "$@" ;;
  disconnect)  cmd_disconnect "$@" ;;
  route)       cmd_route "$@" ;;
  help|--help|-h) cmd_help ;;
  *) die "unknown command: $cmd (try 'models help')" ;;
esac
