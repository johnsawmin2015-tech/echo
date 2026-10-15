import type { EmotionalTheme } from "./types.js";
import { EMOTIONAL_CONTEXT_LABEL } from "./types.js";

const THEMES: { id: EmotionalTheme; terms: string[] }[] = [
  { id: "Stress", terms: ["stress", "stressed", "anxious", "anxiety", "overwhelmed", "စိတ်ဖိစီး", "ပူပန်", "စိတ်ညစ်"] },
  { id: "Relief", terms: ["relieved", "relief", "weight off"] },
  { id: "Accomplishment", terms: ["accomplished", "proud of", "finally finished", "nailed the"] },
  { id: "Joy", terms: ["happy", "grateful", "joy", "ပျော်"] },
  { id: "Sadness", terms: ["sad", "lonely", "miss them", "ဝမ်းနည်း"] },
];

export function detectEmotionalThemes(content: string): EmotionalTheme[] {
  const haystack = content.toLowerCase();
  const found = new Set<EmotionalTheme>();
  for (const theme of THEMES) {
    if (theme.terms.some((term) => haystack.includes(term))) found.add(theme.id);
  }
  if (
    /\b(pretty good|went well|did well)\b/i.test(content) &&
    /\b(presentation|exam|project|interview|assignment)\b/i.test(content)
  ) {
    found.add("Accomplishment");
  }
  return [...found];
}

export function emotionalContext(content: string, enabled: boolean): {
  status: "succeeded" | "skipped";
  label?: typeof EMOTIONAL_CONTEXT_LABEL;
  themes?: EmotionalTheme[];
} {
  if (!enabled) return { status: "skipped" };
  return {
    status: "succeeded",
    label: EMOTIONAL_CONTEXT_LABEL,
    themes: detectEmotionalThemes(content),
  };
}
