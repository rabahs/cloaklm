import { ExportIcon, PenIcon } from "./Icons";

interface ChatHeaderProps {
  onNewChat: () => void;
  hasMessages: boolean;
  onExport: () => void;
  docCount: number;
}

/** Slim, borderless bar shown only during a conversation; the window title already says CloakLM. */
export function ChatHeader({ onNewChat, hasMessages, onExport, docCount }: ChatHeaderProps) {
  if (!hasMessages) return null;
  return (
    <header
      className="flex items-center justify-end gap-1 px-4 py-2"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        {docCount > 0 && (
          <span className="px-2 text-[11px] text-text-muted">
            {docCount} {docCount === 1 ? "document" : "documents"}
          </span>
        )}
        <button
          onClick={onExport}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="Export transcript"
        >
          <ExportIcon className="w-3.5 h-3.5" /> Export
        </button>
        <button
          onClick={onNewChat}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
          title="New conversation (Cmd+N)"
        >
          <PenIcon className="w-3.5 h-3.5" /> New chat
        </button>
      </div>
    </header>
  );
}
