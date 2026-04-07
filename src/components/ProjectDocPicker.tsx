import { useState } from "react";
import type { Project, Attachment } from "../types";

interface ProjectDocPickerProps {
  projects: Project[];
  onSelect: (doc: Attachment) => void;
  onClose: () => void;
}

export function ProjectDocPicker({ projects, onSelect, onClose }: ProjectDocPickerProps) {
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    projects.length === 1 ? projects[0].id : null
  );

  const projectsWithDocs = projects.filter(
    (p) => Object.values(p.attachments).some((a) => a.status === "ready")
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-surface-elevated border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[70vh] flex flex-col animate-view-enter"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div>
            <h2 className="text-sm font-bold text-text-primary">Attach from Project</h2>
            <p className="text-[10px] text-text-muted mt-0.5">Select an already-redacted document</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-text-muted hover:text-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {projectsWithDocs.length === 0 ? (
            <div className="text-center py-12 text-text-muted text-xs">
              No projects with ready documents yet.
            </div>
          ) : (
            projectsWithDocs.map((project) => {
              const readyDocs = Object.values(project.attachments).filter(
                (a) => a.status === "ready"
              );
              const isExpanded = expandedProjectId === project.id;

              return (
                <div key={project.id} className="rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setExpandedProjectId(isExpanded ? null : project.id)}
                    className="w-full flex items-center justify-between p-3 hover:bg-surface-hover transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm">📁</span>
                      <div>
                        <div className="text-xs font-semibold text-text-primary">{project.name}</div>
                        <div className="text-[10px] text-text-muted">{readyDocs.length} ready</div>
                      </div>
                    </div>
                    <span className="text-text-muted text-xs">{isExpanded ? "▾" : "▸"}</span>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border bg-surface/50 p-2 space-y-1">
                      {readyDocs.map((doc) => (
                        <button
                          key={doc.id}
                          onClick={() => { onSelect(doc); onClose(); }}
                          className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-primary/10 transition-colors text-left group"
                        >
                          <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-[10px] font-bold text-red-400 shrink-0">
                            PDF
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-text-primary truncate">{doc.fileName}</div>
                            <div className="text-[10px] text-text-muted">
                              🛡️ {doc.redactionCount || 0} PII redacted
                            </div>
                          </div>
                          <span className="text-[10px] text-primary font-bold opacity-0 group-hover:opacity-100 transition-opacity uppercase">
                            Add
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
