import { useState, useRef, useCallback, useEffect } from "react";
import { ChatHeader } from "./components/ChatHeader";
import { MessageList } from "./components/MessageList";
import { ChatInput } from "./components/ChatInput";
import { DropOverlay } from "./components/DropOverlay";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { ReviewPanel } from "./components/ReviewPanel";
import { SettingsModal } from "./components/SettingsModal";
import { listen } from "@tauri-apps/api/event";
import { callLLM, deAnonymize } from "./llm";
import type { Message, Attachment, LLMProvider, AppSettings } from "./types";

const DEFAULT_SETTINGS: AppSettings = {
  provider: "claude",
  apiKeys: {},
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "llama3.2",
};

// Load settings from localStorage
function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem("cloaklm_settings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reviewingAttachment, setReviewingAttachment] = useState<Attachment | null>(null);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [engineStatus, setEngineStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const dragCounter = useRef(0);

  // Derive provider from settings
  const provider = settings.provider;
  const setProvider = useCallback((p: LLMProvider) => {
    setSettings((prev) => {
      const next = { ...prev, provider: p };
      localStorage.setItem("cloaklm_settings", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleSaveSettings = useCallback((newSettings: AppSettings) => {
    setSettings(newSettings);
    localStorage.setItem("cloaklm_settings", JSON.stringify(newSettings));
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

        const response = await fetch("http://127.0.0.1:4321/api/process", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(err);
        }

        const data = await response.json();

        setAttachments((prev) =>
          prev.map((a) =>
            a.id === attachmentId
              ? {
                  ...a,
                  status: "ready" as const,
                  redactionCount: data.redaction_count,
                  anonymizedContent: data.anonymized_markdown,
                  redactionMap: data.redaction_map,
                }
              : a
          )
        );
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
    const checkHealth = async () => {
      try {
        const res = await fetch("http://127.0.0.1:4321/health");
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
    interval = window.setInterval(checkHealth, 2000);
    return () => clearInterval(interval);
  }, []);

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

  const handleManualRedact = useCallback(
    (attachmentId: string, _selectedText: string, newContent: string, newEntry: import("./types").RedactionEntry) => {
      setAttachments((prev) =>
        prev.map((a) => {
          if (a.id !== attachmentId) return a;
          const key = `manual_${Date.now()}`;
          return {
            ...a,
            anonymizedContent: newContent,
            redactionCount: (a.redactionCount || 0) + 1,
            redactionMap: { ...a.redactionMap, [key]: newEntry },
          };
        })
      );
      setReviewingAttachment((prev) => {
        if (!prev || prev.id !== attachmentId) return prev;
        const key = `manual_${Date.now()}`;
        return {
          ...prev,
          anonymizedContent: newContent,
          redactionCount: (prev.redactionCount || 0) + 1,
          redactionMap: { ...prev.redactionMap, [key]: newEntry },
        };
      });
    },
    []
  );

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() && attachments.length === 0) return;

      const readyAttachments = attachments.filter((a) => a.status === "ready");

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
        attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
        provider,
      };

      setMessages((prev) => [...prev, userMessage]);
      setAttachments([]);
      setIsLoading(true);

      try {
        // Collect ALL attachments from the entire conversation (not just this turn)
        const allAttachments: Attachment[] = [];
        const seenIds = new Set<string>();
        for (const msg of [...messages, userMessage]) {
          for (const att of msg.attachments || []) {
            if (!seenIds.has(att.id)) {
              seenIds.add(att.id);
              allAttachments.push(att);
            }
          }
        }

        // Build conversation history for the LLM
        const conversationHistory = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Call the actual LLM API — all conversation attachments are included in the system prompt
        const rawResponse = await callLLM({
          provider,
          apiKeys: settings.apiKeys,
          ollamaUrl: settings.ollamaUrl,
          ollamaModel: settings.ollamaModel,
          messages: conversationHistory,
          attachments: allAttachments,
        });

        // De-anonymize: replace [PERSON_1] with real names for the user
        const deAnonymizedResponse = deAnonymize(rawResponse, allAttachments);

        const aiMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: deAnonymizedResponse,
          timestamp: new Date(),
          provider,
        };
        setMessages((prev) => [...prev, aiMessage]);
      } catch (error) {
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ ${error instanceof Error ? error.message : "Failed to get response. Check your API key in Settings."}`,
          timestamp: new Date(),
          provider,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [attachments, messages, provider, settings]
  );

  return (
    <div
      className="flex flex-col h-screen bg-surface relative"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ChatHeader
        provider={provider}
        onProviderChange={setProvider}
        onOpenSettings={() => setShowSettings(true)}
        onNewChat={() => { setMessages([]); setAttachments([]); }}
        hasApiKey={hasApiKey}
        hasMessages={messages.length > 0}
      />

      <main className="flex-1 overflow-hidden flex flex-col relative">
        {engineStatus === 'loading' && (
          <div className="absolute top-0 left-0 right-0 bg-primary/10 border-b border-primary/20 p-2 text-center text-sm text-primary animate-pulse z-10">
            🛡️ CloakLM Shield is initializing AI models... (30-40 seconds)
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

      <ChatInput
        onSend={sendMessage}
        attachments={attachments}
        onRemoveAttachment={removeAttachment}
        onReviewAttachment={setReviewingAttachment}
        onAttachFiles={handleFiles}
        isLoading={isLoading}
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
        />
      )}
    </div>
  );
}

export default App;
