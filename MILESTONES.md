# CloakLM — Milestones & Roadmap

## Milestone 1 ✅ — UI Shell & Project Setup
- [x] Tauri 2.0 + React + Vite + Tailwind CSS
- [x] Chat interface with dark mode
- [x] Drag-and-drop file handling (native Finder + browser)
- [x] Attachment chips with status indicators
- [x] Model selector dropdown (Claude, Gemini, GPT-4o, Ollama)
- [x] Welcome screen

## Milestone 2 ✅ — Python Sidecar Integration
- [x] FastAPI local server (`sidecar/server.py`) on port 4321
- [x] Docling PDF → Markdown conversion (in memory, no disk writes)
- [x] GLiNER PII anonymization (in memory)
- [x] Review Panel — "Identified PII" list view
- [x] Review Panel — "Raw Output to AI" view with highlighted placeholders
- [x] Manual redaction: select text → floating "🛡️ Redact" button → `[MANUAL_N]`
- [x] Auto (purple) vs manual (amber) redaction color coding

## Milestone 3 ✅ — LLM API Integration (BYOK)
- [x] Settings modal for API key management
- [x] Claude (Anthropic Messages API) integration
- [x] Gemini (Google GenerateContent API) integration
- [x] OpenAI (Chat Completions API) integration
- [x] Ollama (local) integration
- [x] API key status indicator (green/red dot)
- [x] Real API calls replace simulated responses
- [x] De-anonymization of AI responses (AI says `[PERSON_1]`, user sees real name)
- [x] Document context preserved across follow-up messages and model switches
- [x] Provider badge on every AI response
- [x] "New Chat" button
- [x] Improved system prompt for messy PDF formatting

## Milestone 4 ✅ — Distribution & Packaging
- [x] Bundle Python sidecar via PyInstaller into a single binary
- [x] Tauri auto-spawns sidecar as child process on app launch
- [x] Dynamic port assignment (sidecar picks random free port, reports via stdout)
- [x] Auto-restart sidecar on crash
- [x] Health-check polling with user-friendly error states
- [x] macOS `.dmg` build (CI/CD via GitHub Actions)
- [x] Windows `.msi` build (CI/CD via GitHub Actions)
- [x] Secure API key storage (migrated to Tauri's secure store plugin)

## Milestone 5 — Polish & Post-MVP
- [x] Conversation history persistence (save/load past chats)
- [x] Multi-file chat context (persistent Document Sidebar)
- [x] Enhanced Search in Review Panel (navigation, count, auto-scroll)
- [ ] Hybrid BYOK: OAuth-based model access (use existing Claude/Gemini subscriptions)
- [x] Export anonymized chat transcripts (Markdown)
- [ ] IRS form-specific post-processing (structured Box extraction)
- [x] Global Keyboard shortcuts (Cmd+N, Cmd+H, Cmd+D, Cmd+,)
- [ ] Auto-update mechanism
