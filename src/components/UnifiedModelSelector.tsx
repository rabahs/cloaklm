import { useState, useRef, useEffect } from "react";
import type { LLMProvider } from "../types";
import { getProviderIcon } from "../llm";
import { CURATED_MODELS, guessProvider, listProviderModels, type ModelOption } from "../models";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "./Icons";

const PROVIDER_GROUPS: { provider: LLMProvider; label: string }[] = [
  { provider: "claude", label: "Anthropic" },
  { provider: "gemini", label: "Google" },
  { provider: "openai", label: "OpenAI" },
  { provider: "ollama", label: "On this computer" },
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
  const [query, setQuery] = useState("");
  const [liveModels, setLiveModels] = useState<ModelOption[]>([]);
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [customId, setCustomId] = useState("");
  const [customProvider, setCustomProvider] = useState<LLMProvider>(provider);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      // composedPath, not contains(): clicking "Add a custom model" re-renders and
      // detaches the clicked button before this listener runs.
      if (dropdownRef.current && !event.composedPath().includes(dropdownRef.current)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      setTimeout(() => searchRef.current?.focus(), 0);
    } else {
      setQuery("");
      setAdding(false);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Fetch what each key can access when the picker opens (cached for 10 minutes)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (["claude", "gemini", "openai"] as const).forEach(async (p) => {
      const models = await listProviderModels(p, apiKeys[p]);
      if (!cancelled && models.length) {
        setLiveModels((prev) => [...prev.filter((m) => m.provider !== p), ...models]);
      }
    });
    fetch(`${ollamaUrl}/api/tags`)
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => {
        if (!cancelled) {
          setOllamaModels((data.models || []).map((m: { name: string }) => ({ id: m.name, provider: "ollama" as const, label: m.name })));
        }
      })
      .catch(() => !cancelled && setOllamaModels([]));
    return () => { cancelled = true; };
  }, [isOpen, apiKeys, ollamaUrl]);

  const hasKey = (p: LLMProvider) => p === "ollama" || !!apiKeys[p as keyof typeof apiKeys];
  const customOptions: ModelOption[] = Object.entries(customModels).flatMap(([prov, ids]) =>
    ids.map((id) => ({ id, provider: prov as LLMProvider, label: id, badge: "Custom" })));

  // Recommended first, then custom, then everything else the key can access
  const optionsFor = (p: LLMProvider): ModelOption[] => {
    const seen = new Set<string>();
    const all = [
      ...CURATED_MODELS.filter((m) => m.provider === p),
      ...customOptions.filter((m) => m.provider === p),
      ...(p === "ollama" ? ollamaModels : liveModels.filter((m) => m.provider === p)),
    ].filter((m) => !seen.has(m.id) && seen.add(m.id));
    const q = query.trim().toLowerCase();
    if (q) return all.filter((m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q));
    // Unfiltered: keep the list short — recommended + custom, or the first few local models
    return p === "ollama" ? all.slice(0, 6) : all.filter((m) => m.badge);
  };

  const allKnown = [...CURATED_MODELS, ...customOptions, ...liveModels, ...ollamaModels];
  const current = allKnown.find((m) => m.id === activeModel && m.provider === provider);
  const currentLabel = current?.label || activeModel || "Choose a model";

  const handleSelect = (p: LLMProvider, id: string) => {
    onSelect(p, id);
    setIsOpen(false);
  };

  const startAdding = () => {
    setCustomId(query.trim());
    setCustomProvider(guessProvider(query.trim(), provider));
    setAdding(true);
  };

  const submitCustom = () => {
    const id = customId.trim();
    if (!id) return;
    onAddCustomModel(customProvider, id);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
      >
        <span className="text-[11px]">{getProviderIcon(provider)}</span>
        <span className="truncate max-w-[180px]">{currentLabel}</span>
        <ChevronDownIcon className="w-3 h-3 opacity-60" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-[300px] bg-surface-elevated border border-border/60 rounded-xl shadow-[0_12px_40px_rgb(0,0,0,0.5)] z-50 flex flex-col overflow-hidden animate-view-enter">
          {adding ? (
            <div className="p-3 space-y-2.5">
              <div className="text-xs font-semibold text-text-primary">Add a custom model</div>
              <input
                autoFocus
                value={customId}
                onChange={(e) => { setCustomId(e.target.value); setCustomProvider(guessProvider(e.target.value, customProvider)); }}
                onKeyDown={(e) => { if (e.key === "Enter") submitCustom(); if (e.key === "Escape") setAdding(false); }}
                placeholder="Model ID, e.g. claude-opus-5"
                className="w-full bg-surface rounded-lg px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted outline-none focus:ring-1 focus:ring-primary/50"
              />
              <div className="flex gap-1">
                {PROVIDER_GROUPS.map(({ provider: p, label }) => (
                  <button
                    key={p}
                    onClick={() => setCustomProvider(p)}
                    className={`flex-1 px-1.5 py-1 rounded-md text-[10px] font-medium transition-colors ${
                      customProvider === p ? "bg-primary/20 text-primary" : "text-text-muted hover:text-text-primary hover:bg-surface"
                    }`}
                  >
                    {p === "ollama" ? "Local" : label}
                  </button>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary">Cancel</button>
                <button
                  onClick={submitCustom}
                  disabled={!customId.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-white disabled:opacity-40"
                >
                  Add model
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                <SearchIcon className="w-3.5 h-3.5 text-text-muted shrink-0" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search all models"
                  className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                />
              </div>
              <div className="max-h-[320px] overflow-y-auto px-1.5 pb-1.5 custom-scrollbar">
                {PROVIDER_GROUPS.filter(({ provider: p }) => hasKey(p)).map(({ provider: p, label }) => {
                  const options = optionsFor(p);
                  if (options.length === 0) return null;
                  return (
                    <div key={p} className="mt-1">
                      <div className="px-2 py-1 text-[10px] font-semibold text-text-muted">{label}</div>
                      {options.map((opt) => (
                        <button
                          key={`${opt.provider}-${opt.id}`}
                          onMouseDown={(e) => { e.preventDefault(); handleSelect(opt.provider, opt.id); }}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded-md flex items-center justify-between gap-2 transition-colors ${
                            activeModel === opt.id && provider === opt.provider
                              ? "bg-primary/15 text-primary font-medium"
                              : "text-text-primary hover:bg-surface-hover"
                          }`}
                        >
                          <span className="truncate">{opt.label}</span>
                          {opt.badge && <span className="text-[10px] text-text-muted shrink-0">{opt.badge}</span>}
                        </button>
                      ))}
                    </div>
                  );
                })}
                {!apiKeys.claude && !apiKeys.gemini && !apiKeys.openai && ollamaModels.length === 0 ? (
                  <div className="px-2 py-2 text-[11px] text-text-secondary leading-relaxed">
                    Add an API key in Settings to use Claude, Gemini, or OpenAI, or install Ollama to run models on this computer.
                  </div>
                ) : !query && (
                  <div className="px-2 pt-2 pb-1 text-[10px] text-text-muted">Search to see every model your keys can use.</div>
                )}
              </div>
              <button
                onMouseDown={(e) => { e.preventDefault(); startAdding(); }}
                className="flex items-center gap-1.5 px-3.5 py-2.5 text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                {query.trim() ? <>Add “{query.trim()}” as a custom model</> : "Add a custom model"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
