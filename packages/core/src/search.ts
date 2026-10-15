import { cosineSimilarity, embedText } from "./embed.js";
import type { SearchDocument, SearchFilters, SearchHit } from "./types.js";
import { excerptAround, meaningfulTerms, normalizeText } from "./text.js";

const EXPANSIONS: Record<string, string[]> = {
  worried: ["worry", "worried", "anxiety", "anxious", "stress", "stressed", "စိတ်ဖိစီး"],
  worry: ["worried", "anxiety", "anxious", "stress", "stressed"],
  goals: ["goal", "goals", "aim", "ပန်းတိုင်"],
  goal: ["goals", "aim", "ပန်းတိုင်"],
  running: ["run", "running", "jog", "workout"],
  run: ["running", "jog"],
  university: ["university", "college", "campus", "ကျောင်း", "တက္ကသိုလ်"],
  presentation: ["presentation", "slides"],
  software: ["software", "programming", "coding", "engineer"],
  engineering: ["engineering", "engineer", "software"],
  react: ["react", "frontend", "javascript"],
  study: ["study", "studied", "homework", "လေ့လာ"],
  family: ["family", "mom", "dad", "အမေ", "မိသားစု"],
};

export function expandQuery(query: string): string[] {
  const terms = meaningfulTerms(query);
  const expanded = new Set<string>();
  for (const term of terms) {
    for (const extra of EXPANSIONS[term] ?? []) expanded.add(extra);
  }
  for (const term of terms) expanded.delete(term);
  return [...expanded];
}

function coverage(terms: string[], haystack: string): number {
  if (terms.length === 0) return 0;
  const hits = terms.filter((term) => haystack.includes(term.toLowerCase())).length;
  return hits / terms.length;
}

function keywordScore(query: string, content: string, expanded: string[]): number {
  const phrase = normalizeText(query).toLowerCase();
  const haystack = content.toLowerCase();
  const phraseHit = phrase.length >= 3 && haystack.includes(phrase) ? 1 : 0;
  const primary = meaningfulTerms(query);
  const expansionHit = expanded.some((term) => haystack.includes(term.toLowerCase()));
  const overlap = Math.max(coverage(primary, haystack), expansionHit ? 0.72 : 0);
  return Math.max(phraseHit, overlap);
}

function passesFilters(document: SearchDocument, filters: SearchFilters): boolean {
  if (filters.topic && !document.topics.includes(filters.topic)) return false;
  if (filters.tag && !document.tags.map((tag) => tag.toLowerCase()).includes(filters.tag.toLowerCase())) return false;
  if (filters.language && document.language !== filters.language) return false;
  if (filters.from && document.createdAt < filters.from) return false;
  if (filters.to && document.createdAt > filters.to) return false;
  return true;
}

export function hybridSearch(query: string, documents: SearchDocument[], filters: SearchFilters = {}): SearchHit[] {
  const expanded = expandQuery(query);
  const mode = filters.mode ?? "hybrid";
  const queryVector = embedText([query, ...expanded].join(" "));
  const hits: SearchHit[] = [];

  for (const document of documents) {
    if (!passesFilters(document, filters)) continue;
    const lexical = keywordScore(query, document.content, expanded);
    const semantic = cosineSimilarity(queryVector, document.embedding ?? embedText(document.content));
    let score = lexical;
    if (mode === "semantic") score = semantic;
    if (mode === "hybrid") score = lexical * 0.55 + semantic * 0.45;
    if (score <= 0.05) continue;
    hits.push({
      id: document.id,
      score: Number(score.toFixed(4)),
      keywordScore: Number(lexical.toFixed(4)),
      semanticScore: Number(semantic.toFixed(4)),
      createdAt: document.createdAt,
      excerpt: excerptAround(document.content, query),
    });
  }

  hits.sort((a, b) => b.score - a.score || a.createdAt.localeCompare(b.createdAt));
  return hits.slice(0, filters.limit ?? 20);
}
