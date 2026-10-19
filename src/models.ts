import type { LLMProvider } from "./types";

export interface ModelOption {
  id: string;
  provider: LLMProvider;
  label: string;
  badge?: string;
}

// Recommended models shown first in the picker (reviewed October 2026).
// Everything else the user's key can access is fetched live by listProviderModels().
export const CURATED_MODELS: ModelOption[] = [
  { id: "claude-opus-5-5", provider: "claude", label: "Claude Opus 5.5", badge: "Smart" },
  { id: "claude-sonnet-5-5", provider: "claude", label: "Claude Sonnet 5.5", badge: "Balanced" },
  { id: "claude-haiku-5-5", provider: "claude", label: "Claude Haiku 5.5", badge: "Fast" },
  { id: "claude-fable-5-1", provider: "claude", label: "Claude Fable 5.1", badge: "Most capable" },

  { id: "gemini-4-argon", provider: "gemini", label: "Gemini 4 Argon", badge: "Smart" },
  { id: "gemini-3.8-flash", provider: "gemini", label: "Gemini 3.8 Flash", badge: "Fast" },

  { id: "gpt-6.1-sol", provider: "openai", label: "GPT-6.1 Sol", badge: "Smart" },
  { id: "gpt-6-luna", provider: "openai", label: "GPT-6 Luna", badge: "Fast" },
];

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: "claude-opus-5-5",
  gemini: "gemini-4-argon",
  openai: "gpt-6.1-sol",
  ollama: "llama3.2",
};

// Models that earlier CloakLM versions shipped as defaults or recommendations, mapped
// tier-to-tier to today's equivalents (a Haiku user stays on Haiku). Applied once per
// MODELS_VERSION, so a model the user picks afterwards is never changed again.
export const MODELS_VERSION = "2026-10";
const UPGRADES: Record<string, string> = {
  "claude-3-5-sonnet-latest": "claude-sonnet-5-5",
  "claude-sonnet-4-20250514": "claude-sonnet-5-5",
  "claude-opus-4-6": "claude-opus-5-5",
  "claude-sonnet-4-6": "claude-sonnet-5-5",
  "claude-haiku-4-5": "claude-haiku-5-5",
  "gemini-3.1-pro": "gemini-4-argon",
  "gemini-3.1-pro-preview": "gemini-4-argon",
  "gemini-3-flash-preview": "gemini-3.8-flash",
  "gemini-2.5-pro": "gemini-4-argon",
  "gemini-2.5-flash": "gemini-3.8-flash",
  "gemini-2.5-flash-lite": "gemini-3.8-flash",
  "gpt-5.4-thinking": "gpt-6.1-sol",
  "gpt-5.2": "gpt-6.1-sol",
  "gpt-5-mini": "gpt-6-luna",
  "o4-mini": "gpt-6.1-sol",
  "o3-mini": "gpt-6.1-sol",
  "gpt-4o": "gpt-6.1-sol",
};

export function migrateActiveModels(
  saved: Partial<Record<LLMProvider, string>> | undefined,
  savedVersion: string | undefined,
): Record<LLMProvider, string> {
  const result = { ...DEFAULT_MODELS };
  for (const p of Object.keys(result) as LLMProvider[]) {
    const id = saved?.[p];
    if (!id) continue;
    result[p] = savedVersion === MODELS_VERSION ? id : (UPGRADES[id] ?? id);
  }
  return result;
}

/** Guess a provider from a model ID typed by the user. */
export function guessProvider(modelId: string, fallback: LLMProvider): LLMProvider {
  const id = modelId.toLowerCase();
  if (id.startsWith("claude")) return "claude";
  if (id.startsWith("gemini") || id.startsWith("gemma")) return "gemini";
  if (/^(gpt|o\d|chatgpt)/.test(id)) return "openai";
  return fallback;
}

// ---------- Live model lists ----------

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; models: ModelOption[] }>();

// Non-chat model families the providers also return from their list endpoints.
const OPENAI_NON_CHAT = /(audio|realtime|tts|transcribe|whisper|image|dall-e|embedding|moderation|search|instruct|codex|computer-use|live)/;
const GEMINI_NON_CHAT = /(embedding|tts|image|aqa|live|veo|imagen)/;

async function fetchClaude(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map((m: { id: string; display_name?: string }) => ({
    id: m.id, provider: "claude" as const, label: m.display_name || m.id,
  }));
}

async function fetchOpenAI(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || [])
    .map((m: { id: string }) => m.id)
    .filter((id: string) => /^(gpt-|o\d|chatgpt-)/.test(id) && !OPENAI_NON_CHAT.test(id))
    .sort()
    .map((id: string) => ({ id, provider: "openai" as const, label: id }));
}

async function fetchGemini(apiKey: string): Promise<ModelOption[]> {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
    headers: { "x-goog-api-key": apiKey },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || [])
    .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes("generateContent") && !GEMINI_NON_CHAT.test(m.name))
    .map((m: { name: string; displayName?: string }) => ({
      id: m.name.replace(/^models\//, ""), provider: "gemini" as const, label: m.displayName || m.name,
    }));
}

/** Models the user's API key can access. Returns [] on any failure (offline, bad key). */
export async function listProviderModels(provider: LLMProvider, apiKey?: string): Promise<ModelOption[]> {
  if (!apiKey || provider === "ollama") return [];
  const key = `${provider}:${apiKey.slice(-8)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.models;
  try {
    const fetcher = provider === "claude" ? fetchClaude : provider === "openai" ? fetchOpenAI : fetchGemini;
    const models = await fetcher(apiKey);
    cache.set(key, { at: Date.now(), models });
    return models;
  } catch {
    return [];
  }
}
