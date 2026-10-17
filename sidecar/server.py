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
from pathlib import Path
from tempfile import NamedTemporaryFile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from pydantic import BaseModel

# We import the classes directly from our bundled scripts
from docling.document_converter import DocumentConverter
from anonymize_llm import GLiNERAnonymizer

app = FastAPI(title="CloakLM Local Backend")

# Only the CloakLM webview (tauri://localhost on macOS, http://tauri.localhost on
# Windows) and local dev servers may read responses. With "*", any website open in
# the user's browser could POST a file_path and read back the un-redacted text.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(tauri://localhost|https?://tauri\.localhost|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
# Reject requests addressed to any other hostname (blocks DNS-rebinding attacks,
# where a malicious domain resolves to 127.0.0.1 to look same-origin).
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])

# Initialize engines once on startup (loads models into memory)
print("CLOAKLM_STAGE=models", flush=True)
print("Loading CloakLM Engines...")
converter = DocumentConverter()
anonymizer = GLiNERAnonymizer()
print("Engines Ready.")


class AnonymizeResult(BaseModel):
    filename: str
    original_markdown: str
    anonymized_markdown: str
    redaction_count: int
    redaction_map: dict


@app.get("/health")
def health_check():
    return {"status": "ok", "message": "CloakLM Local Shield Active"}


@app.post("/api/process", response_model=AnonymizeResult)
async def process_document(
    file: UploadFile = File(None),
    file_path: str = Form(None)
):
    if not file and not file_path:
        raise HTTPException(status_code=400, detail="Must provide file or file_path")

    # Determine paths and names
    if file_path:
        target_path = Path(file_path)
        filename = target_path.name
        if not target_path.exists():
            raise HTTPException(status_code=404, detail="File path not found on disk")
    else:
        filename = file.filename
        suffix = Path(filename).suffix
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp_path = Path(tmp.name)
            target_path = tmp_path

    if not str(target_path).lower().endswith(".pdf"):
        if 'tmp_path' in locals() and tmp_path.exists():
            tmp_path.unlink()
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    try:
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

        # Cleanup if we used a temp file
        if 'tmp_path' in locals() and tmp_path.exists():
            tmp_path.unlink()

        return AnonymizeResult(
            filename=filename,
            original_markdown=original_md,
            anonymized_markdown=anonymized_md,
            redaction_count=anonymizer.stats["total_redactions"],
            redaction_map=anonymizer.redaction_map,
        )

    except Exception as e:
        if 'tmp_path' in locals() and tmp_path.exists():
            tmp_path.unlink()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    import sys
    import socket
    import logging
    
    # Disable Uvicorn default logging to avoid cluttering stdout 
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    # Pick an available port dynamically
    def get_free_port():
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', 0))
            return s.getsockname()[1]

    port = get_free_port()

    # Exit when the process that launched us goes away. The app stops the engine by
    # SIGKILLing PyInstaller's launcher, which can't forward that signal, so without
    # this the server kept running (models in memory) and the 784 MB it unpacked was
    # never deleted. Also covers the app crashing.
    def exit_with_parent():
        import threading
        import time

        launcher = os.getppid()
        def watch():
            while os.getppid() == launcher:
                time.sleep(2)
            if getattr(sys, "frozen", False):
                shutil.rmtree(getattr(sys, "_MEIPASS", ""), ignore_errors=True)
            os._exit(0)
        threading.Thread(target=watch, daemon=True).start()

    exit_with_parent()

    # EMIT the strict structured log for Tauri to parse
    print(f"CLOAKLM_PORT={port}", flush=True)
    
    # Run the server
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
