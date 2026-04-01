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
  originalPath: string;
  status: "anonymizing" | "ready" | "error";
  redactionCount?: number;
  anonymizedContent?: string;
  redactionMap?: Record<string, RedactionEntry>;
  error?: string;
}

export interface RedactionEntry {
  real_value: string;
  placeholder: string;
  category: string;
}

export type LLMProvider = "claude" | "gemini" | "openai" | "ollama";

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
}
