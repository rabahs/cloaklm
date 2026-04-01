import type { Message } from "../types";
import { AttachmentChip } from "./AttachmentChip";
import { getProviderDisplayName, getProviderIcon } from "../llm";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex gap-3 message-enter ${
        isUser ? "flex-row-reverse" : ""
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? "bg-primary/30"
            : "bg-primary/20"
        }`}
      >
        <span className="text-sm">
          {isUser ? "👤" : message.provider ? getProviderIcon(message.provider) : "🛡️"}
        </span>
      </div>

      {/* Content */}
      <div className={`max-w-[80%] space-y-2 ${isUser ? "items-end" : ""}`}>
        {/* Provider badge for AI messages */}
        {!isUser && message.provider && (
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] font-bold text-text-muted bg-surface-elevated border border-border px-2 py-0.5 rounded-full">
              {message.modelId ? message.modelId : getProviderDisplayName(message.provider)}
            </span>
          </div>
        )}

        {/* Attachment chips */}
        {message.attachments && message.attachments.length > 0 && (
          <div className={`flex flex-wrap gap-2 ${isUser ? "justify-end" : ""}`}>
            {message.attachments.map((att) => (
              <AttachmentChip key={att.id} attachment={att} compact />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {message.content && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
              isUser
                ? "bg-primary text-white rounded-tr-sm"
                : "bg-surface-elevated border border-border text-text-primary rounded-tl-sm"
            }`}
          >
            {message.content}
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-[10px] text-text-muted px-1 ${
            isUser ? "text-right" : ""
          }`}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {!isUser && (
            <span className="ml-2 text-primary/60">
              🔒 PII was never shared
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
