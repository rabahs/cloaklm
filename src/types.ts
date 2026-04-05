export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  attachments?: Attachment[];
  provider?: LLMProvider;
  modelId?: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  anonymizedFileName?: string;
  originalPath: string;
  status: "anonymizing" | "ready" | "deep-scanning" | "error";
  redactionCount?: number;
  anonymizedContent?: string;
  redactionMap?: Record<string, RedactionEntry>;
  error?: string;
  deepScanSuggestions?: DeepScanSuggestion[];
}

export interface RedactionEntry {
  real_value: string;
  placeholder: string;
  category: string;
  source?: "gliner" | "deep-scan" | "manual";
  sourceModel?: string;
}

export interface DeepScanSuggestion {
  id: string;
  text: string;
  category: string;
  status: "pending" | "accepted" | "dismissed";
}

export type LLMProvider = "claude" | "gemini" | "openai" | "ollama";

export type AppView = "chat" | "projects" | "project-detail" | "history" | "settings";

export interface AppSettings {
  provider: LLMProvider;
  apiKeys: {
    claude?: string;
    gemini?: string;
    openai?: string;
  };
  ollamaUrl: string;
  activeModels?: Record<LLMProvider, string>;
  customModels?: Record<LLMProvider, string[]>;
  showDocsSidebar?: boolean;
  deepScan?: {
    enabled: boolean;
    model: string;
  };
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  attachments: Record<string, Attachment>;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
  attachments: Attachment[];
  historyAttachments: Record<string, Attachment>;
  projectId?: string;
  activeAttachmentIds?: string[];
}
