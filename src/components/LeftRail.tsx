import type { AppView } from "../types";
import { ChatIcon, ClockIcon, FolderIcon, SettingsIcon } from "./Icons";

interface LeftRailProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  hasApiKey: boolean;
}

const NAV_ITEMS: { view: AppView; Icon: typeof ChatIcon; label: string }[] = [
  { view: "chat", Icon: ChatIcon, label: "Chat" },
  { view: "projects", Icon: FolderIcon, label: "Projects" },
  { view: "history", Icon: ClockIcon, label: "History" },
];

export function LeftRail({ activeView, onNavigate, hasApiKey }: LeftRailProps) {
  return (
    <nav className="w-14 bg-surface-elevated/40 flex flex-col items-center py-3 gap-1.5 shrink-0">
      {/* Logo */}
      <div className="w-8 h-8 rounded-lg overflow-hidden mb-4">
        <img src="/logo.png" alt="CloakLM" className="w-full h-full object-cover" />
      </div>

      {/* Main nav */}
      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          onClick={() => onNavigate(item.view)}
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
            activeView === item.view || (item.view === "projects" && activeView === "project-detail")
              ? "bg-surface-hover text-text-primary"
              : "text-text-muted hover:text-text-primary hover:bg-surface-hover/60"
          }`}
          title={item.label}
        >
          <item.Icon className="w-5 h-5" />
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings (bottom-pinned) */}
      <button
        onClick={() => onNavigate("settings")}
        className={`relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
          activeView === "settings"
            ? "bg-surface-hover text-text-primary"
            : "text-text-muted hover:text-text-primary hover:bg-surface-hover/60"
        }`}
        title={hasApiKey ? "Settings" : "Settings: add an API key to start chatting"}
      >
        <SettingsIcon className="w-5 h-5" />
        {!hasApiKey && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-danger" />}
      </button>
    </nav>
  );
}
