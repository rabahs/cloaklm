import { useState, useRef, useEffect } from "react";
import type { LLMProvider } from "../types";
import { getProviderIcon } from "../llm";

interface ModelOption {
  id: string;
  provider: LLMProvider;
  label: string;
  badge?: string;
  group: string;
}

const CURATED_MODELS: ModelOption[] = [
  // ─── Anthropic ───────────────────────────────────────────────────────────
  { id: "claude-opus-4-6", provider: "claude", label: "Claude Opus 4.6", badge: "Thinking", group: "Anthropic" },
  { id: "claude-sonnet-4-6", provider: "claude", label: "Claude Sonnet 4.6", badge: "Balanced", group: "Anthropic" },
  { id: "claude-haiku-4-5", provider: "claude", label: "Claude Haiku 4.5", badge: "Fast", group: "Anthropic" },
  
  // ─── Google ──────────────────────────────────────────────────────────────
  { id: "gemini-3.1-pro-preview", provider: "gemini", label: "Gemini 3.1 Pro", badge: "Smart", group: "Google" },
  { id: "gemini-3-flash-preview", provider: "gemini", label: "Gemini 3 Flash", badge: "Fast", group: "Google" },
  { id: "gemini-2.5-flash", provider: "gemini", label: "Gemini 2.5 Flash", group: "Google" },

  // ─── OpenAI ──────────────────────────────────────────────────────────────
  { id: "gpt-5.2", provider: "openai", label: "GPT-5.2", badge: "Smart", group: "OpenAI" },
  { id: "gpt-5-mini", provider: "openai", label: "GPT-5 Mini", badge: "Fast", group: "OpenAI" },
  { id: "o4-mini", provider: "openai", label: "O4-Mini", badge: "Thinking", group: "OpenAI" },
  { id: "o3-mini", provider: "openai", label: "O3-Mini", badge: "Thinking", group: "OpenAI" }
];

interface UnifiedModelSelectorProps {
  provider: LLMProvider;
  activeModel: string;
  onSelect: (provider: LLMProvider, modelId: string) => void;
  apiKeys: { claude?: string; gemini?: string; openai?: string };
  ollamaUrl: string;
  customModels: Record<string, string[]>;
  onAddCustomModel: (provider: LLMProvider, modelId: string) => void;
  isDisabled?: boolean;
}

export function UnifiedModelSelector({
  provider,
  activeModel,
  onSelect,
  apiKeys,
  ollamaUrl,
  customModels,
  onAddCustomModel,
  isDisabled
}: UnifiedModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Fetch local Ollama models gracefully
  useEffect(() => {
    async function fetchLocal() {
      try {
        const res = await fetch(`${ollamaUrl}/api/tags`);
        if (res.ok) {
          const data = await res.json();
          const mapped = data.models.map((m: any) => ({
            id: m.name,
            provider: "ollama" as LLMProvider,
            label: m.name,
            group: "Local Device"
          }));
          setOllamaModels(mapped);
        }
      } catch {
        setOllamaModels([]);
      }
    }
    fetchLocal();
  }, [ollamaUrl]);

  // Filter curated models based on configured API keys
  let availableModels = CURATED_MODELS.filter(m => {
    if (m.provider === 'claude') return !!apiKeys.claude;
    if (m.provider === 'gemini') return !!apiKeys.gemini;
    if (m.provider === 'openai') return !!apiKeys.openai;
    return false;
  });

  // Attach dynamic Ollama models
  availableModels = [...availableModels, ...ollamaModels];

  // Attach User Custom Models
  const customOptions: ModelOption[] = [];
  Object.entries(customModels).forEach(([prov, ids]) => {
    ids.forEach(id => {
      customOptions.push({
        id,
        provider: prov as LLMProvider,
        label: `${id}`,
        badge: "Custom",
        group: "Custom"
      });
    });
  });

  availableModels = [...availableModels, ...customOptions];

  const currentOption = availableModels.find(m => m.id === activeModel) || {
    id: activeModel, provider: provider, label: activeModel, group: ""
  };

  const handleSelect = (selectedProv: LLMProvider, selectedId: string) => {
    onSelect(selectedProv, selectedId);
    setIsOpen(false);
  };

  const handleCustomAdd = () => {
    const raw = prompt("Enter Custom Model ID (e.g., claude-opus-4-6):");
    if (!raw?.trim()) return;
    
    // Attempt to guess provider from name, default to what they're using
    let prov = provider;
    const lower = raw.toLowerCase();
    if (lower.includes("claude") || lower.includes("anthropic")) prov = "claude";
    else if (lower.includes("gemini") || lower.includes("google")) prov = "gemini";
    else if (lower.includes("gpt") || lower.includes("o1")) prov = "openai";
    
    onAddCustomModel(prov, raw.trim());
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors"
      >
        <span className="text-sm">{getProviderIcon(currentOption.provider)}</span>
        <span className="truncate max-w-[160px]">{currentOption.label}</span>
        <span className="opacity-50 text-[10px] ml-1">▼</span>
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-[280px] bg-surface-elevated/95 backdrop-blur-xl border border-border rounded-xl shadow-[0_8px_30px_rgb(0,0,0,0.4)] z-50 flex flex-col overflow-hidden animate-[scale-in_0.15s_ease-out_forwards] origin-bottom-left">
          <div className="max-h-[340px] overflow-y-auto p-1.5 scrollbar-hide">
            
            {["Anthropic", "Google", "OpenAI", "Local Device", "Custom"].map(group => {
              const groupModels = availableModels.filter(m => m.group === group);
              if (groupModels.length === 0) return null;
              
              return (
                <div key={group} className="mb-1.5">
                  <div className="px-2 py-1 text-[10px] font-bold text-text-muted uppercase tracking-wider">
                    {group}
                  </div>
                  {groupModels.map(opt => (
                    <button
                      key={`${opt.provider}-${opt.id}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSelect(opt.provider, opt.id);
                      }}
                      className={`w-full text-left px-2 py-1.5 text-xs rounded-md flex items-center justify-between transition-colors ${
                        activeModel === opt.id
                          ? "bg-primary/20 text-primary font-semibold"
                          : "text-text-primary hover:bg-surface"
                      }`}
                    >
                      <span className="truncate">{opt.label}</span>
                      {opt.badge && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-surface-elevated border border-border text-text-secondary">
                          {opt.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              );
            })}
            
            <div className="h-px bg-border/50 my-1 mx-2" />
            <button
              onMouseDown={(e) => {
                e.preventDefault();
                handleCustomAdd();
              }}
              className="w-full text-left px-2 py-1.5 text-xs text-text-secondary hover:text-text-primary rounded-md transition-colors"
            >
              <span className="opacity-70 mr-1">+</span> Add Custom Model ID...
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
