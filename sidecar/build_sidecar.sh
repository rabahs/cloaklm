#!/usr/bin/env bash
# Builds the engine binary into src-tauri/bin. Used locally and by the release
# workflow (which sets TARGET and, on macOS, CLOAKLM_SIGNING_IDENTITY).
set -euo pipefail

cd "$(dirname "$0")"
SIDECAR_DIR=$(pwd)
ROOT_DIR=$(dirname "$SIDECAR_DIR")

echo "======================================"
echo "    Building CloakLM Sidecar"
echo "======================================"

# 1. Use the project venv when there is one (CI uses the runner's Python)
if [ -f "$ROOT_DIR/.venv/bin/activate" ]; then
    source "$ROOT_DIR/.venv/bin/activate"
elif [ -f "$ROOT_DIR/.venv/Scripts/activate" ]; then
    source "$ROOT_DIR/.venv/Scripts/activate"
fi
PYTHON="$(command -v python3 || command -v python)"   # Windows runners only have "python"
python3() { "$PYTHON" "$@"; }

# 2. Install pinned dependencies (hash-checked) and PyInstaller
echo "📦 Installing locked dependencies..."
python3 -m pip install --require-hashes --no-deps -r requirements.lock

# 3. Determine Mac Architecture (ignoring Rosetta)
echo "🔍 Detecting machine architecture..."
# Use host_cpu from rustc if available, or uname -m
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    MACHINE="aarch64"
else
    MACHINE="x86_64"
fi

# Determine the actual target triplet Tauri expects
# Name the binary for the Rust host Tauri builds for (it looks up
# bin/cloaklm-sidecar-<host triple>). With an x86_64 (Rosetta) Rust toolchain on
# Apple Silicon that is x86_64-apple-darwin even though the engine itself is arm64;
# an x86_64 app can start an arm64 program, so that is fine.
RUSTC="$(command -v rustc || echo "$HOME/.cargo/bin/rustc")"
if [ -n "${TARGET:-}" ]; then
    :
elif [ -x "$RUSTC" ]; then
    TARGET=$("$RUSTC" -vV | sed -n 's|host: ||p')
else
    TARGET="$MACHINE-apple-darwin"
fi
EXE=""
[[ "$TARGET" == *windows* ]] && EXE=".exe"

echo "🎯 Machine: $MACHINE, Target: $TARGET"

# 4. Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf build dist *.spec

# 5. Build --onefile only (skip --onedir to save time)
# Sign every bundled library with our Developer ID so macOS library validation
# accepts them at runtime; then the app needs no disable-library-validation
# entitlement. Set CLOAKLM_SIGNING_IDENTITY, or it is detected when available.
SIGN_ARGS=()
if [[ "$TARGET" == *apple-darwin ]]; then
    IDENTITY="${CLOAKLM_SIGNING_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -1)}"
    if [ -n "$IDENTITY" ]; then
        echo "🔏 Signing bundled libraries as: $IDENTITY"
        SIGN_ARGS=(--codesign-identity "$IDENTITY")
    else
        echo "⚠️  No Developer ID found: the engine will only run unsigned (development) builds."
    fi
fi

echo "🔨 Running PyInstaller (--onefile)..."
# --noupx: UPX-compressed libraries break code signatures.
python3 -m PyInstaller --clean --noconfirm --onefile --noupx ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} \
    --name "cloaklm-sidecar-$TARGET" \
    --collect-all docling \
    --collect-all docling_core \
    --collect-all docling_parse \
    --collect-all gliner \
    --collect-all uvicorn \
    --collect-all fastapi \
    --collect-all onnxruntime \
    --collect-all tokenizers \
    --collect-all torch \
    --collect-all rich \
    --collect-all huggingface_hub \
    --collect-all safetensors \
    --hidden-import transformers \
    --hidden-import tokenizers \
    --hidden-import tokenizers.tokenizers \
    --hidden-import onnxruntime.capi.onnxruntime_pybind11_state \
    --hidden-import onnxruntime.capi._pybind_state \
    --copy-metadata docling-ibm-models \
    --copy-metadata docling \
    --copy-metadata docling-core \
    --copy-metadata docling-parse \
    server.py

# 6. Smoke test: hand it tokens over stdin, wait for its port, close stdin, and
# check it exits. On macOS this also proves the signed libraries load.
echo "🧪 Smoke testing binary..."
python3 - "dist/cloaklm-sidecar-$TARGET$EXE" <<'PY'
import json, secrets, subprocess, sys
p = subprocess.Popen([sys.argv[1], "--tokens-stdin"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
p.stdin.write(json.dumps({"app": secrets.token_hex(32), "tools": secrets.token_hex(32)}) + "\n"); p.stdin.flush()
for line in p.stdout:
    if line.startswith("CLOAKLM_PORT="):
        break
else:
    sys.exit("engine exited before it was ready")
p.stdin.close()
p.wait(timeout=60)
print("  Engine started and exited cleanly")
PY

# 7. Install where tauri.conf.json's externalBin ("bin/cloaklm-sidecar") looks, under
# this machine's target name only (an arm64 binary must not pose as x86_64).
echo "📁 Installing binary to src-tauri/bin..."
mkdir -p "$ROOT_DIR/src-tauri/bin"
cp "dist/cloaklm-sidecar-$TARGET$EXE" "$ROOT_DIR/src-tauri/bin/cloaklm-sidecar-$TARGET$EXE"

echo "✅ Success! Sidecar built for $TARGET."
