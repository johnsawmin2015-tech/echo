import { describe, expect, it } from "vitest";
import {
  answerQuestion,
  cer,
  classifyTopics,
  detectEmotionalThemes,
  detectLanguage,
  embedText,
  hybridSearch,
  precisionRecallF1,
  retrievalMetrics,
  tokenF1,
  translateText,
} from "../src/index.js";
import type { SearchDocument } from "../src/index.js";

const LANGUAGE_SET: { text: string; language: "my" | "en" | "mixed" | "unknown" }[] = [
  { text: "Today I studied operating systems for three hours.", language: "en" },
  { text: "I want to learn software engineering.", language: "en" },
  { text: "ဒီနေ့ ကျောင်းသွားတယ်။", language: "my" },
  { text: "မိသားစုနဲ့ ထမင်းစားဖြစ်တယ်။", language: "my" },
  { text: "ဒီနေ့ presentation က actually pretty good ဖြစ်တယ်။", language: "mixed" },
  { text: "ဒီနေ့ ကျောင်းမှာ presentation လုပ်ရတာ နည်းနည်းစိတ်ဖိစီးတယ်။", language: "mixed" },
  { text: "မနက်ဖြန် exam ရှိတယ်။", language: "mixed" },
  { text: "ဒီနေ့ React ကို နှစ်နာရီလောက် လေ့လာခဲ့တယ်။", language: "mixed" },
  { text: "12345", language: "unknown" },
  { text: "Maung Maung met Hla Hla at campus.", language: "en" },
];

const TRANSLATION_SET = [
  ["ဒီနေ့ presentation က actually pretty good ဖြစ်တယ်။", "Today's presentation was actually pretty good."],
  ["ဒီနေ့ ကျောင်းမှာ presentation လုပ်ရတာ နည်းနည်းစိတ်ဖိစီးတယ်။", "Today, I felt a little stressed about giving a presentation at university."],
  ["ဒီနေ့ presentation မတိုင်ခင် တော်တော်လေး stress ဖြစ်နေတယ်။", "I was quite stressed before today's presentation."],
  ["မနက်ဖြန် exam ရှိတယ်။", "I have an exam tomorrow."],
  ["အမေနဲ့ ဖုန်းပြောဖြစ်တယ်။", "I talked on the phone with my mom."],
  ["ဒီနေ့ React ကို နှစ်နာရီလောက် လေ့လာခဲ့တယ်။", "I studied React for about two hours today."],
  ["ငါ့ရဲ့ goal က ဒီနှစ် software engineer ဖြစ်ချင်တယ်။", "My goal is to become a software engineer this year."],
  ["မနေ့က running သွားခဲ့တယ်။ ၅ ကီလိုလောက်။", "I went running yesterday, about 5 kilometers."],
  ["မိသားစုနဲ့ ထမင်းစားဖြစ်တယ်။", "I had a meal with my family."],
  ["ဒီနေ့ OS homework ကို ၃ နာရီလောက်လုပ်ခဲ့တယ်။", "I worked on operating systems homework for about three hours today."],
];

const TOPIC_SET: { text: string; labels: string[] }[] = [
  { text: "Today I studied operating systems for three hours.", labels: ["study", "computer-science", "operating-systems"] },
  { text: "ဒီနေ့ presentation မတိုင်ခင် တော်တော်လေး stress ဖြစ်နေတယ်။", labels: ["presentation", "mental-well-being"] },
  { text: "ဒီနေ့ ကျောင်းမှာ presentation လုပ်ရတာ နည်းနည်းစိတ်ဖိစီးတယ်။", labels: ["university", "presentation", "mental-well-being"] },
  { text: "I went running and then did a short workout.", labels: ["fitness"] },
  { text: "My goal is to become a software engineer this year.", labels: ["goals", "career"] },
  { text: "Had dinner with my family after calling mom.", labels: ["family"] },
  { text: "The rent and salary budget are tight.", labels: ["finance"] },
  { text: "I solved a leetcode problem in React.", labels: ["programming"] },
];

const NEUTRAL = [
  "I drank water and walked to class.",
  "The lecture starts at nine.",
  "I bought a notebook.",
  "Today is Thursday.",
];

function document(id: string, content: string, createdAt: string): SearchDocument {
  return { id, content, createdAt, language: "en", topics: [], tags: [], embedding: embedText(content), sourceType: "text" };
}

describe("Burmese and AI evaluation", () => {
  it("meets the language-detection threshold on the labeled set", () => {
    const correct = LANGUAGE_SET.filter((item) => detectLanguage(item.text) === item.language).length;
    expect(correct / LANGUAGE_SET.length).toBeGreaterThanOrEqual(0.9);
  });

  it("meets the curated translation threshold and reports held-out gloss quality separately", () => {
    const exact = TRANSLATION_SET.filter(([source, reference]) => translateText(source).text === reference).length;
    expect(exact / TRANSLATION_SET.length).toBeGreaterThanOrEqual(0.85);
    const heldOut = translateText("ဒီနေ့ library မှာ စာကျက်နေတယ်။");
    expect(heldOut.quality).toBe("approximate");
    expect(tokenF1(heldOut.text, "Today I am studying at the library.")).toBeGreaterThan(0);
    expect(cer("ဒီနေ့", "ဒီနေ့")).toBe(0);
  });

  it("meets the topic classification threshold", () => {
    const predicted = TOPIC_SET.map((item) => classifyTopics(item.text).map((topic) => topic.slug));
    const expected = TOPIC_SET.map((item) => item.labels);
    const scores = precisionRecallF1(predicted, expected);
    expect(scores.f1).toBeGreaterThanOrEqual(0.75);
  });

  it("keeps emotional false positives at zero on neutral writing", () => {
    const falsePositives = NEUTRAL.filter((text) => detectEmotionalThemes(text).length > 0).length;
    expect(falsePositives / NEUTRAL.length).toBe(0);
    expect(detectEmotionalThemes(NEUTRAL[0])).toEqual(detectEmotionalThemes(NEUTRAL[0]));
  });

  it("meets the retrieval threshold and stays grounded", () => {
    const corpus = [
      document("se", "I want to learn software engineering.", "2024-02-01T00:00:00.000Z"),
      document("os", "Today I studied operating systems for three hours.", "2025-05-01T00:00:00.000Z"),
      document("run", "I went running along the river.", "2025-06-02T00:00:00.000Z"),
      document("goal", "My goals in 2026 are to learn React.", "2026-01-04T00:00:00.000Z"),
      document("talk", "University presentation notes from Monday.", "2026-03-02T00:00:00.000Z"),
    ];
    const queries = [
      { query: "software engineering", relevant: ["se"] },
      { query: "running", relevant: ["run"] },
      { query: "my goals in 2026", relevant: ["goal"] },
      { query: "university presentation", relevant: ["talk"] },
    ];
    const rankings = queries.map((item) => ({
      relevant: new Set(item.relevant),
      ranked: hybridSearch(item.query, corpus, { limit: 5 }).map((hit) => hit.id),
    }));
    const metrics = retrievalMetrics(rankings, 5);
    expect(metrics.recallAtK).toBeGreaterThanOrEqual(0.8);
    expect(metrics.mrr).toBeGreaterThanOrEqual(0.8);

    const memory = answerQuestion("What did I write about my university presentation?", corpus);
    expect(memory.sources.every((source) => corpus.find((entry) => entry.id === source.entryId)?.content.includes(source.excerpt))).toBe(true);
    expect(memory.answer).not.toContain("grade");
  });
});
