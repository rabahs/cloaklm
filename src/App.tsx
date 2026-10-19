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
import { invoke } from "@tauri-apps/api/core";
import { callLLM, deepScanWithLLM, identifiabilityCheckWithLLM } from "./llm";
import type { Message, Attachment, LLMProvider, AppSettings, AppView, ChatSession, Project } from "./types";
import { loadSettingsStore, saveSettingsStore, loadChatSessions, saveChatSessions, loadProjects, saveProjects } from "./store";
import { DEFAULT_MODELS, MODELS_VERSION } from "./models";
import { EngineStatus, type EngineStage } from "./components/EngineStatus";
import { sidecarFetch, buildSharedDocuments, pushSharedDocuments } from "./sidecar";
import { anonymizeFileName, nextManualPlaceholder, replaceSelection } from "./redact";

const DEFAULT_SETTINGS: AppSettings = {
  provider: "claude",
  apiKeys: {},
  ollamaUrl: "http://localhost:11434",
  activeModels: { ...DEFAULT_MODELS },
  modelsVersion: MODELS_VERSION,
  customModels: {
    claude: [], gemini: [], openai: [], ollama: []
  },
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
  const [engineStage, setEngineStage] = useState<EngineStage>('unpacking');
  // Unknown until the shell reports the port the engine actually bound. Nothing is
  // sent (and no token leaves the app) before then.
  const [sidecarPort, setSidecarPort] = useState<number | null>(null);
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
      const baseActive = prev.activeModels || DEFAULT_MODELS;
      const next = { ...prev, provider: p, activeModels: { ...baseActive, [p]: modelId } };
      saveSettingsStore(next);
      return next;
    });
  }, []);

  const addCustomModel = useCallback((prov: LLMProvider, modelId: string) => {
    setSettings((prev) => {
      const baseCustom = prev.customModels || { claude: [], gemini: [], openai: [], ollama: [] };
      const baseActive = prev.activeModels || DEFAULT_MODELS;
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

        if (sidecarPort === null) throw new Error("engine not ready");
        const response = await sidecarFetch(sidecarPort, "/api/process", { method: "POST", body: formData });
        if (!response.ok) throw new Error(await response.text());

        const data = await response.json();
        const updatedAttachment = {
          ...attachment,
          status: "ready" as const,
          redactionCount: data.redaction_count,
          anonymizedContent: data.anonymized_markdown,
          anonymizedFileName: anonymizeFileName(fileName, data.redaction_map),
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
            const scannedAtt: Attachment = { ...updatedAttachment, status: "ready", deepScanSuggestions: suggestions, deepScannedAt: new Date().toISOString() };
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
    // A restarting engine gets a new port: forget the old one at once.
    const unlistenDown = listen("sidecar-down", () => {
      setSidecarPort(null);
      setEngineStatus("loading");
      setEngineStage("unpacking");
    }).catch(() => null);
    // The engine may have announced its port before this listener existed.
    if (sidecarPort === null) invoke<number | null>("get_sidecar_port").then((port) => port && setSidecarPort(port)).catch(() => {});
    const unlistenStage = listen<string>("sidecar-stage", (event) => {
      setEngineStage((prev) => (prev === "ready" ? prev : (event.payload as EngineStage)));
    }).catch(() => null);

    const checkHealth = async () => {
      if (sidecarPort === null) return;
      try {
        const res = await sidecarFetch(sidecarPort, "/health");
        if (res.ok) { setEngineStatus('ready'); setEngineStage('ready'); clearInterval(interval); }
      } catch { attempts++; if (attempts > 60) { setEngineStatus('error'); setEngineStage('error'); clearInterval(interval); } }
    };

    checkHealth();
    refreshAvailableProviders(settings);
    interval = window.setInterval(checkHealth, 2000);
    return () => { clearInterval(interval); unlistenPromise.then(u => u && u()); unlistenDown.then(u => u && u()); unlistenStage.then(u => u && u()); };
  }, [refreshAvailableProviders, settings, sidecarPort]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); dragCounter.current = 0;
    handleFiles(Array.from(e.dataTransfer.files));
  }, [handleFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);


  const handleManualRedact = useCallback(
    (attachmentId: string, _selectedText: string, newContent: string, newEntry: import("./types").RedactionEntry) => {
      // Update in standalone chat attachments
      setAttachments((prev) =>
        prev.map((a) => {
          if (a.id !== attachmentId) return a;
          const key = `manual_${Date.now()}`;
          const newMap = { ...a.redactionMap, [key]: newEntry };
          return { ...a, anonymizedContent: newContent, anonymizedFileName: anonymizeFileName(a.fileName, newMap), redactionCount: (a.redactionCount || 0) + 1, redactionMap: newMap };
        })
      );
      setReviewingAttachment((prev) => {
        if (!prev || prev.id !== attachmentId) return prev;
        const key = `manual_${Date.now()}`;
        const newMap = { ...prev.redactionMap, [key]: newEntry };
        return { ...prev, anonymizedContent: newContent, anonymizedFileName: anonymizeFileName(prev.fileName, newMap), redactionCount: (prev.redactionCount || 0) + 1, redactionMap: newMap };
      });
      setHistoryAttachments(prev => {
        const current = prev[attachmentId];
        if (!current) return prev;
        const key = `manual_${Date.now()}`;
        const newMap = { ...current.redactionMap, [key]: newEntry };
        return { ...prev, [attachmentId]: { ...current, anonymizedContent: newContent, anonymizedFileName: anonymizeFileName(current.fileName, newMap), redactionCount: (current.redactionCount || 0) + 1, redactionMap: newMap } };
      });

      // Also update in project if this attachment belongs to one
      setProjects(prev => prev.map(p => {
        if (!p.attachments[attachmentId]) return p;
        const key = `manual_${Date.now()}`;
        const current = p.attachments[attachmentId];
        const newMap = { ...current.redactionMap, [key]: newEntry };
        const updated = { ...p, updatedAt: new Date().toISOString(), attachments: { ...p.attachments, [attachmentId]: { ...current, anonymizedContent: newContent, anonymizedFileName: anonymizeFileName(current.fileName, newMap), redactionCount: (current.redactionCount || 0) + 1, redactionMap: newMap } } };
        return updated;
      }));
    },
    []
  );

  // --- Deep scan suggestion handlers ---
  // Applies a change to one attachment wherever it lives (chat, history, review, projects).
  const updateAttachment = useCallback((attachmentId: string, change: (att: Attachment) => Attachment) => {
    const update = (att: Attachment): Attachment => (att.id === attachmentId ? change(att) : att);
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

  const updateAttachmentSuggestions = useCallback((attachmentId: string, updater: (suggestions: import("./types").DeepScanSuggestion[]) => import("./types").DeepScanSuggestion[]) => {
    updateAttachment(attachmentId, att => ({ ...att, deepScanSuggestions: updater(att.deepScanSuggestions || []) }));
  }, [updateAttachment]);

  // --- Identifiability check (local Ollama) ---
  const identifiabilityModel = availableProviders.includes("ollama")
    ? settings.deepScan?.model || settings.activeModels?.ollama || undefined
    : undefined;
  const [checkingIdentifiability, setCheckingIdentifiability] = useState<Record<string, boolean>>({});
  const [identifiabilityError, setIdentifiabilityError] = useState<Record<string, string>>({});

  const handleIdentifiabilityCheck = useCallback(async (attachmentId: string) => {
    const att = historyAttachments[attachmentId] || projects.flatMap(p => Object.values(p.attachments)).find(a => a.id === attachmentId)
      || attachments.find(a => a.id === attachmentId);
    if (!att?.anonymizedContent || !identifiabilityModel) return;

    setCheckingIdentifiability(prev => ({ ...prev, [attachmentId]: true }));
    setIdentifiabilityError(prev => ({ ...prev, [attachmentId]: "" }));
    try {
      const found = await identifiabilityCheckWithLLM(att.anonymizedContent, settings.ollamaUrl, identifiabilityModel);
      updateAttachment(attachmentId, current => {
        // Drop anything already suggested or already redacted.
        const known = new Set((current.deepScanSuggestions || []).map(s => s.text.toLowerCase()));
        const fresh = found.filter(s => !known.has(s.text.toLowerCase()) && current.anonymizedContent?.includes(s.text));
        return {
          ...current,
          deepScanSuggestions: [...(current.deepScanSuggestions || []), ...fresh],
          identifiabilityCheckedAt: new Date().toISOString(),
        };
      });
    } catch (e) {
      setIdentifiabilityError(prev => ({ ...prev, [attachmentId]: e instanceof Error ? e.message : "Check failed" }));
    } finally {
      setCheckingIdentifiability(prev => ({ ...prev, [attachmentId]: false }));
    }
  }, [historyAttachments, projects, attachments, identifiabilityModel, settings.ollamaUrl, updateAttachment]);

  // Deep Scan on demand (also a second model for the sharing gate).
  const [deepScanning, setDeepScanning] = useState<Record<string, boolean>>({});
  const handleRunDeepScan = useCallback(async (attachmentId: string) => {
    const att = historyAttachments[attachmentId] || projects.flatMap(p => Object.values(p.attachments)).find(a => a.id === attachmentId)
      || attachments.find(a => a.id === attachmentId);
    if (!att?.anonymizedContent || !identifiabilityModel) return;
    setDeepScanning(prev => ({ ...prev, [attachmentId]: true }));
    setIdentifiabilityError(prev => ({ ...prev, [attachmentId]: "" }));
    try {
      const found = await deepScanWithLLM(att.anonymizedContent, settings.ollamaUrl, identifiabilityModel);
      updateAttachment(attachmentId, current => {
        const known = new Set((current.deepScanSuggestions || []).map(s => s.text.toLowerCase()));
        const fresh = found.filter(s => !known.has(s.text.toLowerCase()) && current.anonymizedContent?.includes(s.text));
        return { ...current, deepScanSuggestions: [...(current.deepScanSuggestions || []), ...fresh], deepScannedAt: new Date().toISOString() };
      });
    } catch (e) {
      setIdentifiabilityError(prev => ({ ...prev, [attachmentId]: e instanceof Error ? e.message : "Deep Scan failed" }));
    } finally {
      setDeepScanning(prev => ({ ...prev, [attachmentId]: false }));
    }
  }, [historyAttachments, projects, attachments, identifiabilityModel, settings.ollamaUrl, updateAttachment]);

  const handleApproveForSharing = useCallback((attachmentId: string, approve: boolean) => {
    updateAttachment(attachmentId, current => ({ ...current, approvedForSharingAt: approve ? new Date().toISOString() : undefined }));
  }, [updateAttachment]);

  const handleAcceptSuggestion = useCallback((attachmentId: string, suggestionId: string) => {
    // Find the suggestion and create a manual redaction from it
    const att = historyAttachments[attachmentId] || Object.values(projects.flatMap(p => Object.values(p.attachments))).find(a => a.id === attachmentId);
    const suggestion = att?.deepScanSuggestions?.find(s => s.id === suggestionId);
    if (!suggestion || !att?.anonymizedContent) return;

    const placeholder = nextManualPlaceholder(att.redactionMap);
    const newContent = replaceSelection(att.anonymizedContent, suggestion.text, placeholder);
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
    const newEntries: Record<string, import("./types").RedactionEntry> = {};

    pending.forEach((s, i) => {
      const placeholder = nextManualPlaceholder({ ...att.redactionMap, ...newEntries });
      content = replaceSelection(content, s.text, placeholder);
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
    const newFileName = anonymizeFileName(att.fileName, newMap);

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
  }, [historyAttachments, projects, settings]);

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
      let content = `# CloakLM Chat Transcript\n\n**Date:** ${new Date().toLocaleString()}\n**Model:** \`${settings.activeModels?.[settings.provider] || 'unknown'}\`\n\n---\n\n`;
      messages.forEach(msg => {
        content += `## ${msg.role === 'user' ? '👤 USER' : '🤖 CLOAK-LLM'}\n\n${msg.content}\n\n`;
        if (msg.attachments?.length) content += `*Attachments:* ${msg.attachments.map(a => `\`${a.fileName}\``).join(', ')}\n\n`;
        content += `---\n\n`;
      });
      content += `*Exported via CloakLM — Privacy-First LLM Interface*\n`;
      // The shell shows the save dialog and writes the file; the webview has no file access.
      await invoke("export_transcript", { contents: content, fileName: `cloaklm_transcript_${timestamp}.md` });
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

  // --- Share redacted documents with AI tools (MCP) ---
  // Re-sent on every change: covers sharing toggles, new documents, manual
  // redactions, accepted deep-scan suggestions, and a restarted sidecar.
  useEffect(() => {
    if (engineStatus !== "ready" || sidecarPort === null) return;
    const port = sidecarPort;
    const documents = buildSharedDocuments(projects);
    let cancelled = false;
    let retry: number | undefined;
    // A restarted sidecar announces its port just before it starts listening.
    const push = (attempt: number) => {
      pushSharedDocuments(port, documents).catch((e) => {
        if (cancelled) return;
        if (attempt < 10) retry = window.setTimeout(() => push(attempt + 1), 2000);
        else console.warn("Could not update shared documents:", e);
      });
    };
    push(0);
    return () => { cancelled = true; clearTimeout(retry); };
  }, [projects, sidecarPort, engineStatus]);

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
      else if (isMod && e.key === "p") { e.preventDefault(); setActiveView("projects"); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewChat]);

  // --- Render views ---
  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  const chatInput = (variant: "hero" | "docked") => (
    <ChatInput
      variant={variant}
      engineReady={engineStage === "ready"}
      onSend={sendMessage}
      attachments={attachments}
      onRemoveAttachment={removeAttachment}
      onReviewAttachment={setReviewingAttachment}
      onAttachFiles={handleFiles}
      onAttachProjectDoc={(doc) => {
        setHistoryAttachments(prev => ({ ...prev, [doc.id]: doc }));
        setAttachments(prev => [...prev, doc]);
      }}
      projects={projects}
      isLoading={isLoading}
      provider={provider}
      activeModel={settings.activeModels?.[provider] || ""}
      onSelectModel={handleSelectModel}
      apiKeys={settings.apiKeys}
      ollamaUrl={settings.ollamaUrl}
      customModels={settings.customModels || {}}
      onAddCustomModel={addCustomModel}
    />
  );

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
              onExport={handleExport}
              docCount={Object.keys(historyAttachments).length}
            />

            {messages.length === 0 ? (
              <WelcomeScreen
                projects={projects}
                onOpenProject={handleOpenProject}
                onStartProjectChat={(projectId) => { setActiveProjectId(projectId); setActiveView("project-detail"); }}
                onCreateProject={(name) => {
                  const id = crypto.randomUUID();
                  const newProject = { id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attachments: {} };
                  const updated = [newProject, ...projects];
                  setProjects(updated);
                  saveProjects(updated);
                  setActiveProjectId(id);
                  setActiveView("project-detail");
                }}
                status={engineStage !== "ready" ? <EngineStatus stage={engineStage} /> : undefined}
                composer={chatInput("hero")}
              />
            ) : (
              <>
                <main className="flex-1 overflow-hidden flex flex-col relative">
                  {engineStage === "error" && (
                    <div className="max-w-3xl w-full mx-auto px-4 pt-2"><EngineStatus stage="error" /></div>
                  )}
                  <MessageList messages={messages} isLoading={isLoading} />
                  {isLoading && (
                    <div className="max-w-3xl w-full mx-auto px-6 pb-2 flex items-center gap-2 text-text-muted">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.3s]" />
                      <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" />
                      <span className="text-xs ml-1">Thinking...</span>
                    </div>
                  )}
                </main>
                {chatInput("docked")}
              </>
            )}
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
          identifiabilityModel={identifiabilityModel}
          identifiabilityChecking={!!checkingIdentifiability[reviewingAttachment.id]}
          identifiabilityError={identifiabilityError[reviewingAttachment.id] || undefined}
          onRunIdentifiabilityCheck={handleIdentifiabilityCheck}
          deepScanRunning={!!deepScanning[reviewingAttachment.id]}
          onRunDeepScan={handleRunDeepScan}
          onApproveForSharing={handleApproveForSharing}
        />
      )}
    </div>
  );
}

export default App;
