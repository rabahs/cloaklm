# CloakLM

**Privacy-first AI chat for sensitive documents.** Drop your PDFs, CloakLM strips all personal information locally, then lets you chat with any AI model — without ever exposing real names, SSNs, or addresses.

## How It Works

```
┌─────────────────────────────────────────────────┐
│  1. Drop PDF        2. Local PII Scan           │
│  ───────────►   GLiNER strips names, SSNs, etc. │
│                                                 │
│  3. You Review      4. Chat with AI             │
│  Verify redactions  Claude/Gemini/GPT/Ollama    │
│  Add manual ones    sees [PERSON_1], not "John"  │
│                                                 │
│  5. De-anonymize    You see real names           │
│  AI response shown  AI never did                 │
└─────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- **Node.js** 22+ (LTS)
- **Rust** 1.84+ (for Tauri)
- **Python** 3.12+

### Setup

```bash
# 1. Install frontend dependencies
npm install

# 2. Create Python virtual environment & install sidecar dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r sidecar/requirements.txt

# 3. Start the anonymization engine (Terminal 1)
source .venv/bin/activate
cd sidecar && uvicorn server:app --port 4321

# 4. Start the desktop app (Terminal 2)
npm run tauri dev
```

### Configure API Keys
Click ⚙️ in the app header to add your API keys for:
- **Claude** (Anthropic) — best for nuanced document analysis
- **Gemini** (Google) — fast and cost-effective
- **GPT-4o** (OpenAI) — strong general-purpose
- **Ollama** — 100% offline, no API key needed

## Project Structure

```
cloaklm/
├── src/                    # React + TypeScript + Tailwind CSS frontend
│   ├── App.tsx             # Main app shell
│   ├── llm.ts              # LLM API service (Claude/Gemini/OpenAI/Ollama)
│   ├── types.ts            # Shared TypeScript types
│   └── components/         # UI components
│       ├── ChatHeader.tsx
│       ├── ChatInput.tsx
│       ├── MessageBubble.tsx
│       ├── MessageList.tsx
│       ├── ReviewPanel.tsx
│       ├── SettingsModal.tsx
│       ├── WelcomeScreen.tsx
│       ├── AttachmentChip.tsx
│       └── DropOverlay.tsx
├── src-tauri/              # Rust (Tauri 2.0) desktop wrapper
│   ├── tauri.conf.json     # App config, window settings
│   └── src/
│       ├── main.rs         # Binary entry point
│       └── lib.rs          # Tauri builder & commands
├── sidecar/                # Python anonymization engine
│   ├── server.py           # FastAPI local server (port 4321)
│   ├── anonymize_llm.py    # GLiNER PII detection + regex fallback
│   └── requirements.txt    # Python dependencies
└── .venv/                  # Python virtual environment
```

> For architecture details, design decisions, and security model, see [ARCHITECTURE.md](./ARCHITECTURE.md).
> For the roadmap and milestone tracking, see [MILESTONES.md](./MILESTONES.md).

## License

MIT — see [LICENSE](./LICENSE).
