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
  /** When the identifiability check last ran on this document. */
  identifiabilityCheckedAt?: string;
  /** When Deep Scan (a second, local model) finished on this document. */
  deepScannedAt?: string;
  /** When the user approved this document for sharing with AI tools after reviewing it. */
  approvedForSharingAt?: string;
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
  /** "identifying": from the identifiability check, not missed PII. */
  kind?: "pii" | "identifying";
  /** Why the identifiability check flagged it. */
  reason?: string;
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
  /** Model-list version the saved model choices were last upgraded to. */
  modelsVersion?: string;
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
  /** Redacted documents are readable by AI tools through the cloaklm MCP server. */
  sharedWithTools?: boolean;
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
