# Security Policy

CloakLM exists to keep personal information out of AI providers' hands, so security reports are taken seriously.

## Supported Versions

Only the [latest release](https://github.com/rabahs/cloaklm/releases/latest) receives security fixes. Please update before reporting.

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub: go to the [Security tab](https://github.com/rabahs/cloaklm/security) and click **Report a vulnerability**, or use [this direct link](https://github.com/rabahs/cloaklm/security/advisories/new). Only the maintainer can see the report.

Please include:

- What you found and its impact (for example, "a website can read un-redacted text from the sidecar")
- Steps to reproduce, ideally with a minimal sample document
- The CloakLM version and your OS

**Never include real personal data.** Use made-up names and the standard fake SSN `123-45-6789`.

CloakLM is maintained by one person, so timelines are best-effort: expect an acknowledgment within 7 days and an update on a fix within 30 days. You'll be credited in the release notes unless you prefer not to be.

## Scope

In scope:

- Un-redacted text or real values leaving the device (to an AI provider or anywhere else)
- Other programs or websites reaching the local anonymization engine (the sidecar)
- Ways to bypass the outbound PII scrub on messages
- Exposure of stored API keys or chat history

Out of scope (please open a regular issue instead, using fake data):

- The detector missing a specific piece of PII, or redacting something it shouldn't. Detection is statistical and no tool catches everything, which is why the Review panel exists. Reports with sample text help improve it.
- Vulnerabilities in AI providers' own services
- Attacks that require someone who already has full control of your computer
