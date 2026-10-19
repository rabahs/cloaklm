import { useMemo, useState } from "react";
import type { Attachment } from "../types";
import { MessageBubble } from "./MessageBubble";

interface RehydratePanelProps {
  /** The project's documents, numbered the way AI tools see them ("Document N"). */
  docs: Attachment[];
  onClose: () => void;
}

/**
 * Paste an answer from Claude Desktop, Claude Code, Codex, etc. and see it with the
 * real values put back. Rehydration happens here only; nothing is sent anywhere.
 */
export function RehydratePanel({ docs, onClose }: RehydratePanelProps) {
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>(docs.map((d) => d.id));

  const selectedDocs = docs.filter((d) => selected.includes(d.id));

  // Each document numbers its placeholders from 1, so [PERSON_1] can mean a
  // different person in Document 1 and Document 2.
  const conflicts = useMemo(() => {
    const seen = new Map<string, Set<string>>();
    for (const doc of selectedDocs) {
      for (const entry of Object.values(doc.redactionMap || {})) {
        const values = seen.get(entry.placeholder) || new Set<string>();
        values.add(entry.real_value.trim().toLowerCase());
        seen.set(entry.placeholder, values);
      }
    }
    return [...seen].filter(([, values]) => values.size > 1).map(([placeholder]) => placeholder);
  }, [selectedDocs]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-view-enter">
      <div className="bg-surface-elevated border border-border rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Rehydrate an answer</h2>
            <p className="text-[11px] text-text-muted">
              Paste a reply from Claude, Codex or another AI tool. Real values are filled in locally.
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-sm" title="Close">✕</button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {docs.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {docs.map((doc, i) => (
                <label
                  key={doc.id}
                  className="flex items-center gap-1.5 text-xs text-text-secondary bg-surface border border-border rounded-lg px-2 py-1 cursor-pointer"
                  title={doc.fileName}
                >
                  <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => toggle(doc.id)} />
                  Document {i + 1} · <span className="truncate max-w-[10rem]">{doc.fileName}</span>
                </label>
              ))}
            </div>
          )}

          {conflicts.length > 0 && (
            <p className="text-[11px] text-warning">
              {conflicts.slice(0, 4).join(", ")}
              {conflicts.length > 4 ? "…" : ""} mean different things in the selected documents. Select only the
              document the answer is about.
            </p>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the AI's answer here…"
            rows={6}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-primary/50 resize-y"
          />

          {text.trim() && (
            <MessageBubble
              message={{ id: "rehydrated", role: "assistant", content: text, timestamp: new Date(), attachments: selectedDocs }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
