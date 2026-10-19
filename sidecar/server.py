import multiprocessing

# Must run before the heavy imports below. In the PyInstaller binary, helper
# processes (e.g. multiprocessing's resource tracker) re-execute this file; without
# freeze_support() each one loads the models and starts another server, which
# spawns another helper, multiplying processes until the machine runs out of memory.
if __name__ == "__main__":
    multiprocessing.freeze_support()

# Startup stages, relayed to the UI's progress indicator by the Tauri shell.
print("CLOAKLM_STAGE=libraries", flush=True)

import os
import shutil
import sys
import tempfile
import threading
from pathlib import Path


def _models_cached() -> bool:
    """True once the models this engine needs are in the Hugging Face cache."""
    hub = Path(os.environ.get("HF_HUB_CACHE") or Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "hub")
    from anonymize_llm import GLINER_MODEL, GLINER_REVISION
    needed = [hub / f"models--{GLINER_MODEL.replace('/', '--')}" / "snapshots" / GLINER_REVISION]
    for repo in ("docling-project--docling-layout-heron", "docling-project--docling-models"):
        snapshots = hub / f"models--{repo}" / "snapshots"
        needed.append(next(snapshots.iterdir(), snapshots / "missing") if snapshots.is_dir() else snapshots)
    return all(path.is_dir() and any(path.iterdir()) for path in needed)


# No telemetry, ever. Once the models are cached, don't contact Hugging Face at
# all: unpinned "main" revisions were re-resolved (and could be replaced) on every
# launch. Must be set before huggingface_hub is imported (via docling/gliner).
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
if _models_cached():
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel

# We import the classes directly from our bundled scripts
from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter
from anonymize_llm import GLiNERAnonymizer
from shared_docs import configure_tokens, ensure_tokens, require_token, router as shared_router

# No /docs, /redoc or /openapi.json: nothing needs them, so don't serve them.
app = FastAPI(title="CloakLM Local Backend", docs_url=None, redoc_url=None, openapi_url=None)

# Every request needs a bearer token (see shared_docs.py). CORS and the host check
# only stop browsers; this also stops other local programs. Registered first so it
# sits innermost: the CORS layer still answers preflights and labels 401s.
app.middleware("http")(require_token)

# Only the CloakLM webview (tauri://localhost on macOS, http://tauri.localhost on
# Windows) may read responses; local dev servers only in development builds. With
# "*", any website open in the user's browser could read back un-redacted text.
_DEV_ORIGINS = r"|http://(localhost|127\.0\.0\.1)(:\d+)?" if os.environ.get("CLOAKLM_DEV") == "1" else ""
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=rf"^(tauri://localhost|https?://tauri\.localhost{_DEV_ORIGINS})$",
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)
# Reject requests addressed to any other hostname (blocks DNS-rebinding attacks,
# where a malicious domain resolves to 127.0.0.1 to look same-origin).
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

# Initialize engines once on startup (loads models into memory)
print("CLOAKLM_STAGE=models", flush=True)
print("Loading CloakLM Engines...")
# PDF only. Docling picks a parser from the file's content, so without this a
# Word, Excel or METS file renamed ".pdf" reached parsers with known XML attacks.
converter = DocumentConverter(allowed_formats=[InputFormat.PDF])
anonymizer = GLiNERAnonymizer()
# The anonymizer keeps per-document state; process one document at a time.
engine_lock = threading.Lock()
print("Engines Ready.")

# Uploads go to a private folder that is emptied on every start, so a copy left
# behind when the engine was killed mid-conversion doesn't linger.
UPLOAD_DIR = Path(tempfile.gettempdir()) / "cloaklm-uploads"
shutil.rmtree(UPLOAD_DIR, ignore_errors=True)
UPLOAD_DIR.mkdir(mode=0o700, exist_ok=True)


class AnonymizeResult(BaseModel):
    filename: str
    original_markdown: str
    anonymized_markdown: str
    redaction_count: int
    redaction_map: dict


app.include_router(shared_router)


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "CloakLM Local Shield Active"}


def _looks_like_pdf(path: Path) -> bool:
    try:
        with path.open("rb") as f:
            return b"%PDF-" in f.read(1024)
    except OSError:
        return False


# A plain (sync) function runs in FastAPI's thread pool, so a long conversion no
# longer blocks other requests (the MCP server's reads used to time out).
@app.post("/api/process", response_model=AnonymizeResult)
def process_document(
    file: UploadFile = File(None),
    file_path: str = Form(None)
):
    if not file and not file_path:
        raise HTTPException(status_code=400, detail="Must provide file or file_path")

    tmp_path = None
    if file_path:
        target_path = Path(file_path)
        filename = target_path.name
        # Check the name before touching the disk, and give one answer for every
        # failure, so the endpoint can't be used to probe which paths exist.
        if target_path.suffix.lower() != ".pdf" or not target_path.is_file() or not _looks_like_pdf(target_path):
            raise HTTPException(status_code=400, detail="Not a readable PDF file")
    else:
        filename = Path(file.filename or "document.pdf").name
        if Path(filename).suffix.lower() != ".pdf":
            raise HTTPException(status_code=400, detail="Only PDF files are supported")
        fd, name = tempfile.mkstemp(suffix=".pdf", dir=UPLOAD_DIR)
        tmp_path = target_path = Path(name)
        with os.fdopen(fd, "wb") as tmp:
            shutil.copyfileobj(file.file, tmp)
        if not _looks_like_pdf(target_path):
            tmp_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail="Not a readable PDF file")

    try:
        with engine_lock:
            # 1. Ingest (PDF -> Markdown)
            print(f"Ingesting document of size {target_path.stat().st_size} bytes...")
            result = converter.convert(target_path)
            original_md = result.document.export_to_markdown()

            # 2. Anonymize (Markdown -> Anonymized Markdown)
            print("Anonymizing PII...")
            anonymizer.redaction_map = {}  # reset for new file
            anonymizer.counters = {}
            anonymizer.stats = {"total_redactions": 0, "by_category": {}}
            anonymized_md = anonymizer.anonymize(original_md)

            return AnonymizeResult(
                filename=filename,
                original_markdown=original_md,
                anonymized_markdown=anonymized_md,
                redaction_count=anonymizer.stats["total_redactions"],
                redaction_map=anonymizer.redaction_map,
            )
    except Exception as e:
        # The exception text can contain paths or document fragments: log only its type.
        print(f"Processing failed: {type(e).__name__}", file=sys.stderr, flush=True)
        raise HTTPException(status_code=500, detail="Could not process this PDF")
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def _read_tokens_from_stdin() -> None:
    """The app writes both tokens as one JSON line on stdin. Environment variables
    were readable by any program running as the user (`ps -E`)."""
    import json
    line = sys.stdin.readline()
    tokens = json.loads(line)
    configure_tokens(tokens["app"], tokens["tools"])


def _cleanup_and_exit() -> None:
    if getattr(sys, "frozen", False):
        shutil.rmtree(getattr(sys, "_MEIPASS", ""), ignore_errors=True)
    os._exit(0)


def _exit_when_stdin_closes() -> None:
    """The app holds our stdin open; it closes when the app exits or crashes, on
    every OS (the parent-pid check below doesn't work on Windows)."""
    def watch():
        while sys.stdin.buffer.read(4096):
            pass
        _cleanup_and_exit()
    threading.Thread(target=watch, daemon=True).start()


if __name__ != "__main__":
    # Imported by `uvicorn server:app` during development: tokens from the environment.
    ensure_tokens()

if __name__ == "__main__":
    import uvicorn
    import socket
    import logging

    if "--tokens-stdin" in sys.argv:
        _read_tokens_from_stdin()
        _exit_when_stdin_closes()
    else:
        ensure_tokens()

    # Disable Uvicorn default logging to avoid cluttering stdout
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    # Bind first and hand uvicorn the open socket: picking a free port, closing it
    # and binding again let another program take the port in between.
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(64)
    port = sock.getsockname()[1]

    # Exit when the process that launched us goes away. The app stops the engine by
    # SIGKILLing PyInstaller's launcher, which can't forward that signal, so without
    # this the server kept running (models in memory) and the 784 MB it unpacked was
    # never deleted. Also covers the app crashing.
    def exit_with_parent():
        import time

        launcher = os.getppid()
        def watch():
            while os.getppid() == launcher:
                time.sleep(2)
            _cleanup_and_exit()
        threading.Thread(target=watch, daemon=True).start()

    if os.name != "nt":
        exit_with_parent()

    # EMIT the strict structured log for Tauri to parse
    print(f"CLOAKLM_PORT={port}", flush=True)

    # Run the server
    uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
