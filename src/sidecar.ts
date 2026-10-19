import { invoke } from "@tauri-apps/api/core";
import { anonymizePrompt } from "./llm";
import type { Attachment, Project } from "./types";
import { sharingClearance, type SharingClearance } from "./redact";

// The sidecar rejects requests without the per-launch token the Tauri shell gave it.
let tokenPromise: Promise<string> | null = null;

function getToken(): Promise<string> {
  if (!tokenPromise) {
    tokenPromise = invoke<string>("get_sidecar_auth").catch((e) => {
      tokenPromise = null;
      throw e;
    });
  }
  return tokenPromise;
}

export async function sidecarFetch(port: number, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await getToken()}`);
  return fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers });
}

// ---------- Sharing with AI tools (the cloaklm MCP server) ----------

export interface SharedDocument {
  id: string;
  name: string;
  project: string;
  content: string;
  clearance: SharingClearance;
}

export interface SharedSet {
  documents: SharedDocument[];
  /** Documents in shared projects still waiting for a second check or approval. */
  withheld: number;
}

/** Ready documents of a project, in the order they are numbered for AI tools. */
export function shareableDocs(project: Project): Attachment[] {
  return Object.values(project.attachments).filter((a) => a.status === "ready" && a.anonymizedContent);
}

/**
 * What AI tools may see: redacted text only, and only from documents cleared by
 * two models or approved by the user (sharingClearance). Content and project name
 * go through the same outbound scrub as chat prompts. File names are never sent
 * (the chat path redacts them too), so documents are labelled "Document N".
 */
export function buildSharedDocuments(projects: Project[]): SharedSet {
  const documents: SharedDocument[] = [];
  let withheld = 0;
  for (const project of projects.filter((p) => p.sharedWithTools)) {
    const docs = shareableDocs(project);
    withheld += Object.values(project.attachments).filter((a) => a.status === "anonymizing" || a.status === "deep-scanning").length;
    const projectName = anonymizePrompt(project.name, docs);
    docs.forEach((doc, i) => {
      const clearance = sharingClearance(doc);
      if (!clearance) {
        withheld++;
        return;
      }
      documents.push({
        id: doc.id,
        name: `Document ${i + 1}`,
        project: projectName,
        content: anonymizePrompt(doc.anonymizedContent!, [doc]),
        clearance,
      });
    });
  }
  return { documents, withheld };
}

export async function pushSharedDocuments(port: number, shared: SharedSet): Promise<void> {
  const res = await sidecarFetch(port, "/api/shared", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(shared),
  });
  if (!res.ok) throw new Error(`Sharing failed: ${res.status}`);
}
