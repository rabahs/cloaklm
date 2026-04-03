

interface ChatHeaderProps {
  onOpenSettings: () => void;
  onNewChat: () => void;
  hasApiKey: boolean;
  hasMessages: boolean;
  onOpenHistory: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  docCount: number;
}

export function ChatHeader({ 
  onOpenSettings, 
  onNewChat, 
  hasApiKey, 
  hasMessages,
  onOpenHistory,
  isSidebarOpen,
  onToggleSidebar,
  docCount
}: ChatHeaderProps) {


  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-elevated/80 backdrop-blur-sm"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center shadow-sm">
          <img src="/logo.png" alt="CloakLM Map Logo" className="w-full h-full object-cover" />
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

        <button
          onClick={onOpenHistory}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
          title="View Past Conversations"
        >
          🕰️ History
        </button>

        <button
          onClick={onToggleSidebar}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            isSidebarOpen 
              ? "bg-primary/10 border-primary/30 text-primary" 
              : "bg-surface border-border text-text-secondary hover:text-text-primary hover:border-primary/50"
          }`}
          title={isSidebarOpen ? "Close Documents Sidebar" : "Open Documents Sidebar"}
        >
          <span>📄</span>
          <span>Docs</span>
          {docCount > 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] bg-primary text-white text-[10px] font-bold rounded-full px-1">
              {docCount}
            </span>
          )}
        </button>

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
