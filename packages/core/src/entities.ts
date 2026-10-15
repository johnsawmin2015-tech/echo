import type { EntityMention } from "./types.js";
import { extractHashtags } from "./text.js";

const TERMS = ["react", "typescript", "leetcode", "github", "operating systems", "software engineering", "software engineer"];

export function extractEntities(content: string): EntityMention[] {
  const entities: EntityMention[] = [];
  for (const tag of extractHashtags(content)) {
    entities.push({ text: `#${tag}`, type: "hashtag" });
  }
  for (const match of content.matchAll(/\b(20\d{2}|[0-9]{1,2}\s(?:January|February|March|April|May|June|July|August|September|October|November|December))\b/gi)) {
    entities.push({ text: match[0], type: "date" });
  }
  for (const match of content.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g)) {
    entities.push({ text: match[1], type: "name" });
  }
  const lower = content.toLowerCase();
  for (const term of TERMS) {
    if (lower.includes(term)) entities.push({ text: term, type: "term" });
  }
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = `${entity.type}:${entity.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
