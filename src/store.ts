import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, ChatSession, LLMProvider, Project } from './types';
import { MODELS_VERSION, migrateActiveModels } from './models';

// App data lives in an encrypted file managed by the Rust side (src-tauri/src/
// secure_store.rs), keyed from the OS keychain. The webview can only read and
// write these three entries.
type StoreKey = 'settings' | 'chat_sessions' | 'projects';

async function get<T>(key: StoreKey): Promise<T | null> {
  return (await invoke<T | null>('store_get', { key })) ?? null;
}

async function set(key: StoreKey, value: unknown): Promise<void> {
  await invoke('store_set', { key, value });
}

export const loadSettingsStore = async (defaultSettings: AppSettings): Promise<AppSettings> => {
  try {
    const saved = await get<AppSettings>('settings');
    // Ensure all nested fields exist to avoid crashes on old versions
    if (saved) {
      const merged: AppSettings = {
        ...defaultSettings,
        ...saved,
        activeModels: migrateActiveModels(saved.activeModels, saved.modelsVersion),
        customModels: { ...defaultSettings.customModels, ...(saved.customModels as Record<LLMProvider, string[]> || {}) },
        modelsVersion: MODELS_VERSION,
      };
      // Persist the upgrade right away so it runs only once
      if (saved.modelsVersion !== MODELS_VERSION) await set('settings', merged);
      return merged;
    }
  } catch (e) {
    console.error("Failed to load settings", e);
  }
  return defaultSettings;
};

export const saveSettingsStore = async (settings: AppSettings) => {
  try {
    await set('settings', settings);
  } catch (e) {
    console.error("Failed to save settings", e);
  }
};

export const loadChatSessions = async (): Promise<ChatSession[]> => {
  try {
    return (await get<ChatSession[]>('chat_sessions')) || [];
  } catch (e) {
    console.error("Failed to load chat sessions", e);
    return [];
  }
};

export const saveChatSessions = async (sessions: ChatSession[]) => {
  try {
    await set('chat_sessions', sessions);
  } catch (e) {
    console.error("Failed to save chat sessions", e);
  }
};

export const loadProjects = async (): Promise<Project[]> => {
  try {
    return (await get<Project[]>('projects')) || [];
  } catch (e) {
    console.error("Failed to load projects", e);
    return [];
  }
};

export const saveProjects = async (projects: Project[]) => {
  try {
    await set('projects', projects);
  } catch (e) {
    console.error("Failed to save projects", e);
  }
};
