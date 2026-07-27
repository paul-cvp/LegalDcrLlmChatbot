#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  trap - INT TERM EXIT
  if [[ -n "$BACKEND_PID" ]]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [[ -n "$FRONTEND_PID" ]]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}

trap cleanup INT TERM EXIT

(
  cd "$PROJECT_DIR/backend"
  python3 -m uvicorn main:app \
    --host "${BACKEND_HOST:-0.0.0.0}" \
    --port "${BACKEND_PORT:-8000}" \
    --reload
) &
BACKEND_PID=$!

(
  cd "$PROJECT_DIR/frontend"
  export DCR_BACKEND_URL="${DCR_BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT:-8000}}"
  yarn start --host "${FRONTEND_HOST:-0.0.0.0}" --port "${FRONTEND_PORT:-5173}"
) &
FRONTEND_PID=$!

echo "Backend: http://localhost:${BACKEND_PORT:-8000}"
echo "Frontend: http://localhost:${FRONTEND_PORT:-5173}/dcr-js"

wait -n "$BACKEND_PID" "$FRONTEND_PID"
