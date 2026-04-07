import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { LLMProvider, AppSettings } from "../types";

interface SettingsViewProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  isOllamaAvailable: boolean;
}

const PROVIDERS: {
  key: LLMProvider;
  name: string;
  icon: string;
  keyPlaceholder: string;
  description: string;
}[] = [
  {
    key: "claude",
    name: "Anthropic Claude",
    icon: "🟣",
    keyPlaceholder: "sk-ant-api03-...",
    description: "Claude Sonnet — best for careful, nuanced analysis",
  },
  {
    key: "gemini",
    name: "Google Gemini",
    icon: "🔵",
    keyPlaceholder: "AIza...",
    description: "Gemini Flash — fast and cost-effective",
  },
  {
    key: "openai",
    name: "OpenAI",
    icon: "🟢",
    keyPlaceholder: "sk-proj-...",
    description: "GPT-4o — strong general-purpose model",
  },
  {
    key: "ollama",
    name: "Ollama (Local)",
    icon: "🖥️",
    keyPlaceholder: "",
    description: "100% offline — no API key needed",
  },
];

export function SettingsView({ settings, onSave, isOllamaAvailable }: SettingsViewProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  // Fetch Ollama models for deep scan picker
  useEffect(() => {
    if (!isOllamaAvailable) return;
    fetch(`${draft.ollamaUrl}/api/tags`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.models) {
          const models = data.models.map((m: { name: string }) => m.name);
          setOllamaModels(models);
          // Auto-correct model if current selection isn't available
          if (models.length > 0 && draft.deepScan?.model && !models.includes(draft.deepScan.model)) {
            setDraft(d => ({ ...d, deepScan: { ...d.deepScan!, model: models[0] } }));
          }
        }
      })
      .catch(() => {});
  }, [draft.ollamaUrl, isOllamaAvailable]);

  const handleKeyChange = (provider: LLMProvider, value: string) => {
    setDraft((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: value },
    }));
    setSaved(false);
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleSave = () => {
    onSave(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const isKeySet = (provider: LLMProvider) => {
    if (provider === "ollama") return isOllamaAvailable;
    return !!draft.apiKeys[provider as keyof typeof draft.apiKeys]?.trim();
  };

  const isDirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto py-10 px-6">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-text-primary">Settings</h1>
          <p className="text-sm text-text-secondary mt-1">
            Configure your AI providers. Keys are stored locally on your device.
          </p>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 mb-6">
          <p className="text-xs text-text-secondary leading-relaxed">
            <strong className="text-primary">🔒 Privacy guarantee:</strong> Your API keys are stored{" "}
            <strong>only on this device</strong>. CloakLM connects directly to the provider — no middleman server.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {PROVIDERS.map((p) => (
            <div
              key={p.key}
              className={`bg-surface border rounded-xl p-4 transition-colors ${
                isKeySet(p.key) ? "border-success/30" : "border-border"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{p.icon}</span>
                  <div>
                    <span className="text-sm font-semibold text-text-primary">{p.name}</span>
                    <p className="text-[10px] text-text-muted">{p.description}</p>
                  </div>
                </div>
                {isKeySet(p.key) && (
                  <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full uppercase">
                    ✓ Ready
                  </span>
                )}
              </div>

              {p.key === "ollama" ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={draft.ollamaUrl}
                      onChange={(e) => { setDraft((d) => ({ ...d, ollamaUrl: e.target.value })); setSaved(false); }}
                      placeholder="http://localhost:11434"
                      className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <p className="text-[10px] text-text-muted">Server URL (Select Model in Chat Header)</p>
                </div>
              ) : (
                <div className="relative">
                  <input
                    type={showKeys[p.key] ? "text" : "password"}
                    value={draft.apiKeys[p.key as keyof typeof draft.apiKeys] || ""}
                    onChange={(e) => handleKeyChange(p.key, e.target.value)}
                    placeholder={p.keyPlaceholder}
                    className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 pr-10 text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-primary transition-colors"
                  />
                  <button
                    onClick={() => toggleShowKey(p.key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary text-xs"
                    title={showKeys[p.key] ? "Hide" : "Show"}
                  >
                    {showKeys[p.key] ? "🙈" : "👁️"}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Deep Scan Section */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            🔍 Deep Scan
            <span className="text-[10px] font-medium text-text-muted">(Local LLM)</span>
          </h2>
          <div className={`bg-surface border rounded-xl p-4 transition-colors ${draft.deepScan?.enabled ? "border-primary/30" : "border-border"}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Use a local Ollama model to scan for PII that GLiNER missed — names, addresses, SSN fragments.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="deepScan"
                  checked={!draft.deepScan?.enabled}
                  onChange={() => { setDraft(d => ({ ...d, deepScan: { enabled: false, model: d.deepScan?.model || ollamaModels[0] || "llama3.2" } })); setSaved(false); }}
                  className="accent-primary"
                />
                <div>
                  <span className="text-xs font-medium text-text-primary">Off</span>
                  <span className="text-[10px] text-text-muted ml-2">GLiNER only (faster)</span>
                </div>
              </label>
              <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-hover cursor-pointer transition-colors">
                <input
                  type="radio"
                  name="deepScan"
                  checked={!!draft.deepScan?.enabled}
                  onChange={() => { setDraft(d => ({ ...d, deepScan: { enabled: true, model: d.deepScan?.model || ollamaModels[0] || "llama3.2" } })); setSaved(false); }}
                  className="accent-primary"
                />
                <div>
                  <span className="text-xs font-medium text-text-primary">On</span>
                  <span className="text-[10px] text-text-muted ml-2">GLiNER + local LLM second pass</span>
                </div>
              </label>

              {draft.deepScan?.enabled && (
                <div className="pl-8 space-y-2 animate-view-enter">
                  <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Model</label>
                  <select
                    value={draft.deepScan.model}
                    onChange={(e) => { setDraft(d => ({ ...d, deepScan: { ...d.deepScan!, model: e.target.value } })); setSaved(false); }}
                    className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-primary transition-colors"
                  >
                    {ollamaModels.length > 0 ? (
                      ollamaModels.map(m => <option key={m} value={m}>{m}</option>)
                    ) : (
                      <option value={draft.deepScan.model}>{draft.deepScan.model}</option>
                    )}
                  </select>
                  {!isOllamaAvailable && (
                    <p className="text-[10px] text-warning">Ollama is not running. Start it to use Deep Scan.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Storage Location */}
        <div className="mb-8">
          <h2 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
            💾 Document Storage
          </h2>
          <div className="bg-surface border border-border rounded-xl p-4">
            <p className="text-xs text-text-secondary leading-relaxed mb-3">
              Where anonymized project documents are stored on disk.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                value={draft.storageDir || "~/Documents/CloakLM"}
                readOnly
                className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary outline-none"
              />
              <button
                onClick={async () => {
                  try {
                    const selected = await open({ directory: true, title: "Choose storage location" });
                    if (selected && typeof selected === "string") {
                      setDraft((d) => ({ ...d, storageDir: selected }));
                      setSaved(false);
                    }
                  } catch { /* user cancelled */ }
                }}
                className="px-3 py-2 bg-surface-elevated border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all shrink-0"
              >
                Browse...
              </button>
            </div>
            <p className="text-[10px] text-text-muted mt-2">
              Default: ~/Documents/CloakLM
            </p>
          </div>
        </div>

        {/* Save button (sticky at bottom of content) */}
        <button
          onClick={handleSave}
          disabled={!isDirty && !saved}
          className={`w-full py-2.5 rounded-xl font-medium transition-all ${
            saved
              ? "bg-success/20 text-success border border-success/30"
              : isDirty
                ? "bg-primary hover:bg-primary-dark text-white shadow-md"
                : "bg-surface border border-border text-text-muted cursor-not-allowed"
          }`}
        >
          {saved ? "✓ Saved" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
