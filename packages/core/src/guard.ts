const SENSITIVE_KEYS = new Set([
  "originalcontent",
  "content",
  "translation",
  "password",
  "passwordhash",
  "token",
  "authorization",
  "audiobase64",
  "body",
  "excerpt",
  "quote",
  "transcript",
  "vector",
  "vectorjson",
]);

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max-depth]";
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth + 1));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      output[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? "[redacted]" : redactForLog(inner, depth + 1);
    }
    return output;
  }
  return value;
}

export function wrapUntrustedJournal(content: string): string {
  const safe = content.replaceAll("</journal_entry>", "<\\/journal_entry>");
  return `<journal_entry trust="untrusted">\n${safe}\n</journal_entry>`;
}

export const USER_MESSAGES: Record<string, string> = {
  speech_unavailable: "Speech recognition isn't available right now. You can type this entry instead.",
  translation_failed: "Translation is unavailable. Your original entry is saved.",
  timeout: "That took too long. Your writing is saved.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  unauthorized: "Sign in to continue.",
  not_found: "That entry could not be found.",
  invalid: "Check the details and try again.",
  conflict: "This entry changed on another device. Both versions are kept.",
  too_large: "This entry is too long to save.",
  empty: "Write something before saving.",
};

export function userMessage(code: string): string {
  return USER_MESSAGES[code] ?? "Something went wrong. Your writing is saved.";
}

export async function retry<T>(fn: () => Promise<T>, attempts = 3, baseMs = 20): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
