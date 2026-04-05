import { useState } from "react";
import type { ChatSession, Project } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

interface HistoryViewProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  projects: Project[];
  onSelect: (session: ChatSession) => void;
  onDelete: (id: string) => void;
}

export function HistoryView({ sessions, currentSessionId, projects, onSelect, onDelete }: HistoryViewProps) {
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p]));
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto py-10 px-6">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-text-primary">Chat History</h1>
          <p className="text-sm text-text-secondary mt-1">
            {sessions.length} conversation{sessions.length !== 1 ? "s" : ""}
          </p>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-4 opacity-40">🕰️</div>
            <p className="text-text-muted text-sm">No conversations yet.</p>
            <p className="text-text-muted text-xs mt-1">Start a chat and it will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => onSelect(session)}
                className={`flex items-center justify-between p-4 rounded-xl border cursor-pointer transition-all group ${
                  currentSessionId === session.id
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-surface border-border hover:border-primary/50 text-text-primary hover:shadow-md"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-sm">
                    {session.title || "New Conversation"}
                  </div>
                  <div className="text-xs text-text-muted mt-1 flex items-center gap-2">
                    <span>{new Date(session.updatedAt).toLocaleDateString()}</span>
                    <span>·</span>
                    <span>{session.messages.length} messages</span>
                    {session.historyAttachments && Object.keys(session.historyAttachments).length > 0 && (
                      <>
                        <span>·</span>
                        <span>📄 {Object.keys(session.historyAttachments).length} docs</span>
                      </>
                    )}
                    {session.projectId && projectMap[session.projectId] && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full font-medium">
                        📁 {projectMap[session.projectId].name}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-2 text-danger/70 hover:text-danger hover:bg-danger/10 rounded-lg transition-all ml-3 shrink-0"
                  title="Delete"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          message="Delete this conversation?"
          onConfirm={() => { onDelete(confirmDeleteId); setConfirmDeleteId(null); }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </div>
  );
}
