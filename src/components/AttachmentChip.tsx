import type { Attachment } from "../types";

interface AttachmentChipProps {
  attachment: Attachment;
  compact?: boolean;
  onRemove?: () => void;
  onReview?: () => void;
}

export function AttachmentChip({
  attachment,
  compact = false,
  onRemove,
  onReview,
}: AttachmentChipProps) {
  const isReady = attachment.status === "ready";
  const isAnonymizing = attachment.status === "anonymizing";
  const isDeepScanning = attachment.status === "deep-scanning";
  const isError = attachment.status === "error";
  const isProcessing = isAnonymizing || isDeepScanning;

  const pendingSuggestions = (attachment.deepScanSuggestions || []).filter(s => s.status === "pending").length;

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 bg-surface border border-primary/30 rounded-full px-2 py-0.5 text-xs">
        <span>📄</span>
        <span className="truncate max-w-[120px] font-medium">
          {attachment.anonymizedFileName || attachment.fileName}
        </span>
      </div>
    );
  }

  const count = attachment.redactionCount || 0;
  const statusText = () => {
    if (isAnonymizing) return "Pass 1 · GLiNER scanning...";
    if (isDeepScanning) return `Pass 2 · Deep Scan · ${count} PII found`;
    if (isError) return attachment.error || "Anonymization failed";
    if (pendingSuggestions > 0)
      return `🛡️ ${count} PII redacted · ${pendingSuggestions} to review`;
    return `🛡️ ${count} PII redacted`;
  };

  return (
    <div className="relative group flex items-start gap-3 bg-surface border border-border rounded-xl p-3 pr-8 min-w-[200px] max-w-[280px] shadow-sm hover:border-primary/50 transition-colors">
      {/* Icon/Status Indicator */}
      <div className="relative">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg ${
            isReady
              ? "bg-success/10 text-success"
              : isProcessing
              ? "bg-primary/10 text-primary"
              : "bg-danger/10 text-danger"
          }`}
        >
          📄
        </div>
        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-surface flex items-center justify-center">
          {isReady && pendingSuggestions === 0 && <span className="text-[10px]">✅</span>}
          {isReady && pendingSuggestions > 0 && (
            <span className="text-[10px] text-warning font-bold">🔍</span>
          )}
          {isError && <span className="text-[10px]">❌</span>}
          {isProcessing && (
            <div className="w-2.5 h-2.5 border-2 border-primary border-t-transparent rounded-full spinner" />
          )}
        </div>
      </div>

      {/* Details */}
      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-semibold text-sm text-text-primary truncate">
          {attachment.anonymizedFileName || attachment.fileName}
        </span>
        <span className={`text-xs mt-0.5 ${isProcessing ? "text-primary animate-pulse" : isError ? "text-danger" : "text-text-secondary"}`}>
          {statusText()}
        </span>

        {/* Show running redaction count during processing */}
        {isDeepScanning && attachment.redactionCount !== undefined && attachment.redactionCount > 0 && (
          <span className="text-[10px] text-text-muted mt-0.5">
            🛡️ {attachment.redactionCount} from Pass 1
          </span>
        )}

        {isReady && (
          <button
            onClick={onReview}
            className="text-[10px] uppercase font-bold text-primary mt-2 text-left hover:underline w-max"
          >
            👁️ Review Redactions
          </button>
        )}
      </div>

      {/* Remove Button */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center text-text-muted hover:bg-surface-hover hover:text-danger hover:border hover:border-border transition-all opacity-0 group-hover:opacity-100"
          title="Remove attachment"
        >
          ✕
        </button>
      )}
    </div>
  );
}
