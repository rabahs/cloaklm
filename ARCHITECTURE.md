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

### Using an AI subscription instead of an API key (MCP)

People who already pay for Claude, ChatGPT or Gemini can connect their own AI app to CloakLM instead of adding an API key. This sits alongside the API-key chat; it does not replace it.

```
Project with "Share with AI tools" on
     │  Only documents cleared by two models (GLiNER + a local LLM pass, all
     │  suggestions handled) or approved by the user after reading the raw output
     │  React runs each through the outbound scrub (anonymizePrompt)
     ▼  PUT /api/shared {id, name: "Document N", project, content, clearance}   (app token)
Sidecar keeps the shared set in memory only; rejects documents without a clearance
     ▲  GET /api/shared, /api/shared/{id}, /api/shared/search                  (tools token)
     │  after GET /api/hello proves the sidecar knows the token (HMAC challenge)
cloaklm MCP server (mcp/src/server.ts, stdio, reads connection.json)
     ▲  document text framed as untrusted data, never instructions
Claude Desktop (.mcpb) / Claude Code / Codex CLI / Gemini CLI
```

- The user's AI app talks to its own provider with the user's own login. CloakLM never sees or stores those credentials, and never drives the vendor's app itself.
- Only redacted text is shared. File names are replaced by "Document N", and the registry rejects any payload with extra fields (such as a redaction map).
- **Sharing gate** (`sharingClearance` in `src/redact.ts`): a document in a shared project is served only once a second model has checked it (Deep Scan or the identifiability check, run on a local Ollama, with every suggestion redacted or dismissed), or once the user approved it in the Review panel after opening the Raw Output to AI tab. Others are withheld, and the MCP server tells the AI how many are waiting.
- Answers come back with placeholders. The user pastes them into the project's **Rehydrate** panel, which fills in the real values locally and marks each restored value with its source document. Placeholders that mean different things in different documents are left unfilled.
- The MCP server is bundled into one file by `scripts/build-mcp.sh` and shipped as a Tauri resource (`mcp/server.cjs`), together with `cloaklm.mcpb` for one-click install in Claude Desktop.

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

### Why MCP for subscriptions (not driving the vendor CLIs)?
- Anthropic's terms forbid third-party apps from routing requests through a user's Claude Pro/Max login, and Google forbids third-party use of Gemini CLI's consumer login. Running `claude -p` or `gemini -p` behind CloakLM's chat would put users' accounts at risk.
- With MCP, the user stays in their own AI app and CloakLM only serves redacted text. One server works with Claude Desktop, Claude Code, Codex CLI and Gemini CLI.

### Why BYOK (Bring Your Own Key)?
- Zero infrastructure cost — no middleman server to maintain.
- Users' API keys never leave their machine.
- Supports direct OAuth integration in the future (Milestone 5).

## Security Model

| Layer | Protection |
|---|---|
| PDF ingestion | PDF only: the file must start with `%PDF-` and Docling is restricted to its PDF parser (a renamed Word/ZIP/XML file can't reach other parsers). Uploads go to a private temp folder that is emptied on every start |
| Text processing | In memory. Nothing is written except the encrypted app store and `connection.json` (below) |
| PII detection | Runs locally via GLiNER and Docling. Model files are pinned to known revisions and, once downloaded, loaded with Hugging Face offline mode and telemetry off: no network calls after the first run |
| Normalization | Before detection and before anything is sent: NFKC, all invisible format characters (zero-width, bidi, Unicode tags, variation selectors) removed, mixed-script lookalike letters folded. Bracket tokens already in a document (`[PERSON_1]`) are neutralized so they can't collide with real placeholders |
| Matching known values | Short values (≤3 ASCII characters) only as whole words; longer values anywhere (`John123`, names inside URLs, CJK text). SSN/EIN/phone patterns check neighbouring digits, not word boundaries |
| Manual redaction | User can catch anything the model missed; Deep Scan and the identifiability check run only on a local (loopback) Ollama |
| LLM communication | Only anonymized text sent; direct to provider (no proxy). Every turn re-scrubs the whole conversation with every document it has used. API keys go in headers, never URLs |
| Webview | Strict Content Security Policy (scripts from the app only; network only to the sidecar, local Ollama and the three provider APIs). Capabilities are `core:default` only: no file, shell, store or URL-opener access. Saving a transcript, opening the MCP bundle and the three privacy links are fixed-purpose Rust commands |
| Local sidecar | Bound to 127.0.0.1 on a socket it binds itself (no port race). Every request needs a per-launch bearer token, compared in constant time. CORS allows only the CloakLM webview (dev origins only in development builds); other Hosts are rejected (DNS-rebinding guard). No `/docs` or OpenAPI routes |
| Sidecar tokens | Two random 256-bit tokens per launch, generated by the Rust shell and passed over **stdin** (not environment variables, which any program running as the user can read). The app token (full access) is handed only to the webview, and only once the shell has confirmed the sidecar's port. The tools token can only read the shared redacted documents; it is written with the port and pid to `connection.json` (owner-only, mode 0600), which is deleted on exit and on the next start after a crash |
| AI tools (MCP) | Off by default, opt-in per project, then gated per document (two models or manual approval). Read-only tools; ids must be UUIDs. Before sending its token, the MCP server checks the app's process is alive and that the sidecar proves it knows the token. What the user's AI provider does with the text follows the provider's terms (consumer plans may retain it or train on it unless the user opts out) |
| App data at rest | Settings (including API keys), chats, projects and redaction maps are in one AES-256-GCM encrypted file, owner-only, written atomically. The key is in the OS keychain (macOS Keychain, Windows Credential Manager). A plaintext store from older versions is migrated and overwritten |
| De-anonymization | Happens client-side only; AI never sees real values. Restored values are marked, with their source document |
| Supply chain | Python dependencies installed from a hash-locked file; npm from the lockfile without install scripts, in a CI job with no secrets; GitHub Actions pinned to commits; bundled engine libraries signed with the app's Developer ID; release checksums published |

### Known limits

- Detection is statistical. GLiNER can miss a name, especially in unusual layouts or scripts; that is why sharing needs a second model or the user's approval, and why the Review panel exists.
- Programs running as the same user can, with effort, still reach app data (for example by reading process memory). The keychain and stdin hand-off raise the bar; they don't make CloakLM safe on a compromised account.
- AI apps connected through MCP are told that document text is untrusted, but a model can still be misled by a malicious document. Prefer Claude Desktop or keep tool approvals on in agents that can run commands.
- GLiNER requires transformers < 5.2; the advisory fixed in 5.3 (malicious model config) is mitigated by the pinned model revision and offline loading.
