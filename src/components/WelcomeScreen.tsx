import type { ReactNode } from "react";
import type { Project } from "../types";
import { FolderIcon, PlusIcon } from "./Icons";

interface WelcomeScreenProps {
  projects?: Project[];
  onOpenProject?: (projectId: string) => void;
  onStartProjectChat?: (projectId: string) => void;
  onCreateProject?: (name: string) => void;
  /** Rendered in the center of the screen (the chat composer). */
  composer?: ReactNode;
  /** Shown above the composer while the local engine starts. */
  status?: ReactNode;
}

export function WelcomeScreen({ projects, onOpenProject, onStartProjectChat, onCreateProject, composer, status }: WelcomeScreenProps) {
  const recentProjects = projects
    ? [...projects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 4)
    : [];
  const showProjects = !!projects && !!onOpenProject && !!onStartProjectChat && !!onCreateProject;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="" className="w-11 h-11 rounded-xl mx-auto mb-5" />
            <h1 className="text-[28px] font-semibold tracking-tight text-text-primary mb-2">
              What would you like to know?
            </h1>
            <p className="text-text-secondary text-sm leading-relaxed max-w-md mx-auto">
              Ask about tax forms, bills, and statements. Names, SSNs, and addresses are
              removed <span className="text-text-primary">on this computer</span> before any AI sees them.
            </p>
          </div>

          {status && <div className="mb-3">{status}</div>}
          {composer}

          {showProjects && (
            <section className="mt-10">
              <div className="flex items-center justify-between mb-3 px-1">
                <h2 className="text-xs font-medium text-text-secondary">
                  {recentProjects.length > 0 ? "Recent projects" : "Projects"}
                </h2>
                <button
                  onClick={() => onCreateProject!(`Project ${projects!.length + 1}`)}
                  className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors"
                >
                  <PlusIcon className="w-3.5 h-3.5" /> New project
                </button>
              </div>

              {recentProjects.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {recentProjects.map((p) => {
                    const docCount = Object.keys(p.attachments).length;
                    return (
                      <div
                        key={p.id}
                        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-surface-elevated/50 hover:bg-surface-elevated transition-colors"
                      >
                        <button onClick={() => onOpenProject!(p.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                          <FolderIcon className="w-4 h-4 text-text-muted shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm text-text-primary truncate">{p.name}</div>
                            <div className="text-[11px] text-text-muted">
                              {docCount} {docCount === 1 ? "document" : "documents"} · {new Date(p.updatedAt).toLocaleDateString()}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={() => onStartProjectChat!(p.id)}
                          className="px-2.5 py-1 rounded-md text-[11px] font-medium text-primary-light hover:bg-primary/15 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0"
                        >
                          Chat
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-text-muted px-1">
                  Projects keep related documents and chats together, like a folder for this year's taxes.
                </p>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
