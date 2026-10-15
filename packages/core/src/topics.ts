import type { TopicMatch } from "./types.js";
import { normalizeText } from "./text.js";

export const TOPIC_TAXONOMY: { slug: string; label: string; keywords: string[] }[] = [
  { slug: "university", label: "University", keywords: ["university", "college", "campus", "lecture", "professor", "semester", "ကျောင်း", "တက္ကသိုလ်"] },
  { slug: "study", label: "Study", keywords: ["study", "studied", "studying", "homework", "exam", "revise", "revision", "စာကျက်", "စာမေးပွဲ", "လေ့လာ"] },
  { slug: "computer-science", label: "Computer Science", keywords: ["computer science", "algorithm", "data structure", "operating systems", "operating system"] },
  { slug: "operating-systems", label: "Operating Systems", keywords: ["operating systems", "operating system"] },
  { slug: "presentation", label: "Presentation", keywords: ["presentation", "slides", "presenting"] },
  { slug: "mental-well-being", label: "Mental Well-being", keywords: ["stress", "stressed", "anxious", "anxiety", "overwhelmed", "burnout", "စိတ်ဖိစီး", "စိတ်ညစ်", "ပူပန်"] },
  { slug: "career", label: "Career", keywords: ["career", "interview", "resume", "promotion", "job offer", "software engineer", "software engineering"] },
  { slug: "work", label: "Work", keywords: ["work", "office", "meeting", "deadline", "boss", "coworker", "အလုပ်"] },
  { slug: "relationships", label: "Relationships", keywords: ["relationship", "boyfriend", "girlfriend", "partner"] },
  { slug: "family", label: "Family", keywords: ["family", "mom", "dad", "mother", "father", "sister", "brother", "parents", "မိသားစု", "အမေ", "အဖေ"] },
  { slug: "personal-growth", label: "Personal Growth", keywords: ["habit", "reflect", "personal growth", "ကိုယ်ပိုင်"] },
  { slug: "fitness", label: "Fitness", keywords: ["gym", "workout", "running", "jog", "lifted", "mileage"] },
  { slug: "health", label: "Health", keywords: ["health", "doctor", "sick", "illness", "headache", "ကျန်းမာ"] },
  { slug: "finance", label: "Finance", keywords: ["money", "rent", "salary", "budget", "spent", "ငွေ"] },
  { slug: "travel", label: "Travel", keywords: ["travel", "flight", "airport", "trip to", "ခရီး"] },
  { slug: "creativity", label: "Creativity", keywords: ["painting", "guitar", "sketch", "creative", "compose"] },
  { slug: "goals", label: "Goals", keywords: ["goal", "goals", "resolution", "ပန်းတိုင်"] },
  { slug: "hobbies", label: "Hobbies", keywords: ["hobby", "chess", "garden"] },
  { slug: "technology", label: "Technology", keywords: ["software", "startup", "computer", "typescript", "github"] },
  { slug: "programming", label: "Programming", keywords: ["programming", "coding", "react", "leetcode", "code"] },
];

function keywordMatches(haystack: string, keyword: string): boolean {
  const needle = keyword.toLowerCase();
  if (/[a-z]/i.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(haystack);
  }
  return haystack.includes(needle);
}

export function classifyTopics(content: string): TopicMatch[] {
  const haystack = normalizeText(content).toLowerCase();
  const matches: TopicMatch[] = [];
  for (const topic of TOPIC_TAXONOMY) {
    const hits = topic.keywords.filter((keyword) => keywordMatches(haystack, keyword));
    if (hits.length === 0) continue;
    const confidence = Math.min(0.95, 0.62 + hits.length * 0.12);
    matches.push({ slug: topic.slug, label: topic.label, confidence: Number(confidence.toFixed(2)) });
  }
  return matches.sort((a, b) => b.confidence - a.confidence || a.label.localeCompare(b.label));
}

export function suggestTags(content: string, topics: { slug: string }[], existing: string[] = []): string[] {
  const taken = new Set(existing.map((tag) => tag.toLowerCase()));
  const suggestions: string[] = [];
  for (const topic of topics) {
    const tag = topic.slug.toLowerCase();
    if (taken.has(tag)) continue;
    suggestions.push(tag);
    if (suggestions.length >= 5) break;
  }
  if (content.toLowerCase().includes("leetcode") && !taken.has("leetcode")) suggestions.push("leetcode");
  return [...new Set(suggestions)].slice(0, 5);
}
