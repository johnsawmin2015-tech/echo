import { embeddingModelId, embedText } from "./embed.js";
import { emotionalContext } from "./emotion.js";
import { extractEntities } from "./entities.js";
import { classifyTopics, suggestTags } from "./topics.js";
import { detectLanguage, extractHashtags, splitSegments } from "./text.js";
import { defaultTranslationTarget, translateText } from "./translate.js";
import type { PipelineInput, PipelineResult, StageName, StageStatus } from "./types.js";

function failed(): { status: "failed" } {
  return { status: "failed" };
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const originalContent = input.originalContent;
  const failedStages = new Set<StageName>(input.failStages ?? []);
  const result: PipelineResult = {
    originalContent,
    language: { status: "pending" },
    translation: { status: "pending" },
    topics: { status: "pending" },
    emotionalContext: { status: "pending" },
    entities: { status: "pending" },
    embedding: { status: "pending" },
    suggestedTags: [],
  };

  const run = <T>(stage: StageName, fn: () => T, apply: (value: T) => void, onFail: () => void) => {
    if (failedStages.has(stage)) {
      onFail();
      return;
    }
    try {
      apply(fn());
    } catch {
      onFail();
    }
  };

  run("language", () => ({
    status: "succeeded" as StageStatus,
    value: detectLanguage(originalContent),
    segments: splitSegments(originalContent),
  }), (value) => {
    result.language = value;
  }, () => {
    result.language = failed();
  });

  run("translation", () => {
    const language = result.language.value ?? detectLanguage(originalContent);
    const target = input.translationTarget ?? defaultTranslationTarget(language);
    const translated = translateText(originalContent, target);
    if (!translated.translated) return { status: "skipped" as StageStatus };
    return {
      status: "succeeded" as StageStatus,
      text: translated.text,
      language: translated.language,
      quality: translated.quality,
      provider: translated.provider,
    };
  }, (value) => {
    result.translation = value;
  }, () => {
    result.translation = failed();
  });

  run("topics", () => ({
    status: "succeeded" as StageStatus,
    items: classifyTopics(originalContent),
  }), (value) => {
    result.topics = value;
    result.suggestedTags = suggestTags(originalContent, value.items ?? [], extractHashtags(originalContent));
  }, () => {
    result.topics = failed();
  });

  if (!input.emotionalContextEnabled) {
    result.emotionalContext = { status: "skipped" };
  } else {
    run("emotionalContext", () => emotionalContext(originalContent, true), (value) => {
      result.emotionalContext = value;
    }, () => {
      result.emotionalContext = failed();
    });
  }

  run("entities", () => ({
    status: "succeeded" as StageStatus,
    items: extractEntities(originalContent),
  }), (value) => {
    result.entities = value;
  }, () => {
    result.entities = failed();
  });

  run("embedding", () => ({
    status: "succeeded" as StageStatus,
    vector: embedText(originalContent),
    model: embeddingModelId(),
  }), (value) => {
    result.embedding = value;
  }, () => {
    result.embedding = failed();
  });

  if (result.originalContent !== originalContent) {
    throw new Error("original_content_mutated");
  }
  return result;
}
