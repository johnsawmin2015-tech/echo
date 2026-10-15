import { hybridSearch } from "./search.js";
import { expandQuery } from "./search.js";
import type { MemoryAnswer, SearchDocument } from "./types.js";
import { INSUFFICIENT_EVIDENCE } from "./types.js";
import { formatJournalDate, meaningfulTerms, sentences } from "./text.js";

function detectIntent(question: string): MemoryAnswer["retrievalMetadata"]["intent"] {
  const normalized = question.toLowerCase();
  if (/when did i first|first (talk|mention|write|wrote)|earliest/.test(normalized)) return "first";
  if (/show everything|everything i wrote|everything about|all entries|list everything/.test(normalized)) return "list";
  return "question";
}

function bestSentence(content: string, question: string): string {
  const terms = meaningfulTerms(question);
  const parts = sentences(content);
  let best = parts[0] ?? content;
  let bestScore = -1;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const score = terms.reduce((total, term) => total + (lower.includes(term.toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) {
      best = part;
      bestScore = score;
    }
  }
  return best.trim();
}

function isStrong(score: number, keywordScore: number): boolean {
  return keywordScore >= 0.45 || score >= 0.32;
}

export function answerQuestion(question: string, documents: SearchDocument[]): MemoryAnswer {
  const expandedTerms = expandQuery(question);
  const intent = detectIntent(question);
  const hits = hybridSearch(question, documents, { limit: 8 });
  const strong = hits.filter((hit) => isStrong(hit.score, hit.keywordScore));
  const byId = new Map(documents.map((document) => [document.id, document]));

  const metadata = {
    intent,
    candidateCount: hits.length,
    usedCount: 0,
    expandedTerms,
  };

  if (strong.length === 0) {
    return { answer: INSUFFICIENT_EVIDENCE, sources: [], confidence: 0, retrievalMetadata: metadata };
  }

  const ordered = intent === "first"
    ? [...strong].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 1)
    : intent === "list"
      ? [...strong].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 8)
      : strong.slice(0, 3);

  const sources = ordered.flatMap((hit) => {
    const document = byId.get(hit.id);
    if (!document) return [];
    const excerpt = bestSentence(document.content, question);
    if (!document.content.includes(excerpt)) return [];
    return [{ entryId: document.id, createdAt: document.createdAt, excerpt }];
  });

  if (sources.length === 0) {
    return { answer: INSUFFICIENT_EVIDENCE, sources: [], confidence: 0, retrievalMetadata: metadata };
  }

  metadata.usedCount = sources.length;
  const confidence = Number(Math.max(...ordered.map((hit) => hit.score)).toFixed(4));
  const lines = sources.map((source) => `${formatJournalDate(source.createdAt)}: "${source.excerpt}"`);

  let answer: string;
  if (intent === "first") {
    answer = `The earliest entry I can ground this in is ${lines[0]}`;
  } else if (intent === "list") {
    answer = `I found ${sources.length} ${sources.length === 1 ? "entry" : "entries"} in your journal.\n${lines.join("\n")}`;
  } else {
    answer = `Here is what your journal says.\n${lines.join("\n")}`;
  }

  return { answer, sources, confidence, retrievalMetadata: metadata };
}
