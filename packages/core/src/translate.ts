import type { LanguageCode } from "./types.js";
import { detectLanguage, normalizeText } from "./text.js";

const PHRASES: { my: string; en: string }[] = [
  {
    my: "ဒီနေ့ ကျောင်းမှာ presentation လုပ်ရတာ နည်းနည်းစိတ်ဖိစီးတယ်။",
    en: "Today, I felt a little stressed about giving a presentation at university.",
  },
  {
    my: "ဒီနေ့ presentation က actually pretty good ဖြစ်တယ်။",
    en: "Today's presentation was actually pretty good.",
  },
  {
    my: "ဒီနေ့ presentation မတိုင်ခင် တော်တော်လေး stress ဖြစ်နေတယ်။",
    en: "I was quite stressed before today's presentation.",
  },
  {
    my: "မနက်ဖြန် exam ရှိတယ်။",
    en: "I have an exam tomorrow.",
  },
  {
    my: "အမေနဲ့ ဖုန်းပြောဖြစ်တယ်။",
    en: "I talked on the phone with my mom.",
  },
  {
    my: "ဒီနေ့ React ကို နှစ်နာရီလောက် လေ့လာခဲ့တယ်။",
    en: "I studied React for about two hours today.",
  },
  {
    my: "ငါ့ရဲ့ goal က ဒီနှစ် software engineer ဖြစ်ချင်တယ်။",
    en: "My goal is to become a software engineer this year.",
  },
  {
    my: "မနေ့က running သွားခဲ့တယ်။ ၅ ကီလိုလောက်။",
    en: "I went running yesterday, about 5 kilometers.",
  },
  {
    my: "မိသားစုနဲ့ ထမင်းစားဖြစ်တယ်။",
    en: "I had a meal with my family.",
  },
  {
    my: "ဒီနေ့ OS homework ကို ၃ နာရီလောက်လုပ်ခဲ့တယ်။",
    en: "I worked on operating systems homework for about three hours today.",
  },
];

const GLOSSARY: [string, string][] = [
  ["နည်းနည်းစိတ်ဖိစီး", "a little stressed"],
  ["စိတ်ဖိစီး", "stressed"],
  ["မတိုင်ခင်", "before"],
  ["တော်တော်လေး", "quite"],
  ["ဖြစ်နေတယ်", "feeling"],
  ["ဖြစ်ချင်တယ်", "want to become"],
  ["လေ့လာခဲ့တယ်", "studied"],
  ["နှစ်နာရီလောက်", "about two hours"],
  ["၃ နာရီလောက်", "about three hours"],
  ["ဖုန်းပြောဖြစ်တယ်", "talked on the phone"],
  ["ထမင်းစားဖြစ်တယ်", "had a meal"],
  ["သွားခဲ့တယ်", "went"],
  ["လုပ်ခဲ့တယ်", "worked"],
  ["ရှိတယ်", "there is"],
  ["ဖြစ်တယ်", "is"],
  ["ဒီနေ့", "today"],
  ["မနေ့က", "yesterday"],
  ["မနက်ဖြန်", "tomorrow"],
  ["ကျောင်းမှာ", "at university"],
  ["တက္ကသိုလ်", "university"],
  ["ကျောင်း", "school"],
  ["အမေနဲ့", "with my mom"],
  ["အမေ", "mom"],
  ["မိသားစုနဲ့", "with my family"],
  ["မိသားစု", "family"],
  ["ငါ့ရဲ့", "my"],
  ["ဒီနှစ်", "this year"],
  ["လုပ်ရတာ", "having to do"],
  ["ကီလိုလောက်", "kilometers"],
  ["ကို", ""],
  ["က", ""],
  ["နဲ့", "with"],
  ["တယ်", ""],
  ["ပါ", ""],
];

const GLOSSARY_LOOKUP = new Map(GLOSSARY);

export type TranslationQuality = "high" | "approximate";

export type TranslationResult = {
  text: string;
  language: "en" | "my";
  quality: TranslationQuality;
  provider: string;
  translated: boolean;
};

type GlossToken = { kind: "syllable" | "latin" | "space" | "other"; text: string };

function isMyanmarBase(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (code >= 0x1000 && code <= 0x102a)
    || code === 0x103f
    || (code >= 0x1050 && code <= 0x1055)
    || (code >= 0x105a && code <= 0x105d)
    || code === 0x1061
    || code === 0x1065
    || code === 0x1066
    || (code >= 0x106e && code <= 0x1070)
    || (code >= 0x1075 && code <= 0x1081)
    || code === 0x108e
    || (code >= 0xaa60 && code <= 0xaa76)
    || (code >= 0xaa7a && code <= 0xaa7f)
    || (code >= 0xa9e0 && code <= 0xa9ef);
}

function isMyanmarDependent(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x102b && code <= 0x1038) return true;
  if (code >= 0x103b && code <= 0x103e) return true;
  if (code >= 0x1056 && code <= 0x1059) return true;
  if (code >= 0x105e && code <= 0x1060) return true;
  if (code >= 0x1062 && code <= 0x1064) return true;
  if (code >= 0x1067 && code <= 0x106d) return true;
  if (code >= 0x1071 && code <= 0x1074) return true;
  if (code >= 0x1082 && code <= 0x108d) return true;
  if (code === 0x108f || (code >= 0x109a && code <= 0x109d)) return true;
  return false;
}

function readSyllable(chars: string[], start: number): { text: string; next: number } | null {
  if (!isMyanmarBase(chars[start] ?? "")) return null;
  let index = start + 1;
  let text = chars[start];
  while (index + 1 < chars.length && chars[index] === "\u1039" && isMyanmarBase(chars[index + 1])) {
    text += chars[index] + chars[index + 1];
    index += 2;
  }
  while (index < chars.length && isMyanmarDependent(chars[index])) {
    text += chars[index];
    index += 1;
  }
  if (index + 1 < chars.length && isMyanmarBase(chars[index]) && chars[index + 1] === "\u103A") {
    text += chars[index] + chars[index + 1];
    index += 2;
    while (index < chars.length && isMyanmarDependent(chars[index])) {
      text += chars[index];
      index += 1;
    }
  }
  return { text, next: index };
}

function tokenizeGloss(text: string): GlossToken[] {
  const chars = [...text];
  const tokens: GlossToken[] = [];
  let index = 0;
  while (index < chars.length) {
    const char = chars[index];
    if (/\s/.test(char)) {
      let space = "";
      while (index < chars.length && /\s/.test(chars[index])) {
        space += chars[index];
        index += 1;
      }
      tokens.push({ kind: "space", text: space });
      continue;
    }
    if (/[A-Za-z0-9]/.test(char)) {
      let word = "";
      while (index < chars.length && /[A-Za-z0-9'’.-]/.test(chars[index])) {
        word += chars[index];
        index += 1;
      }
      tokens.push({ kind: "latin", text: word });
      continue;
    }
    const syllable = readSyllable(chars, index);
    if (syllable) {
      tokens.push({ kind: "syllable", text: syllable.text });
      index = syllable.next;
      continue;
    }
    tokens.push({ kind: "other", text: char });
    index += 1;
  }
  return tokens;
}

export function myanmarSyllables(text: string): string[] {
  return tokenizeGloss(text).filter((token) => token.kind === "syllable").map((token) => token.text);
}

function phraseKey(value: string): string {
  return normalizeText(value).replace(/[။၊.!?…]+/g, "").replace(/\s+/g, "").toLowerCase();
}

function unmatched(language: "en" | "my"): TranslationResult {
  return { text: "", language, quality: "approximate", provider: "glossary", translated: false };
}

export function translateText(text: string, target?: "en" | "my"): TranslationResult {
  const source = detectLanguage(text);
  const resolvedTarget: "en" | "my" = target ?? (source === "en" ? "my" : "en");
  if (source === "unknown") return unmatched(resolvedTarget);
  if ((resolvedTarget === "en" && source === "en") || (resolvedTarget === "my" && source === "my")) {
    return unmatched(resolvedTarget);
  }

  const normalized = normalizeText(text);
  const key = phraseKey(normalized);
  if (resolvedTarget === "en") {
    const exact = PHRASES.find((phrase) => phraseKey(phrase.my) === key);
    if (exact) return { text: exact.en, language: "en", quality: "high", provider: "glossary", translated: true };
    const gloss = glossToEnglish(normalized);
    if (!gloss) return unmatched("en");
    return { text: gloss, language: "en", quality: "approximate", provider: "glossary", translated: true };
  }

  const exactEnglish = PHRASES.find((phrase) => phraseKey(phrase.en) === key);
  if (exactEnglish) return { text: exactEnglish.my, language: "my", quality: "high", provider: "glossary", translated: true };
  return unmatched("my");
}

function glossToEnglish(text: string): string | null {
  const tokens = tokenizeGloss(text);
  const pieces: string[] = [];
  for (let index = 0; index < tokens.length;) {
    const token = tokens[index];
    if (token.kind === "space") {
      pieces.push(" ");
      index += 1;
      continue;
    }
    if (token.kind === "other") {
      pieces.push(token.text === "။" || token.text === "၊" ? "." : token.text);
      index += 1;
      continue;
    }
    let matchedEnd = -1;
    let matchedEnglish = "";
    let built = "";
    for (let cursor = index; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].kind === "space" || tokens[cursor].kind === "other") break;
      built += tokens[cursor].text;
      const english = GLOSSARY_LOOKUP.get(built);
      if (english !== undefined) {
        matchedEnd = cursor;
        matchedEnglish = english;
      }
    }
    if (matchedEnd >= 0) {
      if (matchedEnglish) pieces.push(matchedEnglish);
      index = matchedEnd + 1;
      continue;
    }
    pieces.push(token.text);
    index += 1;
  }
  const sentence = pieces.join("").replace(/\s+/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
  if (!sentence || sentence === text || detectLanguage(sentence) === "my") return null;
  if (/[\u102B-\u103E\u1056-\u1059]/.test(sentence) && brokenCluster(sentence)) return null;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function brokenCluster(text: string): boolean {
  const chars = [...text];
  for (let index = 0; index < chars.length; index += 1) {
    if (!isMyanmarDependent(chars[index]) && chars[index] !== "\u103A" && chars[index] !== "\u1039") continue;
    const previous = chars[index - 1];
    if (!previous || (!isMyanmarBase(previous) && !isMyanmarDependent(previous) && previous !== "\u103A" && previous !== "\u1039")) {
      return true;
    }
  }
  return false;
}

export function defaultTranslationTarget(language: LanguageCode): "en" | "my" {
  return language === "en" ? "my" : "en";
}
