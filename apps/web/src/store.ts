import {
  answerQuestion,
  buildInsights,
  createId,
  exportCsv,
  exportJson,
  exportMarkdown,
  extractHashtags,
  hybridSearch,
  runPipeline,
  type ExportEntry,
  type MemoryAnswer,
  type SearchHit,
  type SearchMode,
} from "@echo/core";

const STORAGE_KEY = "echo.journal.v1";
const SESSION_KEY = "echo.session.v1";

export type LocalEntry = {
  id: string;
  originalContent: string;
  originalLanguage: string | null;
  sourceType: "text" | "voice";
  createdAt: string;
  updatedAt: string;
  processingStatus: "pending" | "ready" | "partial";
  syncStatus: "pending" | "synced" | "conflict" | "local";
  translation: { language: string; content: string; quality: string } | null;
  topics: { slug: string; label: string; confidence: number }[];
  tags: string[];
  suggestedTags: string[];
  emotionalThemes: string[] | null;
  revisions: { content: string; reason: string; createdAt: string }[];
  conflictContent: string | null;
  remoteUpdatedAt: string | null;
};

export type EchoSettings = {
  emotionalContextEnabled: boolean;
  showTranslation: boolean;
  speechLanguage: "en" | "my";
  email: string | null;
  apiBase: string;
};

export type EchoState = {
  entries: LocalEntry[];
  settings: EchoSettings;
  token: string | null;
  online: boolean;
};

const defaultSettings = (): EchoSettings => ({
  emotionalContextEnabled: true,
  showTranslation: true,
  speechLanguage: "my",
  email: null,
  apiBase: "http://127.0.0.1:8787",
});

let state: EchoState = load();
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): EchoState {
  return state;
}

function emit(next: EchoState): void {
  state = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries: next.entries, settings: next.settings }));
  if (next.token) sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: next.token, email: next.settings.email }));
  else sessionStorage.removeItem(SESSION_KEY);
  for (const listener of listeners) listener();
}

function load(): EchoState {
  let entries: LocalEntry[] = [];
  let settings = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { entries?: LocalEntry[]; settings?: EchoSettings };
      entries = Array.isArray(parsed.entries) ? parsed.entries : [];
      settings = { ...defaultSettings(), ...parsed.settings };
    }
  } catch {
    entries = [];
  }
  let token: string | null = null;
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as { token?: string; email?: string } | null;
    token = session?.token ?? null;
    if (session?.email) settings.email = session.email;
  } catch {
    token = null;
  }
  return { entries, settings, token, online: typeof navigator === "undefined" ? true : navigator.onLine };
}

function patchEntry(id: string, recipe: (entry: LocalEntry) => LocalEntry): void {
  emit({
    ...state,
    entries: state.entries.map((entry) => (entry.id === id ? recipe(entry) : entry)),
  });
}

export function createEntry(content: string, sourceType: "text" | "voice", tags: string[] = []): string {
  const now = new Date().toISOString();
  const entry: LocalEntry = {
    id: createId(),
    originalContent: content,
    originalLanguage: null,
    sourceType,
    createdAt: now,
    updatedAt: now,
    processingStatus: "pending",
    syncStatus: state.token ? "pending" : "local",
    translation: null,
    topics: [],
    tags: uniqueTags([...tags, ...extractHashtags(content)]),
    suggestedTags: [],
    emotionalThemes: null,
    revisions: [],
    conflictContent: null,
    remoteUpdatedAt: null,
  };
  emit({ ...state, entries: [entry, ...state.entries] });
  queueMicrotask(() => {
    enrich(entry.id);
    void pushEntry(entry.id);
  });
  return entry.id;
}

export function updateEntry(id: string, content: string): void {
  const current = state.entries.find((entry) => entry.id === id);
  if (!current || current.originalContent === content) return;
  const now = new Date().toISOString();
  patchEntry(id, (entry) => ({
    ...entry,
    revisions: [{ content: entry.originalContent, reason: "user_edit", createdAt: now }, ...entry.revisions].slice(0, 20),
    originalContent: content,
    updatedAt: now,
    processingStatus: "pending",
    syncStatus: state.token ? "pending" : "local",
    translation: null,
    topics: [],
    suggestedTags: [],
    emotionalThemes: null,
    tags: uniqueTags([...entry.tags, ...extractHashtags(content)]),
  }));
  queueMicrotask(() => {
    enrich(id);
    void pushEntry(id);
  });
}

export function reprocess(id: string): void {
  patchEntry(id, (entry) => ({ ...entry, processingStatus: "pending", translation: null }));
  queueMicrotask(() => enrich(id));
}

export function deleteEntry(id: string): void {
  emit({ ...state, entries: state.entries.filter((entry) => entry.id !== id) });
  void deleteRemote(id);
}

export function addTag(id: string, label: string): void {
  const clean = label.replace(/^#/, "").trim().toLowerCase();
  if (!clean) return;
  patchEntry(id, (entry) => ({ ...entry, tags: uniqueTags([...entry.tags, clean]) }));
  void pushEntry(id);
}

export function removeTag(id: string, label: string): void {
  patchEntry(id, (entry) => ({ ...entry, tags: entry.tags.filter((tag) => tag !== label) }));
  void pushEntry(id);
}

export function keepConflictVersion(id: string, choice: "device" | "other"): void {
  patchEntry(id, (entry) => {
    if (choice === "device" || !entry.conflictContent) {
      return { ...entry, syncStatus: state.token ? "pending" : "local", conflictContent: null };
    }
    return {
      ...entry,
      revisions: [{ content: entry.originalContent, reason: "sync_conflict_preserved", createdAt: new Date().toISOString() }, ...entry.revisions],
      originalContent: entry.conflictContent,
      conflictContent: null,
      syncStatus: state.token ? "pending" : "local",
      translation: null,
      processingStatus: "pending",
    };
  });
  queueMicrotask(() => {
    enrich(id);
    void pushEntry(id);
  });
}

export function updateSettings(patch: Partial<EchoSettings>): void {
  const settings = { ...state.settings, ...patch };
  emit({ ...state, settings });
  if (patch.emotionalContextEnabled !== undefined) {
    for (const entry of state.entries) enrich(entry.id);
  }
}

export function clearDevice(): void {
  emit({ ...state, entries: [] });
}

export function searchEntries(query: string, filters?: { topic?: string; tag?: string; language?: "my" | "en" | "mixed" | "unknown"; mode?: SearchMode }): SearchHit[] {
  return hybridSearch(query, state.entries.map(toDocument), { ...filters, limit: 20 });
}

export function askJournal(question: string): MemoryAnswer {
  return answerQuestion(question, state.entries.map(toDocument));
}

export function insights() {
  return buildInsights(state.entries.map((entry) => ({
    content: entry.originalContent,
    createdAt: entry.createdAt,
    sourceType: entry.sourceType,
    topics: entry.topics.map((topic) => topic.label),
  })));
}

export function exportEntries(format: "json" | "markdown" | "csv"): string {
  const entries = state.entries.map(toExport);
  if (format === "markdown") return exportMarkdown(entries);
  if (format === "csv") return exportCsv(entries);
  return exportJson(entries);
}

export async function signIn(email: string, password: string, mode: "login" | "register"): Promise<string | null> {
  const response = await fetch(`${state.settings.apiBase}/api/auth/${mode === "login" ? "login" : "register"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName: email.split("@")[0] }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Sign-in didn't work." })) as { error?: string };
    return body.error ?? "Sign-in didn't work.";
  }
  const body = await response.json() as { token: string };
  emit({ ...state, token: body.token, settings: { ...state.settings, email } });
  await pull();
  for (const entry of state.entries.filter((item) => item.syncStatus !== "synced")) void pushEntry(entry.id);
  return null;
}

export async function signOut(): Promise<void> {
  if (state.token) {
    await fetch(`${state.settings.apiBase}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${state.token}` } }).catch(() => undefined);
  }
  emit({ ...state, token: null, settings: { ...state.settings, email: null } });
}

export async function deleteAccount(): Promise<string | null> {
  if (!state.token) return "Sign in before deleting an account.";
  const response = await fetch(`${state.settings.apiBase}/api/me`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${state.token}`, "content-type": "application/json" },
    body: JSON.stringify({ confirm: "delete" }),
  });
  if (!response.ok) return "The account could not be deleted.";
  emit({ ...state, entries: [], token: null, settings: { ...state.settings, email: null } });
  return null;
}

export function setOnline(online: boolean): void {
  if (state.online === online) return;
  emit({ ...state, online });
  if (online) void pull();
}

function enrich(id: string): void {
  const entry = state.entries.find((item) => item.id === id);
  if (!entry) return;
  const snapshot = entry.originalContent;
  const result = runPipeline({
    originalContent: snapshot,
    emotionalContextEnabled: state.settings.emotionalContextEnabled,
  });
  const current = state.entries.find((item) => item.id === id);
  if (!current || current.originalContent !== snapshot || result.originalContent !== snapshot) return;
  const translationText = result.translation.status === "succeeded" ? result.translation.text ?? "" : "";
  const showTranslation = result.translation.status === "succeeded" && translationText.trim() && translationText.trim() !== snapshot.trim();
  patchEntry(id, (item) => ({
    ...item,
    originalLanguage: result.language.value ?? item.originalLanguage,
    processingStatus: [result.language, result.translation, result.topics, result.embedding].some((stage) => stage.status === "failed") ? "partial" : "ready",
    translation: showTranslation ? {
      language: result.translation.language ?? "en",
      content: translationText,
      quality: result.translation.quality ?? "approximate",
    } : null,
    topics: result.topics.items ?? [],
    suggestedTags: result.suggestedTags.filter((tag) => !item.tags.includes(tag)),
    emotionalThemes: result.emotionalContext.status === "succeeded" ? result.emotionalContext.themes ?? [] : null,
  }));
}

async function pushEntry(id: string): Promise<void> {
  const token = state.token;
  const entry = state.entries.find((item) => item.id === id);
  if (!token || !entry || !state.online) return;
  try {
    const response = await fetch(`${state.settings.apiBase}/api/sync/push`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        operations: [{
          entityId: entry.id,
          op: "upsert",
          payload: {
            originalContent: entry.originalContent,
            sourceType: entry.sourceType,
            baseUpdatedAt: entry.remoteUpdatedAt,
            tags: entry.tags,
          },
        }],
      }),
    });
    if (!response.ok) return;
    const body = await response.json() as { results: { status: string; serverContent?: string; incomingContent?: string }[] };
    const result = body.results[0];
    if (!result || state.entries.find((item) => item.id === id)?.originalContent !== entry.originalContent) return;
    if (result.status === "conflict" && result.serverContent && result.serverContent !== entry.originalContent) {
      patchEntry(id, (item) => ({
        ...item,
        syncStatus: "conflict",
        conflictContent: result.serverContent ?? item.conflictContent,
      }));
      return;
    }
    if (result.status === "saved") {
      const detail = await fetch(`${state.settings.apiBase}/api/journal/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = detail.ok ? await detail.json() as { entry?: { updatedAt?: string } } : {};
      patchEntry(id, (item) => ({
        ...item,
        syncStatus: "synced",
        remoteUpdatedAt: payload.entry?.updatedAt ?? item.remoteUpdatedAt,
      }));
    }
  } catch {
    patchEntry(id, (item) => ({ ...item, syncStatus: "pending" }));
  }
}

async function deleteRemote(id: string): Promise<void> {
  if (!state.token) return;
  await fetch(`${state.settings.apiBase}/api/journal/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${state.token}` },
  }).catch(() => undefined);
}

async function pull(): Promise<void> {
  if (!state.token || !state.online) return;
  try {
    const response = await fetch(`${state.settings.apiBase}/api/journal`, {
      headers: { authorization: `Bearer ${state.token}` },
    });
    if (!response.ok) return;
    const body = await response.json() as { entries: { id: string; originalContent: string; originalLanguage: string | null; sourceType: "text" | "voice"; createdAt: string; updatedAt: string; processingStatus: string; syncStatus: string }[] };
    const known = new Map(state.entries.map((entry) => [entry.id, entry]));
    const merged = [...state.entries];
    for (const remote of body.entries) {
      if (known.has(remote.id)) continue;
      merged.push({
        id: remote.id,
        originalContent: remote.originalContent,
        originalLanguage: remote.originalLanguage,
        sourceType: remote.sourceType,
        createdAt: remote.createdAt,
        updatedAt: remote.updatedAt,
        processingStatus: "pending",
        syncStatus: "synced",
        translation: null,
        topics: [],
        tags: extractHashtags(remote.originalContent),
        suggestedTags: [],
        emotionalThemes: null,
        revisions: [],
        conflictContent: null,
        remoteUpdatedAt: remote.updatedAt,
      });
    }
    if (merged.length !== state.entries.length) {
      emit({ ...state, entries: merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
      for (const entry of merged.filter((item) => item.processingStatus === "pending")) enrich(entry.id);
    }
  } catch {
    setOnline(false);
  }
}

function toDocument(entry: LocalEntry) {
  return {
    id: entry.id,
    content: entry.originalContent,
    createdAt: entry.createdAt,
    language: (entry.originalLanguage as "my" | "en" | "mixed" | "unknown" | null) ?? null,
    topics: entry.topics.map((topic) => topic.slug),
    tags: entry.tags,
    embedding: null,
    sourceType: entry.sourceType,
  };
}

function toExport(entry: LocalEntry): ExportEntry {
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    originalContent: entry.originalContent,
    originalLanguage: entry.originalLanguage,
    sourceType: entry.sourceType,
    translation: entry.translation?.content ?? null,
    translationLanguage: entry.translation?.language ?? null,
    topics: entry.topics.map((topic) => topic.label),
    tags: entry.tags,
    emotionalThemes: entry.emotionalThemes ?? [],
  };
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}
