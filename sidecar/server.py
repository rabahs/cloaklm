import os
import shutil
from pathlib import Path
from tempfile import NamedTemporaryFile
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# We import the classes directly from our bundled scripts
from docling.document_converter import DocumentConverter
from anonymize_llm import GLiNERAnonymizer

app = FastAPI(title="CloakLM Local Backend")

# Allow the Tauri webview to hit this local server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to Tauri's localhost port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize engines once on startup (loads models into memory)
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
        print(f"Ingesting {filename}...")
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
    
    # Read port from arguments or default to 4321
    port = 4321
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
        
    print(f"Starting CloakLM Sidecar on port {port}...")
    uvicorn.run(app, host="127.0.0.1", port=port)
