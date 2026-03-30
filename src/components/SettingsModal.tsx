import { useState } from "react";
import type { LLMProvider, AppSettings } from "../types";

interface SettingsModalProps {
  settings: AppSettings;
  onSave: (settings: AppSettings) => void;
  onClose: () => void;
}

const PROVIDERS: {
  key: LLMProvider;
  name: string;
  icon: string;
  color: string;
  keyPlaceholder: string;
  description: string;
}[] = [
  {
    key: "claude",
    name: "Anthropic Claude",
    icon: "🟣",
    color: "purple",
    keyPlaceholder: "sk-ant-api03-...",
    description: "Claude Sonnet — best for careful, nuanced analysis",
  },
  {
    key: "gemini",
    name: "Google Gemini",
    icon: "🔵",
    color: "blue",
    keyPlaceholder: "AIza...",
    description: "Gemini Flash — fast and cost-effective",
  },
  {
    key: "openai",
    name: "OpenAI",
    icon: "🟢",
    color: "green",
    keyPlaceholder: "sk-proj-...",
    description: "GPT-4o — strong general-purpose model",
  },
  {
    key: "ollama",
    name: "Ollama (Local)",
    icon: "🖥️",
    color: "gray",
    keyPlaceholder: "",
    description: "100% offline — no API key needed",
  },
];

export function SettingsModal({ settings, onSave, onClose }: SettingsModalProps) {
  const [draft, setDraft] = useState<AppSettings>({ ...settings });
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});

  const handleKeyChange = (provider: LLMProvider, value: string) => {
    setDraft((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: value },
    }));
  };

  const toggleShowKey = (provider: string) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleSave = () => {
    onSave(draft);
    onClose();
  };

  const isKeySet = (provider: LLMProvider) => {
    if (provider === "ollama") return true;
    return !!draft.apiKeys[provider as keyof typeof draft.apiKeys]?.trim();
  };

  return (
    <div className="absolute inset-0 z-[100] bg-surface/80 backdrop-blur-sm flex items-center justify-center p-8">
      <div className="w-full max-w-lg bg-surface-elevated border border-border rounded-2xl shadow-2xl flex flex-col max-h-[80vh] animate-[scale-in_0.2s_ease-out]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Configure your AI providers. Keys are stored locally on your device.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface border border-border text-text-secondary hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3">
            <p className="text-xs text-text-secondary leading-relaxed">
              <strong className="text-primary">🔒 Privacy guarantee:</strong> Your API keys are stored{" "}
              <strong>only on this device</strong>. CloakLM connects directly to the provider — no middleman server.
            </p>
          </div>

          {PROVIDERS.map((p) => (
            <div
              key={p.key}
              className={`bg-surface border rounded-xl p-4 transition-colors ${
                isKeySet(p.key)
                  ? "border-success/30"
                  : "border-border"
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
                      onChange={(e) => setDraft((d) => ({ ...d, ollamaUrl: e.target.value }))}
                      placeholder="http://localhost:11434"
                      className="flex-1 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-primary transition-colors"
                    />
                    <input
                      type="text"
                      value={draft.ollamaModel}
                      onChange={(e) => setDraft((d) => ({ ...d, ollamaModel: e.target.value }))}
                      placeholder="llama3"
                      className="w-28 bg-surface-elevated border border-border rounded-lg px-3 py-2 text-xs font-mono text-text-primary placeholder:text-text-muted outline-none focus:border-primary transition-colors"
                    />
                  </div>
                  <p className="text-[10px] text-text-muted">Server URL + Model name</p>
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

        {/* Footer */}
        <div className="p-6 border-t border-border flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-surface border border-border text-text-secondary rounded-lg font-medium hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>

      <style>{`
        @keyframes scale-in {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
