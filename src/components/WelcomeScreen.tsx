import type { Project } from "../types";

interface WelcomeScreenProps {
  projects?: Project[];
  onOpenProject?: (projectId: string) => void;
  onStartProjectChat?: (projectId: string) => void;
  onCreateProject?: (name: string) => void;
}

export function WelcomeScreen({ projects, onOpenProject, onStartProjectChat, onCreateProject }: WelcomeScreenProps) {
  const recentProjects = projects
    ? [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 4)
    : [];

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full text-center">
        <div className="w-20 h-20 rounded-2xl bg-surface-elevated/50 flex items-center justify-center mx-auto mb-6 shadow-sm border border-border overflow-hidden">
          <img src="/logo.png" alt="CloakLM Logo" className="w-full h-full object-cover" />
        </div>

        <h2 className="text-2xl font-bold text-text-primary mb-3">
          Welcome to CloakLM
        </h2>
        <p className="text-text-secondary text-base leading-relaxed mb-8">
          Your documents are anonymized{" "}
          <span className="text-primary font-medium">on your device</span>{" "}
          before the AI sees them.
        </p>

        {/* Two entry paths */}
        {onCreateProject && projects && (
          <div className="grid grid-cols-2 gap-4 mb-8 max-w-lg mx-auto">
            <button
              onClick={() => {
                const textarea = document.querySelector('textarea');
                textarea?.focus();
              }}
              className="bg-surface-elevated border border-border rounded-xl p-5 text-left hover:border-primary/40 transition-all group cursor-pointer"
            >
              <div className="text-2xl mb-3">📎</div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">Quick Chat</h3>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Drop a PDF below for a one-off conversation. No project needed.
              </p>
            </button>
            <button
              onClick={() => onCreateProject(`Project ${projects.length + 1}`)}
              className="bg-surface-elevated border border-border rounded-xl p-5 text-left hover:border-primary/40 transition-all group cursor-pointer"
            >
              <div className="text-2xl mb-3">📁</div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">New Project</h3>
              <p className="text-[11px] text-text-muted leading-relaxed">
                Organize documents & chats together for ongoing work.
              </p>
            </button>
          </div>
        )}

        {/* Recent Projects */}
        {recentProjects.length > 0 && onOpenProject && onStartProjectChat && (
          <div className="max-w-lg mx-auto mb-8">
            <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-3 text-left">
              Recent Projects
            </h3>
            <div className="space-y-2">
              {recentProjects.map((p) => {
                const docCount = Object.keys(p.attachments).length;
                return (
                  <div
                    key={p.id}
                    className="group flex items-center justify-between p-3 rounded-xl bg-surface border border-border hover:border-primary/40 transition-all"
                  >
                    <button
                      onClick={() => onOpenProject(p.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm shrink-0">
                        📁
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-text-primary truncate">{p.name}</div>
                        <div className="text-[10px] text-text-muted">
                          {docCount} {docCount === 1 ? "doc" : "docs"}
                          <span className="mx-1">·</span>
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                    </button>
                    <button
                      onClick={() => onStartProjectChat(p.id)}
                      className="px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-lg text-[10px] font-bold text-primary hover:bg-primary/20 transition-all uppercase tracking-wider opacity-0 group-hover:opacity-100 shrink-0 ml-2"
                    >
                      Chat
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border-2 border-dashed border-border rounded-2xl p-8 hover:border-primary/40 transition-colors cursor-default max-w-lg mx-auto">
          <p className="text-text-muted text-sm">
            📎 Drop a PDF here or type a message below
          </p>
        </div>
      </div>
    </div>
  );
}
