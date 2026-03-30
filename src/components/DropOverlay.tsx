export function DropOverlay() {
  return (
    <div className="absolute inset-0 z-50 bg-surface/80 backdrop-blur-sm flex flex-col items-center justify-center transition-all drop-overlay-active rounded-xl m-4 border-2 border-primary border-dashed">
      <div className="w-24 h-24 rounded-full bg-primary/20 flex items-center justify-center mb-6 shadow-[0_0_40px_rgba(124,58,237,0.3)]">
        <span className="text-5xl drop-shadow-md">🛡️</span>
      </div>
      <h2 className="text-3xl font-bold text-white tracking-tight mb-2">
        Drop to Anonymize
      </h2>
      <p className="text-text-secondary text-lg font-medium">
        Your PII will be stripped before the AI sees it.
      </p>
    </div>
  );
}
