import { afterEach, describe, expect, it, vi } from "vitest";
import { anonymizePrompt, callLLM, deepScanWithLLM, identifiabilityCheckWithLLM } from "./llm";
import {
  fileNameFragments, isLoopbackUrl, looksLikePersonalProfile, nextManualPlaceholder, rehydrateSegments,
  replaceSelection, replaceValue, sanitizeUnicode, sharingClearance,
} from "./redact";
import { buildSharedDocuments } from "./sidecar";
import type { Attachment, Project, RedactionEntry } from "./types";

const entry = (real_value: string, placeholder: string, category = "person"): RedactionEntry => ({ real_value, placeholder, category });
const att = (redactionMap: Record<string, RedactionEntry>, extra: Partial<Attachment> = {}): Attachment => ({
  id: extra.id ?? crypto.randomUUID(), fileName: "doc.pdf", originalPath: "doc.pdf", status: "ready",
  anonymizedContent: "text", redactionMap, ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("replaceValue", () => {
  it("short values must stand alone", () => {
    expect(replaceValue("Canadian, based in CA.", "CA", "[X]")).toBe("Canadian, based in [X].");
    expect(replaceValue("eBay and the Bay Area", "Bay", "[X]")).toBe("eBay and the [X] Area");
  });
  it("longer values match anywhere, so glued and CJK text is caught", () => {
    expect(replaceValue("John123 logged in", "John", "[X]")).toBe("[X]123 logged in");
    expect(replaceValue("linkedin.com/in/johnsmith", "smith", "[X]")).toBe("linkedin.com/in/john[X]");
    expect(replaceValue("我是张伟先生", "张伟", "[X]")).toBe("我是[X]先生");
    expect(replaceValue("Rabah_Shihab_Resume.pdf", "Rabah", "[X]")).toBe("[X]_Shihab_Resume.pdf");
  });
});

describe("replaceSelection", () => {
  it("prefers the matching rule", () => {
    expect(replaceSelection("eBay and Bay", "Bay", "[X]")).toBe("eBay and [X]");
  });
  it("falls back to the exact selection", () => {
    expect(replaceSelection("Whitaker", "Whit", "[X]")).toBe("[X]aker");
  });
});

describe("nextManualPlaceholder", () => {
  it("counts manual placeholders of any category", () => {
    const map = { a: entry("Acme", "[MANUAL_1]", "ORGANIZATION"), b: entry("Bob", "[MANUAL_3]", "manual"), c: entry("X", "[PERSON_1]") };
    expect(nextManualPlaceholder(map)).toBe("[MANUAL_4]");
    expect(nextManualPlaceholder({})).toBe("[MANUAL_1]");
  });
});

describe("fileNameFragments", () => {
  it("keeps names and drops years and generic words", () => {
    expect(fileNameFragments("Rabah_Shihab_Resume.pdf")).toEqual(["rabah", "shihab"]);
    expect(fileNameFragments("W2_2025.pdf")).toEqual([]);
  });
});

describe("sanitizeUnicode", () => {
  it("strips invisible and smuggling characters", () => {
    expect(sanitizeUnicode("Jo​hn‮ ⁦Doe⁩ \u{e0041}\u{e0042} x️ㅤ")).toBe("John Doe  x");
  });
  it("folds fullwidth letters, ligatures and mixed-script lookalikes", () => {
    expect(sanitizeUnicode("Ｊｏｈｎ Jeﬀrey Griﬃn Jоhn")).toBe("John Jeffrey Griffin John");
    expect(sanitizeUnicode("Иван Петров")).toBe("Иван Петров");
  });
});

describe("anonymizePrompt", () => {
  it("leaves words that merely contain a short redacted value", () => {
    expect(anonymizePrompt("Worked at eBay in the Bay Area", [att({ k: entry("Bay", "[LOCATION_1]", "location") })]))
      .toBe("Worked at eBay in the [LOCATION_1] Area");
  });
  it("redacts two-character values as whole words", () => {
    expect(anonymizePrompt("Moved to CA, Canadian", [att({ k: entry("CA", "[CITY_STATE_1]") })])).toBe("Moved to [CITY_STATE_1], Canadian");
  });
  it("catches values glued to other text", () => {
    expect(anonymizePrompt("ping John123 and SSN123-45-6789 or Tel555-123-4567", [att({ k: entry("John", "[PERSON_1]") })]))
      .toBe("ping [PERSON_1]123 and SSN[SSN_REDACTED] or Tel[PHONE_REDACTED]");
  });
  it("matches names stored in decomposed form and lookalike spellings", () => {
    const nfd = { k: entry("José García".normalize("NFD"), "[PERSON_1]") };
    expect(anonymizePrompt("Ask José García", [att(nfd)])).toBe("Ask [PERSON_1]");
    const latin = { k: entry("John Smith", "[PERSON_1]") };
    // Cyrillic "o" inside a Latin word, and fullwidth letters
    expect(anonymizePrompt("Ask Jоhn or Ｊｏｈｎ", [att(latin)])).toBe("Ask [PERSON_1] or [PERSON_1]");
  });
  it("keeps years and generic words from the file name, scrubs names", () => {
    expect(anonymizePrompt("Form W-2 for 2025. Resume attached.", [att({}, { fileName: "W2_2025_Resume.pdf" })]))
      .toBe("Form W-2 for 2025. Resume attached.");
    expect(anonymizePrompt("Shihab worked with Jordan.", [att({ k: entry("Jordan Whitaker", "[PERSON_1]") }, { fileName: "Rabah_Shihab_Resume.pdf" })]))
      .toBe("[FILE_NAME] worked with [PERSON_1].");
  });
});

describe("callLLM", () => {
  it("scrubs earlier messages with every document the conversation used", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ message: { content: "ok" } }));
    }));
    const removed = att({ k: entry("John Smith", "[PERSON_1]") });
    await callLLM({
      provider: "ollama", apiKeys: {}, ollamaUrl: "http://localhost:11434", activeModel: "m",
      messages: [{ role: "user", content: "Does John Smith owe tax?" }, { role: "assistant", content: "ok" }, { role: "user", content: "next" }],
      attachments: [], scrubAttachments: [removed],
    });
    expect(bodies[0]).not.toContain("John Smith");
    expect(bodies[0]).toContain("[PERSON_1]");
  });

  it("sends the Gemini key in a header, not the URL", async () => {
    const calls: [string, RequestInit][] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init]);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
    }));
    await callLLM({ provider: "gemini", apiKeys: { gemini: "AIza-secret" }, ollamaUrl: "", activeModel: "gemini-x", messages: [{ role: "user", content: "hi" }], attachments: [] });
    expect(calls[0][0]).not.toContain("AIza-secret");
    expect(new Headers(calls[0][1].headers).get("x-goog-api-key")).toBe("AIza-secret");
  });
});

describe("local-only scans", () => {
  it("recognises loopback URLs only", () => {
    for (const url of ["http://localhost:11434", "http://127.0.0.1:11434", "http://[::1]:11434"]) expect(isLoopbackUrl(url)).toBe(true);
    for (const url of ["http://192.168.1.5:11434", "https://ollama.example.com", "http://localhost.evil.com", "nonsense"]) expect(isLoopbackUrl(url)).toBe(false);
  });
  it("refuses to send text to a remote Ollama", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(deepScanWithLLM("text", "http://192.168.1.5:11434", "m")).rejects.toThrow(/localhost/);
    await expect(identifiabilityCheckWithLLM("text", "https://ollama.example.com", "m")).rejects.toThrow(/localhost/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("rehydrateSegments", () => {
  it("marks restored values with their source", () => {
    const segs = rehydrateSegments("Hi [PERSON_1].", [att({ k: entry("Jane Roe", "[PERSON_1]") }, { fileName: "w2.pdf" })]);
    expect(segs.map((s) => s.text).join("")).toBe("Hi Jane Roe.");
    expect(segs[1]).toMatchObject({ placeholder: "[PERSON_1]", source: "w2.pdf" });
  });
  it("does not guess when documents disagree", () => {
    const a = att({ k: entry("Jane Roe", "[PERSON_1]") }, { fileName: "a.pdf" });
    const b = att({ k: entry("Sam Poe", "[PERSON_1]") }, { fileName: "b.pdf" });
    const segs = rehydrateSegments("Pay [PERSON_1]", [a, b]);
    expect(segs.map((s) => s.text).join("")).toBe("Pay [PERSON_1]");
    expect(segs[1].ambiguous).toEqual(["Jane Roe (a.pdf)", "Sam Poe (b.pdf)"]);
  });
});

describe("sharing gate", () => {
  const pending = { id: "s", text: "x", category: "c", status: "pending" as const };
  it("requires a second model with no pending suggestions, or manual approval", () => {
    expect(sharingClearance(att({}))).toBeNull(); // GLiNER only
    expect(sharingClearance(att({}, { deepScannedAt: "t", deepScanSuggestions: [pending] }))).toBeNull();
    expect(sharingClearance(att({}, { deepScannedAt: "t", deepScanSuggestions: [{ ...pending, status: "dismissed" }] }))).toBe("two-model");
    expect(sharingClearance(att({}, { identifiabilityCheckedAt: "t" }))).toBe("two-model");
    expect(sharingClearance(att({}, { approvedForSharingAt: "t" }))).toBe("manual");
    expect(sharingClearance(att({}, { status: "deep-scanning", approvedForSharingAt: "t" }))).toBeNull();
  });
  it("shares only cleared documents and counts the rest", () => {
    const cleared = att({}, { id: "a", deepScannedAt: "t", anonymizedContent: "Cleared text" });
    const unchecked = att({}, { id: "b", anonymizedContent: "Unchecked text" });
    const scanning = att({}, { id: "c", status: "deep-scanning" });
    const project = (shared: boolean): Project => ({
      id: "p", name: "Taxes", createdAt: "", updatedAt: "", sharedWithTools: shared, attachments: { a: cleared, b: unchecked, c: scanning },
    });
    const { documents, withheld } = buildSharedDocuments([project(true)]);
    expect(documents.map((d) => [d.id, d.clearance])).toEqual([["a", "two-model"]]);
    expect(JSON.stringify(documents)).not.toContain("Unchecked text");
    expect(withheld).toBe(2);
    expect(buildSharedDocuments([project(false)])).toEqual({ documents: [], withheld: 0 });
  });
});

describe("looksLikePersonalProfile", () => {
  it("spots résumés by file name or section headings", () => {
    expect(looksLikePersonalProfile("Jane_Doe_Resume.pdf")).toBe(true);
    expect(looksLikePersonalProfile("doc.pdf", "Mon résumé complet")).toBe(true);
    expect(looksLikePersonalProfile("doc.pdf", "## Experience\n...\n## Education\n...")).toBe(true);
  });
  it("leaves tax forms alone", () => {
    expect(looksLikePersonalProfile("w2.pdf", "## Form W-2 Wage and Tax Statement\n| 1 Wages | $84,250.00 |")).toBe(false);
    expect(looksLikePersonalProfile("biology_1098T.pdf", "Tuition statement")).toBe(false);
  });
});
