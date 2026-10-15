import { EMBEDDING_MODEL } from "./types.js";
import { tokenize } from "./text.js";

export const EMBEDDING_DIMENSION = 256;

function hashToken(token: string): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function characterGrams(text: string): string[] {
  const compact = text.toLowerCase().replace(/\s+/g, " ").trim();
  const grams: string[] = [];
  for (let size = 3; size <= 4; size += 1) {
    for (let index = 0; index <= compact.length - size; index += 1) {
      grams.push(compact.slice(index, index + size));
    }
  }
  return grams;
}

export function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSION).fill(0);
  for (const token of tokenize(text)) {
    vector[hashToken(token) % EMBEDDING_DIMENSION] += 1;
    vector[hashToken(`t:${token}`) % EMBEDDING_DIMENSION] += 0.5;
  }
  for (const gram of characterGrams(text)) {
    vector[hashToken(`g:${gram}`) % EMBEDDING_DIMENSION] += 0.25;
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += left[index] * right[index];
  return score;
}

export function embeddingModelId(): string {
  return EMBEDDING_MODEL;
}
