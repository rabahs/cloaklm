import { useState, useRef, useCallback, useEffect } from "react";
import type { Attachment, RedactionEntry } from "../types";

interface ReviewPanelProps {
  attachment: Attachment;
  onClose: () => void;
  onManualRedact: (attachmentId: string, selectedText: string, newContent: string, newEntry: RedactionEntry) => void;
  onAcceptSuggestion?: (attachmentId: string, suggestionId: string) => void;
  onDismissSuggestion?: (attachmentId: string, suggestionId: string) => void;
  onAcceptAllSuggestions?: (attachmentId: string) => void;
  onDismissAllSuggestions?: (attachmentId: string) => void;
  deepScanEnabled?: boolean;
  deepScanModel?: string;
}

interface FloatingButton {
  x: number;
  y: number;
  text: string;
}

export function ReviewPanel({ attachment, onClose, onManualRedact, onAcceptSuggestion, onDismissSuggestion, onAcceptAllSuggestions, onDismissAllSuggestions, deepScanEnabled, deepScanModel }: ReviewPanelProps) {
  const [viewMode, setViewMode] = useState<"list" | "raw">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [floatingBtn, setFloatingBtn] = useState<FloatingButton | null>(null);
  const rawContentRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);

  const map = attachment.redactionMap || {};
  const entries = Object.values(map);

  // Count how many manual redactions already exist
  const manualCount = entries.filter(e => e.category === "manual").length;
  const pendingSuggestions = (attachment.deepScanSuggestions || []).filter(s => s.status === "pending");

  const handleCopy = useCallback(() => {
    if (!attachment.anonymizedContent) return;
    navigator.clipboard.writeText(attachment.anonymizedContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [attachment.anonymizedContent]);

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      setFloatingBtn(null);
      return;
    }

    const selectedText = selection.toString().trim();
    if (selectedText.length < 2) {
      setFloatingBtn(null);
      return;
    }

    // Only show the button if selection is inside the raw content area
    const range = selection.getRangeAt(0);
    if (!rawContentRef.current?.contains(range.commonAncestorContainer)) {
      setFloatingBtn(null);
      return;
    }

    // Position the floating button above the selection
    const rect = range.getBoundingClientRect();
    const panelRect = panelRef.current?.getBoundingClientRect();
    if (!panelRect) return;

    setFloatingBtn({
      x: rect.left + rect.width / 2 - panelRect.left,
      y: rect.top - panelRect.top - 10,
      text: selectedText,
    });
  }, []);

  // Listen for mouseup to detect text selection
  useEffect(() => {
    document.addEventListener("mouseup", handleTextSelection);
    return () => document.removeEventListener("mouseup", handleTextSelection);
  }, [handleTextSelection]);

  // Dismiss floating button on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("[data-redact-btn]")) return; // don't dismiss if clicking the redact button
      // Small delay to allow selection to register
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) setFloatingBtn(null);
      }, 200);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleRedact = useCallback(() => {
    if (!floatingBtn) return;

    const selectedText = floatingBtn.text;
    const currentContent = attachment.anonymizedContent || "";
    const placeholderNum = manualCount + 1;
    const placeholder = `[MANUAL_${placeholderNum}]`;

    // Replace ALL occurrences of the selected text
    const newContent = currentContent.split(selectedText).join(placeholder);

    const newEntry: RedactionEntry = {
      real_value: selectedText,
      placeholder,
      category: "manual",
      source: "manual",
    };

    onManualRedact(attachment.id, selectedText, newContent, newEntry);
    setFloatingBtn(null);
    window.getSelection()?.removeAllRanges();
  }, [floatingBtn, attachment, manualCount, onManualRedact]);

  const totalMatches = searchQuery.trim().length >= 2 
    ? (attachment.anonymizedContent?.match(new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length
    : 0;

  // Handle scrolling to current match
  useEffect(() => {
    if (viewMode === "raw" && matchRefs.current[currentSearchIndex]) {
      matchRefs.current[currentSearchIndex]?.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest"
      });
    }
  }, [currentSearchIndex, viewMode, totalMatches]);

  // Reset search index when query changes
  useEffect(() => {
    setCurrentSearchIndex(0);
  }, [searchQuery]);

  const handleNextMatch = useCallback(() => {
    const total = totalMatches;
    if (total === 0) return;
    if (total === 1) {
      // Force scroll to the single match even though index doesn't change
      matchRefs.current[0]?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      return;
    }
    setCurrentSearchIndex((prev) => (prev + 1) % total);
  }, [totalMatches]);

  const handlePrevMatch = useCallback(() => {
    const total = totalMatches;
    if (total === 0) return;
    if (total === 1) {
      matchRefs.current[0]?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      return;
    }
    setCurrentSearchIndex((prev) => (prev - 1 + total) % total);
  }, [totalMatches]);

  const renderHighlightedText = (text: string | undefined) => {
    if (!text) return "No content generated.";

    const placeholders = entries.map(e => e.placeholder);
    
    // Create combined regex for placeholders and search query
    const escapedPlaceholders = placeholders.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    let regexParts = [...escapedPlaceholders];
    
    if (searchQuery.trim().length >= 2) {
      regexParts.push(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    if (regexParts.length === 0) return text;

    const regex = new RegExp(`(${regexParts.join('|')})`, 'gi');
    const parts = text.split(regex);
    
    let searchMatchCounter = 0;
    // Reset match refs
    matchRefs.current = [];

    return parts.map((part, i) => {
      const lowerPart = part.toLowerCase();
      const lowerSearch = searchQuery.toLowerCase();
      
      // Match placeholders (case sensitive)
      if (placeholders.includes(part)) {
        const isManual = part.startsWith("[MANUAL_");
        return (
          <span
            key={i}
            className={`font-bold px-1 py-0.5 rounded mx-0.5 shadow-sm border ${
              isManual
                ? "text-amber-400 bg-amber-500/20 border-amber-500/30"
                : "text-primary bg-primary/20 border-primary/30"
            }`}
          >
            {part}
          </span>
        );
      }
      
      // Match search query (case insensitive)
      if (searchQuery.trim().length >= 2 && lowerPart === lowerSearch) {
        const matchIdx = searchMatchCounter++;
        const isCurrent = matchIdx === currentSearchIndex;
        return (
          <mark
            key={i}
            ref={(el) => { matchRefs.current[matchIdx] = el; }}
            className={`rounded px-1 py-0.5 transition-all duration-300 font-bold ${
              isCurrent 
                ? "bg-[#ff9900] text-black ring-4 ring-[#ff9900]/30 shadow-2xl z-20 scale-110" 
                : "bg-yellow-400/40 text-white"
            }`}
          >
            {part}
          </mark>
        );
      }
      
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="absolute inset-0 z-[100] bg-surface/80 backdrop-blur-sm flex justify-end">
      {/* Side Drawer */}
      <div ref={panelRef} className="w-[450px] bg-surface-elevated h-full shadow-2xl border-l border-border flex flex-col animate-[slide-in_0.2s_ease-out] relative">

        {/* Floating Redact Button */}
        {floatingBtn && (
          <div
            data-redact-btn
            className="absolute z-[200] animate-[fade-in_0.1s_ease-out]"
            style={{
              left: `${Math.max(16, Math.min(floatingBtn.x - 60, 330))}px`,
              top: `${floatingBtn.y}px`,
              transform: "translateY(-100%)",
            }}
          >
            <button
              onClick={handleRedact}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-danger hover:bg-red-600 text-white text-xs font-bold rounded-lg shadow-xl transition-colors whitespace-nowrap"
            >
              🛡️ Redact "{floatingBtn.text.length > 20 ? floatingBtn.text.slice(0, 20) + "…" : floatingBtn.text}"
            </button>
            <div className="w-3 h-3 bg-danger rotate-45 mx-auto -mt-1.5" />
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Redaction Review</h2>
            <p className="text-xs text-text-secondary mt-1 max-w-[300px] truncate">
              {attachment.anonymizedFileName || attachment.fileName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-text-muted transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col">
          <div className="mb-4 flex bg-surface border border-border rounded-lg p-1 w-full relative">
            <button
              onClick={() => setViewMode("list")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors z-10 ${
                viewMode === "list" ? "text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Identified PII ({entries.length})
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors z-10 ${
                viewMode === "raw" ? "text-white" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              Raw Output to AI
            </button>
            <div
              className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-primary rounded-md transition-transform duration-200 ease-out shadow-sm"
              style={{ transform: viewMode === "list" ? "translateX(0)" : "translateX(100%)" }}
            />
          </div>

          {viewMode === "list" ? (
            <div className="space-y-3">
              {/* Pipeline Summary */}
              {(() => {
                const glinerCount = entries.filter(e => !e.source || e.source === "gliner").length;
                const deepCount = entries.filter(e => e.source === "deep-scan").length;
                const manualCountTotal = entries.filter(e => e.source === "manual" || (!e.source && e.category === "manual")).length;
                const totalCount = entries.length;
                const isScanning = attachment.status === "deep-scanning";

                return (
                  <div className="mb-3 bg-surface border border-border rounded-xl p-4 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-[11px] font-bold text-text-primary uppercase tracking-wider">Redaction Pipeline</h3>
                      <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
                        🛡️ {totalCount} total
                      </span>
                    </div>

                    {/* Pass 1: GLiNER */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-success">✅</span>
                        <span className="text-text-secondary">Pass 1</span>
                        <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">GLiNER</span>
                      </div>
                      <span className="text-text-muted font-mono text-[11px]">{glinerCount} found</span>
                    </div>

                    {/* Pass 2: Deep Scan — only show if enabled or has results */}
                    {(deepScanEnabled || isScanning || deepCount > 0) && (
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          {isScanning ? (
                            <span className="text-blue-400 animate-pulse">🔄</span>
                          ) : (
                            <span className="text-success">✅</span>
                          )}
                          <span className="text-text-secondary">Pass 2</span>
                          <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">
                            {deepScanModel || "LLM"}
                          </span>
                        </div>
                        <span className="text-text-muted font-mono text-[11px]">
                          {isScanning ? "scanning..." : `${deepCount} found`}
                        </span>
                      </div>
                    )}

                    {/* Manual */}
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={manualCountTotal > 0 ? "text-success" : "text-text-muted"}>
                          {manualCountTotal > 0 ? "✅" : "—"}
                        </span>
                        <span className="text-text-secondary">Manual</span>
                        <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">✋</span>
                      </div>
                      <span className="text-text-muted font-mono text-[11px]">{manualCountTotal} added</span>
                    </div>

                    <div className="border-t border-border pt-2 mt-1">
                      <p className="text-[10px] text-text-muted leading-relaxed">
                        All redactions happen <strong className="text-text-secondary">locally on your device</strong> before the AI sees anything.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {entries.length === 0 && (!pendingSuggestions || pendingSuggestions.length === 0) ? (
                <div className="text-center text-text-muted py-8 text-sm">
                  No PII detected in this document.
                </div>
              ) : (
                <>
                  {/* Deep Scan Suggestions — shown first so user sees them immediately */}
                  {pendingSuggestions.length > 0 && (
                    <>
                      <div className="mt-4 mb-2 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 flex items-center justify-between">
                        <div>
                          <h3 className="text-xs font-bold text-blue-400 flex items-center gap-1.5">
                            🔍 Deep Scan found {pendingSuggestions.length} suggestion{pendingSuggestions.length !== 1 ? "s" : ""}
                          </h3>
                        </div>
                        <div className="flex gap-1.5">
                          {onAcceptAllSuggestions && (
                            <button
                              onClick={() => onAcceptAllSuggestions(attachment.id)}
                              className="text-[10px] font-bold px-2 py-1 bg-success/20 text-success rounded-md hover:bg-success/30 transition-colors"
                            >
                              Accept All
                            </button>
                          )}
                          {onDismissAllSuggestions && (
                            <button
                              onClick={() => onDismissAllSuggestions(attachment.id)}
                              className="text-[10px] font-bold px-2 py-1 bg-surface text-text-muted rounded-md hover:text-text-primary hover:bg-surface-hover transition-colors border border-border"
                            >
                              Dismiss All
                            </button>
                          )}
                        </div>
                      </div>

                      {pendingSuggestions.map((suggestion) => (
                        <div key={suggestion.id} className="bg-surface border border-blue-500/20 rounded-lg p-3 flex flex-col gap-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full text-blue-400 bg-blue-500/10">
                              🔍 {suggestion.category}
                            </span>
                          </div>
                          <div className="text-sm text-text-primary px-2 border-l-2 border-blue-500/30 font-mono">
                            "{suggestion.text}"
                          </div>
                          <div className="flex gap-2 mt-1">
                            {onAcceptSuggestion && (
                              <button
                                onClick={() => onAcceptSuggestion(attachment.id, suggestion.id)}
                                className="flex-1 py-1.5 text-[10px] font-bold bg-success/10 text-success border border-success/20 rounded-md hover:bg-success/20 transition-colors"
                              >
                                ✓ Redact
                              </button>
                            )}
                            {onDismissSuggestion && (
                              <button
                                onClick={() => onDismissSuggestion(attachment.id, suggestion.id)}
                                className="flex-1 py-1.5 text-[10px] font-bold bg-surface text-text-muted border border-border rounded-md hover:text-text-primary hover:bg-surface-hover transition-colors"
                              >
                                ✕ Dismiss
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Deep scanning indicator */}
                  {attachment.status === "deep-scanning" && (
                    <div className="mb-3 bg-blue-500/5 border border-blue-500/15 rounded-xl p-4 text-center animate-pulse">
                      <span className="text-xs text-blue-400 font-medium">🔍 Deep Scan in progress...</span>
                    </div>
                  )}

                  {/* Confirmed redactions */}
                  {entries.map((entry, idx) => {
                    const source = entry.source || (entry.category === "manual" ? "manual" : "gliner");
                    return (
                      <div key={idx} className={`bg-surface border rounded-lg p-3 flex flex-col gap-2 ${
                        source === "manual" ? "border-amber-500/30" :
                        source === "deep-scan" ? "border-blue-500/20" : "border-border"
                      }`}>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            source === "manual"
                              ? "text-amber-400 bg-amber-500/10"
                              : source === "deep-scan"
                                ? "text-blue-400 bg-blue-500/10"
                                : "text-primary bg-primary/10"
                          }`}>
                            {source === "manual" ? "✋ Manual" :
                             source === "deep-scan" ? `🔍 Deep${entry.sourceModel ? " · " + entry.sourceModel : ""}` :
                             "GLiNER"}
                          </span>
                          {source !== "manual" && (
                            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-surface-hover text-text-muted">
                              {entry.category || "Entity"}
                            </span>
                          )}
                          <span className="text-xs text-text-muted font-mono bg-surface-hover px-1.5 py-0.5 rounded ml-auto">
                            {entry.placeholder}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <div className="flex-1 text-sm text-danger line-through opacity-70 truncate px-2 border-l-2 border-danger/30">
                            {entry.real_value}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          ) : (
            <div className="flex-1 bg-surface border border-border rounded-lg overflow-hidden flex flex-col min-h-0">
              <div className="bg-surface-elevated border-b border-border px-3 py-2 flex items-center justify-between gap-4">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search in text..."
                    className="w-full bg-surface border border-border rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-primary transition-colors pl-7 pr-20"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (e.shiftKey) handlePrevMatch();
                        else handleNextMatch();
                      }
                    }}
                  />
                  <span className="absolute left-2.5 top-1.5 text-text-muted text-[10px]">🔍</span>
                  
                  {searchQuery.trim().length >= 2 && (
                    <div className="absolute right-2 top-1 flex items-center gap-1.5 bg-surface-elevated pl-2">
                       <span className="text-[10px] text-text-muted font-mono">
                        {totalMatches > 0 ? currentSearchIndex + 1 : 0}/{totalMatches}
                      </span>
                      <div className="flex border-l border-border ml-1 pl-1 gap-0.5">
                        <button 
                          onClick={handlePrevMatch}
                          className="hover:text-primary transition-colors p-0.5"
                          title="Previous (Shift+Enter)"
                        >
                          <span className="rotate-180 block">▼</span>
                        </button>
                        <button 
                          onClick={handleNextMatch}
                          className="hover:text-primary transition-colors p-0.5"
                          title="Next (Enter)"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold transition-all ${
                    copied 
                      ? "bg-success text-white shadow-success/20" 
                      : "bg-surface hover:bg-surface-hover text-text-secondary border border-border"
                  }`}
                >
                  {copied ? "✅ Copied" : "📋 Copy All"}
                </button>
              </div>
              <div ref={rawContentRef} className="flex-1 overflow-auto p-4 select-text cursor-text">
                <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap leading-relaxed">
                  {renderHighlightedText(attachment.anonymizedContent)}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-border bg-surface">
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-primary hover:bg-primary-dark text-white rounded-lg font-medium transition-colors"
          >
            Looks Good
          </button>
        </div>

      </div>

      <style>{`
        @keyframes slide-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(-100%) scale(0.9); }
          to { opacity: 1; transform: translateY(-100%) scale(1); }
        }
      `}</style>
    </div>
  );
}
