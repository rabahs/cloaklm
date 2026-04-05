import type { AppView } from "../types";

interface LeftRailProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  hasApiKey: boolean;
}

const NAV_ITEMS: { view: AppView; icon: string; label: string }[] = [
  { view: "chat", icon: "💬", label: "Chats" },
  { view: "projects", icon: "📁", label: "Projects" },
  { view: "history", icon: "🕰️", label: "History" },
];

export function LeftRail({ activeView, onNavigate, hasApiKey }: LeftRailProps) {
  return (
    <nav className="w-14 bg-surface-elevated border-r border-border flex flex-col items-center py-3 gap-1 shrink-0">
      {/* Logo */}
      <div className="w-9 h-9 rounded-xl overflow-hidden mb-4 shadow-sm border border-border">
        <img src="/logo.png" alt="CloakLM" className="w-full h-full object-cover" />
      </div>

      {/* Main nav */}
      {NAV_ITEMS.map((item) => (
        <button
          key={item.view}
          onClick={() => onNavigate(item.view)}
          className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
            activeView === item.view || (item.view === "projects" && activeView === "project-detail")
              ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20"
              : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
          }`}
          title={item.label}
        >
          {item.icon}
        </button>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings (bottom-pinned) */}
      <button
        onClick={() => onNavigate("settings")}
        className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
          activeView === "settings"
            ? "bg-primary/15 text-primary shadow-sm ring-1 ring-primary/20"
            : !hasApiKey
              ? "text-danger animate-pulse hover:bg-danger/10"
              : "text-text-muted hover:text-text-primary hover:bg-surface-hover"
        }`}
        title="Settings"
      >
        ⚙️
      </button>
    </nav>
  );
}
