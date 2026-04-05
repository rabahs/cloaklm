import { useState, useRef, useCallback, useEffect } from "react";
import type { Project, Attachment, ChatSession, Message, LLMProvider, AppSettings, RedactionEntry } from "../types";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";
import { WelcomeScreen } from "./WelcomeScreen";
import { DropOverlay } from "./DropOverlay";
import { callLLM, deepScanWithLLM } from "../llm";
import { ConfirmDialog } from "./ConfirmDialog";

interface ProjectDetailViewProps {
  project: Project;
  chatSessions: ChatSession[];
  settings: AppSettings;
  sidecarPort: number;
  engineStatus: "loading" | "ready" | "error";
  onBack: () => void;
  onUpdateProject: (updater: Project | ((prev: Project) => Project)) => void;
  onReviewAttachment: (attachment: Attachment) => void;
  onSaveChatSession: (session: ChatSession) => void;
  onDeleteChatSession: (id: string) => void;
  onSelectModel: (provider: LLMProvider, modelId: string) => void;
  addCustomModel: (provider: LLMProvider, modelId: string) => void;
}

type Tab = "documents" | "chats";

export function ProjectDetailView({
  project,
  chatSessions,
  settings,
  sidecarPort,
  engineStatus,
  onBack,
  onUpdateProject,
  onReviewAttachment,
  onSaveChatSession,
  onDeleteChatSession,
  onSelectModel,
  addCustomModel,
}: ProjectDetailViewProps) {
  const [tab, setTab] = useState<Tab>("documents");
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeAttachmentIds, setActiveAttachmentIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<Attachment | null>(null);
  const [confirmDeleteChat, setConfirmDeleteChat] = useState<string | null>(null);

  const projectChats = chatSessions.filter((s) => s.projectId === project.id);
  const projectDocs = Object.values(project.attachments);
  const provider = settings.provider;

  // When opening a chat, load its state
  const openChat = useCallback((session: ChatSession) => {
    setActiveChatId(session.id);
    setMessages(session.messages);
    setActiveAttachmentIds(session.activeAttachmentIds || Object.keys(project.attachments));
    setTab("chats");
  }, [project.attachments]);

  const startNewChat = useCallback(() => {
    setActiveChatId(null);
    setMessages([]);
    setActiveAttachmentIds(Object.keys(project.attachments));
    setTab("chats");
  }, [project.attachments]);

  // Auto-save chat when messages change
  useEffect(() => {
    if (messages.length === 0) return;

    let chatId = activeChatId;
    if (!chatId) {
      chatId = crypto.randomUUID();
      setActiveChatId(chatId);
    }

    let title = messages.find((m) => m.role === "user")?.content.substring(0, 40) || "New Conversation";
    if (title.length >= 40) title += "...";

    onSaveChatSession({
      id: chatId,
      title,
      updatedAt: new Date().toISOString(),
      messages,
      attachments: [],
      historyAttachments: {},
      projectId: project.id,
      activeAttachmentIds,
    });
  }, [messages]);

  // Toggle a document in/out of active context
  const toggleAttachment = useCallback((attachmentId: string) => {
    setActiveAttachmentIds((prev) =>
      prev.includes(attachmentId)
        ? prev.filter((id) => id !== attachmentId)
        : [...prev, attachmentId]
    );
  }, []);

  // Get active attachment objects
  const getActiveAttachments = useCallback((): Attachment[] => {
    return activeAttachmentIds
      .map((id) => project.attachments[id])
      .filter((a): a is Attachment => !!a && a.status === "ready");
  }, [activeAttachmentIds, project.attachments]);

  // Send message
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() && pendingAttachments.length === 0) return;

      const activeAtts = getActiveAttachments();
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        attachments: activeAtts.length > 0 ? activeAtts : undefined,
        provider,
      };

      setMessages((prev) => [...prev, userMessage]);
      setPendingAttachments([]);
      setIsLoading(true);

      try {
        const rawResponse = await callLLM({
          provider,
          apiKeys: settings.apiKeys,
          ollamaUrl: settings.ollamaUrl,
          activeModel: settings.activeModels?.[provider] || "unknown",
          messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
          attachments: activeAtts,
        });

        const aiMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: rawResponse,
          timestamp: new Date(),
          provider,
          modelId: settings.activeModels?.[provider] || "unknown",
          attachments: activeAtts,
        };
        setMessages((prev) => [...prev, aiMessage]);
      } catch (error) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: `⚠️ ${error instanceof Error ? error.message : "Failed to get response."}`,
            timestamp: new Date(),
            provider,
            modelId: settings.activeModels?.[provider] || "unknown",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [messages, provider, settings, getActiveAttachments, pendingAttachments]
  );

  // Anonymize string helper
  const anonymizeString = (text: string, redactionMap: Record<string, RedactionEntry> = {}) => {
    let result = text;
    for (const entry of Object.values(redactionMap)) {
      if (entry.real_value.length > 2) {
        result = result.split(entry.real_value).join(entry.placeholder);
      }
    }
    return result;
  };

  // File handling for project documents
  const handleProjectFiles = useCallback(
    (files: (File | string)[]) => {
      const pdfFiles = files.filter((f) => {
        const name = typeof f === "string" ? f : f.name;
        const type = typeof f === "string" ? "" : f.type;
        return type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
      });

      pdfFiles.forEach(async (fileObj) => {
        const isPath = typeof fileObj === "string";
        const fileName = isPath ? fileObj.split(/[/\\]/).pop() || fileObj : fileObj.name;

        const attachmentId = crypto.randomUUID();
        const attachment: Attachment = {
          id: attachmentId,
          fileName,
          originalPath: isPath ? fileObj : fileName,
          status: "anonymizing",
        };

        // Helper to atomically update one attachment in the project
        const updateAtt = (att: Attachment) => {
          onUpdateProject((prev: Project) =>
            prev.id !== project.id ? prev : {
              ...prev,
              updatedAt: new Date().toISOString(),
              attachments: { ...prev.attachments, [attachmentId]: att },
            }
          );
        };

        // Add to project immediately
        updateAtt(attachment);

        try {
          const formData = new FormData();
          if (isPath) formData.append("file_path", fileObj);
          else formData.append("file", fileObj);

          const response = await fetch(`http://127.0.0.1:${sidecarPort}/api/process`, {
            method: "POST",
            body: formData,
          });

          if (!response.ok) throw new Error(await response.text());

          const data = await response.json();
          const readyAttachment: Attachment = {
            ...attachment,
            status: "ready",
            redactionCount: data.redaction_count,
            anonymizedContent: data.anonymized_markdown,
            anonymizedFileName: anonymizeString(fileName, data.redaction_map),
            redactionMap: data.redaction_map,
          };

          updateAtt(readyAttachment);

          // Deep scan if enabled
          if (settings.deepScan?.enabled && readyAttachment.anonymizedContent) {
            updateAtt({ ...readyAttachment, status: "deep-scanning" });

            try {
              const suggestions = await deepScanWithLLM(
                readyAttachment.anonymizedContent,
                settings.ollamaUrl,
                settings.deepScan.model
              );
              updateAtt({ ...readyAttachment, status: "ready", deepScanSuggestions: suggestions });
            } catch (e) {
              console.warn("Deep scan failed:", e);
              updateAtt(readyAttachment);
            }
          }
        } catch {
          updateAtt({ ...attachment, status: "error", error: "Anonymizer failed." });
        }
      });
    },
    [project, sidecarPort, onUpdateProject, settings]
  );

  const removeProjectAttachment = useCallback(
    (attachmentId: string) => {
      onUpdateProject((prev: Project) => {
        if (prev.id !== project.id) return prev;
        const { [attachmentId]: _, ...rest } = prev.attachments;
        return { ...prev, updatedAt: new Date().toISOString(), attachments: rest };
      });
      setActiveAttachmentIds((prev) => prev.filter((id) => id !== attachmentId));
    },
    [project.id, onUpdateProject]
  );

  // Drag handlers for documents tab
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      dragCounter.current = 0;
      handleProjectFiles(Array.from(e.dataTransfer.files));
    },
    [handleProjectFiles]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleProjectFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const showChatList = tab === "chats" && activeChatId === null && messages.length === 0 && !isLoading;

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      onDragEnter={tab === "documents" ? handleDragEnter : undefined}
      onDragLeave={tab === "documents" ? handleDragLeave : undefined}
      onDragOver={tab === "documents" ? handleDragOver : undefined}
      onDrop={tab === "documents" ? handleDrop : undefined}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between px-5 py-2.5 border-b border-border bg-surface-elevated/80 backdrop-blur-sm"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            onClick={activeChatId ? () => { setActiveChatId(null); setMessages([]); } : onBack}
            className="text-text-muted hover:text-text-primary transition-colors text-sm mr-1"
            title="Back"
          >
            ←
          </button>
          <h1 className="text-sm font-semibold text-text-primary truncate max-w-xs">
            {project.name}
          </h1>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          {/* Tabs */}
          <button
            onClick={() => { setTab("documents"); setActiveChatId(null); setMessages([]); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              tab === "documents"
                ? "bg-primary/15 text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            📄 Documents ({projectDocs.length})
          </button>
          <button
            onClick={() => { if (activeChatId) return; setTab("chats"); }}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
              tab === "chats"
                ? "bg-primary/15 text-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            💬 Chats ({projectChats.length})
          </button>
        </div>
      </header>

      {/* Content */}
      {tab === "documents" ? (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-xl mx-auto">
            {/* Drop zone */}
            <input type="file" multiple accept=".pdf" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full mb-6 border-2 border-dashed border-border rounded-xl p-6 text-center hover:border-primary/40 transition-colors cursor-pointer group"
            >
              <div className="text-3xl mb-2 opacity-60 group-hover:opacity-100 transition-opacity">📎</div>
              <p className="text-sm text-text-muted group-hover:text-text-secondary transition-colors">
                Drop PDFs here or click to browse
              </p>
            </button>

            {/* Document list */}
            {projectDocs.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-xs">
                No documents yet. Drop a PDF above to get started.
              </div>
            ) : (
              <div className="space-y-3">
                {projectDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="group flex items-center justify-between p-3 rounded-xl bg-surface border border-border hover:border-primary/40 transition-all"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-xs font-bold text-red-400 shrink-0">
                        PDF
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xs font-semibold text-text-primary truncate" title={doc.fileName}>
                          {doc.fileName}
                        </h3>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-tighter px-1.5 py-0.5 rounded ${
                              doc.status === "ready"
                                ? "bg-success/10 text-success"
                                : doc.status === "anonymizing"
                                  ? "bg-primary/10 text-primary animate-pulse"
                                  : doc.status === "deep-scanning"
                                    ? "bg-blue-500/10 text-blue-400 animate-pulse"
                                    : "bg-danger/10 text-danger"
                            }`}
                          >
                            {doc.status === "anonymizing" ? "Pass 1 · GLiNER" :
                             doc.status === "deep-scanning" ? `Pass 2 · Deep Scan` :
                             doc.status}
                          </span>
                          {doc.redactionCount !== undefined && doc.redactionCount > 0 && (
                            <span className="text-[10px] text-text-muted">
                              🛡️ {doc.redactionCount} PII
                            </span>
                          )}
                          {doc.deepScanSuggestions && doc.deepScanSuggestions.filter(s => s.status === "pending").length > 0 && (
                            <span className="text-[10px] text-warning font-semibold">
                              🔍 {doc.deepScanSuggestions.filter(s => s.status === "pending").length} suggestions
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {doc.status === "ready" && (
                        <button
                          onClick={() => onReviewAttachment(doc)}
                          className="px-2.5 py-1.5 bg-surface-elevated border border-border rounded-lg text-[10px] font-bold text-text-secondary hover:text-primary hover:border-primary/50 transition-all uppercase tracking-wider"
                        >
                          Review
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDeleteDoc(doc)}
                        className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {isDragging && <DropOverlay />}
        </div>
      ) : showChatList ? (
        /* Chat list */
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-xl mx-auto">
            <button
              onClick={startNewChat}
              className="w-full mb-6 flex items-center justify-center gap-2 py-3 bg-primary hover:bg-primary-dark text-white text-sm font-semibold rounded-xl transition-colors shadow-md"
            >
              ✨ New Chat
            </button>

            {projectChats.length === 0 ? (
              <div className="text-center py-12 text-text-muted text-xs">
                No chats yet. Start one to ask questions about your documents.
              </div>
            ) : (
              <div className="space-y-2">
                {projectChats
                  .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                  .map((session) => (
                    <div
                      key={session.id}
                      onClick={() => openChat(session)}
                      className="group flex items-center justify-between p-4 rounded-xl bg-surface border border-border hover:border-primary/40 hover:shadow-md transition-all cursor-pointer"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-text-primary truncate">
                          {session.title || "New Conversation"}
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                          {session.messages.length} messages
                          {session.activeAttachmentIds && (
                            <> · 📄 {session.activeAttachmentIds.length} docs</>
                          )}
                          <span className="mx-1">·</span>
                          {new Date(session.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteChat(session.id); }}
                        className="p-2 text-danger/70 hover:text-danger hover:bg-danger/10 rounded-lg transition-all opacity-0 group-hover:opacity-100 ml-2"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Active chat with document picker sidebar */
        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 overflow-hidden flex flex-col relative">
            {engineStatus === "loading" && (
              <div className="absolute top-0 left-0 right-0 bg-primary/10 border-b border-primary/20 p-2 text-center text-sm text-primary animate-pulse z-10">
                🛡️ CloakLM Shield is initializing...
              </div>
            )}
            {messages.length === 0 ? (
              <WelcomeScreen />
            ) : (
              <MessageList messages={messages} isLoading={isLoading} />
            )}
          </main>

          {/* Document picker sidebar */}
          <aside className="w-56 border-l border-border bg-surface-elevated flex flex-col h-full shrink-0">
            <div className="p-3 border-b border-border">
              <h3 className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
                Documents in Context
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {projectDocs.length === 0 ? (
                <p className="text-[10px] text-text-muted p-2">No documents in project.</p>
              ) : (
                projectDocs.map((doc) => {
                  const isActive = activeAttachmentIds.includes(doc.id);
                  return (
                    <label
                      key={doc.id}
                      className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all text-xs ${
                        isActive
                          ? "bg-primary/10 border border-primary/20"
                          : "hover:bg-surface-hover border border-transparent"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={() => toggleAttachment(doc.id)}
                        className="accent-primary w-3.5 h-3.5 shrink-0"
                      />
                      <span
                        className={`truncate ${
                          doc.status === "ready" ? "text-text-primary" : "text-text-muted"
                        }`}
                        title={doc.fileName}
                      >
                        {doc.fileName}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            <div className="p-2 border-t border-border text-center">
              <span className="text-[10px] text-text-muted">
                {activeAttachmentIds.length} of {projectDocs.length} active
              </span>
            </div>
          </aside>
        </div>
      )}

      {/* Chat input (only when chatting) */}
      {tab === "chats" && !showChatList && (
        <ChatInput
          onSend={sendMessage}
          attachments={pendingAttachments}
          onRemoveAttachment={(id) => setPendingAttachments((prev) => prev.filter((a) => a.id !== id))}
          onReviewAttachment={onReviewAttachment}
          onAttachFiles={(files) => handleProjectFiles(files)}
          isLoading={isLoading}
          provider={provider}
          activeModel={settings.activeModels?.[provider] || ""}
          onSelectModel={onSelectModel}
          apiKeys={settings.apiKeys}
          ollamaUrl={settings.ollamaUrl}
          customModels={settings.customModels || {}}
          onAddCustomModel={addCustomModel}
        />
      )}

      {confirmDeleteDoc && (
        <ConfirmDialog
          message={`Remove "${confirmDeleteDoc.fileName}" from this project?`}
          onConfirm={() => { removeProjectAttachment(confirmDeleteDoc.id); setConfirmDeleteDoc(null); }}
          onCancel={() => setConfirmDeleteDoc(null)}
        />
      )}

      {confirmDeleteChat && (
        <ConfirmDialog
          message="Delete this chat?"
          onConfirm={() => { onDeleteChatSession(confirmDeleteChat); setConfirmDeleteChat(null); }}
          onCancel={() => setConfirmDeleteChat(null)}
        />
      )}
    </div>
  );
}
