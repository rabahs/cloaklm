import { useState, useRef, useEffect } from "react";
import type { Attachment, LLMProvider } from "../types";
import { AttachmentChip } from "./AttachmentChip";
import { UnifiedModelSelector } from "./UnifiedModelSelector";

interface ChatInputProps {
  onSend: (message: string) => void;
  attachments: Attachment[];
  onRemoveAttachment: (id: string) => void;
  onReviewAttachment: (attachment: Attachment) => void;
  onAttachFiles?: (files: File[]) => void;
  isLoading: boolean;
  
  // Model Selector Props
  provider: LLMProvider;
  activeModel: string;
  onSelectModel: (provider: LLMProvider, modelId: string) => void;
  apiKeys: { claude?: string; gemini?: string; openai?: string };
  ollamaUrl: string;
  customModels: Record<string, string[]>;
  onAddCustomModel: (provider: LLMProvider, modelId: string) => void;
}

export function ChatInput({
  onSend,
  attachments,
  onRemoveAttachment,
  onReviewAttachment,
  onAttachFiles,
  isLoading,
  provider,
  activeModel,
  onSelectModel,
  apiKeys,
  ollamaUrl,
  customModels,
  onAddCustomModel
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !isLoading;
  const isAnonymizing = attachments.some(a => a.status === 'anonymizing');

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
      // Reset input so the same file can be selected again if removed
      e.target.value = "";
    }
  };

  return (
    <div className="bg-surface border-t border-border px-4 py-4 pb-6 relative z-10">
      <div className="max-w-3xl mx-auto">
        <div className="bg-surface-elevated border border-border rounded-xl shadow-lg flex flex-col focus-within:border-primary/50 transition-colors">
          
          {/* Attachments Section */}
          {attachments.length > 0 && (
            <div className="flex gap-2 p-3 pb-0 overflow-x-auto">
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

          {/* Input Area */}
          <div className="flex items-end gap-2 p-3">
            <input 
              type="file" 
              multiple 
              accept="application/pdf,.pdf" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-text-secondary hover:text-primary hover:bg-primary/10 transition-colors focus:outline-none"
              title="Attach File"
            >
              📎
            </button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isAnonymizing ? "Wait for anonymization to finish..." : "Message CloakLM..."}
              disabled={isLoading}
              className="flex-1 max-h-[200px] bg-transparent border-none outline-none resize-none py-2 text-text-primary placeholder:text-text-muted text-[15px] leading-relaxed"
              rows={1}
            />
            <button
              onClick={handleSubmit}
              disabled={!canSend || isAnonymizing}
              className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
                canSend && !isAnonymizing
                  ? "bg-primary text-white shadow-md hover:bg-primary-dark"
                  : "bg-surface text-text-muted cursor-not-allowed"
              }`}
            >
              ▶
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 px-2">
          {/* Action Bar Left */}
          <div className="flex items-center gap-2">
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
          </div>

          {/* Action Bar Right */}
          <span className="text-[11px] text-text-muted text-right">
            <span className="text-primary font-bold">CloakLM Shield Active.</span> Drop PDFs to anonymize locally.
          </span>
        </div>
      </div>
    </div>
  );
}
