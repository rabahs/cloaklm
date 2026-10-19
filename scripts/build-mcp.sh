#!/usr/bin/env bash
# Builds the CloakLM MCP server into the app's resources:
#   src-tauri/resources/mcp/server.cjs  single-file server for Claude Code, Codex, Gemini CLI
#   src-tauri/resources/mcp/cloaklm.mcpb one-click extension for Claude Desktop
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/src-tauri/resources/mcp"
STAGE_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGE_DIR"' EXIT

mkdir -p "$OUT_DIR" "$STAGE_DIR/server"

# .cjs so Node runs it as CommonJS wherever it sits (the repo root is "type": "module").
npx esbuild "$ROOT_DIR/mcp/src/server.ts" \
  --bundle --platform=node --format=cjs --target=node18 --log-level=warning \
  --outfile="$OUT_DIR/server.cjs"

cp "$OUT_DIR/server.cjs" "$STAGE_DIR/server/index.cjs"
cp "$ROOT_DIR/mcp/manifest.json" "$STAGE_DIR/manifest.json"
cp "$ROOT_DIR/src-tauri/icons/128x128.png" "$STAGE_DIR/icon.png"

node "$ROOT_DIR/mcp/validate-manifest.mjs"
# A .mcpb is a zip with manifest.json at its root. Python's zipfile works the same
# on macOS, Windows and Linux runners.
rm -f "$OUT_DIR/cloaklm.mcpb"
PYTHON="$(command -v python3 || command -v python)"
(cd "$STAGE_DIR" && "$PYTHON" -m zipfile -c "$OUT_DIR/cloaklm.mcpb" manifest.json icon.png server)

echo "Built $OUT_DIR/server.cjs and $OUT_DIR/cloaklm.mcpb"
