export function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <div className="w-20 h-20 rounded-2xl bg-surface-elevated/50 flex items-center justify-center mx-auto mb-6 shadow-sm border border-border overflow-hidden">
          <img src="/logo.png" alt="CloakLM Logo" className="w-full h-full object-cover" />
        </div>

        <h2 className="text-2xl font-bold text-text-primary mb-3">
          Welcome to CloakLM
        </h2>
        <p className="text-text-secondary text-base leading-relaxed mb-8">
          Drop any PDF to start. Your documents are anonymized{" "}
          <span className="text-primary font-medium">on your device</span>{" "}
          before the AI sees them. Your PII never leaves your machine.
        </p>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-surface-elevated border border-border rounded-xl p-4">
            <div className="text-2xl mb-2">🔒</div>
            <div className="text-xs font-medium text-text-secondary">
              100% Local
              <br />
              PII Redaction
            </div>
          </div>
          <div className="bg-surface-elevated border border-border rounded-xl p-4">
            <div className="text-2xl mb-2">🤖</div>
            <div className="text-xs font-medium text-text-secondary">
              Claude, Gemini
              <br />
              GPT, or Local
            </div>
          </div>
          <div className="bg-surface-elevated border border-border rounded-xl p-4">
            <div className="text-2xl mb-2">👁️</div>
            <div className="text-xs font-medium text-text-secondary">
              Review What
              <br />
              Was Redacted
            </div>
          </div>
        </div>

        <div className="border-2 border-dashed border-border rounded-2xl p-8 hover:border-primary/40 transition-colors cursor-default">
          <p className="text-text-muted text-sm">
            📎 Drop a PDF here or type a message below
          </p>
        </div>
      </div>
    </div>
  );
}
