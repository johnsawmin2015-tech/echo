export type ExportEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  originalContent: string;
  originalLanguage: string | null;
  sourceType: string;
  translation: string | null;
  translationLanguage: string | null;
  topics: string[];
  tags: string[];
  emotionalThemes: string[];
};

function csvCell(value: string): string {
  let cell = value.replaceAll('"', '""');
  if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
  return `"${cell}"`;
}

export function exportJson(entries: ExportEntry[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2);
}

export function exportMarkdown(entries: ExportEntry[]): string {
  return entries.map((entry) => {
    const topics = entry.topics.length ? entry.topics.join(", ") : "None";
    const tags = entry.tags.length ? entry.tags.map((tag) => `#${tag}`).join(" ") : "None";
    const translation = entry.translation
      ? `\n\n### ${entry.translationLanguage === "my" ? "Burmese" : "English"}\n\n${entry.translation}`
      : "";
    return `# ${entry.createdAt}\n\n${entry.originalContent}${translation}\n\nTopics: ${topics}\nTags: ${tags}\n`;
  }).join("\n---\n\n");
}

export function exportCsv(entries: ExportEntry[]): string {
  const header = ["id", "createdAt", "updatedAt", "sourceType", "originalLanguage", "originalContent", "translationLanguage", "translation", "topics", "tags", "emotionalThemes"];
  const lines = [header.join(",")];
  for (const entry of entries) {
    lines.push([
      entry.id,
      entry.createdAt,
      entry.updatedAt,
      entry.sourceType,
      entry.originalLanguage ?? "",
      entry.originalContent,
      entry.translationLanguage ?? "",
      entry.translation ?? "",
      entry.topics.join("|"),
      entry.tags.join("|"),
      entry.emotionalThemes.join("|"),
    ].map(csvCell).join(","));
  }
  return lines.join("\n");
}
