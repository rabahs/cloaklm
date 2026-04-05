import type { Attachment } from "../types";

interface DocumentSidebarProps {
  documents: Attachment[];
  onReview: (attachment: Attachment) => void;
  onClose: () => void;
}

export function DocumentSidebar({ documents, onReview, onClose }: DocumentSidebarProps) {
  return (
    <aside className="w-80 border-l border-border bg-surface-elevated flex flex-col h-full animate-slide-in-right">
      <div className="p-4 border-b border-border flex items-center justify-between bg-surface/50">
        <div className="flex items-center gap-2">
          <span className="text-lg">📁</span>
          <h2 className="font-semibold text-sm text-text-primary uppercase tracking-wider">Documents</h2>
        </div>
        <button 
          onClick={onClose}
          className="text-text-muted hover:text-text-primary transition-colors p-1"
          title="Close Sidebar"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
        {documents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-40">
            <div className="text-4xl mb-3">📄</div>
            <p className="text-xs font-medium text-text-secondary">
              No documents in this session yet.<br/>Drop a PDF to get started.
            </p>
          </div>
        ) : (
          documents.map((doc) => (
            <div 
              key={doc.id}
              className="group p-3 rounded-xl bg-surface border border-border hover:border-primary/40 transition-all hover:shadow-lg hover:shadow-primary/5"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform">
                  PDF
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-xs font-semibold text-text-primary truncate mb-1" title={doc.fileName}>
                    {doc.fileName}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-bold uppercase tracking-tighter px-1.5 py-0.5 rounded ${
                      doc.status === 'ready' ? 'bg-success/10 text-success' :
                      doc.status === 'anonymizing' ? 'bg-primary/10 text-primary animate-pulse' :
                      doc.status === 'deep-scanning' ? 'bg-blue-500/10 text-blue-400 animate-pulse' :
                      'bg-danger/10 text-danger'
                    }`}>
                      {doc.status === 'anonymizing' ? 'Pass 1 · GLiNER' :
                       doc.status === 'deep-scanning' ? 'Pass 2 · Deep Scan' :
                       doc.status}
                    </span>
                    {doc.redactionCount !== undefined && doc.redactionCount > 0 && (
                      <span className="text-[10px] text-text-muted">
                        🛡️ {doc.redactionCount} PII
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              {doc.status === 'ready' && (
                <button
                  onClick={() => onReview(doc)}
                  className="mt-3 w-full py-2 bg-surface-elevated border border-border rounded-lg text-[11px] font-bold text-text-secondary hover:text-primary hover:border-primary/50 transition-all uppercase tracking-widest shadow-sm"
                >
                  Review Redactions
                </button>
              )}
              {doc.status === 'error' && (
                <p className="mt-2 text-[10px] text-danger bg-danger/5 p-1.5 rounded-md border border-danger/10 italic">
                  {doc.error || "Processing failed"}
                </p>
              )}
            </div>
          ))
        )}
      </div>
      
      <div className="p-4 bg-surface/30 border-t border-border flex items-center justify-center">
         <span className="text-[10px] text-text-muted font-medium uppercase tracking-widest opacity-60">
            CloakLM Privacy Shield v0.3
         </span>
      </div>
    </aside>
  );
}
