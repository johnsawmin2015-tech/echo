import type { LanguageCode } from "./types.js";
import { embedText } from "./embed.js";
import { translateText } from "./translate.js";
import { retry } from "./guard.js";

export interface SpeechProvider {
  readonly id: string;
  transcribe(input: { audio: Uint8Array; mime: string; languageHint?: string }): Promise<{ transcript: string; language: LanguageCode }>;
}

export interface TranslationProvider {
  readonly id: string;
  translate(text: string, target: "en" | "my"): Promise<{ text: string; quality: "high" | "approximate" }>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(text: string): Promise<number[]>;
}

export interface LLMProvider {
  readonly id: string;
  complete(input: { system: string; untrustedJournal: string; question: string }): Promise<string>;
}

export interface StorageProvider {
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class GlossaryTranslationProvider implements TranslationProvider {
  readonly id = "glossary";
  async translate(text: string, target: "en" | "my") {
    const result = translateText(text, target);
    return { text: result.text, quality: result.quality };
  }
}

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly id = "echo-hash-v1";
  async embed(text: string) {
    return embedText(text);
  }
}

export class UnavailableSpeechProvider implements SpeechProvider {
  readonly id = "unavailable";
  async transcribe(): Promise<{ transcript: string; language: LanguageCode }> {
    throw Object.assign(new Error("speech_unavailable"), { code: "speech_unavailable" });
  }
}

export function createHttpTranslationProvider(url: string, timeoutMs = 8000): TranslationProvider {
  return {
    id: "http",
    async translate(text: string, target: "en" | "my") {
      const response = await retry(async () => {
        const result = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, target }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!result.ok) throw new Error("translation_failed");
        return result;
      }, 2, 50);
      const payload = await response.json() as { text?: string };
      if (!payload.text) throw new Error("translation_failed");
      return { text: payload.text, quality: "high" as const };
    },
  };
}

export async function translateWithFallback(
  text: string,
  target: "en" | "my",
  providers: TranslationProvider[],
): Promise<{ text: string; quality: "high" | "approximate"; provider: string }> {
  const chain = providers.length > 0 ? providers : [new GlossaryTranslationProvider()];
  let lastError: unknown;
  for (const provider of chain) {
    try {
      const result = await provider.translate(text, target);
      return { ...result, provider: provider.id };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) {
    const glossary = new GlossaryTranslationProvider();
    const result = await glossary.translate(text, target);
    return { ...result, provider: glossary.id };
  }
  const glossary = new GlossaryTranslationProvider();
  const result = await glossary.translate(text, target);
  return { ...result, provider: glossary.id };
}
