"""Access control and the shared-document registry for AI tools (MCP clients).

Two bearer tokens, handed to us by the Tauri shell over stdin (see server.py):

- the app token: full access, including /api/process, whose response carries
  the original text and the redaction map.
- the tools token: written to connection.json for the cloaklm MCP server. It can
  only read the registry below, which holds redacted text and nothing else.

Kept free of model imports so it can be tested without loading Docling/GLiNER.
"""
import hashlib
import hmac
import os
import re
import secrets
import sys
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field


def _random_token(name: str) -> str:
    # Started outside the app (e.g. `python server.py` while developing): lock the
    # server with a random token rather than leaving it open, and print it for curl.
    token = secrets.token_hex(32)
    print(f"{name} not set; using {token}", file=sys.stderr, flush=True)
    return token


_tokens = {
    "app": os.environ.get("CLOAKLM_TOKEN") or "",
    "tools": os.environ.get("CLOAKLM_TOOLS_TOKEN") or "",
}


def configure_tokens(app_token: str, tools_token: str) -> None:
    if len(app_token) < 32 or len(tools_token) < 32 or app_token == tools_token:
        raise ValueError("tokens must be distinct and at least 32 characters")
    _tokens["app"], _tokens["tools"] = app_token, tools_token


def ensure_tokens() -> None:
    if not _tokens["app"]:
        _tokens["app"] = _random_token("CLOAKLM_TOKEN")
    if not _tokens["tools"]:
        _tokens["tools"] = _random_token("CLOAKLM_TOOLS_TOKEN")


def _same(a: str, b: str) -> bool:
    # Compare bytes: compare_digest raises on non-ASCII str, which turned a crafted
    # token into an HTTP 500 with a traceback.
    return bool(a) and bool(b) and hmac.compare_digest(a.encode(), b.encode())


def _bearer(request: Request) -> str:
    header = request.headers.get("authorization", "")
    return header[7:] if header.lower().startswith("bearer ") else ""


def _tools_may_read(path: str) -> bool:
    return path in ("/health", "/api/shared") or path.startswith("/api/shared/")


# Unauthenticated: lets a client check it reached the real engine before it sends
# a token (see hello_proof).
PUBLIC_PATHS = ("/api/hello",)


def is_authorized(request: Request) -> bool:
    if request.url.path in PUBLIC_PATHS and request.method == "GET":
        return True
    token = _bearer(request)
    if _same(token, _tokens["app"]):
        return True
    return request.method == "GET" and _tools_may_read(request.url.path) and _same(token, _tokens["tools"])


async def require_token(request: Request, call_next):
    # CORS preflights never get here: the outer CORS middleware answers them.
    if is_authorized(request):
        return await call_next(request)
    return JSONResponse({"detail": "Unauthorized"}, status_code=401)


def hello_proof(nonce: str, token: str) -> str:
    return hmac.new(token.encode(), f"cloaklm-hello:{nonce}".encode(), hashlib.sha256).hexdigest()


# ---------- Shared-document registry (in memory only) ----------

MAX_DOCUMENTS = 500
MAX_CONTENT_CHARS = 5_000_000


class SharedDocument(BaseModel):
    # extra="forbid": a payload carrying anything else (e.g. a redaction_map) is
    # rejected outright instead of being silently accepted.
    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[A-Za-z0-9-]{1,64}$")
    name: str = Field(max_length=500)
    project: Optional[str] = Field(default=None, max_length=500)
    content: str = Field(max_length=MAX_CONTENT_CHARS)
    # How the app cleared this document for sharing: checked by two models
    # (GLiNER plus a local LLM pass) or approved by the user. Anything else is
    # rejected, so a future code path can't share an unchecked document by accident.
    clearance: Literal["two-model", "manual"]


class SharedSet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    documents: list[SharedDocument] = Field(max_length=MAX_DOCUMENTS)
    # Documents in shared projects that are still waiting for a second check.
    withheld: int = Field(default=0, ge=0, le=100_000)


_registry: dict[str, SharedDocument] = {}
_withheld = {"count": 0}

router = APIRouter(prefix="/api")

SNIPPET_RADIUS = 200
MAX_SNIPPETS_PER_DOC = 5
PREVIEW_CHARS = 160


def _summary(doc: SharedDocument) -> dict:
    # A short preview lets the model tell documents apart (they're named "Document N").
    preview = " ".join(doc.content.split())[:PREVIEW_CHARS]
    return {"id": doc.id, "name": doc.name, "project": doc.project, "chars": len(doc.content), "preview": preview}


@router.get("/hello")
def hello(nonce: str = Query(pattern=r"^[0-9a-f]{32,128}$")):
    return {"proof": hello_proof(nonce, _tokens["tools"])}


@router.put("/shared")
def replace_shared(shared: SharedSet):
    _registry.clear()
    for doc in shared.documents:
        _registry[doc.id] = doc
    _withheld["count"] = shared.withheld
    return {"count": len(_registry)}


@router.get("/shared")
def list_shared():
    return {"documents": [_summary(d) for d in _registry.values()], "withheld": _withheld["count"]}


# Declared before /shared/{doc_id} so "search" isn't taken as an id.
@router.get("/shared/search")
def search_shared(q: str = Query(min_length=1, max_length=200)):
    needle = re.compile(re.escape(q), re.IGNORECASE)
    results = []
    for doc in _registry.values():
        snippets = []
        for match in needle.finditer(doc.content):
            if snippets and match.start() < last_end:
                continue
            lo = max(0, match.start() - SNIPPET_RADIUS)
            last_end = min(len(doc.content), match.end() + SNIPPET_RADIUS)
            snippets.append(doc.content[lo:last_end])
            if len(snippets) == MAX_SNIPPETS_PER_DOC:
                break
        if snippets:
            results.append({**_summary(doc), "snippets": snippets})
    return {"results": results}


@router.get("/shared/{doc_id}")
def get_shared(doc_id: str):
    doc = _registry.get(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not shared")
    return {**_summary(doc), "content": doc.content}
