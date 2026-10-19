import type { Attachment, RedactionEntry } from "./types";

// ---------- Matching known PII values ----------

const NOT_AFTER_ALNUM = "(?<![\\p{L}\\p{N}])";
const NOT_BEFORE_ALNUM = "(?![\\p{L}\\p{N}])";
const SHORT_ASCII = /^[A-Za-z0-9]{1,3}$/;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Same rule as the engine (sidecar/anonymize_llm.py value_pattern): short ASCII
 * values ("CA", "Bay") must stand alone, so "Canadian" isn't cut into
 * "[LOCATION_1]nadian". Longer values match anywhere, so "John123", "johnsmith"
 * in a URL and CJK names without spaces are still caught. Over-redacting
 * "Johnson" is the safe failure.
 */
function valueSource(value: string): string {
  const escaped = escapeRegExp(value);
  return SHORT_ASCII.test(value.trim()) ? `${NOT_AFTER_ALNUM}${escaped}${NOT_BEFORE_ALNUM}` : escaped;
}

/** One case-insensitive regex for all values, longest first so "John Doe" wins over "John". */
export function redactionRegex(values: string[]): RegExp {
  const alternatives = [...values].sort((a, b) => b.length - a.length).map(valueSource).join("|");
  return new RegExp(alternatives, "giu");
}

export function replaceValue(text: string, value: string, placeholder: string): string {
  return text.replace(redactionRegex([value]), placeholder);
}

/**
 * For text a person (or Deep Scan) picked out of the document: matched with the
 * rule above, or failing that the exact text as selected (it may be part of a
 * word on purpose).
 */
export function replaceSelection(text: string, value: string, placeholder: string): string {
  const replaced = replaceValue(text, value, placeholder);
  return replaced !== text ? replaced : text.split(value).join(placeholder);
}

/** Next free [MANUAL_N], counting every manual placeholder whatever its category. */
export function nextManualPlaceholder(redactionMap: Record<string, RedactionEntry> = {}): string {
  const used = Object.values(redactionMap)
    .map((e) => /^\[MANUAL_(\d+)\]$/.exec(e.placeholder)?.[1])
    .filter((n): n is string => !!n)
    .map(Number);
  return `[MANUAL_${Math.max(0, ...used) + 1}]`;
}

/** File name with the document's redacted values replaced, for display. */
export function anonymizeFileName(fileName: string, redactionMap: Record<string, RedactionEntry> = {}): string {
  let result = fileName;
  for (const entry of Object.values(redactionMap)) {
    if (entry.real_value.length > 2) result = replaceValue(result, entry.real_value, entry.placeholder);
  }
  return result;
}

// Words that are common in file names but say nothing about who the file belongs to.
const GENERIC_FILE_WORDS = new Set([
  "resume", "cover", "letter", "form", "forms", "return", "returns", "statement", "statements",
  "final", "draft", "copy", "scan", "scanned", "signed", "document", "documents", "report",
  "invoice", "receipt", "summary", "page", "pages", "taxes", "federal", "state", "annual",
]);

/**
 * Pieces of a file name worth scrubbing from outbound text ("Rabah_Shihab_Resume.pdf"
 * gives "rabah" and "shihab"). Skips numbers like years and generic words, which
 * otherwise turned every "2025" or "Resume" in the text into [FILE_NAME].
 */
export function fileNameFragments(fileName: string): string[] {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .split(/[\s,._-]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 3 && !/^\d+$/.test(p) && !GENERIC_FILE_WORDS.has(p));
}

// ---------- Unicode cleanup (same as sanitize_unicode in the engine) ----------

// Lookalike Cyrillic/Greek letters, folded only inside words that mix them with
// Latin letters ("Jоhn" with a Cyrillic "о"); real Cyrillic or Greek is untouched.
const CONFUSABLES: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", ԁ: "d", һ: "h", ӏ: "l",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y", І: "I",
  Ј: "J", Ѕ: "S", α: "a", ο: "o", ν: "v", ρ: "p", ι: "i", κ: "k", τ: "t", υ: "u", Α: "A", Β: "B", Ε: "E",
  Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
};

function foldMixedScript(word: string): string {
  const hasLatin = /[A-Za-z]/.test(word);
  const hasOther = /[Ͱ-ϿЀ-ԯ]/.test(word);
  return hasLatin && hasOther ? [...word].map((c) => CONFUSABLES[c] ?? c).join("") : word;
}

/**
 * Makes what the regexes see match what a language model reads. Removes every
 * format character (zero-width, bidi controls, soft hyphen, BOM, Unicode tag
 * characters used to smuggle hidden text), variation selectors and Hangul
 * fillers; folds fullwidth letters and ligatures (NFKC) and mixed-script lookalikes.
 */
export function sanitizeUnicode(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\p{Cf}͏ᅟᅠ឴឵᠎ㅤﾠ︀-️\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu, "")
    .replace(/[  -   　]/g, " ")
    .replace(/\p{L}+/gu, foldMixedScript);
}

// ---------- Local-only model calls ----------

/** Deep Scan and the identifiability check send text that may still hold PII, so only to this computer. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "::1" || /^127(\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

// ---------- Rehydration ----------

export interface RehydratedSegment {
  text: string;
  /** Set when this segment is a placeholder that was filled in. */
  placeholder?: string;
  source?: string;
  /** The placeholder means different things in different documents; left as is. */
  ambiguous?: string[];
}

/**
 * Splits text into plain parts and filled-in placeholders, so the UI can show
 * which values were restored and from which document. A placeholder that maps to
 * different values in different documents is not filled in (picking one would
 * show the wrong real value).
 */
export function rehydrateSegments(text: string, attachments: Attachment[]): RehydratedSegment[] {
  const byPlaceholder = new Map<string, Map<string, string>>(); // placeholder -> value -> document
  for (const att of attachments) {
    for (const entry of Object.values(att.redactionMap || {})) {
      const values = byPlaceholder.get(entry.placeholder) ?? new Map<string, string>();
      if (!values.has(entry.real_value)) values.set(entry.real_value, att.fileName);
      byPlaceholder.set(entry.placeholder, values);
    }
  }
  if (byPlaceholder.size === 0) return [{ text }];

  const regex = new RegExp([...byPlaceholder.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|"), "g");
  const segments: RehydratedSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index! > last) segments.push({ text: text.slice(last, match.index) });
    const values = byPlaceholder.get(match[0])!;
    if (values.size === 1) {
      const [[value, source]] = [...values];
      segments.push({ text: value, placeholder: match[0], source });
    } else {
      segments.push({ text: match[0], placeholder: match[0], ambiguous: [...values].map(([v, doc]) => `${v} (${doc})`) });
    }
    last = match.index! + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

// ---------- Sharing with AI tools ----------

export type SharingClearance = "two-model" | "manual";

/**
 * A document reaches AI tools only after two models checked it (GLiNER, then a
 * local LLM pass: Deep Scan or the identifiability check, with every suggestion
 * redacted or dismissed) or after the user approved it in the Review panel.
 */
export function sharingClearance(att: Attachment): SharingClearance | null {
  if (att.status !== "ready" || !att.anonymizedContent) return null;
  if (att.approvedForSharingAt) return "manual";
  const secondPass = !!att.deepScannedAt || !!att.identifiabilityCheckedAt;
  const pending = (att.deepScanSuggestions || []).some((s) => s.status === "pending");
  return secondPass && !pending ? "two-model" : null;
}

// ---------- Personal profiles ----------

const PROFILE_WORDS = new RegExp(
  `${NOT_AFTER_ALNUM}(?:r[eé]sum[eé]s?|cv|curriculum vitae|cover letter|biography|bio)${NOT_BEFORE_ALNUM}`,
  "iu"
);
const PROFILE_HEADING =
  /^\s*(?:#{1,6}\s*|\*\*)?(?:work |professional |employment )?(?:experience|education|skills|employment|projects|publications|certifications|awards)\b/gim;

/**
 * Résumés, cover letters and bios identify a person through what they did, even
 * with every name redacted. Used to suggest the identifiability check.
 */
export function looksLikePersonalProfile(fileName: string, content = ""): boolean {
  if (PROFILE_WORDS.test(fileName.replace(/[_.-]+/g, " ")) || PROFILE_WORDS.test(content.slice(0, 500))) return true;
  const headings = new Set((content.match(PROFILE_HEADING) || []).map((h) => h.replace(/[#*\s]/g, "").toLowerCase()));
  return headings.size >= 2;
}
