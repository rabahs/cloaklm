# Changelog

All notable changes to CloakLM. Download any version from [Releases](https://github.com/rabahs/cloaklm/releases).

## [0.4.1] - 2026-10-17

**Critical fix and security update. All users should upgrade.**

### Fixed
- **The app could not start its anonymization engine** (since v0.3.2), so it showed "AI Engine failed to start" and could not process documents. Three causes, all fixed: the app looked for the engine in the wrong place, macOS blocked the engine from loading its bundled Python, and the engine could repeatedly start copies of itself.
- W-2 box 12 codes (such as `D` for 401(k) contributions) were sometimes redacted as zip codes, so the AI lost information it needed.
- Box labels like "15 State" and "17 State" were redacted as locations.
- "Add custom model" did nothing.
- Replies from current Claude models could come back blank, and OpenAI's reasoning models returned an error.
- Settings still pointing at retired default models (such as Gemini 2.5 Flash, retiring October 20, 2026) move to current ones automatically.

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
