

interface ChatHeaderProps {
  onNewChat: () => void;
  hasMessages: boolean;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onExport: () => void;
  docCount: number;
}

export function ChatHeader({
  onNewChat,
  hasMessages,
  isSidebarOpen,
  onToggleSidebar,
  onExport,
  docCount,
}: ChatHeaderProps) {
  return (
    <header
      className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface-elevated/80 backdrop-blur-sm"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2.5">
        <h1 className="text-sm font-semibold text-text-primary tracking-tight">
          CloakLM
        </h1>
        <span className="text-[10px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full uppercase tracking-wider">
          Beta
        </span>
      </div>

      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        {hasMessages && (
          <button
            onClick={onNewChat}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
            title="New conversation (Cmd+N)"
          >
            ✨ New Chat
          </button>
        )}

        {hasMessages && (
          <button
            onClick={onExport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
            title="Export transcript"
          >
            📤 Export
          </button>
        )}

        <button
          onClick={onToggleSidebar}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
            isSidebarOpen
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-surface border-border text-text-secondary hover:text-text-primary hover:border-primary/50"
          }`}
          title={
            isSidebarOpen
              ? "Close Documents Sidebar (Cmd+D)"
              : "Open Documents Sidebar (Cmd+D)"
          }
        >
          <span>📄</span>
          <span>Docs</span>
          {docCount > 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] bg-primary text-white text-[10px] font-bold rounded-full px-1">
              {docCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}
