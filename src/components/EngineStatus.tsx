import { useEffect, useRef, useState } from "react";
import { ShieldIcon } from "./Icons";

export type EngineStage = "unpacking" | "libraries" | "models" | "ready" | "error";

// Measured on an Apple Silicon Mac: most of startup is the packaged engine unpacking itself.
const STEPS: { stage: EngineStage; label: string; seconds: number; share: number }[] = [
  { stage: "unpacking", label: "Unpacking the privacy engine", seconds: 27, share: 0.72 },
  { stage: "libraries", label: "Loading document reader", seconds: 6, share: 0.18 },
  { stage: "models", label: "Loading PII detection model", seconds: 3, share: 0.1 },
];

/** Startup progress for the local engine. Within a stage the bar eases toward the
 *  stage's end but never reaches it until the engine reports the next stage. */
export function EngineStatus({ stage }: { stage: EngineStage }) {
  const [progress, setProgress] = useState(0);
  const stageStart = useRef(Date.now());

  useEffect(() => { stageStart.current = Date.now(); }, [stage]);

  useEffect(() => {
    if (stage === "ready" || stage === "error") return;
    const index = STEPS.findIndex((s) => s.stage === stage);
    const before = STEPS.slice(0, index).reduce((sum, s) => sum + s.share, 0);
    const step = STEPS[index];
    const tick = () => {
      const elapsed = (Date.now() - stageStart.current) / 1000;
      const within = 1 - Math.exp(-elapsed / (step.seconds / 2)); // ~86% of the stage at its expected duration
      setProgress((prev) => Math.max(prev, before + step.share * Math.min(within, 0.95)));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [stage]);

  if (stage === "ready") return null;

  if (stage === "error") {
    return (
      <div className="flex items-center gap-2.5 px-4 py-3 rounded-xl bg-danger/10 text-sm text-danger">
        <ShieldIcon className="w-4 h-4 shrink-0" />
        The privacy engine didn't start. Quit and reopen CloakLM to try again.
      </div>
    );
  }

  const index = STEPS.findIndex((s) => s.stage === stage);
  return (
    <div className="px-4 py-3 rounded-xl bg-surface-elevated/60" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-xs mb-2">
        <span className="text-text-primary font-medium">Starting the privacy engine</span>
        <span className="text-text-muted">Step {index + 1} of {STEPS.length} · {STEPS[index].label}</span>
      </div>
      <div className="h-1 rounded-full bg-surface-hover overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <p className="text-[11px] text-text-muted mt-2">You can type your question now. Documents can be added once this finishes.</p>
    </div>
  );
}
