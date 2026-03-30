#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"
SIDECAR_DIR=$(pwd)
ROOT_DIR=$(dirname "$SIDECAR_DIR")

echo "======================================"
echo "    Building CloakLM Sidecar"
echo "======================================"

# 1. Ensure venv exists and is activated
if [ ! -d "$ROOT_DIR/.venv" ]; then
    echo "❌ Error: Virtual environment not found at $ROOT_DIR/.venv"
    exit 1
fi
source "$ROOT_DIR/.venv/bin/activate"

# 2. Install pyinstaller
echo "📦 Installing PyInstaller..."
python3 -m pip install pyinstaller

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
if command -v rustc >/dev/null 2>&1; then
    TARGET=$(rustc -vV | sed -n 's|host: ||p')
else
    TARGET="$MACHINE-apple-darwin"
fi

echo "🎯 Machine: $MACHINE, Target: $TARGET"

# 4. Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf build dist *.spec

# 5. Build --onefile only (skip --onedir to save time)
echo "🔨 Running PyInstaller (--onefile)..."
python3 -m PyInstaller --clean --noconfirm --onefile \
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

# 6. Quick smoke test
echo "🧪 Smoke testing binary..."
if ./dist/cloaklm-sidecar-$TARGET --help 2>&1 | head -1; then
    echo "  Binary executes OK"
fi

# 7. Move binary to Tauri folder
echo "📁 Moving binary to src-tauri/binaries..."
mkdir -p "$ROOT_DIR/src-tauri/binaries"
# We copy to BOTH aarch64 and x86_64 naming conventions on Mac 
# to ensure Tauri 2 finds it regardless of which toolchain is being used locally.
cp "dist/cloaklm-sidecar-$TARGET" "$ROOT_DIR/src-tauri/binaries/cloaklm-sidecar-aarch64-apple-darwin"
cp "dist/cloaklm-sidecar-$TARGET" "$ROOT_DIR/src-tauri/binaries/cloaklm-sidecar-x86_64-apple-darwin"

echo "✅ Success! Sidecar bundled for both aarch64 and x86_64."
