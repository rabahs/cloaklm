import { useEffect, useState } from "react";
import { resolveResource } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";

type ClientKey = "claude-code" | "codex" | "gemini" | "claude-desktop-json";

const CLIENTS: { key: ClientKey; name: string; where: string }[] = [
  { key: "claude-code", name: "Claude Code", where: "Run in a terminal" },
  { key: "codex", name: "Codex CLI", where: "Add to ~/.codex/config.toml" },
  { key: "gemini", name: "Gemini CLI", where: "Add to ~/.gemini/settings.json" },
  { key: "claude-desktop-json", name: "Claude Desktop (manual)", where: "Add to claude_desktop_config.json" },
];

const isWindows = navigator.userAgent.includes("Windows");

// For a shell command: single quotes on macOS/Linux, so "$" and backticks in the
// path can't expand; double quotes on Windows, where single quotes aren't quoting.
function shellQuote(path: string): string {
  return isWindows ? `"${path}"` : `'${path.replace(/'/g, `'\\''`)}'`;
}

function snippet(client: ClientKey, serverPath: string): string {
  // JSON string escaping also suits TOML basic strings (Windows backslashes).
  const path = JSON.stringify(serverPath);
  switch (client) {
    case "claude-code":
      return `claude mcp add --scope user cloaklm -- node ${shellQuote(serverPath)}`;
    case "codex":
      return `[mcp_servers.cloaklm]\ncommand = "node"\nargs = [${path}]`;
    case "gemini":
    case "claude-desktop-json":
      return JSON.stringify({ mcpServers: { cloaklm: { command: "node", args: [serverPath] } } }, null, 2);
  }
}

// Opened by the shell (open_privacy_link), which only knows these three pages.
const OPT_OUTS = [
  { label: "Claude", name: "claude" },
  { label: "ChatGPT / Codex", name: "openai" },
  { label: "Gemini API", name: "gemini" },
];

/**
 * Settings section: connect Claude Desktop, Claude Code, Codex or Gemini CLI to
 * CloakLM's MCP server, so people can use the subscription they already pay for.
 */
export function ConnectAiTools() {
  const [serverPath, setServerPath] = useState<string | null>(null);
  const [bundlePath, setBundlePath] = useState<string | null>(null);
  const [client, setClient] = useState<ClientKey>("claude-code");
  const [copied, setCopied] = useState(false);
  const [installError, setInstallError] = useState(false);

  useEffect(() => {
    resolveResource("mcp/server.cjs").then(setServerPath).catch(() => setServerPath(null));
    resolveResource("mcp/cloaklm.mcpb").then(setBundlePath).catch(() => setBundlePath(null));
  }, []);

  const installInClaudeDesktop = async () => {
    if (!bundlePath) return;
    setInstallError(false);
    // The shell opens the bundled file; if no app handles .mcpb (Claude Desktop
    // missing or too old) it shows the file in the file manager instead.
    const result = await invoke<string>("install_mcp_bundle").catch(() => "failed");
    if (result !== "opened") setInstallError(true);
  };

  const text = serverPath ? snippet(client, serverPath) : "";
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mb-8">
      <h2 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">🔌 Connect AI tools</h2>
      <div className="bg-surface border border-border rounded-xl p-4 space-y-4">
        <p className="text-xs text-text-secondary leading-relaxed">
          Already pay for Claude, ChatGPT or Gemini? Connect your AI app to CloakLM instead of adding an API key. In a
          project, turn on <strong>Share with AI tools</strong>. Your AI app can then read the{" "}
          <strong>redacted</strong> text of that project's documents. Real values stay in CloakLM. Paste the answer
          into <strong>Rehydrate</strong> to see it with the real values. CloakLM must be open while you chat.
        </p>

        <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-elevated border border-border">
          <div>
            <p className="text-xs font-semibold text-text-primary">Claude Desktop</p>
            <p className="text-[10px] text-text-muted">One-click extension install</p>
            {installError && (
              <p className="text-[10px] text-warning mt-1">
                Couldn't open it. In Claude Desktop, go to Settings → Extensions → Advanced settings → Install
                Extension and choose cloaklm.mcpb.
              </p>
            )}
          </div>
          <button
            onClick={installInClaudeDesktop}
            disabled={!bundlePath}
            className="px-3 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-xs font-medium transition-all shrink-0 disabled:opacity-40"
          >
            Install in Claude Desktop
          </button>
        </div>

        <div>
          <div className="flex flex-wrap gap-1 mb-2">
            {CLIENTS.map((c) => (
              <button
                key={c.key}
                onClick={() => setClient(c.key)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-lg transition-all ${
                  client === c.key ? "bg-primary/15 text-primary" : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mb-1.5">
            {CLIENTS.find((c) => c.key === client)?.where}. Needs Node.js 18 or newer.
          </p>
          <div className="relative">
            <pre className="bg-surface-elevated border border-border rounded-lg px-3 py-2 pr-16 text-[11px] font-mono text-text-primary whitespace-pre-wrap break-all">
              {serverPath ? text : "MCP server not found in this build. Run npm run build:mcp."}
            </pre>
            {serverPath && (
              <button
                onClick={copy}
                className="absolute right-2 top-2 px-2 py-0.5 text-[10px] rounded bg-surface border border-border text-text-secondary hover:text-text-primary"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>

        <p className="text-[10px] text-text-muted leading-relaxed">
          Redacted text you share is handled under your AI provider's terms. Consumer plans may keep chats or use them
          for training unless you opt out:{" "}
          {OPT_OUTS.map((o, i) => (
            <span key={o.name}>
              <button onClick={() => invoke("open_privacy_link", { name: o.name })} className="underline hover:text-text-secondary">
                {o.label}
              </button>
              {i < OPT_OUTS.length - 1 ? " · " : "."}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
