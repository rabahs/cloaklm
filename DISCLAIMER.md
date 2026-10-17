# Disclaimer

*Last updated: October 17, 2026. This is a draft and has not yet been reviewed by a lawyer.*

CloakLM is free, open-source software published by BitHunch LLC. By downloading or using it, you agree to the following.

## Redaction is not guaranteed

CloakLM uses automated detection (a local AI model plus pattern matching) to find and replace personal information. Automated detection can **miss information**, or **redact things that aren't personal**. Unusual formats, scanned or low-quality PDFs, and handwriting are especially likely to cause misses.

**You are responsible for reviewing what is sent.** Before sending anything to an AI provider, open the Review panel and check the "Raw Output to AI" tab, which shows exactly what will be sent. Redact anything that was missed. Do not rely on CloakLM as your only safeguard for information whose exposure would cause serious harm.

## Not professional advice

CloakLM, the answers AI models give through it, and the guides on our website are general information, **not tax, legal, financial, or medical advice**. AI models make mistakes, including confident-sounding ones. Verify anything important with a qualified professional or an official source, such as the IRS, before acting on it.

## Third-party AI providers

If you choose a cloud model (for example Anthropic Claude, OpenAI GPT, or Google Gemini), CloakLM sends the anonymized text **directly from your device to that provider**, using your own API key. That provider's own terms of service and privacy policy apply to what you send, including how long they keep it and whether they use it. CloakLM has no control over these providers. You are responsible for any API charges they bill you.

If you use a local model through Ollama, your data stays on your computer.

## Your data and devices

CloakLM runs on your computer and has no server of its own: we do not receive your documents, chats, or API keys. Your settings, API keys, and chat history are stored in local files on your device and are **not encrypted** by CloakLM. Anyone with access to your user account could read them. Keeping your device and accounts secure is your responsibility.

## No warranty, no liability

CloakLM is provided **"as is", without warranty of any kind**, express or implied, including any warranty that it is fit for a particular purpose, error-free, or that it will detect all personal information. To the fullest extent permitted by law, BitHunch LLC and CloakLM's contributors are **not liable for any damages** arising from your use of CloakLM. This includes data exposure, identity theft, financial loss, or reliance on AI output. See the [MIT License](./LICENSE) for the full terms.

## Questions and security issues

Open an issue on [GitHub](https://github.com/rabahs/cloaklm/issues). For security problems, follow [SECURITY.md](./SECURITY.md) to report privately.
