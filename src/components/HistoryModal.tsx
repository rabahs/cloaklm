import React from 'react';
import type { ChatSession } from '../types';

interface HistoryModalProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  onSelect: (session: ChatSession) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function HistoryModal({ sessions, currentSessionId, onSelect, onDelete, onClose }: HistoryModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-surface-elevated w-full max-w-md rounded-2xl shadow-2xl border border-border shadow-black/40 overflow-hidden flex flex-col max-h-[80vh]"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface/50">
          <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
            <span>🕰️</span> Chat History
          </h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface text-text-secondary hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {sessions.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-sm">
              No previous chats found.
            </div>
          ) : (
            sessions.map((session) => (
              <div 
                key={session.id}
                onClick={() => onSelect(session)}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors group ${
                  currentSessionId === session.id 
                    ? 'bg-primary/10 border-primary/30 text-primary' 
                    : 'bg-surface border-border hover:border-primary/50 text-text-primary'
                }`}
              >
                <div className="flex-col overflow-hidden">
                  <div className="font-medium truncate">{session.title || 'New Conversation'}</div>
                  <div className="text-xs text-text-muted mt-1">
                    {new Date(session.updatedAt).toLocaleString()} • {session.messages.length} msgs
                  </div>
                </div>
                
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(session.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-2 text-danger/70 hover:text-danger hover:bg-danger/10 rounded-md transition-all ml-2"
                  title="Delete Session"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
