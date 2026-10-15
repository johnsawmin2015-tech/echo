export type InsightEntry = {
  content: string;
  createdAt: string;
  sourceType: "text" | "voice";
  topics: string[];
};

export type Insights = {
  entriesThisMonth: number;
  writingStreak: number;
  wordCount: number;
  voiceEntries: number;
  textEntries: number;
  mostActiveDay: string | null;
  topics: { topic: string; count: number }[];
  disclaimer: string;
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function countWords(content: string): number {
  const latin = content.match(/[A-Za-z0-9']+/g)?.length ?? 0;
  const myanmar = content.match(/[\u1000-\u109F\uAA60-\uAA7F\uA9E0-\uA9FF]+/g)?.length ?? 0;
  return latin + myanmar;
}

export function buildInsights(entries: InsightEntry[], now = new Date()): Insights {
  const month = now.toISOString().slice(0, 7);
  const entriesThisMonth = entries.filter((entry) => entry.createdAt.slice(0, 7) === month).length;
  const days = [...new Set(entries.map((entry) => dayKey(entry.createdAt)))].sort();
  const daySet = new Set(days);
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!daySet.has(cursor.toISOString().slice(0, 10))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  let writingStreak = 0;
  while (daySet.has(cursor.toISOString().slice(0, 10))) {
    writingStreak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const weekdayCounts = new Map<string, number>();
  const topicCounts = new Map<string, number>();
  let wordCount = 0;
  let voiceEntries = 0;
  let textEntries = 0;
  for (const entry of entries) {
    wordCount += countWords(entry.content);
    if (entry.sourceType === "voice") voiceEntries += 1;
    else textEntries += 1;
    const weekday = DAY_NAMES[new Date(entry.createdAt).getUTCDay()];
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);
    for (const topic of entry.topics) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  const mostActiveDay = [...weekdayCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topics = [...topicCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, 8);

  return {
    entriesThisMonth,
    writingStreak,
    wordCount,
    voiceEntries,
    textEntries,
    mostActiveDay,
    topics,
    disclaimer: "These counts describe your writing. They are not a health or psychological assessment.",
  };
}
