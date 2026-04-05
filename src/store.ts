import { load, Store } from '@tauri-apps/plugin-store';
import type { AppSettings, ChatSession, LLMProvider, Project } from './types';

// Create a single store instance for the app
let storePromise: Promise<Store> | null = null;
try {
  storePromise = load('cloaklm_store.bin');
} catch (e) {
  console.warn("Could not initialized Tauri store. Is this running outside Tauri?");
}

export const loadSettingsStore = async (defaultSettings: AppSettings): Promise<AppSettings> => {
  if (!storePromise) return defaultSettings;
  try {
    const store = await storePromise;
    const saved = await store.get<AppSettings>('settings');
    // Ensure all nested fields exist to avoid crashes on old versions
    if (saved) {
      return { 
        ...defaultSettings, 
        ...saved,
        activeModels: { ...defaultSettings.activeModels, ...(saved.activeModels as Record<LLMProvider, string> || {}) },
        customModels: { ...defaultSettings.customModels, ...(saved.customModels as Record<LLMProvider, string[]> || {}) }
      };
    }
  } catch (e) {
    console.error("Failed to load settings from secure store", e);
  }
  return defaultSettings;
};

export const saveSettingsStore = async (settings: AppSettings) => {
  if (!storePromise) return;
  try {
    const store = await storePromise;
    await store.set('settings', settings);
    await store.save();
  } catch (e) {
    console.error("Failed to save settings to secure store", e);
  }
};

export const loadChatSessions = async (): Promise<ChatSession[]> => {
  if (!storePromise) return [];
  try {
    const store = await storePromise;
    const sessions = await store.get<ChatSession[]>('chat_sessions');
    return sessions || [];
  } catch (e) {
    console.error("Failed to load chat sessions from secure store", e);
    return [];
  }
};

export const saveChatSessions = async (sessions: ChatSession[]) => {
  if (!storePromise) return;
  try {
    const store = await storePromise;
    await store.set('chat_sessions', sessions);
    await store.save();
  } catch (e) {
    console.error("Failed to save chat sessions to secure store", e);
  }
};

export const loadProjects = async (): Promise<Project[]> => {
  if (!storePromise) return [];
  try {
    const store = await storePromise;
    const projects = await store.get<Project[]>('projects');
    return projects || [];
  } catch (e) {
    console.error("Failed to load projects from secure store", e);
    return [];
  }
};

export const saveProjects = async (projects: Project[]) => {
  if (!storePromise) return;
  try {
    const store = await storePromise;
    await store.set('projects', projects);
    await store.save();
  } catch (e) {
    console.error("Failed to save projects to secure store", e);
  }
};
