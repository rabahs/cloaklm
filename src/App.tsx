import { useState, useRef, useCallback, useEffect } from "react";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { DropOverlay } from "./components/DropOverlay";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ReviewPanel } from "./components/ReviewPanel";
import { SettingsModal } from "./components/SettingsModal";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { callLLM } from "./llm";
import type { Message, Attachment, LLMProvider, AppSettings, ChatSession } from "./types";
import { loadSettingsStore, saveSettingsStore, loadChatSessions, saveChatSessions } from "./store";
import { HistoryModal } from "./components/HistoryModal";
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [historyAttachments, setHistoryAttachments] = useState<Record<string, Attachment>>({});
  const [reviewingAttachment, setReviewingAttachment] = useState<Attachment | null>(null);
  
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [sidecarPort, setSidecarPort] = useState<number>(4321);
  const [availableProviders, setAvailableProviders] = useState<LLMProvider[]>(["claude", "gemini", "openai", "ollama"]);
  const dragCounter = useRef(0);

  useEffect(() => {
    loadSettingsStore(DEFAULT_SETTINGS).then(setSettings);
    loadChatSessions().then(setChatSessions);
  }, []);

  // Derive provider from settings
  const provider = settings.provider;
  
  const refreshAvailableProviders = useCallback(async (currentSettings: AppSettings) => {
    const available: LLMProvider[] = [];
    
    // Check API keys
    if (currentSettings.apiKeys.claude?.trim()) available.push("claude");
    if (currentSettings.apiKeys.gemini?.trim()) available.push("gemini");
    if (currentSettings.apiKeys.openai?.trim()) available.push("openai");
    
    // Check Ollama
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 1000); // 1s timeout for local check
      const res = await fetch(`${currentSettings.ollamaUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(id);
      if (res.ok) {
        available.push("ollama");
      }
    } catch (e) {
      // Ollama not reachable
    }

    setAvailableProviders(available);
    
    // If current provider is no longer available, switch to first available
    if (available.length > 0 && !available.includes(currentSettings.provider)) {
      setSettings(prev => ({ ...prev, provider: available[0] }));
    }
  }, []);



  const handleSelectModel = useCallback((p: LLMProvider, modelId: string) => {
    setSettings((prev) => {
      const baseActive = prev.activeModels || {
        claude: "claude-opus-4-6",
        gemini: "gemini-3.1-pro",
        openai: "gpt-5.4-thinking",
        ollama: "llama3.2"
      };
      const next = {
        ...prev,
        provider: p,
        activeModels: { ...baseActive, [p]: modelId }
      };
      saveSettingsStore(next);
      return next;
    });
  }, []);

  const addCustomModel = useCallback((prov: LLMProvider, modelId: string) => {
    setSettings((prev) => {
      const baseCustom = prev.customModels || { claude: [], gemini: [], openai: [], ollama: [] };
      const baseActive = prev.activeModels || {
        claude: "claude-opus-4-6", gemini: "gemini-3.1-pro", openai: "gpt-5.4-thinking", ollama: "llama3.2"
      };

      const next = {
        ...prev,
        provider: prov,
        customModels: {
          ...baseCustom,
          [prov]: [...(baseCustom[prov] || []), modelId]
        }
      };
      // Auto-switch to the newly added custom model
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

  // Check if current provider has an API key
  const hasApiKey = provider === "ollama" || !!settings.apiKeys[provider as keyof typeof settings.apiKeys]?.trim();

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

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
      const attachment: Attachment = {
        id: attachmentId,
        fileName: fileName,
        originalPath: isPath ? fileObj : fileName,
        status: "anonymizing",
      };
      setAttachments((prev) => [...prev, attachment]);

      try {
        const formData = new FormData();
        if (isPath) {
          formData.append("file_path", fileObj);
        } else {
          formData.append("file", fileObj);
        }

        const response = await fetch(`http://127.0.0.1:${sidecarPort}/api/process`, {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(err);
        }

        const data = await response.json();

        const updatedAttachment = {
          ...attachment,
          status: "ready" as const,
          redactionCount: data.redaction_count,
          anonymizedContent: data.anonymized_markdown,
          anonymizedFileName: anonymizeString(fileName, data.redaction_map),
          redactionMap: data.redaction_map,
        };

        setAttachments((prev) =>
          prev.map((a) => (a.id === attachmentId ? updatedAttachment : a))
        );

        // --- SSoT Fix: Register for history persistence ---
        setHistoryAttachments((prev) => ({
          ...prev,
          [attachmentId]: updatedAttachment,
        }));
      } catch (error) {
        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachmentId
              ? { 
                  ...a, 
                  status: "error" as const, 
                  error: "Anonymizer failed. Is the engine running?" 
                }
              : a
          )
        );
      }
    });
  }, []);

  // Poll sidecar health on startup
  useEffect(() => {
    let interval: number;
    let attempts = 0;
    
    const unlistenPromise = listen<number>("sidecar-ready", (event) => {
      setSidecarPort(event.payload);
      console.log(`🛡️ Sidecar connected on dynamic port: ${event.payload}`);
    }).catch(() => null);

    const checkHealth = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${sidecarPort}/health`);
        if (res.ok) {
          setEngineStatus('ready');
          clearInterval(interval);
        }
      } catch (e) {
        attempts++;
        if (attempts > 60) { // 2 minutes timeout
          setEngineStatus('error');
          clearInterval(interval);
        }
      }
    };

    checkHealth();
    refreshAvailableProviders(settings);
    interval = window.setInterval(checkHealth, 2000);
    return () => {
      clearInterval(interval);
      unlistenPromise.then(u => u && u());
    };
  }, [refreshAvailableProviders, settings, sidecarPort]);

  // Handle native Tauri OS Drag & Drop
  useEffect(() => {
    const unlistenEnter = listen('tauri://file-drop-hover', () => setIsDragging(true));
    const unlistenLeave = listen('tauri://file-drop-cancelled', () => setIsDragging(false));
    const unlistenDrop = listen<{paths: string[]}>('tauri://file-drop', (event) => {
      setIsDragging(false);
      dragCounter.current = 0;
      if (event.payload && event.payload.paths) {
        handleFiles(event.payload.paths);
      }
    });

    return () => {
      unlistenEnter.then(f => f());
      unlistenLeave.then(f => f());
      unlistenDrop.then(f => f());
    };
  }, [handleFiles]);


  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, [handleFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const anonymizeString = (text: string, redactionMap: Record<string, import("./types").RedactionEntry> = {}) => {
    let result = text;
    for (const entry of Object.values(redactionMap)) {
      // Small optimization: only replace if the real_value is more than 3 chars to avoid minor collisions
      if (entry.real_value.length > 2) {
        result = result.split(entry.real_value).join(entry.placeholder);
      }
    }
    return result;
  };

  const handleManualRedact = useCallback(
    (attachmentId: string, _selectedText: string, newContent: string, newEntry: import("./types").RedactionEntry) => {
      setAttachments((prev) =>
        prev.map((a) => {
          if (a.id !== attachmentId) return a;
          const key = `manual_${Date.now()}`;
          const newMap = { ...a.redactionMap, [key]: newEntry };
          return {
            ...a,
            anonymizedContent: newContent,
            anonymizedFileName: anonymizeString(a.fileName, newMap),
            redactionCount: (a.redactionCount || 0) + 1,
            redactionMap: newMap,
          };
        })
      );
      setReviewingAttachment((prev) => {
        if (!prev || prev.id !== attachmentId) return prev;
        const key = `manual_${Date.now()}`;
        const newMap = { ...prev.redactionMap, [key]: newEntry };
        return {
          ...prev,
          anonymizedContent: newContent,
          anonymizedFileName: anonymizeString(prev.fileName, newMap),
          redactionCount: (prev.redactionCount || 0) + 1,
          redactionMap: newMap,
        };
      });

      // --- SSoT Update: Sync to global history registry ---
      setHistoryAttachments(prev => {
        const current = prev[attachmentId];
        if (!current) return prev;
        const key = `manual_${Date.now()}`;
        const newMap = { ...current.redactionMap, [key]: newEntry };
        return {
          ...prev,
          [attachmentId]: {
            ...current,
            anonymizedContent: newContent,
            anonymizedFileName: anonymizeString(current.fileName, newMap),
            redactionCount: (current.redactionCount || 0) + 1,
            redactionMap: newMap,
          }
        };
      });
    },
    [anonymizeString]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() && attachments.length === 0) return;

      // --- CRITICAL STATE CAPTURE START ---
      // We lock in the current state locally at the start to prevent race conditions 
      // if the user clicks fast or if state is cleared during the process.
      const currentTurnReady = attachments.filter((a) => a.status === "ready");
      const currentHistoryMap = { ...historyAttachments };
      
      // Merge current turn files into history map for the complete current turn view
      currentTurnReady.forEach(a => { currentHistoryMap[a.id] = a; });
      const currentFullContext = Object.values(currentHistoryMap);
      // --- CRITICAL STATE CAPTURE END ---

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        attachments: currentFullContext.length > 0 ? currentFullContext : undefined,
        provider,
      };

      setMessages((prev) => [...prev, userMessage]);
      setAttachments([]);
      setIsLoading(true);

      try {
        const rawResponse = await callLLM({
          provider,
          apiKeys: settings.apiKeys,
          ollamaUrl: settings.ollamaUrl,
          activeModel: settings.activeModels?.[provider] || "unknown",
          messages: [...messages, userMessage].map(m => ({ role: m.role, content: m.content })),
          attachments: currentFullContext,
        });

        const aiMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: rawResponse,
          timestamp: new Date(),
          provider,
          modelId: settings.activeModels?.[provider] || "unknown",
          attachments: currentFullContext, // Keep for UI de-anonymization
        };
        setMessages((prev) => [...prev, aiMessage]);
      } catch (error) {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ ${error instanceof Error ? error.message : "Failed to get response. Check your API key in Settings."}`,
          timestamp: new Date(),
          provider,
          modelId: settings.activeModels?.[provider] || "unknown",
        };
        const updatedMessages = [...messages, errorMessage];
        setMessages(updatedMessages);
      } finally {
        setIsLoading(false);
      }
    },
    [attachments, historyAttachments, messages, provider, settings, currentSessionId, chatSessions]
  );
  
  // Save chat session effect
  useEffect(() => {
    if (messages.length === 0) return;
    
    // Auto-save the current session
    let sessionId = currentSessionId;
    let title = messages.find(m => m.role === 'user')?.content.substring(0, 40) || 'New Conversation';
    if (title.length >= 40) title += '...';
    
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      setCurrentSessionId(sessionId);
    }
    
    const updatedSessions = chatSessions.filter(s => s.id !== sessionId);
    updatedSessions.unshift({
      id: sessionId,
      title,
      updatedAt: new Date().toISOString(),
      messages,
      attachments: [], // Current attachments are transient
      historyAttachments
    });
    
    setChatSessions(updatedSessions);
    saveChatSessions(updatedSessions);
  }, [messages, historyAttachments]);

  const handleNewChat = () => {
    setMessages([]);
    setAttachments([]);
    setHistoryAttachments({});
    setCurrentSessionId(null);
  };

  const handleExport = async () => {
    if (messages.length === 0) return;

    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const defaultPath = `cloaklm_transcript_${timestamp}.md`;
      
      const filePath = await save({
        filters: [{
          name: 'Markdown',
          extensions: ['md']
        }],
        defaultPath
      });

      if (!filePath) return;

      let content = `# CloakLM Chat Transcript\n\n`;
      content += `**Date:** ${new Date().toLocaleString()}\n`;
      content += `**Model:** \`${settings.activeModels?.[settings.provider] || 'unknown'}\`\n\n`;
      content += `---\n\n`;

      messages.forEach(msg => {
        const role = msg.role === 'user' ? '👤 USER' : '🤖 CLOAK-LLM';
        content += `## ${role}\n\n${msg.content}\n\n`;
        
        if (msg.attachments && msg.attachments.length > 0) {
          content += `*Attachments:* ${msg.attachments.map(a => `\`${a.fileName}\``).join(', ')}\n\n`;
        }
        content += `---\n\n`;
      });

      content += `*Exported via CloakLM — Privacy-First LLM Interface*\n`;

      await writeTextFile(filePath, content);
    } catch (err) {
      console.error("Failed to export transcript:", err);
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      
      if (isMod && e.key === "n") {
        e.preventDefault();
        handleNewChat();
      } else if (isMod && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
      } else if (isMod && e.key === "h") {
        e.preventDefault();
        setShowHistory(true);
      } else if (isMod && e.key === "d") {
        e.preventDefault();
        handleToggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewChat, handleToggleSidebar]);

  return (
    <div
      className="flex flex-col h-screen bg-surface relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ChatHeader
        onOpenSettings={() => setShowSettings(true)}
        onOpenHistory={() => setShowHistory(true)}
        onNewChat={handleNewChat}
        hasApiKey={hasApiKey}
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
              <span className="text-[10px] uppercase tracking-widest bg-success/10 text-success px-2 py-0.5 rounded-full border border-success/20 font-bold">
                🛡️ Sentinel Firewall
              </span>
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
        {messages.length === 0 ? (
          <WelcomeScreen />
        ) : (
          <MessageList messages={messages} isLoading={isLoading} />
        )}
        </main>

        {settings.showDocsSidebar && (
          <DocumentSidebar 
            documents={Object.values(historyAttachments)}
            onReview={setReviewingAttachment}
            onClose={handleToggleSidebar}
          />
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
      
      {reviewingAttachment && (
        <ReviewPanel 
          attachment={reviewingAttachment} 
          onClose={() => setReviewingAttachment(null)}
          onManualRedact={handleManualRedact}
        />
      )}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          isOllamaAvailable={availableProviders.includes("ollama")}
        />
      )}

      {showHistory && (
        <HistoryModal 
          sessions={chatSessions}
          currentSessionId={currentSessionId}
          onClose={() => setShowHistory(false)}
          onSelect={(session) => {
            setMessages(session.messages);
            setHistoryAttachments(session.historyAttachments || {});
            setCurrentSessionId(session.id);
            setAttachments([]); // Clear pending
            setShowHistory(false);
          }}
          onDelete={(id) => {
            const updated = chatSessions.filter(s => s.id !== id);
            setChatSessions(updated);
            saveChatSessions(updated);
            if (currentSessionId === id) handleNewChat();
          }}
        />
      )}
    </div>
  );
}

export default App;
