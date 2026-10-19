# Changelog

All notable changes to CloakLM. Download any version from [Releases](https://github.com/rabahs/cloaklm/releases).

## [Unreleased]

### Added
- **Use your Claude, ChatGPT or Gemini subscription instead of an API key.** Connect Claude Desktop (one click), Claude Code, Codex CLI or Gemini CLI in **Settings → Connect AI tools**, then turn on **Share with AI tools** in a project. Your AI app reads only the redacted text; paste its answer into **Rehydrate** to see the real values. See the [setup guide](docs/ai-subscriptions.md).
- **Documents are shared with AI tools only after a second check.** A second local model (Deep Scan or the identifiability check) must have reviewed a document, with every suggestion handled, or you approve it yourself after reading what the AI will get. **Run Deep Scan** is now available in the Review panel at any time.
- **Identifiability check** in the Review panel: a local model looks for details that could reveal who a document is about even with names hidden, such as project names, funding amounts with dates, and awards. Résumés and bios get a reminder to run it.
- Restored names in chat and Rehydrate are underlined; hover to see which placeholder and document they came from.

### Fixed
- **Names in Chinese, Japanese, Korean, Cyrillic, Arabic and Greek script were never redacted**, even when detected.
- Redacting a short value cut into longer words ("CA" turned "Canadian" into "[LOCATION_1]nadian"). Short values now match only whole words; longer ones still match inside words, so "John123" and names in URLs are caught.
- SSNs and phone numbers stuck to letters ("SSN123-45-6789") weren't redacted.
- Invisible characters (direction marks, Unicode "tag" characters), fullwidth letters and lookalike Cyrillic letters could hide names from redaction.
- A document containing text like "[PERSON_1]" could make CloakLM show a real name in the wrong place. Restored values that are ambiguous across documents are no longer guessed.
- In project chats, a name you typed could be sent unredacted after you unchecked or removed the document it came from.
- Numbers and common words in a file name were removed from the text sent to the AI (a file named `W2_2025.pdf` turned every "2025" into `[FILE_NAME]`).
- Accepting several Deep Scan suggestions gave them all the same `[MANUAL_1]` placeholder.
- **Export transcript** did nothing.

### Security
- **Other programs on your computer could read your documents through the local engine.** It now requires a secret key that changes every launch, handed over privately (not in environment variables). AI tools get a separate key that can only read redacted text from documents you cleared.
- **The app could send its key to the wrong program** while the engine was starting. It now waits for the engine's real address.
- **App data is encrypted.** Settings, API keys, chats and documents are stored encrypted with a key in your system keychain, instead of a plain file. Existing data is converted automatically.
- **Crafted "PDFs" could reach other document parsers** with known file-reading attacks. Only real PDFs are accepted now, and the document libraries are updated.
- **The engine contacted Hugging Face on every launch** and would load changed model files. Models are now pinned to known versions and loaded offline once downloaded, with telemetry off.
- Deep Scan and the identifiability check only run on an Ollama on this computer.
- The app window has a strict content security policy and no access to files, programs or arbitrary links; the Gemini API key is no longer put in URLs.
- The macOS engine is signed with the app's Developer ID, so the app no longer needs an exception to macOS library checks.
- Releases are built with locked, hash-checked dependencies and pinned build actions, with signing kept apart from third-party build code. Each release publishes SHA-256 checksums.
- The website no longer loads Google Fonts or calls GitHub from your browser.

## [0.4.1] - 2026-10-17

**Critical fix and security update. All users should upgrade.**

### Fixed
- **The app could not start its anonymization engine** (since v0.3.2), so it showed "AI Engine failed to start" and could not process documents. Three causes, all fixed: the app looked for the engine in the wrong place, macOS blocked the engine from loading its bundled Python, and the engine could repeatedly start copies of itself.
- W-2 box 12 codes (such as `D` for 401(k) contributions) were sometimes redacted as zip codes, so the AI lost information it needed.
- Box labels like "15 State" and "17 State" were redacted as locations.
- Quitting the app left the privacy engine running in the background, holding its AI models in memory and leaving about 800 MB of temporary files behind each time.
- "Add custom model" did nothing.
- Replies from current Claude models could come back blank, and OpenAI's reasoning models returned an error.
- Model choices from earlier versions' defaults move once to today's equivalent in the same tier (for example Claude Opus 4.6 to Opus 5.5, Gemini 2.5 Flash, retiring October 20, 2026, to Gemini 3.8 Flash). Models you pick afterwards are never changed.

### Changed
- **Redesigned home screen**: the message box sits in the center with recent projects right below it, with fewer lines and cleaner icons.
- **Startup progress**: a progress bar shows each step while the privacy engine starts, instead of a blinking banner.
- **Current models**: the picker recommends Claude Opus 5.5, Sonnet 5.5, Haiku 5.5, and Fable 5.1; Gemini 4 Argon and 3.8 Flash; GPT-6.1 Sol and GPT-6 Luna. Search to find any other model your API key can use.
- Security policy now explains how to report vulnerabilities privately through GitHub.

### Security
- **Websites could read documents through the local anonymization engine.** While the engine was running, a malicious web page open in your browser could ask it to process a PDF from your disk and read back the original, un-redacted text. The engine now answers only the CloakLM app itself, and rejects requests that use DNS rebinding to look local.

## [0.4.0] - 2026-04-06

### Added
- Projects: group documents and chats together, then create, rename, and delete projects.
- Reuse already-redacted documents in new chats without re-processing them.
- Choose where documents are stored.

### Fixed
- Invisible Unicode characters from PDF extraction no longer let PII slip past detection.

### Changed
- Linux builds paused: the bundled engine exceeds GitHub's 2 GB release limit.

## [0.3.5] - 2026-04-03

### Fixed
- Build configuration for macOS and Windows installers.

## [0.3.4] - 2026-04-03

### Fixed
- Linux release build hanging in CI.

## [0.3.3] - 2026-04-03

### Added
- macOS builds are signed and notarized, so no Gatekeeper workaround is needed.

## [0.3.2] - 2026-04-02

### Fixed
- The packaged app could fail to find its bundled anonymization engine.

## [0.3.1] - 2026-04-02

### Fixed
- Engine path resolution in release builds.

## [0.3.0] - 2026-04-02

### Added
- Settings and chat history persist between launches.
- Document sidebar for managing attachments, and search in the Review panel.
- Export chats.
- The anonymization engine is bundled with the app and restarts automatically if it stops.

### Changed
- The engine runs on a dynamically chosen local port.

## [0.2.0] - 2026-03-31

First public release.

## [0.1.1] - 2026-03-31

### Fixed
- App crashed on launch when the anonymization engine was missing.

## [0.1.0] - 2026-03-31

Initial release: drop in a PDF, review local PII redaction, and chat with Claude, GPT, Gemini, or Ollama.

[0.4.1]: https://github.com/rabahs/cloaklm/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/rabahs/cloaklm/compare/v0.3.5...v0.4.0
[0.3.5]: https://github.com/rabahs/cloaklm/compare/v0.3.4...v0.3.5
[0.3.4]: https://github.com/rabahs/cloaklm/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/rabahs/cloaklm/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/rabahs/cloaklm/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/rabahs/cloaklm/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/rabahs/cloaklm/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/rabahs/cloaklm/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/rabahs/cloaklm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/rabahs/cloaklm/releases/tag/v0.1.0
