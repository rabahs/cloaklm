import type { LLMProvider } from "../types";

const PROVIDERS: { value: LLMProvider; label: string; icon: string }[] = [
  { value: "claude", label: "Claude", icon: "🟣" },
  { value: "gemini", label: "Gemini", icon: "🔵" },
  { value: "openai", label: "GPT-4o", icon: "🟢" },
  { value: "ollama", label: "Local (Ollama)", icon: "🖥️" },
];

interface ChatHeaderProps {
  provider: LLMProvider;
  onProviderChange: (provider: LLMProvider) => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  availableProviders: LLMProvider[];
  hasApiKey: boolean;
  hasMessages: boolean;
}

export function ChatHeader({ 
  provider, 
  onProviderChange, 
  onOpenSettings, 
  onNewChat, 
  availableProviders,
  hasApiKey, 
  hasMessages 
}: ChatHeaderProps) {
  // Filter the list of providers based on what's available
  // If nothing is available, we show all (at least so they can see what's there before setting up)
  // or better, if nothing is available, the list might be empty, but the user should see at least one
  const filteredProviders = PROVIDERS.filter(p => availableProviders.includes(p.value));
  
  // Fallback: if no providers are available, show all but maybe they will be disabled or just show the current one
  const displayProviders = filteredProviders.length > 0 ? filteredProviders : PROVIDERS;

  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-elevated/80 backdrop-blur-sm"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
          <span className="text-lg">🛡️</span>
        </div>
        <h1 className="text-base font-semibold text-text-primary tracking-tight">
          CloakLM
        </h1>
        <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
          Beta
        </span>
      </div>

      <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        {/* New Chat button */}
        {hasMessages && (
          <button
            onClick={onNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
            title="Start a new conversation"
          >
            ✨ New Chat
          </button>
        )}
        {/* Provider selector with status indicator */}
        <div className="relative">
          <select
            value={provider}
            onChange={(e) => onProviderChange(e.target.value as LLMProvider)}
            className="bg-surface border border-border rounded-lg pl-3 pr-8 py-1.5 text-sm text-text-primary cursor-pointer outline-none focus:border-primary transition-colors appearance-none"
          >
            {displayProviders.map((p) => (
              <option key={p.value} value={p.value}>
                {p.icon} {p.label}
              </option>
            ))}
          </select>
          {/* Status dot */}
          <div
            className={`absolute right-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ${
              hasApiKey ? "bg-success animate-pulse" : "bg-danger"
            }`}
            title={hasApiKey ? "API key configured" : "No API key — click ⚙️"}
          />
        </div>

        <button
          onClick={onOpenSettings}
          className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all ${
            hasApiKey
              ? "bg-surface border-border text-text-secondary hover:text-text-primary hover:border-primary/50"
              : "bg-danger/10 border-danger/30 text-danger animate-pulse"
          }`}
          title="Settings — configure API keys"
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
