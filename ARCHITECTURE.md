# CloakLM — Architecture

## System Overview

CloakLM is a desktop application built with a three-layer architecture:

```
┌─────────────────────────────────────────┐
│     Frontend (React + TS + Tailwind)    │
│  Vite dev server / Tauri webview        │
│  Components: Chat, Review, Settings     │
├─────────────────────────────────────────┤
│         Desktop Shell (Tauri/Rust)      │
│  Native window, file system access,     │
│  drag-and-drop (M4: auto-spawn sidecar)│
├─────────────────────────────────────────┤
│       Sidecar (Python + FastAPI)        │
│  Local HTTP server on port 4321         │
│  Docling (PDF→MD) + GLiNER (PII→redact)│
└─────────────────────────────────────────┘
```

## Data Flow

```
User drops PDF
     │
     ▼
React sends file to http://127.0.0.1:4321/api/process
     │
     ▼
Python sidecar:
  1. Docling converts PDF → Markdown (in memory)
  2. GLiNER scans for PII entities
  3. Replaces real values with [PERSON_1], [SSN_REDACTED], etc.
  4. Returns JSON: { anonymized_markdown, redaction_map, redaction_count }
     │
     ▼
React stores anonymized content + redaction map in state
     │
     ▼
User reviews redactions (can manually add more)
     │
     ▼
User sends message → React calls LLM API with anonymized content as context
     │
     ▼
LLM responds using placeholders → React de-anonymizes → User sees real names
```

## Key Technical Decisions

### Why Python sidecar (not pure Rust)?
- **Docling** (IBM's ML-based PDF parser) has no Rust equivalent. It handles complex tax form layouts with tables, floating boxes, and grid structures that basic PDF text extractors destroy.
- **GLiNER** (zero-shot NER model) runs via PyTorch/ONNX. A Rust port is feasible but estimated at 1-2 weeks of work.
- The sidecar adds ~800MB to the distribution but only downloads once.

### Why localhost HTTP (not stdin/stdout IPC)?
- Large PDF files (5MB+) reliably transfer via multipart/form-data over HTTP.
- JSON serialization of complex redaction maps is native and debuggable.
- The UI never freezes during processing (fully async).
- Industry standard: LM Studio, AnythingLLM, Docker Desktop all use this pattern.

### Why BYOK (Bring Your Own Key)?
- Zero infrastructure cost — no middleman server to maintain.
- Users' API keys never leave their machine.
- Supports direct OAuth integration in the future (Milestone 5).

## Security Model

| Layer | Protection |
|---|---|
| PDF ingestion | Temp file deleted immediately after reading |
| Text processing | All in-memory, no disk writes |
| PII detection | Runs 100% locally via GLiNER (no network calls) |
| Manual redaction | User can catch anything the model missed |
| LLM communication | Only anonymized text sent; direct to provider (no proxy) |
| API key storage | localStorage (to be migrated to Tauri secure store in M4) |
| De-anonymization | Happens client-side only; AI never sees real values |
