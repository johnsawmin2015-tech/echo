import { embedText, hybridSearch, runPipeline, type SearchDocument } from "@echo/core";

const samples = [
  "Today I studied operating systems for three hours.",
  "ဒီနေ့ presentation က actually pretty good ဖြစ်တယ်။",
  "I went running before the rain.",
  "My goals in 2026 are to learn React.",
];

const startedPipeline = performance.now();
for (let index = 0; index < 100; index += 1) {
  const result = runPipeline({ originalContent: samples[index % samples.length], emotionalContextEnabled: true });
  if (result.originalContent !== samples[index % samples.length]) throw new Error("original mutated");
}
const pipelineMs = performance.now() - startedPipeline;

const documents: SearchDocument[] = Array.from({ length: 1000 }, (_, index) => {
  const content = `${samples[index % samples.length]} note ${index}`;
  return {
    id: `doc-${index}`,
    content,
    createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    language: "en",
    topics: [],
    tags: [],
    embedding: embedText(content),
    sourceType: "text",
  };
});

const startedSearch = performance.now();
const hits = hybridSearch("operating systems", documents, { limit: 10 });
const searchMs = performance.now() - startedSearch;

const report = {
  pipelineRuns: 100,
  pipelineMs: Number(pipelineMs.toFixed(1)),
  searchDocuments: documents.length,
  searchMs: Number(searchMs.toFixed(1)),
  topHit: hits[0]?.id ?? null,
};
console.log(JSON.stringify(report, null, 2));

if (pipelineMs > 1500) throw new Error(`pipeline too slow: ${pipelineMs}ms`);
if (searchMs > 500) throw new Error(`search too slow: ${searchMs}ms`);
if (!hits[0]) throw new Error("search returned no hits");
