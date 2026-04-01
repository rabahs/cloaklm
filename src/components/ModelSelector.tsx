import { useState, useEffect } from "react";
import type { LLMProvider } from "../types";

interface ModelSelectorProps {
  provider: LLMProvider;
  activeModel: string;
  onModelChange: (modelId: string) => void;
  customModels: string[];
  onAddCustomModel: (modelId: string) => void;
  apiKeys: { claude?: string; gemini?: string; openai?: string };
  ollamaUrl: string;
}

// Anthropic's hardcoded evergreen list
const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" }
];

export function ModelSelector({
  provider,
  activeModel,
  onModelChange,
  customModels,
  onAddCustomModel,
  apiKeys,
  ollamaUrl
}: ModelSelectorProps) {
  const [fetchedModels, setFetchedModels] = useState<{ id: string; label: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Fetch dynamic models when provider or API keys change
  useEffect(() => {
    let active = true;

    async function fetchModels() {
      setIsLoading(true);
      setFetchedModels([]);
      try {
        if (provider === "claude") {
          // Hardcoded fallbacks for Anthropic
          setFetchedModels(ANTHROPIC_MODELS);
        } else if (provider === "openai" && apiKeys.openai) {
          const res = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKeys.openai}` }
          });
          if (res.ok) {
            const data = await res.json();
            // Filter to only reasonable chat-capable models and sort
            const chatModels = data.data
              .filter((m: any) => m.id.startsWith("gpt-") || m.id.includes("o1") || m.id.includes("o3"))
              .map((m: any) => ({ id: m.id, label: m.id }))
              .sort((a: any, b: any) => b.id.localeCompare(a.id));
            if (active) setFetchedModels(chatModels);
          }
        } else if (provider === "gemini" && apiKeys.gemini) {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKeys.gemini}`);
          if (res.ok) {
            const data = await res.json();
            const gModels = data.models
              .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
              .map((m: any) => ({ id: m.name.replace("models/", ""), label: m.displayName || m.name.replace("models/", "") }))
              .sort((a: any, b: any) => b.id.localeCompare(a.id));
            if (active) setFetchedModels(gModels);
          }
        } else if (provider === "ollama") {
          const res = await fetch(`${ollamaUrl}/api/tags`);
          if (res.ok) {
            const data = await res.json();
            const lModels = data.models.map((m: any) => ({ id: m.name, label: m.name }));
            if (active) setFetchedModels(lModels);
          }
        }
      } catch (err) {
        console.error("Failed to fetch models for", provider, err);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    fetchModels();

    return () => { active = false; };
  }, [provider, apiKeys, ollamaUrl]);

  // Build the unified list of options: dynamically fetched + user custom
  const allOptions = [
    ...fetchedModels,
    ...customModels.map(id => ({ id, label: `${id} (Custom)` }))
  ];

  // If the active model isn't in fetched lists but exists in settings, make a fake one to show
  if (activeModel && !allOptions.find(o => o.id === activeModel)) {
    allOptions.unshift({ id: activeModel, label: activeModel });
  }

  // Remove exact duplicates
  const uniqueOptions = Array.from(new Map(allOptions.map(item => [item.id, item])).values());

  return (
    <div className="relative">
      <select
        value={activeModel || ""}
        onChange={(e) => {
          if (e.target.value === "ADD_CUSTOM") {
            const result = prompt("Enter Custom Model ID (e.g., claude-opus-4-6):");
            if (result && result.trim()) {
              onAddCustomModel(result.trim());
            }
          } else {
            onModelChange(e.target.value);
          }
        }}
        className="max-w-[280px] bg-surface border border-border rounded-lg pl-3 pr-8 py-1.5 text-sm font-medium text-text-primary outline-none hover:border-primary/50 transition-colors appearance-none cursor-pointer"
        style={{ backgroundImage: `url('data:image/svg+xml;utf8,<svg fill="%23888" height="20" viewBox="0 0 24 24" width="20" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/></svg>')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
        title="Select AI Model"
      >
        {isLoading && <option value="" disabled>Loading...</option>}
        {!isLoading && uniqueOptions.length === 0 && <option value="" disabled>No models found</option>}
        
        {uniqueOptions.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
        
        <option value="ADD_CUSTOM">
          + Add Custom Model ID...
        </option>
      </select>
    </div>
  );
}
