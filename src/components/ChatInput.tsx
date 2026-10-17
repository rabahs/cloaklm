import { useState, useRef, useEffect } from "react";
import type { Attachment, LLMProvider, Project } from "../types";
import { AttachmentChip } from "./AttachmentChip";
import { UnifiedModelSelector } from "./UnifiedModelSelector";
import { ProjectDocPicker } from "./ProjectDocPicker";
import { ArrowUpIcon, FileIcon, FolderIcon, PaperclipIcon, ShieldIcon } from "./Icons";

interface ChatInputProps {
  onSend: (message: string) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onReviewAttachment: (attachment: Attachment) => void;
  onAttachFiles?: (files: File[]) => void;
  onAttachProjectDoc?: (doc: Attachment) => void;
  projects?: Project[];
  isLoading: boolean;

  // Model Selector Props
  provider: LLMProvider;
  activeModel: string;
  onSelectModel: (provider: LLMProvider, modelId: string) => void;
  apiKeys: { claude?: string; gemini?: string; openai?: string };
  ollamaUrl: string;
  customModels: Record<string, string[]>;
  onAddCustomModel: (provider: LLMProvider, modelId: string) => void;

  /** "hero": centered on the empty screen. "docked": pinned under a conversation. */
  variant?: "hero" | "docked";
  engineReady?: boolean;
}

export function ChatInput({
  onSend,
  attachments,
  onRemoveAttachment,
  onReviewAttachment,
  onAttachFiles,
  onAttachProjectDoc,
  projects,
  isLoading,
  provider,
  activeModel,
  onSelectModel,
  apiKeys,
  ollamaUrl,
  customModels,
  onAddCustomModel,
  variant = "docked",
  engineReady = true
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showDocPicker, setShowDocPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isLoading;
  const isAnonymizing = attachments.some(a => a.status === 'anonymizing');

  const hasProjectDocs = projects?.some(p =>
    Object.values(p.attachments).some(a => a.status === "ready")
  );

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  // Close menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showAttachMenu]);

  const handleSubmit = () => {
    if (canSend && !isAnonymizing) {
      onSend(input);
      setInput("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && onAttachFiles) {
      onAttachFiles(Array.from(e.target.files));
      e.target.value = "";
    }
  };

  const handleAttachClick = () => {
    if (hasProjectDocs) {
      setShowAttachMenu(!showAttachMenu);
    } else {
      fileInputRef.current?.click();
    }
  };

  return (
    <div className={variant === "docked" ? "px-4 pt-2 pb-5 relative z-10" : "relative z-10"}>
      <div className={variant === "docked" ? "max-w-3xl mx-auto" : ""}>
        <div className="bg-surface-elevated rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.35)] ring-1 ring-white/[0.06] focus-within:ring-primary/40 transition-shadow">

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="flex gap-2 px-3 pt-3 overflow-x-auto">
              {attachments.map((att) => (
                <AttachmentChip
                  key={att.id}
                  attachment={att}
                  onRemove={() => onRemoveAttachment(att.id)}
                  onReview={() => onReviewAttachment(att)}
                />
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isAnonymizing ? "Removing personal info from your document..." : "Ask anything, or attach a PDF..."}
            disabled={isLoading}
            className={`w-full max-h-[200px] bg-transparent border-none outline-none resize-none px-4 pt-3.5 text-text-primary placeholder:text-text-muted text-[15px] leading-relaxed ${variant === "hero" ? "min-h-[72px]" : ""}`}
            rows={1}
          />

          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 pb-2">
            <input
              type="file"
              multiple
              accept="application/pdf,.pdf"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <div className="relative" ref={menuRef}>
              <button
                onClick={handleAttachClick}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors focus:outline-none"
                title="Attach a PDF"
              >
                <PaperclipIcon className="w-[18px] h-[18px]" />
              </button>

              {showAttachMenu && (
                <div className="absolute bottom-10 left-0 bg-surface-elevated ring-1 ring-white/[0.08] rounded-xl shadow-2xl p-1 min-w-[220px] animate-view-enter z-20">
                  <button
                    onClick={() => { setShowAttachMenu(false); fileInputRef.current?.click(); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-text-primary hover:bg-surface-hover transition-colors text-left"
                  >
                    <FileIcon className="w-4 h-4 text-text-secondary" />
                    <div>
                      <div className="font-medium">Upload a PDF</div>
                      <div className="text-[10px] text-text-muted">From your computer</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowAttachMenu(false); setShowDocPicker(true); }}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs text-text-primary hover:bg-surface-hover transition-colors text-left"
                  >
                    <FolderIcon className="w-4 h-4 text-text-secondary" />
                    <div>
                      <div className="font-medium">From a project</div>
                      <div className="text-[10px] text-text-muted">Reuse an already-redacted document</div>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <UnifiedModelSelector
              provider={provider}
              activeModel={activeModel}
              onSelect={onSelectModel}
              apiKeys={apiKeys}
              ollamaUrl={ollamaUrl}
              customModels={customModels}
              onAddCustomModel={onAddCustomModel}
              isDisabled={isLoading}
            />

            <div className="flex-1" />

            <span
              className={`hidden sm:flex items-center gap-1 text-[11px] mr-1 ${engineReady ? "text-text-muted" : "text-text-muted/60"}`}
              title={engineReady ? "Personal information in your PDFs is removed on this computer before anything is sent" : "The privacy engine is starting"}
            >
              <ShieldIcon className={`w-3.5 h-3.5 ${engineReady ? "text-success" : ""}`} />
              {engineReady ? "Redacted on device" : "Engine starting"}
            </span>

            <button
              onClick={handleSubmit}
              disabled={!canSend || isAnonymizing}
              title="Send"
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                canSend && !isAnonymizing
                  ? "bg-primary text-white hover:bg-primary-dark"
                  : "bg-surface-hover text-text-muted cursor-not-allowed"
              }`}
            >
              <ArrowUpIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Project Document Picker Modal */}
      {showDocPicker && projects && onAttachProjectDoc && (
        <ProjectDocPicker
          projects={projects}
          onSelect={onAttachProjectDoc}
          onClose={() => setShowDocPicker(false)}
        />
      )}
    </div>
  );
}
