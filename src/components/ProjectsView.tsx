import { useState } from "react";
import type { Project } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

interface ProjectsViewProps {
  projects: Project[];
  onCreateProject: (name: string) => void;
  onOpenProject: (projectId: string) => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
}

export function ProjectsView({
  projects,
  onCreateProject,
  onOpenProject,
  onRenameProject,
  onDeleteProject,
}: ProjectsViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateProject(name);
    setNewName("");
    setShowCreate(false);
  };

  const handleRename = (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    onRenameProject(id, name);
    setRenamingId(null);
    setRenameValue("");
  };

  const sorted = [...projects].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-xl mx-auto py-10 px-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Projects</h1>
            <p className="text-sm text-text-secondary mt-1">
              Organize documents and reuse them across chats.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-dark text-white text-xs font-semibold rounded-lg transition-colors shadow-md"
          >
            + New Project
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="mb-6 bg-surface-elevated border border-primary/30 rounded-xl p-4 animate-view-enter">
            <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2 block">
              Project name
            </label>
            <div className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") setShowCreate(false); }}
                placeholder="e.g. 2026 Tax Filing"
                className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-primary transition-colors"
              />
              <button onClick={handleCreate} className="px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition-colors">
                Create
              </button>
              <button onClick={() => { setShowCreate(false); setNewName(""); }} className="px-3 py-2 bg-surface border border-border text-text-secondary text-xs rounded-lg hover:text-text-primary transition-colors">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Project list */}
        {sorted.length === 0 && !showCreate ? (
          <div className="text-center py-20">
            <div className="text-5xl mb-4 opacity-40">📁</div>
            <p className="text-text-muted text-sm mb-2">No projects yet.</p>
            <p className="text-text-muted text-xs">Create one to organize your documents.</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-6 px-4 py-2 bg-surface border border-border rounded-lg text-xs text-text-secondary hover:text-text-primary hover:border-primary/50 transition-all"
            >
              + New Project
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sorted.map((project) => {
              const docCount = Object.keys(project.attachments).length;
              const isRenaming = renamingId === project.id;

              return (
                <div
                  key={project.id}
                  onClick={() => !isRenaming && onOpenProject(project.id)}
                  className="group flex items-center justify-between p-4 rounded-xl bg-surface border border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-lg shrink-0">
                      📁
                    </div>
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") handleRename(project.id);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="bg-surface-elevated border border-primary/50 rounded-md px-2 py-1 text-sm text-text-primary outline-none w-full"
                        />
                      ) : (
                        <h3 className="text-sm font-semibold text-text-primary truncate">
                          {project.name}
                        </h3>
                      )}
                      <div className="text-xs text-text-muted mt-0.5">
                        {docCount} document{docCount !== 1 ? "s" : ""}
                        <span className="mx-1.5">·</span>
                        {new Date(project.updatedAt).toLocaleDateString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(project.id);
                        setRenameValue(project.name);
                      }}
                      className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-hover rounded-lg transition-colors"
                      title="Rename"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDelete(project);
                      }}
                      className="p-2 text-danger/70 hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}" and all its chats? This cannot be undone.`}
          onConfirm={() => { onDeleteProject(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
