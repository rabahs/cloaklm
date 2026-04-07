

interface ChatHeaderProps {
  onNewChat: () => void;
  hasMessages: boolean;
  onExport: () => void;
  docCount: number;
}

export function ChatHeader({
  onNewChat,
  hasMessages,
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
          <>
            {docCount > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-[10px] font-bold text-primary uppercase tracking-wider">
                📄 {docCount} docs
              </span>
            )}
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
              title="Export transcript"
            >
              📤 Export
            </button>
            <button
              onClick={onNewChat}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-medium text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
              title="New conversation (Cmd+N)"
            >
              ✨ New Chat
            </button>
          </>
        )}
      </div>
    </header>
  );
}
