import { useState, useRef, useCallback, useEffect } from "react";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { DropOverlay } from "./components/DropOverlay";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ReviewPanel } from "./components/ReviewPanel";
import { LeftRail } from "./components/LeftRail";
import { SettingsView } from "./components/SettingsView";
import { HistoryView } from "./components/HistoryView";
import { ProjectsView } from "./components/ProjectsView";
import { ProjectDetailView } from "./components/ProjectDetailView";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { callLLM, deepScanWithLLM } from "./llm";
import type { Message, Attachment, LLMProvider, AppSettings, AppView, ChatSession, Project } from "./types";
import { loadSettingsStore, saveSettingsStore, loadChatSessions, saveChatSessions, loadProjects, saveProjects } from "./store";
import { DocumentSidebar } from "./components/DocumentSidebar";

const DEFAULT_SETTINGS: AppSettings = {
  provider: "claude",
  apiKeys: {},
  ollamaUrl: "http://localhost:11434",
  activeModels: {
    claude: "claude-3-5-sonnet-latest",
    gemini: "gemini-3.1-pro",
    openai: "gpt-5.4-thinking",
    ollama: "llama3.2"
  },
  customModels: {
    claude: [], gemini: [], openai: [], ollama: []
  },
  showDocsSidebar: false
};

function App() {
  // --- Standalone chat state ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [historyAttachments, setHistoryAttachments] = useState<Record<string, Attachment>>({});
  const [reviewingAttachment, setReviewingAttachment] = useState<Attachment | null>(null);

  // --- Global app state ---
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeView, setActiveView] = useState<AppView>("chat");

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // --- Projects state ---
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Keep a ref to settings so async callbacks always see latest
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // --- UI state ---
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sidecarPort, setSidecarPort] = useState<number>(4321);
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>(["claude", "gemini", "openai", "ollama"]);
  const dragCounter = useRef(0);

  useEffect(() => {
    loadSettingsStore(DEFAULT_SETTINGS).then(setSettings);
    loadChatSessions().then(setChatSessions);
    loadProjects().then(setProjects);
  }, []);

  const provider = settings.provider;

  // --- Provider management ---
  const refreshAvailableProviders = useCallback(async (currentSettings: AppSettings) => {
    const available: LLMProvider[] = [];
    if (currentSettings.apiKeys.claude?.trim()) available.push("claude");
    if (currentSettings.apiKeys.gemini?.trim()) available.push("gemini");
    if (currentSettings.apiKeys.openai?.trim()) available.push("openai");
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${currentSettings.ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) available.push("ollama");
    } catch (e) { /* Ollama not reachable */ }
    setAvailableProviders(available);
    if (available.length > 0 && !available.includes(currentSettings.provider)) {
      setSettings(prev => ({ ...prev, provider: available[0] }));
    }
  }, []);

  const handleSelectModel = useCallback((p: LLMProvider, modelId: string) => {
    setSettings((prev) => {
      const baseActive = prev.activeModels || { claude: "claude-opus-4-6", gemini: "gemini-3.1-pro", openai: "gpt-5.4-thinking", ollama: "llama3.2" };
      const next = { ...prev, provider: p, activeModels: { ...baseActive, [p]: modelId } };
      saveSettingsStore(next);
      return next;
    });
  }, []);

  const addCustomModel = useCallback((prov: LLMProvider, modelId: string) => {
    setSettings((prev) => {
      const baseCustom = prev.customModels || { claude: [], gemini: [], openai: [], ollama: [] };
      const baseActive = prev.activeModels || { claude: "claude-opus-4-6", gemini: "gemini-3.1-pro", openai: "gpt-5.4-thinking", ollama: "llama3.2" };
      const next = {
        ...prev,
        provider: prov,
        customModels: { ...baseCustom, [prov]: [...(baseCustom[prov] || []), modelId] }
      };
      next.activeModels = { ...baseActive, [prov]: modelId };
      saveSettingsStore(next);
      return next;
    });
  }, []);

  const handleSaveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettingsStore(newSettings);
    refreshAvailableProviders(newSettings);
  }, [refreshAvailableProviders]);

  const handleToggleSidebar = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, showDocsSidebar: !prev.showDocsSidebar };
      saveSettingsStore(next);
      return next;
    });
  }, []);

  const hasApiKey = provider === "ollama" || !!settings.apiKeys[provider as keyof typeof settings.apiKeys]?.trim();

  // --- Drag & drop (standalone chat) ---
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);

  const handleFiles = useCallback((files: (File | string)[]) => {
    const pdfFiles = files.filter((f) => {
      const name = typeof f === "string" ? f : f.name;
      const type = typeof f === "string" ? "" : f.type;
      return type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    });

    pdfFiles.forEach(async (fileObj) => {
      const isPath = typeof fileObj === "string";
      const fileName = isPath ? fileObj.split(/[/\\]/).pop() || fileObj : fileObj.name;
      const attachmentId = crypto.randomUUID();
      const attachment: Attachment = { id: attachmentId, fileName, originalPath: isPath ? fileObj : fileName, status: "anonymizing" };
      setAttachments((prev) => [...prev, attachment]);

      try {
        const formData = new FormData();
        if (isPath) formData.append("file_path", fileObj);
        else formData.append("file", fileObj);

        const response = await fetch(`http://127.0.0.1:${sidecarPort}/api/process`, { method: "POST", body: formData });
        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();
        const updatedAttachment = {
          ...attachment,
          status: "ready" as const,
          redactionCount: data.redaction_count,
          anonymizedContent: data.anonymized_markdown,
          anonymizedFileName: anonymizeString(fileName, data.redaction_map),
          redactionMap: data.redaction_map,
        };

        setAttachments((prev) => prev.map((a) => (a.id === attachmentId ? updatedAttachment : a)));
        setHistoryAttachments((prev) => ({ ...prev, [attachmentId]: updatedAttachment }));

        // Deep scan if enabled (use ref to avoid stale closure)
        const currentSettings = settingsRef.current;
        if (currentSettings.deepScan?.enabled && updatedAttachment.anonymizedContent) {
          const deepScanAtt: Attachment = { ...updatedAttachment, status: "deep-scanning" };
          setAttachments((prev) => prev.map((a) => (a.id === attachmentId ? deepScanAtt : a)));
          setHistoryAttachments((prev) => ({ ...prev, [attachmentId]: deepScanAtt }));

          try {
            const suggestions = await deepScanWithLLM(
              updatedAttachment.anonymizedContent,
              currentSettings.ollamaUrl,
              currentSettings.deepScan.model
            );
            const scannedAtt: Attachment = { ...updatedAttachment, status: "ready", deepScanSuggestions: suggestions };
            setAttachments((prev) => prev.map((a) => (a.id === attachmentId ? scannedAtt : a)));
            setHistoryAttachments((prev) => ({ ...prev, [attachmentId]: scannedAtt }));
          } catch (e) {
            console.warn("Deep scan failed:", e);
            setAttachments((prev) => prev.map((a) => (a.id === attachmentId ? updatedAttachment : a)));
            setHistoryAttachments((prev) => ({ ...prev, [attachmentId]: updatedAttachment }));
          }
        }
      } catch {
        setAttachments((prev) =>
          prev.map((a) => a.id === attachmentId ? { ...a, status: "error" as const, error: "Anonymizer failed. Is the engine running?" } : a)
        );
      }
    });
  }, [sidecarPort]);

  // --- Sidecar health ---
  useEffect(() => {
    let interval: number;
    let attempts = 0;
    const unlistenPromise = listen<number>("sidecar-ready", (event) => {
      setSidecarPort(event.payload);
    }).catch(() => null);

    const checkHealth = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`);
        if (res.ok) { setEngineStatus('ready'); clearInterval(interval); }
      } catch { attempts++; if (attempts > 60) { setEngineStatus('error'); clearInterval(interval); } }
    };

    checkHealth();
    refreshAvailableProviders(settings);
    interval = window.setInterval(checkHealth, 2000);
    return () => { clearInterval(interval); unlistenPromise.then(u => u && u()); };
  }, [refreshAvailableProviders, settings, sidecarPort]);

  // --- Native Tauri drag & drop ---
  useEffect(() => {
    const unlistenEnter = listen('tauri://file-drop-hover', () => setIsDragging(true));
    const unlistenLeave = listen('tauri://file-drop-cancelled', () => setIsDragging(false));
    const unlistenDrop = listen<{paths: string[]}>('tauri://file-drop', (event) => {
      setIsDragging(false); dragCounter.current = 0;
      if (event.payload?.paths) handleFiles(event.payload.paths);
    });
    return () => { unlistenEnter.then(f => f()); unlistenLeave.then(f => f()); unlistenDrop.then(f => f()); };
  }, [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); dragCounter.current = 0;
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const anonymizeString = (text: string, redactionMap: Record<string, import("./types").RedactionEntry> = {}) => {
    let result = text;
    for (const entry of Object.values(redactionMap)) {
      if (entry.real_value.length > 2) result = result.split(entry.real_value).join(entry.placeholder);
    }
    return result;
  };

  const handleManualRedact = useCallback(
    (attachmentId: string, _selectedText: string, newContent: string, newEntry: import("./types").RedactionEntry) => {
      // Update in standalone chat attachments
      setAttachments((prev) =>
        prev.map((a) => {
          if (a.id !== attachmentId) return a;
          const key = `manual_${Date.now()}`;
          const newMap = { ...a.redactionMap, [key]: newEntry };
          return { ...a, anonymizedContent: newContent, anonymizedFileName: anonymizeString(a.fileName, newMap), redactionCount: (a.redactionCount || 0) + 1, redactionMap: newMap };
        })
      );
      setReviewingAttachment((prev) => {
        if (!prev || prev.id !== attachmentId) return prev;
        const key = `manual_${Date.now()}`;
        const newMap = { ...prev.redactionMap, [key]: newEntry };
        return { ...prev, anonymizedContent: newContent, anonymizedFileName: anonymizeString(prev.fileName, newMap), redactionCount: (prev.redactionCount || 0) + 1, redactionMap: newMap };
      });
      setHistoryAttachments(prev => {
        const current = prev[attachmentId];
        if (!current) return prev;
        const key = `manual_${Date.now()}`;
        const newMap = { ...current.redactionMap, [key]: newEntry };
        return { ...prev, [attachmentId]: { ...current, anonymizedContent: newContent, anonymizedFileName: anonymizeString(current.fileName, newMap), redactionCount: (current.redactionCount || 0) + 1, redactionMap: newMap } };
      });

      // Also update in project if this attachment belongs to one
      setProjects(prev => prev.map(p => {
        if (!p.attachments[attachmentId]) return p;
        const key = `manual_${Date.now()}`;
        const current = p.attachments[attachmentId];
        const newMap = { ...current.redactionMap, [key]: newEntry };
        const updated = { ...p, updatedAt: new Date().toISOString(), attachments: { ...p.attachments, [attachmentId]: { ...current, anonymizedContent: newContent, anonymizedFileName: anonymizeString(current.fileName, newMap), redactionCount: (current.redactionCount || 0) + 1, redactionMap: newMap } } };
        return updated;
      }));
    },
    [anonymizeString]
  );

  // --- Deep scan suggestion handlers ---
  const updateAttachmentSuggestions = useCallback((attachmentId: string, updater: (suggestions: import("./types").DeepScanSuggestion[]) => import("./types").DeepScanSuggestion[]) => {
    const update = (att: Attachment): Attachment => {
      if (att.id !== attachmentId) return att;
      return { ...att, deepScanSuggestions: updater(att.deepScanSuggestions || []) };
    };
    setAttachments(prev => prev.map(update));
    setHistoryAttachments(prev => {
      const current = prev[attachmentId];
      if (!current) return prev;
      return { ...prev, [attachmentId]: update(current) };
    });
    setReviewingAttachment(prev => prev ? update(prev) : null);
    setProjects(prev => prev.map(p => {
      if (!p.attachments[attachmentId]) return p;
      return { ...p, attachments: { ...p.attachments, [attachmentId]: update(p.attachments[attachmentId]) } };
    }));
  }, []);

  const handleAcceptSuggestion = useCallback((attachmentId: string, suggestionId: string) => {
    // Find the suggestion and create a manual redaction from it
    const att = historyAttachments[attachmentId] || Object.values(projects.flatMap(p => Object.values(p.attachments))).find(a => a.id === attachmentId);
    const suggestion = att?.deepScanSuggestions?.find(s => s.id === suggestionId);
    if (!suggestion || !att?.anonymizedContent) return;

    const manualCount = Object.values(att.redactionMap || {}).filter(e => e.category === "manual").length;
    const placeholder = `[MANUAL_${manualCount + 1}]`;
    const newContent = att.anonymizedContent.split(suggestion.text).join(placeholder);
    const newEntry: import("./types").RedactionEntry = { real_value: suggestion.text, placeholder, category: suggestion.category || "manual", source: "deep-scan", sourceModel: settings.deepScan?.model };

    handleManualRedact(attachmentId, suggestion.text, newContent, newEntry);
    updateAttachmentSuggestions(attachmentId, suggestions =>
      suggestions.map(s => s.id === suggestionId ? { ...s, status: "accepted" as const } : s)
    );
  }, [historyAttachments, projects, handleManualRedact, updateAttachmentSuggestions]);

  const handleDismissSuggestion = useCallback((attachmentId: string, suggestionId: string) => {
    updateAttachmentSuggestions(attachmentId, suggestions =>
      suggestions.map(s => s.id === suggestionId ? { ...s, status: "dismissed" as const } : s)
    );
  }, [updateAttachmentSuggestions]);

  const handleAcceptAllSuggestions = useCallback((attachmentId: string) => {
    const att = historyAttachments[attachmentId] || Object.values(projects.flatMap(p => Object.values(p.attachments))).find(a => a.id === attachmentId);
    if (!att?.anonymizedContent) return;
    const pending = att.deepScanSuggestions?.filter(s => s.status === "pending") || [];
    if (pending.length === 0) return;

    // Batch all replacements in one pass to avoid stale state
    let content = att.anonymizedContent;
    const existingManual = Object.values(att.redactionMap || {}).filter(e => e.category === "manual").length;
    const newEntries: Record<string, import("./types").RedactionEntry> = {};

    pending.forEach((s, i) => {
      const placeholder = `[MANUAL_${existingManual + i + 1}]`;
      content = content.split(s.text).join(placeholder);
      newEntries[`manual_${Date.now()}_${i}`] = {
        real_value: s.text,
        placeholder,
        category: s.category || "manual",
        source: "deep-scan",
        sourceModel: settings.deepScan?.model,
      };
    });

    const newMap = { ...att.redactionMap, ...newEntries };
    const newCount = (att.redactionCount || 0) + pending.length;
    const newFileName = anonymizeString(att.fileName, newMap);

    // Update all state sources atomically
    const updatedAtt: Attachment = {
      ...att,
      anonymizedContent: content,
      anonymizedFileName: newFileName,
      redactionCount: newCount,
      redactionMap: newMap,
      deepScanSuggestions: att.deepScanSuggestions?.map(s =>
        s.status === "pending" ? { ...s, status: "accepted" as const } : s
      ),
    };

    setAttachments(prev => prev.map(a => a.id === attachmentId ? updatedAtt : a));
    setHistoryAttachments(prev => prev[attachmentId] ? { ...prev, [attachmentId]: updatedAtt } : prev);
    setReviewingAttachment(prev => prev?.id === attachmentId ? updatedAtt : prev);
    setProjects(prev => prev.map(p =>
      p.attachments[attachmentId] ? { ...p, attachments: { ...p.attachments, [attachmentId]: updatedAtt } } : p
    ));
  }, [historyAttachments, projects, settings, anonymizeString]);

  const handleDismissAllSuggestions = useCallback((attachmentId: string) => {
    updateAttachmentSuggestions(attachmentId, suggestions =>
      suggestions.map(s => s.status === "pending" ? { ...s, status: "dismissed" as const } : s)
    );
  }, [updateAttachmentSuggestions]);

  // --- Standalone chat: send message ---
  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() && attachments.length === 0) return;
      const currentTurnReady = attachments.filter((a) => a.status === "ready");
      const currentHistoryMap = { ...historyAttachments };
      currentTurnReady.forEach(a => { currentHistoryMap[a.id] = a; });
      const currentFullContext = Object.values(currentHistoryMap);

      const userMessage: Message = { id: crypto.randomUUID(), role: "user", content, timestamp: new Date(), attachments: currentFullContext.length > 0 ? currentFullContext : undefined, provider };
      setMessages((prev) => [...prev, userMessage]);
      setAttachments([]);
      setIsLoading(true);

      try {
        const rawResponse = await callLLM({
          provider, apiKeys: settings.apiKeys, ollamaUrl: settings.ollamaUrl,
          activeModel: settings.activeModels?.[provider] || "unknown",
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          attachments: currentFullContext,
        });
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: rawResponse, timestamp: new Date(), provider, modelId: settings.activeModels?.[provider] || "unknown", attachments: currentFullContext }]);
      } catch (error) {
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: `⚠️ ${error instanceof Error ? error.message : "Failed to get response."}`, timestamp: new Date(), provider, modelId: settings.activeModels?.[provider] || "unknown" }]);
      } finally { setIsLoading(false); }
    },
    [attachments, historyAttachments, messages, provider, settings]
  );

  // --- Session auto-save ---
  useEffect(() => {
    if (messages.length === 0) return;
    let sessionId = currentSessionId;
    let title = messages.find(m => m.role === 'user')?.content.substring(0, 40) || 'New Conversation';
    if (title.length >= 40) title += '...';
    if (!sessionId) { sessionId = crypto.randomUUID(); setCurrentSessionId(sessionId); }

    const updatedSessions = chatSessions.filter(s => s.id !== sessionId);
    updatedSessions.unshift({ id: sessionId, title, updatedAt: new Date().toISOString(), messages, attachments: [], historyAttachments });
    setChatSessions(updatedSessions);
    saveChatSessions(updatedSessions);
  }, [messages, historyAttachments]);

  const handleNewChat = useCallback(() => {
    setMessages([]); setAttachments([]); setHistoryAttachments({}); setCurrentSessionId(null); setActiveView("chat");
  }, []);

  const handleExport = async () => {
    if (messages.length === 0) return;
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filePath = await save({ filters: [{ name: 'Markdown', extensions: ['md'] }], defaultPath: `cloaklm_transcript_${timestamp}.md` });
      if (!filePath) return;
      let content = `# CloakLM Chat Transcript\n\n**Date:** ${new Date().toLocaleString()}\n**Model:** \`${settings.activeModels?.[settings.provider] || 'unknown'}\`\n\n---\n\n`;
      messages.forEach(msg => {
        content += `## ${msg.role === 'user' ? '👤 USER' : '🤖 CLOAK-LLM'}\n\n${msg.content}\n\n`;
        if (msg.attachments?.length) content += `*Attachments:* ${msg.attachments.map(a => `\`${a.fileName}\``).join(', ')}\n\n`;
        content += `---\n\n`;
      });
      content += `*Exported via CloakLM — Privacy-First LLM Interface*\n`;
      await writeTextFile(filePath, content);
    } catch (err) { console.error("Failed to export:", err); }
  };

  // --- Navigation ---
  const handleNavigate = useCallback((view: AppView) => {
    if (view === "projects" && activeView === "project-detail") {
      setActiveProjectId(null);
    }
    setActiveView(view);
  }, [activeView]);

  const handleHistorySelect = useCallback((session: ChatSession) => {
    if (session.projectId) {
      // Open the project and let user navigate from there
      setActiveProjectId(session.projectId);
      setActiveView("project-detail");
    } else {
      setMessages(session.messages);
      setHistoryAttachments(session.historyAttachments || {});
      setCurrentSessionId(session.id);
      setAttachments([]);
      setActiveView("chat");
    }
  }, []);

  const handleHistoryDelete = useCallback((id: string) => {
    const updated = chatSessions.filter(s => s.id !== id);
    setChatSessions(updated);
    saveChatSessions(updated);
    if (currentSessionId === id) handleNewChat();
  }, [chatSessions, currentSessionId, handleNewChat]);

  // --- Project CRUD ---
  const handleCreateProject = useCallback((name: string) => {
    const newProject: Project = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attachments: {},
    };
    const updated = [newProject, ...projects];
    setProjects(updated);
    saveProjects(updated);
  }, [projects]);

  const handleOpenProject = useCallback((projectId: string) => {
    setActiveProjectId(projectId);
    setActiveView("project-detail");
  }, []);

  const handleRenameProject = useCallback((projectId: string, name: string) => {
    const updated = projects.map(p => p.id === projectId ? { ...p, name, updatedAt: new Date().toISOString() } : p);
    setProjects(updated);
    saveProjects(updated);
  }, [projects]);

  const handleDeleteProject = useCallback((projectId: string) => {
    const updated = projects.filter(p => p.id !== projectId);
    setProjects(updated);
    saveProjects(updated);
    // Also delete project chats
    const updatedSessions = chatSessions.filter(s => s.projectId !== projectId);
    setChatSessions(updatedSessions);
    saveChatSessions(updatedSessions);
    if (activeProjectId === projectId) { setActiveProjectId(null); setActiveView("projects"); }
  }, [projects, chatSessions, activeProjectId]);

  const handleUpdateProject = useCallback((updatedOrUpdater: Project | ((prev: Project) => Project)) => {
    setProjects(prev => {
      const next = prev.map(p => {
        if (typeof updatedOrUpdater === "function") {
          // Find which project the updater targets — apply to all, updater checks internally
          return updatedOrUpdater(p);
        }
        return p.id === updatedOrUpdater.id ? updatedOrUpdater : p;
      });
      saveProjects(next);
      return next;
    });
  }, []);

  const handleSaveProjectChat = useCallback((session: ChatSession) => {
    setChatSessions(prev => {
      const filtered = prev.filter(s => s.id !== session.id);
      const next = [session, ...filtered];
      saveChatSessions(next);
      return next;
    });
  }, []);

  const handleDeleteProjectChat = useCallback((id: string) => {
    setChatSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      saveChatSessions(next);
      return next;
    });
  }, []);

  // Save projects whenever they change from manual redaction
  useEffect(() => {
    if (projects.length > 0) saveProjects(projects);
  }, [projects]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === "n") { e.preventDefault(); handleNewChat(); }
      else if (isMod && e.key === ",") { e.preventDefault(); setActiveView("settings"); }
      else if (isMod && e.key === "h") { e.preventDefault(); setActiveView("history"); }
      else if (isMod && e.key === "d") { e.preventDefault(); handleToggleSidebar(); }
      else if (isMod && e.key === "p") { e.preventDefault(); setActiveView("projects"); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewChat, handleToggleSidebar]);

  // --- Render views ---
  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  const renderView = () => {
    switch (activeView) {
      case "settings":
        return (
          <div className="flex-1 flex flex-col overflow-hidden animate-view-enter" key="settings">
            <SettingsView settings={settings} onSave={handleSaveSettings} isOllamaAvailable={availableProviders.includes("ollama")} />
          </div>
        );

      case "history":
        return (
          <div className="flex-1 flex flex-col overflow-hidden animate-view-enter" key="history">
            <HistoryView
              sessions={chatSessions}
              currentSessionId={currentSessionId}
              projects={projects}
              onSelect={handleHistorySelect}
              onDelete={handleHistoryDelete}
            />
          </div>
        );

      case "projects":
        return (
          <div className="flex-1 flex flex-col overflow-hidden animate-view-enter" key="projects">
            <ProjectsView
              projects={projects}
              onCreateProject={handleCreateProject}
              onOpenProject={handleOpenProject}
              onRenameProject={handleRenameProject}
              onDeleteProject={handleDeleteProject}
            />
          </div>
        );

      case "project-detail":
        if (!activeProject) {
          setActiveView("projects");
          return null;
        }
        return (
          <ProjectDetailView
            key={`project-${activeProject.id}`}
            project={activeProject}
            chatSessions={chatSessions}
            settings={settings}
            sidecarPort={sidecarPort}
            engineStatus={engineStatus}
            onBack={() => { setActiveProjectId(null); setActiveView("projects"); }}
            onUpdateProject={handleUpdateProject}
            onReviewAttachment={setReviewingAttachment}
            onSaveChatSession={handleSaveProjectChat}
            onDeleteChatSession={handleDeleteProjectChat}
            onSelectModel={handleSelectModel}
            addCustomModel={addCustomModel}
          />
        );

      case "chat":
      default:
        return (
          <div
            className="flex-1 flex flex-col overflow-hidden"
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <ChatHeader
              onNewChat={handleNewChat}
              hasMessages={messages.length > 0}
              isSidebarOpen={!!settings.showDocsSidebar}
              onToggleSidebar={handleToggleSidebar}
              onExport={handleExport}
              docCount={Object.keys(historyAttachments).length}
            />

            <div className="flex-1 flex overflow-hidden">
              <main className="flex-1 overflow-hidden flex flex-col relative">
                {engineStatus === 'loading' && (
                  <div className="absolute top-0 left-0 right-0 bg-primary/10 border-b border-primary/20 p-2 text-center text-sm text-primary animate-pulse z-10">
                    🛡️ CloakLM Shield is initializing AI models... (30-40 seconds)
                  </div>
                )}
                {isLoading && (
                  <div className="p-4 flex items-center justify-center gap-3 text-text-muted animate-pulse border-t border-border bg-surface/50">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
                    <span className="text-xs font-medium ml-2">CloakLM is thinking...</span>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-[10px] uppercase tracking-widest bg-success/10 text-success px-2 py-0.5 rounded-full border border-success/20 font-bold">🛡️ Sentinel Firewall</span>
                      {Object.keys(historyAttachments).length > 0 && (
                        <span className="text-[10px] uppercase tracking-widest bg-primary/10 text-primary px-2 py-0.5 rounded-full border border-primary/20 font-bold animate-pulse">
                          📄 {Object.keys(historyAttachments).length} Docs Indexed
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {engineStatus === 'error' && (
                  <div className="absolute top-0 left-0 right-0 bg-red-500/10 border-b border-red-500/20 p-2 text-center text-sm text-red-500 z-10">
                    ⚠️ AI Engine failed to start. Please restart the application.
                  </div>
                )}
                {messages.length === 0 ? <WelcomeScreen /> : <MessageList messages={messages} isLoading={isLoading} />}
              </main>
              {settings.showDocsSidebar && (
                <DocumentSidebar documents={Object.values(historyAttachments)} onReview={setReviewingAttachment} onClose={handleToggleSidebar} />
              )}
            </div>

            <ChatInput
              onSend={sendMessage}
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
              onReviewAttachment={setReviewingAttachment}
              onAttachFiles={handleFiles}
              isLoading={isLoading}
              provider={provider}
              activeModel={settings.activeModels?.[provider] || ""}
              onSelectModel={handleSelectModel}
              apiKeys={settings.apiKeys}
              ollamaUrl={settings.ollamaUrl}
              customModels={settings.customModels || {}}
              onAddCustomModel={addCustomModel}
            />
            {isDragging && <DropOverlay />}
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-surface relative">
      <LeftRail activeView={activeView} onNavigate={handleNavigate} hasApiKey={hasApiKey} />
      <div className="flex-1 flex flex-col overflow-hidden">
        {renderView()}
      </div>
      {reviewingAttachment && (
        <ReviewPanel
          attachment={reviewingAttachment}
          onClose={() => setReviewingAttachment(null)}
          onManualRedact={handleManualRedact}
          onAcceptSuggestion={handleAcceptSuggestion}
          onDismissSuggestion={handleDismissSuggestion}
          onAcceptAllSuggestions={handleAcceptAllSuggestions}
          onDismissAllSuggestions={handleDismissAllSuggestions}
          deepScanEnabled={!!settings.deepScan?.enabled}
          deepScanModel={settings.deepScan?.model}
        />
      )}
    </div>
  );
}

export default App;
