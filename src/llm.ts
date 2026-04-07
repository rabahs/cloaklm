import type { LLMProvider, Attachment, DeepScanSuggestion } from "./types";

// Provider configuration
const PROVIDER_CONFIG: Record<string, { url: string; defaultModel: string }> = {
  claude: {
    url: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-20250514",
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.5-flash",
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o",
  },
  ollama: {
    url: "http://localhost:11434/api/chat",
    defaultModel: "llama3",
  },
};

export function getProviderDisplayName(provider: LLMProvider): string {
  const names: Record<LLMProvider, string> = {
    claude: "Claude Sonnet",
    gemini: "Gemini Flash",
    openai: "GPT-4o",
    ollama: "Ollama (Local)",
  };
  return names[provider];
}

export function getProviderIcon(provider: LLMProvider): string {
  const icons: Record<LLMProvider, string> = {
    claude: "🟣",
    gemini: "🔵",
    openai: "🟢",
    ollama: "🖥️",
  };
  return icons[provider];
}

// Strip invisible Unicode that PDF extractors inject.
// Without this, PII hidden behind zero-width chars evades regex but LLMs read it.
function sanitizeUnicode(text: string): string {
  // Strip zero-width / invisible formatting characters
  text = text.replace(/[\u200b\u200c\u200d\u200e\u200f\u00ad\u2060-\u2064\ufeff\ufff9-\ufffb\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e]/g, "");
  // Normalize exotic whitespace to plain space
  text = text.replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, " ");
  // NFC normalization (compose accented chars)
  return text.normalize("NFC");
}

// Regex safety net patterns — independent of what the sidecar caught.
// These run on every outbound prompt as a last line of defense.
const SAFETY_NET_PATTERNS: { pattern: RegExp; placeholder: string }[] = [
  // Partially-redacted emails: [PERSON_4]@knl-cpa.com → full redaction
  { pattern: /\S*\[[A-Z_]+\d*\]@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: "[EMAIL_REDACTED]" },
  // Emails
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: "[EMAIL_REDACTED]" },
  // SSNs (123-45-6789, 123 45 6789)
  { pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b/g, placeholder: "[SSN_REDACTED]" },
  // Phone numbers
  { pattern: /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, placeholder: "[PHONE_REDACTED]" },
  // Street addresses (123 Main Street, 4567 Oak Dr.)
  { pattern: /\b\d{1,6}\s+(?:[A-Z][a-zA-Z]*\.?\s+){1,4}(?:Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Road|Rd\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?|Way|Circle|Cir\.?|Trail|Trl\.?|Terrace|Ter\.?|Parkway|Pkwy\.?)\b\.?/gi, placeholder: "[ADDRESS_REDACTED]" },
  // City, State ZIP
  { pattern: /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, placeholder: "[LOCATION_REDACTED]" },
];

// High-speed, multi-layer PII anonymizer for outbound prompts
export function anonymizePrompt(text: string, attachments: Attachment[]): string {
  if (!text) return text;

  // Layer 0: Strip invisible Unicode BEFORE any pattern matching.
  // This is the root cause of "LLM sees PII that search can't find".
  text = sanitizeUnicode(text);

  // --- Layer 1: Redaction-map-based replacement (what the sidecar caught) ---
  if (attachments.length > 0) {
    // 1. Build a unique set of all PII tokens to redact
    const tokenMap = new Map<string, string>(); // real_value -> placeholder

    attachments.forEach(att => {
      // Also redact original and anonymized filenames to be safe
      [att.fileName, att.anonymizedFileName].forEach(name => {
        if (!name) return;
        tokenMap.set(name.toLowerCase(), "[FILE_NAME]");
        const parts = name.split(/[\s,._-]+/);
        if (parts.length > 1) {
          parts.forEach(p => {
            const part = p.replace(/\.[^/.]+$/, ""); // Strip extension
            if (part.length > 3) tokenMap.set(part.toLowerCase(), "[FILE_NAME]");
          });
        }
      });

      if (!att.redactionMap) return;
      Object.values(att.redactionMap).forEach(entry => {
        const real = entry.real_value.trim().toLowerCase();
        if (real.length < 3) return;

        tokenMap.set(real, entry.placeholder);

        // Force fragment redaction for ALL categories (Safety First)
        const parts = real.split(/[\s,.-]+/);
        if (parts.length > 1) {
          parts.forEach(p => {
            if (p.length > 3) {
              tokenMap.set(p.toLowerCase(), entry.placeholder);
            }
          });
        }
      });
    });

    if (tokenMap.size > 0) {
      // Sort longest first to prioritize "John Doe" over "John"
      const sortedTokens = Array.from(tokenMap.keys()).sort((a, b) => b.length - a.length);
      const regexPattern = sortedTokens
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const regex = new RegExp(`(${regexPattern})`, 'gi');

      text = text.replace(regex, (match) => {
        return tokenMap.get(match.toLowerCase()) || match;
      });
    }
  }

  // --- Layer 2: Regex safety net (catches anything the sidecar missed) ---
  // This is the LAST line of defense before content leaves the device.
  for (const { pattern, placeholder } of SAFETY_NET_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    text = text.replace(pattern, (match) => {
      // Don't re-redact things already in brackets
      if (/^\[.*\]$/.test(match)) return match;
      return placeholder;
    });
  }

  return text;
}

// Build the system prompt with anonymized document context
function buildSystemPrompt(attachments: Attachment[]): string {
  const docs = attachments
    .filter((a) => a.status === "ready" && a.anonymizedContent)
    .map((a, i) => `[DOCUMENT_${i + 1}_CONTENT]:\n${sanitizeUnicode(a.anonymizedContent!)}`)
    .join("\n\n");

  if (!docs) return "Factual Analysis Mode.";

  return `### MECHANICAL_ANALYSIS_MODE
1. TRUTH-LOCK: The student name, addresses, and dates ARE the placeholders (e.g. [PERSON_1]). 
2. NO HALLUCINATIONS: You are FORBIDDEN from inventing names like "Joan Davis" or "Anytown." Only use placeholders. 
3. BOX 1 FIX: On Form 1098-T, ignore standalone numbers between "$" and values. They are box labels. ($ 2 765.00 = $765.00).
4. Direct factual answers only.

[VISIBLE_DATASET]:
${docs}`;
}

// De-anonymize: replace [PERSON_1] etc. with real values in the AI response
export function deAnonymize(
  text: string,
  attachments: Attachment[]
): string {
  if (!text) return text;
  let result = text;
  for (const att of attachments) {
    if (!att.redactionMap) continue;
    for (const entry of Object.values(att.redactionMap)) {
      // Replace all occurrences of the placeholder with the real value
      result = result.split(entry.placeholder).join(entry.real_value);
    }
  }
  return result;
}

// ---------- Deep Scan with Local LLM ----------

const DEEP_SCAN_PROMPT = `You are a strict PII detection scanner. A document has been partially anonymized — items in [SQUARE_BRACKETS] like [PERSON_1] are already redacted. IGNORE those.

Your job: find REMAINING real personal information that was MISSED. Scan every line carefully.

WHAT TO FLAG (with exact text as it appears):
- People's names: first names, last names, full names, initials with last name (e.g. "R. Shihab")
- Street addresses: house numbers + street names (e.g. "742 Evergreen Terrace")
- Cities, states, ZIP codes that identify a location (e.g. "Springfield, IL 62704")
- Phone numbers, even partial (e.g. "555-0123", "(312) 555")
- SSN, even last 4 digits (e.g. "6789", "XXX-XX-6789")
- Email addresses (e.g. "john@example.com")
- Account numbers, loan numbers, policy numbers
- Employer names, school/university names
- Dates of birth in any format

WHAT TO IGNORE (do NOT flag these):
- Anything in [SQUARE_BRACKETS] — already redacted
- Generic terms: "taxpayer", "student", "applicant", "borrower"
- Form labels: "Box 1", "Line 12a", "Form 1098-T"
- Dollar amounts, tax figures, percentages
- Tax years (e.g. "2025", "2026")

EXAMPLES:
Input: "Tuition paid by [PERSON_1] at Springfield University, 456 Oak Street, Springfield IL"
Output: [{"text": "Springfield University", "category": "ORGANIZATION"}, {"text": "456 Oak Street", "category": "ADDRESS"}, {"text": "Springfield IL", "category": "ADDRESS"}]

Input: "SSN ending in 6789 for tax year 2025"
Output: [{"text": "6789", "category": "SSN_PARTIAL"}]

Input: "[PERSON_1] received Form 1098-T showing $5,000 in Box 1"
Output: []

Return ONLY a JSON array. No explanation. If nothing found, return [].

Document:
---
`;

export async function deepScanWithLLM(
  anonymizedContent: string,
  ollamaUrl: string,
  model: string
): Promise<DeepScanSuggestion[]> {
  const prompt = DEEP_SCAN_PROMPT + anonymizedContent + "\n---";

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Deep Scan failed: ${response.status}`);
  }

  const data = await response.json();
  const raw = data.message?.content || "[]";

  // Extract JSON array from response (LLM might wrap it in markdown code blocks)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((item: { text?: string; category?: string }) => item.text && item.category)
      .map((item: { text: string; category: string }) => ({
        id: crypto.randomUUID(),
        text: item.text,
        category: item.category,
        status: "pending" as const,
      }));
  } catch {
    return [];
  }
}

// ---------- Provider-specific API callers ----------

async function parseLLMError(providerName: string, response: Response): Promise<Error> {
  let rawText = "";
  try { rawText = await response.text(); } catch { return new Error(`${providerName} Error: ${response.status}`); }

  let json: any = null;
  try { json = JSON.parse(rawText); } catch { /* Ignore */ }

  const errorMsg = json?.error?.message || json?.message || json?.error || rawText.substring(0, 150) || "Unknown error";
  
  const status = response.status;
  const isRateLimit = status === 429 || String(errorMsg).toLowerCase().includes("quota") || String(errorMsg).toLowerCase().includes("rate limit");
  const isAuth = status === 401 || status === 403;

  if (isRateLimit) return new Error(`You have exceeded your ${providerName} API rate limit or billing quota. Please check your provider account.`);
  if (isAuth) return new Error(`Invalid ${providerName} API key. Please double-check your Settings.`);
  
  return new Error(`${providerName} API Error (${status}): ${typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg).substring(0, 100)}`);
}

async function callClaude(
  apiKey: string,
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const config = PROVIDER_CONFIG.claude;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: modelId || config.defaultModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    throw await parseLLMError("Claude", response);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callGemini(
  apiKey: string,
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const config = PROVIDER_CONFIG.gemini;
  const url = `${config.url}/${modelId || config.defaultModel}:generateContent?key=${apiKey}`;

  const contents = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    }),
  });

  if (!response.ok) {
    throw await parseLLMError("Gemini", response);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callOpenAI(
  apiKey: string,
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const config = PROVIDER_CONFIG.openai;

  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: modelId || config.defaultModel,
      messages: apiMessages,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    throw await parseLLMError("OpenAI", response);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOllama(
  messages: { role: string; content: string }[],
  systemPrompt: string,
  ollamaUrl: string,
  ollamaModel: string
): Promise<string> {
  const finalMessages = [
    { role: "system", content: systemPrompt },
    ...messages
  ];

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      messages: finalMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw await parseLLMError("Ollama", response);
  }

  const data = await response.json();
  return data.message.content;
}

// ---------- Main dispatcher ----------

export interface LLMCallOptions {
  provider: LLMProvider;
  apiKeys: { claude?: string; gemini?: string; openai?: string };
  ollamaUrl: string;
  activeModel: string;
  messages: { role: string; content: string }[];
  attachments: Attachment[];
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const { provider, apiKeys, ollamaUrl, activeModel, messages, attachments } =
    options;

  // --- PRIVACY GATEKEEPER START ---
  // 1. Build the document-context prompt
  const rawSystemPrompt = buildSystemPrompt(attachments);
  
  // 2. Anonymize and STRIP METADATA (Firewall Pass)
  // We explicitly only keep 'role' and 'content' to prevent 'hidden' PII leaks
  // like original filenames or local paths in the messages array.
  const safeSystemPrompt = anonymizePrompt(rawSystemPrompt, attachments);
  const rawMessages = messages.map(m => ({
    role: m.role,
    content: anonymizePrompt(m.content, attachments)
  }));
  
  // 3. UNIVERSAL CONTEXT INJECTION (Global Fix)
  const FinalAPIMessages = rawMessages.map((m, i) => {
    const isCurrentTurnUserMsg = i === rawMessages.length - 1 && m.role === "user";
    if (isCurrentTurnUserMsg && attachments.length > 0) {
      return {
        role: m.role,
        content: `### [VISIBLE_DATASET]\n${safeSystemPrompt}\n\n[USER_QUERY]: ${m.content}`
      };
    }
    return m;
  });

  const finalSystemRole = "Factual Analysis Mode. Direct answers only.";

  // --- PRIVACY GATEKEEPER END ---

  switch (provider) {
    case "claude": {
      if (!apiKeys.claude) throw new Error("Claude API key not configured. Open Settings (⚙️) to add it.");
      return callClaude(apiKeys.claude, activeModel, FinalAPIMessages, finalSystemRole);
    }
    case "gemini": {
      if (!apiKeys.gemini) throw new Error("Gemini API key not configured. Open Settings (⚙️) to add it.");
      return callGemini(apiKeys.gemini, activeModel, FinalAPIMessages, finalSystemRole);
    }
    case "openai": {
      if (!apiKeys.openai) throw new Error("OpenAI API key not configured. Open Settings (⚙️) to add it.");
      return callOpenAI(apiKeys.openai, activeModel, FinalAPIMessages, finalSystemRole);
    }
    case "ollama": {
      return callOllama(FinalAPIMessages, finalSystemRole, ollamaUrl, activeModel);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
