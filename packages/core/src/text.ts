import type { LanguageCode } from "./types.js";

const MYANMAR = /[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]/;

export function createId(): string {
  return globalThis.crypto.randomUUID();
}

export function normalizeText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function detectLanguage(text: string): LanguageCode {
  const myanmar = text.match(new RegExp(MYANMAR, "g"))?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  if (myanmar === 0 && latin === 0) return "unknown";
  if (myanmar > 0 && latin > 0) return "mixed";
  if (myanmar > 0) return "my";
  return "en";
}

export function splitSegments(text: string): { text: string; language: LanguageCode }[] {
  const chunks = text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[။!?])\s+/))
    .map((part) => part.trim())
    .filter(Boolean);
  if (chunks.length === 0) return [];
  return chunks.map((part) => ({ text: part, language: detectLanguage(part) }));
}

const STOP = new Set([
  "the", "a", "an", "i", "my", "me", "about", "what", "when", "did", "do",
  "show", "everything", "wrote", "write", "written", "was", "were", "of",
  "to", "in", "on", "for", "and", "or", "this", "that", "year", "first",
  "talk", "mention", "mentioned", "with", "from", "your", "you", "it",
  "is", "are", "be", "been", "have", "had", "things", "thing", "all",
]);

export function tokenize(text: string): string[] {
  const latin = text.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  const myanmar = text.match(/[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]+/g) ?? [];
  return [...latin, ...myanmar];
}

export function meaningfulTerms(text: string): string[] {
  return [...new Set(tokenize(text))].filter((term) => !STOP.has(term) && term.length > 1);
}

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((match) => match[1].toLowerCase());
}

export function sentences(text: string): string[] {
  const parts = text
    .split(/\n+|(?<=[။!?])\s+|(?<=\.)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [text.trim()].filter(Boolean);
}

export function formatJournalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function assembleTranscript(committed: string, pieces: string[]): string {
  const spoken = pieces.map((piece) => piece.trim()).filter(Boolean).join(" ");
  const base = committed.trim();
  if (!base) return spoken;
  if (!spoken) return base;
  return `${base} ${spoken}`;
}

export function excerptAround(text: string, query: string, limit = 220): string {
  const clean = normalizeText(text);
  if (clean.length <= limit) return clean;
  const terms = meaningfulTerms(query);
  const lower = clean.toLowerCase();
  let index = -1;
  for (const term of terms) {
    index = lower.indexOf(term.toLowerCase());
    if (index >= 0) break;
  }
  if (index < 0) return `${clean.slice(0, limit - 1).trim()}…`;
  const start = Math.max(0, index - 40);
  const slice = clean.slice(start, start + limit).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + limit < clean.length ? "…" : ""}`;
}
