import type { LLMProvider, Attachment } from "./types";

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

// Build the system prompt with anonymized document context
function buildSystemPrompt(attachments: Attachment[]): string {
  const docs = attachments
    .filter((a) => a.status === "ready" && a.anonymizedContent)
    .map(
      (a, i) =>
        `--- Document ${i + 1}: ${a.fileName} ---\n${a.anonymizedContent}`
    )
    .join("\n\n");

  if (!docs) {
    return "You are CloakLM, a privacy-first AI assistant. The user may ask general questions.";
  }

  return `You are CloakLM, a privacy-first AI assistant. The user has shared documents with you, but all personally identifiable information has been replaced with placeholders like [PERSON_1], [DATE_2], etc. You will NEVER see real names, SSNs, or addresses — only placeholders.

When answering, use the same placeholders in your response. Do NOT try to guess the real values.

IMPORTANT: These documents were converted from PDF using OCR/ML. The formatting may be imperfect:
- Dollar amounts may be split across lines (e.g., "$" on one line, "765.00" on the next)
- Box numbers from tax forms (Box 1, Box 2, etc.) may appear inline with values from adjacent boxes
- Table structures may be linearized and hard to parse
- When a standalone number appears between a "$" and a decimal value, check whether it might be a box label rather than part of the dollar amount

Use your best judgment to reconstruct the correct values from context. If you are uncertain about a value, say so explicitly.

Here are the anonymized documents:

${docs}`;
}

// De-anonymize: replace [PERSON_1] etc. with real values in the AI response
export function deAnonymize(
  text: string,
  attachments: Attachment[]
): string {
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

// ---------- Provider-specific API callers ----------

async function callClaude(
  apiKey: string,
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
      model: config.defaultModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
      })),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

async function callGemini(
  apiKey: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const config = PROVIDER_CONFIG.gemini;
  const url = `${config.url}/${config.defaultModel}:generateContent?key=${apiKey}`;

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
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callOpenAI(
  apiKey: string,
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
      model: config.defaultModel,
      messages: apiMessages,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
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
  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      messages: apiMessages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error: ${response.status} — ${err}`);
  }

  const data = await response.json();
  return data.message.content;
}

// ---------- Main dispatcher ----------

export interface LLMCallOptions {
  provider: LLMProvider;
  apiKeys: { claude?: string; gemini?: string; openai?: string };
  ollamaUrl: string;
  ollamaModel: string;
  messages: { role: string; content: string }[];
  attachments: Attachment[];
}

export async function callLLM(options: LLMCallOptions): Promise<string> {
  const { provider, apiKeys, ollamaUrl, ollamaModel, messages, attachments } =
    options;

  const systemPrompt = buildSystemPrompt(attachments);

  switch (provider) {
    case "claude": {
      if (!apiKeys.claude) throw new Error("Claude API key not configured. Open Settings (⚙️) to add it.");
      return callClaude(apiKeys.claude, messages, systemPrompt);
    }
    case "gemini": {
      if (!apiKeys.gemini) throw new Error("Gemini API key not configured. Open Settings (⚙️) to add it.");
      return callGemini(apiKeys.gemini, messages, systemPrompt);
    }
    case "openai": {
      if (!apiKeys.openai) throw new Error("OpenAI API key not configured. Open Settings (⚙️) to add it.");
      return callOpenAI(apiKeys.openai, messages, systemPrompt);
    }
    case "ollama": {
      return callOllama(messages, systemPrompt, ollamaUrl, ollamaModel);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
