import type { LLMProvider, Attachment, DeepScanSuggestion } from "./types";
import { fileNameFragments, isLoopbackUrl, redactionRegex, rehydrateSegments, sanitizeUnicode } from "./redact";
import { DEFAULT_MODELS } from "./models";

// Provider configuration
const PROVIDER_CONFIG: Record<string, { url: string; defaultModel: string }> = {
  claude: {
    url: "https://api.anthropic.com/v1/messages",
    defaultModel: DEFAULT_MODELS.claude,
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: DEFAULT_MODELS.gemini,
  },
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: DEFAULT_MODELS.openai,
  },
  ollama: {
    url: "http://localhost:11434/api/chat",
    defaultModel: DEFAULT_MODELS.ollama,
  },
};

export function getProviderDisplayName(provider: LLMProvider): string {
  const names: Record<LLMProvider, string> = {
    claude: "Claude",
    gemini: "Gemini",
    openai: "OpenAI",
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

// Regex safety net patterns — independent of what the sidecar caught.
// These run on every outbound prompt as a last line of defense.
const SAFETY_NET_PATTERNS: { pattern: RegExp; placeholder: string }[] = [
  // Partially-redacted emails: [PERSON_4]@knl-cpa.com → full redaction
  { pattern: /\S*\[[A-Z_]+\d*\]@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: "[EMAIL_REDACTED]" },
  // Emails
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, placeholder: "[EMAIL_REDACTED]" },
  // SSNs (123-45-6789, 123 45 6789). Digit lookarounds, not \b: "SSN123-45-6789" has no word boundary.
  { pattern: /(?<!\d)\d{3}[-\s]\d{2}[-\s]\d{4}(?!\d)/g, placeholder: "[SSN_REDACTED]" },
  // Phone numbers
  { pattern: /(?<!\d)(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g, placeholder: "[PHONE_REDACTED]" },
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
        tokenMap.set(sanitizeUnicode(name).toLowerCase(), "[FILE_NAME]");
        fileNameFragments(name).forEach(part => tokenMap.set(part, "[FILE_NAME]"));
      });

      if (!att.redactionMap) return;
      Object.values(att.redactionMap).forEach(entry => {
        // Same normalization as the text, or a name stored decomposed (NFD) wouldn't match.
        const real = sanitizeUnicode(entry.real_value).trim().toLowerCase();
        // Two-character values (initials, state codes) too: they only match as whole words.
        if (real.length < 2) return;

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
      const regex = redactionRegex(Array.from(tokenMap.keys()));

      // A match whose case folding doesn't round-trip still gets redacted, never sent as is.
      text = text.replace(regex, (match) => tokenMap.get(match.toLowerCase()) || "[REDACTED]");
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

// De-anonymize: replace [PERSON_1] etc. with real values in the AI response.
// Placeholders that mean different things in different documents stay as they are.
export function deAnonymize(text: string, attachments: Attachment[]): string {
  if (!text) return text;
  return rehydrateSegments(text, attachments).map((s) => s.text).join("");
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
  assertLocalOllama(ollamaUrl);
  const items = await askOllamaForSpans(DEEP_SCAN_PROMPT + anonymizedContent + "\n---", ollamaUrl, model);
  return items.map((item) => ({
    id: crypto.randomUUID(),
    text: item.text,
    category: item.category,
    status: "pending" as const,
  }));
}

// These scans read text that may still contain the very PII they look for.
function assertLocalOllama(ollamaUrl: string): void {
  if (!isLoopbackUrl(ollamaUrl)) {
    throw new Error("Deep Scan and the identifiability check only run on Ollama on this computer (localhost).");
  }
}

interface FoundSpan {
  text: string;
  category: string;
  reason?: string;
}

// Sends one prompt to a local Ollama model and parses the JSON array it returns.
async function askOllamaForSpans(prompt: string, ollamaUrl: string, model: string, numCtx?: number): Promise<FoundSpan[]> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      ...(numCtx ? { options: { num_ctx: numCtx } } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? `The local model "${model}" isn't installed in Ollama. Pick another model under Settings → Deep Scan.`
        : `Local model request failed: ${response.status}`
    );
  }

  const data = await response.json();
  const raw = data.message?.content || "[]";

  // Extract JSON array from response (LLM might wrap it in markdown code blocks)
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: Partial<FoundSpan>): item is FoundSpan => typeof item?.text === "string" && !!item.text && typeof item.category === "string"
    );
  } catch {
    return [];
  }
}

// ---------- Identifiability check with Local LLM ----------

const IDENTIFIABILITY_PROMPT = `You review documents whose personal information was already redacted. Items in [SQUARE_BRACKETS] like [PERSON_1] or [ORG_2] are already hidden. Do NOT flag them.

Your job: find details that could still reveal WHO this person is, or which company or school a placeholder hides, if someone searched the web for them. A name being hidden is not enough when the rest of the text points to one person.

WHAT TO FLAG (copy the exact text as it appears, short as possible):
- UNIQUE_NAME: names of specific products, games, apps, open-source projects, internal projects, publications, patents (e.g. "Starfall Odyssey", "Project Lantern")
- DISTINCTIVE_FACT: facts that single out one company or event, especially money, dates and firsts together (e.g. "raised over $250M, went public in 2019", "acquired in 2017 for $120M", "first FDA-cleared hearing app")
- AWARD: named awards, honors, rankings, competition results (e.g. "2011 Chairman's Excellence Award", "top Hacker News post with 500 points")
- PRODUCT_TIE: product or technology names that reveal a hidden employer (e.g. "ABAP" alongside a hidden employer suggests SAP)
- RARE_DETAIL: unusual personal details (e.g. "Started programming at age 9", a rare combination of spoken languages)

WHAT TO IGNORE:
- Anything in [SQUARE_BRACKETS]
- Common skills, tools and languages: "Python", "React", "AWS", "SQL", "Agile"
- Generic job titles and duties: "Senior Engineer", "led a team of 5"
- Form labels, box numbers, dollar amounts on tax forms, tax years

Return ONLY a JSON array of objects with "text" (exact substring of the document), "category" (one of the categories above) and "reason" (under 12 words, why it is identifying). No explanation. If nothing found, return [].

EXAMPLE:
Input: "[PERSON_1] built Starfall Odyssey, a 1998 PC game, then joined [ORG_3], which raised over $250M and went public in 2019. Skills: Python, SQL."
Output: [{"text": "Starfall Odyssey", "category": "UNIQUE_NAME", "reason": "Searchable game title leads to its creator"}, {"text": "raised over $250M and went public in 2019", "category": "DISTINCTIVE_FACT", "reason": "Funding and IPO year identify the company"}]

Document:
---
`;

const IDENTIFIABILITY_CHUNK_CHARS = 6000;

// Splits on paragraph breaks so each chunk fits a small local model's context.
function chunkText(text: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const para of text.split(/\n{2,}/)) {
    if (current && current.length + para.length + 2 > maxChars) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Finds details that could identify the person even with names redacted (unique
 * project names, funding figures with dates, awards). Runs on a local Ollama model,
 * so nothing leaves the device. Results are suggestions for the Review panel.
 */
export async function identifiabilityCheckWithLLM(
  anonymizedContent: string,
  ollamaUrl: string,
  model: string
): Promise<DeepScanSuggestion[]> {
  assertLocalOllama(ollamaUrl);
  const seen = new Set<string>();
  const suggestions: DeepScanSuggestion[] = [];
  for (const chunk of chunkText(anonymizedContent, IDENTIFIABILITY_CHUNK_CHARS)) {
    const items = await askOllamaForSpans(IDENTIFIABILITY_PROMPT + chunk + "\n---", ollamaUrl, model, 8192);
    for (const item of items) {
      const text = item.text.trim();
      const key = text.toLowerCase();
      // Keep only real, not-yet-redacted text from the document; models paraphrase.
      if (text.length < 3 || seen.has(key) || !anonymizedContent.includes(text) || /^\[[A-Z_]+\d*\]$/.test(text)) continue;
      seen.add(key);
      suggestions.push({
        id: crypto.randomUUID(),
        text,
        category: item.category,
        status: "pending",
        kind: "identifying",
        reason: item.reason?.trim() || undefined,
      });
    }
  }
  return suggestions;
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
  const model = modelId || config.defaultModel;
  // On a safety decline these models can hand the turn to another model server-side.
  const useFallbacks = CLAUDE_FALLBACK_MODELS.has(model);

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
      ...(useFallbacks ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
    },
    body: JSON.stringify({
      model,
      // Current models think before answering, and thinking counts toward this cap.
      max_tokens: 16000,
      ...(useFallbacks ? { fallbacks: "default" } : {}),
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
  if (data.stop_reason === "refusal") {
    throw new Error("Claude declined to answer this request. Try rephrasing it, or choose a different model.");
  }
  // The first block is often a thinking block; the answer is in the text blocks.
  return (data.content || [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("");
}

const CLAUDE_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

async function callGemini(
  apiKey: string,
  modelId: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const config = PROVIDER_CONFIG.gemini;
  // Key in a header, not the URL, where proxies and logs would record it.
  const url = `${config.url}/${modelId || config.defaultModel}:generateContent`;

  const contents = messages.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
    }),
  });

  if (!response.ok) {
    throw await parseLLMError("Gemini", response);
  }

  const data = await response.json();
  const parts: { text?: string; thought?: boolean }[] = data.candidates?.[0]?.content?.parts || [];
  if (parts.length === 0) {
    const reason = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason || "no response";
    throw new Error(`Gemini returned no answer (${reason}). Try rephrasing, or choose a different model.`);
  }
  // Thinking models can return thought parts before the answer.
  return parts.filter((p) => !p.thought && p.text).map((p) => p.text).join("");
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
      // Reasoning models reject max_tokens; this cap also covers their reasoning tokens.
      max_completion_tokens: 16000,
    }),
  });

  if (!response.ok) {
    throw await parseLLMError("OpenAI", response);
  }

  const data = await response.json();
  const message = data.choices?.[0]?.message;
  if (!message?.content) {
    throw new Error(message?.refusal || "OpenAI returned an empty answer. Try rephrasing, or choose a different model.");
  }
  return message.content;
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
  /**
   * Every document the conversation has used. Earlier messages are scrubbed again
   * on each turn; with only the active documents, a name typed while a document
   * was active went out in clear once that document was unchecked or removed.
   */
  scrubAttachments?: Attachment[];
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const { provider, apiKeys, ollamaUrl, activeModel, messages, attachments } =
    options;
  const scrubWith = [...new Map([...attachments, ...(options.scrubAttachments || [])].map(a => [a.id, a])).values()];

  // --- PRIVACY GATEKEEPER START ---
  // 1. Build the document-context prompt
  const rawSystemPrompt = buildSystemPrompt(attachments);
  
  // 2. Anonymize and STRIP METADATA (Firewall Pass)
  // We explicitly only keep 'role' and 'content' to prevent 'hidden' PII leaks
  // like original filenames or local paths in the messages array.
  const safeSystemPrompt = anonymizePrompt(rawSystemPrompt, scrubWith);
  const rawMessages = messages.map(m => ({
    role: m.role,
    content: anonymizePrompt(m.content, scrubWith)
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
