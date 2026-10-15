import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EMOTIONAL_CONTEXT_LABEL,
  TOPIC_TAXONOMY,
  buildInsights,
  createId,
  exportCsv,
  exportJson,
  exportMarkdown,
  extractHashtags,
  hybridSearch,
  resolveSync,
  type ExportEntry,
  type SearchDocument,
  type SearchFilters,
  type StageName,
} from "@echo/core";
import type { PipelineResult } from "@echo/core";
import { SCHEMA } from "./schema.js";

export type EchoDB = DatabaseSync;

const STAGES: StageName[] = ["language", "translation", "topics", "emotionalContext", "entities", "embedding"];

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  emotional_context_enabled: number;
  created_at: string;
};

type EntryRecord = {
  id: string;
  user_id: string;
  original_content: string;
  original_language: string | null;
  source_type: "text" | "voice";
  processing_status: string;
  sync_status: string;
  created_at: string;
  updated_at: string;
};

export function openDatabase(filename: string): EchoDB {
  if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  migrate(db);
  return db;
}

export function migrate(db: EchoDB): void {
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  const insertTopic = db.prepare("INSERT OR IGNORE INTO topics (slug, label) VALUES (?, ?)");
  for (const topic of TOPIC_TAXONOMY) insertTopic.run(topic.slug, topic.label);
}

export function createUser(db: EchoDB, input: { email: string; passwordHash: string; displayName: string }): UserRecord {
  const now = new Date().toISOString();
  const id = createId();
  db.prepare(`INSERT INTO users (id, email, password_hash, display_name, emotional_context_enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)`).run(
    id,
    input.email,
    input.passwordHash,
    input.displayName,
    now,
  );
  return findUserById(db, id)!;
}

export function findUserByEmail(db: EchoDB, email: string): UserRecord | null {
  return (db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRecord | undefined) ?? null;
}

export function findUserById(db: EchoDB, id: string): UserRecord | null {
  return (db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined) ?? null;
}

export function createSession(db: EchoDB, userId: string, tokenHash: string): void {
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();
  db.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
    createId(),
    userId,
    tokenHash,
    expires,
    now.toISOString(),
  );
}

export function findUserByToken(db: EchoDB, tokenHash: string): UserRecord | null {
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).get(tokenHash, now) as UserRecord | undefined;
  return row ?? null;
}

export function deleteSession(db: EchoDB, tokenHash: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function updateUser(db: EchoDB, userId: string, patch: { displayName?: string; emotionalContextEnabled?: boolean }): UserRecord | null {
  const current = findUserById(db, userId);
  if (!current) return null;
  db.prepare("UPDATE users SET display_name = ?, emotional_context_enabled = ? WHERE id = ?").run(
    patch.displayName ?? current.display_name,
    patch.emotionalContextEnabled === undefined ? current.emotional_context_enabled : patch.emotionalContextEnabled ? 1 : 0,
    userId,
  );
  return findUserById(db, userId);
}

export function createEntry(db: EchoDB, input: {
  userId: string;
  id?: string;
  content: string;
  sourceType: "text" | "voice";
  tags?: string[];
}): { type: "created"; id: string } | { type: "forbidden" } | ReturnType<typeof updateEntry> {
  const id = input.id ?? createId();
  const existing = db.prepare("SELECT user_id FROM journal_entries WHERE id = ?").get(id) as { user_id: string } | undefined;
  if (existing && existing.user_id !== input.userId) return { type: "forbidden" };
  if (existing) {
    return updateEntry(db, {
      userId: input.userId,
      id,
      content: input.content,
      baseUpdatedAt: null,
      tags: input.tags,
    });
  }
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO journal_entries (
      id, user_id, original_content, original_language, source_type, processing_status, sync_status, created_at, updated_at, client_updated_at
    ) VALUES (?, ?, ?, NULL, ?, 'pending', 'synced', ?, ?, ?)`).run(id, input.userId, input.content, input.sourceType, now, now, now);
    replaceFts(db, id, input.userId, input.content);
    replaceUserTags(db, id, input.userId, [...(input.tags ?? []), ...extractHashtags(input.content)]);
    enqueueJobs(db, id, input.userId, now);
    recordSync(db, input.userId, id, "upsert", "applied");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { type: "created", id };
}

export function updateEntry(db: EchoDB, input: {
  userId: string;
  id: string;
  content: string;
  baseUpdatedAt: string | null;
  tags?: string[];
}): { type: "missing" } | { type: "ok"; id: string } | { type: "conflict"; id: string; serverContent: string; incomingContent: string; updatedAt: string } {
  const current = getEntry(db, input.userId, input.id);
  if (!current) return { type: "missing" };
  const decision = resolveSync(
    { content: current.original_content, updatedAt: current.updated_at },
    { content: input.content, baseUpdatedAt: input.baseUpdatedAt },
  );
  if (decision.type === "unchanged") return { type: "ok", id: input.id };
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (decision.type === "conflict") {
      db.prepare("INSERT INTO journal_revisions (id, entry_id, user_id, content, reason, created_at) VALUES (?, ?, ?, ?, 'sync_conflict_preserved', ?)").run(
        createId(),
        input.id,
        input.userId,
        input.content,
        now,
      );
      db.prepare("UPDATE journal_entries SET sync_status = 'conflict' WHERE id = ? AND user_id = ?").run(input.id, input.userId);
      recordSync(db, input.userId, input.id, "upsert", "conflict");
      db.exec("COMMIT");
      return {
        type: "conflict",
        id: input.id,
        serverContent: current.original_content,
        incomingContent: input.content,
        updatedAt: current.updated_at,
      };
    }
    db.prepare("INSERT INTO journal_revisions (id, entry_id, user_id, content, reason, created_at) VALUES (?, ?, ?, ?, 'user_edit', ?)").run(
      createId(),
      input.id,
      input.userId,
      current.original_content,
      now,
    );
    const changed = db.prepare("UPDATE journal_entries SET original_content = ?, processing_status = 'pending', sync_status = 'synced', updated_at = ?, client_updated_at = ? WHERE id = ? AND user_id = ? AND original_content = ?").run(
      input.content,
      now,
      now,
      input.id,
      input.userId,
      current.original_content,
    );
    if (Number(changed.changes) !== 1) {
      db.exec("ROLLBACK");
      return { type: "conflict", id: input.id, serverContent: current.original_content, incomingContent: input.content, updatedAt: current.updated_at };
    }
    replaceFts(db, input.id, input.userId, input.content);
    clearDerived(db, input.id);
    if (input.tags) replaceUserTags(db, input.id, input.userId, [...input.tags, ...extractHashtags(input.content)]);
    enqueueJobs(db, input.id, input.userId, now);
    recordSync(db, input.userId, input.id, "upsert", "applied");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { type: "ok", id: input.id };
}

export function deleteEntry(db: EchoDB, userId: string, entryId: string): boolean {
  const current = getEntry(db, userId, entryId);
  if (!current) return false;
  const audios = db.prepare("SELECT path FROM audio_recordings WHERE entry_id = ? AND user_id = ?").all(entryId, userId) as { path: string }[];
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM journal_fts WHERE entry_id = ?").run(entryId);
    db.prepare("DELETE FROM journal_entries WHERE id = ? AND user_id = ?").run(entryId, userId);
    recordSync(db, userId, entryId, "delete", "applied");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const audio of audios) rmSync(audio.path, { force: true });
  return true;
}

export function listEntries(db: EchoDB, userId: string, limit = 30): EntryRecord[] {
  return db.prepare("SELECT * FROM journal_entries WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?").all(userId, limit) as EntryRecord[];
}

export function listEntriesSince(db: EchoDB, userId: string, since: string): EntryRecord[] {
  return db.prepare("SELECT * FROM journal_entries WHERE user_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500").all(userId, since) as EntryRecord[];
}

export function getEntry(db: EchoDB, userId: string, entryId: string): EntryRecord | null {
  return (db.prepare("SELECT * FROM journal_entries WHERE id = ? AND user_id = ?").get(entryId, userId) as EntryRecord | undefined) ?? null;
}

export function entryDetail(db: EchoDB, userId: string, entryId: string) {
  const entry = getEntry(db, userId, entryId);
  if (!entry) return null;
  const user = findUserById(db, userId);
  const translation = db.prepare("SELECT language, content, quality, provider, status FROM translations WHERE entry_id = ? AND user_id = ?").get(entryId, userId) as {
    language: string; content: string; quality: string; provider: string; status: string;
  } | undefined;
  const topics = db.prepare(`
    SELECT t.slug, t.label, jet.confidence
    FROM journal_entry_topics jet JOIN topics t ON t.slug = jet.topic_slug
    WHERE jet.entry_id = ? AND jet.user_id = ?
    ORDER BY jet.confidence DESC
  `).all(entryId, userId) as { slug: string; label: string; confidence: number }[];
  const tags = labelsFor(db, entryId, userId, "user");
  const suggestedTags = labelsFor(db, entryId, userId, "suggestion");
  const mood = db.prepare("SELECT themes_json FROM mood_contexts WHERE entry_id = ? AND user_id = ?").get(entryId, userId) as { themes_json: string } | undefined;
  const entities = db.prepare("SELECT text, kind FROM entities WHERE entry_id = ? AND user_id = ?").all(entryId, userId) as { text: string; kind: string }[];
  const revisions = db.prepare("SELECT content, reason, created_at FROM journal_revisions WHERE entry_id = ? AND user_id = ? ORDER BY created_at DESC").all(entryId, userId) as { content: string; reason: string; created_at: string }[];
  const audio = db.prepare("SELECT id, mime, created_at FROM audio_recordings WHERE entry_id = ? AND user_id = ?").all(entryId, userId) as { id: string; mime: string; created_at: string }[];
  const showEmotion = user?.emotional_context_enabled === 1 && mood;
  return {
    entry: {
      id: entry.id,
      originalContent: entry.original_content,
      originalLanguage: entry.original_language,
      sourceType: entry.source_type,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      processingStatus: entry.processing_status,
      syncStatus: entry.sync_status,
    },
    translation: translation ? { language: translation.language, content: translation.content, quality: translation.quality, provider: translation.provider, status: translation.status } : null,
    topics,
    tags,
    suggestedTags,
    emotionalContext: showEmotion ? { label: EMOTIONAL_CONTEXT_LABEL, themes: JSON.parse(mood.themes_json) as string[] } : null,
    entities: entities.map((entity) => ({ text: entity.text, type: entity.kind })),
    revisions: revisions.map((revision) => ({ content: revision.content, reason: revision.reason, createdAt: revision.created_at })),
    audio,
  };
}

export function addTag(db: EchoDB, userId: string, entryId: string, label: string): boolean {
  if (!getEntry(db, userId, entryId)) return false;
  replaceUserTags(db, entryId, userId, [...labelsFor(db, entryId, userId, "user"), label]);
  return true;
}

export function removeTag(db: EchoDB, userId: string, entryId: string, label: string): boolean {
  if (!getEntry(db, userId, entryId)) return false;
  const next = labelsFor(db, entryId, userId, "user").filter((item) => item !== label.toLowerCase());
  replaceUserTags(db, entryId, userId, next);
  return true;
}

export function searchUser(db: EchoDB, userId: string, query: string, filters: SearchFilters) {
  return hybridSearch(query, documentsFor(db, userId), filters);
}

export function documentsFor(db: EchoDB, userId: string): SearchDocument[] {
  const entries = db.prepare("SELECT id, original_content, original_language, source_type, created_at FROM journal_entries WHERE user_id = ?").all(userId) as {
    id: string; original_content: string; original_language: SearchDocument["language"]; source_type: "text" | "voice"; created_at: string;
  }[];
  const topicRows = db.prepare("SELECT entry_id, topic_slug FROM journal_entry_topics WHERE user_id = ?").all(userId) as { entry_id: string; topic_slug: string }[];
  const tagRows = db.prepare(`
    SELECT jet.entry_id, t.label FROM journal_entry_tags jet
    JOIN tags t ON t.id = jet.tag_id
    WHERE jet.user_id = ? AND jet.source = 'user'
  `).all(userId) as { entry_id: string; label: string }[];
  const vectors = db.prepare("SELECT entry_id, vector_json FROM embeddings WHERE user_id = ?").all(userId) as { entry_id: string; vector_json: string }[];
  const topics = group(topicRows, "entry_id", "topic_slug");
  const tags = group(tagRows, "entry_id", "label");
  const embeddings = new Map(vectors.map((row) => [row.entry_id, JSON.parse(row.vector_json) as number[]]));
  return entries.map((entry) => ({
    id: entry.id,
    content: entry.original_content,
    createdAt: entry.created_at,
    language: entry.original_language,
    topics: topics.get(entry.id) ?? [],
    tags: tags.get(entry.id) ?? [],
    embedding: embeddings.get(entry.id) ?? null,
    sourceType: entry.source_type,
  }));
}

export function insightsFor(db: EchoDB, userId: string) {
  const docs = documentsFor(db, userId);
  return buildInsights(docs.map((doc) => ({
    content: doc.content,
    createdAt: doc.createdAt,
    sourceType: doc.sourceType,
    topics: doc.topics,
  })));
}

export function exportFor(db: EchoDB, userId: string, format: "json" | "markdown" | "csv"): string {
  const entries = listEntries(db, userId, 10000).map((entry) => toExport(db, userId, entry));
  if (format === "markdown") return exportMarkdown(entries);
  if (format === "csv") return exportCsv(entries);
  return exportJson(entries);
}

export function applyPipeline(db: EchoDB, entryId: string, result: PipelineResult): void {
  const owner = db.prepare("SELECT user_id, original_content FROM journal_entries WHERE id = ?").get(entryId) as { user_id: string; original_content: string } | undefined;
  if (!owner || owner.original_content !== result.originalContent) return;
  const now = new Date().toISOString();
  const userId = owner.user_id;
  db.exec("BEGIN");
  try {
    writeStage(db, entryId, userId, "language", result.language.status, now);
    writeStage(db, entryId, userId, "translation", result.translation.status, now);
    writeStage(db, entryId, userId, "topics", result.topics.status, now);
    writeStage(db, entryId, userId, "emotionalContext", result.emotionalContext.status, now);
    writeStage(db, entryId, userId, "entities", result.entities.status, now);
    writeStage(db, entryId, userId, "embedding", result.embedding.status, now);

    if (result.language.status === "succeeded") {
      db.prepare("UPDATE journal_entries SET original_language = ? WHERE id = ? AND user_id = ? AND original_content = ?").run(
        result.language.value ?? null,
        entryId,
        userId,
        result.originalContent,
      );
    }
    if (result.translation.status === "skipped") {
      db.prepare("DELETE FROM translations WHERE entry_id = ?").run(entryId);
    }
    if (result.translation.status === "succeeded" && result.translation.text) {
      db.prepare(`INSERT INTO translations (entry_id, user_id, language, content, quality, provider, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'succeeded', ?)
        ON CONFLICT(entry_id) DO UPDATE SET language = excluded.language, content = excluded.content, quality = excluded.quality, provider = excluded.provider, status = 'succeeded', created_at = excluded.created_at
      `).run(entryId, userId, result.translation.language ?? "en", result.translation.text, result.translation.quality ?? "approximate", result.translation.provider ?? "glossary", now);
    }
    if (result.topics.status === "succeeded") {
      db.prepare("DELETE FROM journal_entry_topics WHERE entry_id = ?").run(entryId);
      db.prepare("DELETE FROM journal_entry_tags WHERE entry_id = ? AND source = 'suggestion'").run(entryId);
      const insertTopic = db.prepare("INSERT OR IGNORE INTO journal_entry_topics (entry_id, user_id, topic_slug, confidence) VALUES (?, ?, ?, ?)");
      for (const topic of result.topics.items ?? []) insertTopic.run(entryId, userId, topic.slug, topic.confidence);
      const insertSuggestion = db.prepare("INSERT OR IGNORE INTO tags (id, user_id, label) VALUES (?, ?, ?)");
      const link = db.prepare("INSERT OR IGNORE INTO journal_entry_tags (entry_id, tag_id, user_id, source) VALUES (?, ?, ?, 'suggestion')");
      for (const label of result.suggestedTags) {
        const existing = db.prepare("SELECT id FROM tags WHERE user_id = ? AND label = ?").get(userId, label) as { id: string } | undefined;
        const tagId = existing?.id ?? createId();
        if (!existing) insertSuggestion.run(tagId, userId, label);
        link.run(entryId, tagId, userId);
      }
    }
    if (result.emotionalContext.status === "succeeded") {
      db.prepare(`INSERT INTO mood_contexts (entry_id, user_id, themes_json, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET themes_json = excluded.themes_json, created_at = excluded.created_at
      `).run(entryId, userId, JSON.stringify(result.emotionalContext.themes ?? []), now);
    } else if (result.emotionalContext.status === "skipped") {
      db.prepare("DELETE FROM mood_contexts WHERE entry_id = ?").run(entryId);
    }
    if (result.entities.status === "succeeded") {
      db.prepare("DELETE FROM entities WHERE entry_id = ?").run(entryId);
      const insertEntity = db.prepare("INSERT INTO entities (id, entry_id, user_id, text, kind) VALUES (?, ?, ?, ?, ?)");
      for (const entity of result.entities.items ?? []) insertEntity.run(createId(), entryId, userId, entity.text, entity.type);
    }
    if (result.embedding.status === "succeeded" && result.embedding.vector) {
      db.prepare(`INSERT INTO embeddings (entry_id, user_id, model, vector_json, created_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(entry_id) DO UPDATE SET model = excluded.model, vector_json = excluded.vector_json, created_at = excluded.created_at
      `).run(entryId, userId, result.embedding.model ?? "echo-hash-v1", JSON.stringify(result.embedding.vector), now);
    }
    const failed = [result.language, result.translation, result.topics, result.emotionalContext, result.entities, result.embedding].some((stage) => stage.status === "failed");
    db.prepare("UPDATE journal_entries SET processing_status = ? WHERE id = ? AND user_id = ? AND original_content = ?").run(
      failed ? "partial" : "ready",
      entryId,
      userId,
      result.originalContent,
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function requeueEntry(db: EchoDB, userId: string, entryId: string): boolean {
  if (!getEntry(db, userId, entryId)) return false;
  enqueueJobs(db, entryId, userId, new Date().toISOString());
  db.prepare("UPDATE journal_entries SET processing_status = 'pending' WHERE id = ? AND user_id = ?").run(entryId, userId);
  return true;
}

export function saveAudio(db: EchoDB, input: { userId: string; entryId: string; bytes: Uint8Array; mime: string; dataDir: string }): string | null {
  if (!getEntry(db, input.userId, input.entryId)) return null;
  const id = createId();
  const directory = path.join(input.dataDir, "audio", input.userId);
  mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, `${id}.bin`);
  writeFileSync(filePath, input.bytes);
  db.prepare("INSERT INTO audio_recordings (id, user_id, entry_id, mime, byte_length, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id,
    input.userId,
    input.entryId,
    input.mime,
    input.bytes.byteLength,
    filePath,
    new Date().toISOString(),
  );
  return id;
}

export function readAudio(db: EchoDB, userId: string, audioId: string): { mime: string; path: string } | null {
  return (db.prepare("SELECT mime, path FROM audio_recordings WHERE id = ? AND user_id = ?").get(audioId, userId) as { mime: string; path: string } | undefined) ?? null;
}

export function deleteAudio(db: EchoDB, userId: string, audioId: string): boolean {
  const audio = readAudio(db, userId, audioId);
  if (!audio) return false;
  db.prepare("DELETE FROM audio_recordings WHERE id = ? AND user_id = ?").run(audioId, userId);
  rmSync(audio.path, { force: true });
  return true;
}

export function deleteAccount(db: EchoDB, userId: string): void {
  const audios = db.prepare("SELECT path FROM audio_recordings WHERE user_id = ?").all(userId) as { path: string }[];
  const entries = db.prepare("SELECT id FROM journal_entries WHERE user_id = ?").all(userId) as { id: string }[];
  db.exec("BEGIN");
  try {
    for (const entry of entries) db.prepare("DELETE FROM journal_fts WHERE entry_id = ?").run(entry.id);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const audio of audios) rmSync(audio.path, { force: true });
}

export function countOwned(db: EchoDB, userId: string): number {
  const tables = ["journal_entries", "sessions", "translations", "embeddings", "audio_recordings", "ai_jobs", "tags", "mood_contexts", "entities", "journal_revisions"];
  return tables.reduce((sum, table) => {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(userId) as { n: number };
    return sum + Number(row.n);
  }, 0);
}

export function ftsEntryIds(db: EchoDB, userId: string, query: string): string[] {
  const safe = query.replace(/["*^:]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!/[A-Za-z0-9]/.test(safe)) return [];
  try {
    const rows = db.prepare("SELECT entry_id FROM journal_fts WHERE user_id = ? AND journal_fts MATCH ? LIMIT 20").all(userId, safe) as { entry_id: string }[];
    return rows.map((row) => row.entry_id);
  } catch {
    return [];
  }
}

export function pendingJobEntryIds(db: EchoDB, limit = 20): string[] {
  const rows = db.prepare("SELECT DISTINCT entry_id FROM ai_jobs WHERE status = 'pending' AND attempts < 3 ORDER BY updated_at ASC LIMIT ?").all(limit) as { entry_id: string }[];
  return rows.map((row) => row.entry_id);
}

function enqueueJobs(db: EchoDB, entryId: string, userId: string, now: string): void {
  const statement = db.prepare(`INSERT INTO ai_jobs (id, entry_id, user_id, stage, status, attempts, last_error, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, NULL, ?)
    ON CONFLICT(entry_id, stage) DO UPDATE SET status = 'pending', last_error = NULL, updated_at = excluded.updated_at`);
  for (const stage of STAGES) statement.run(createId(), entryId, userId, stage, now);
}

function writeStage(db: EchoDB, entryId: string, userId: string, stage: StageName, status: string, now: string): void {
  const jobStatus = status === "failed" ? "failed" : "succeeded";
  const error = status === "failed" ? "stage_failed" : null;
  db.prepare(`INSERT INTO ai_jobs (id, entry_id, user_id, stage, status, attempts, last_error, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(entry_id, stage) DO UPDATE SET status = excluded.status, attempts = ai_jobs.attempts + 1, last_error = excluded.last_error, updated_at = excluded.updated_at
  `).run(createId(), entryId, userId, stage, jobStatus, error, now);
}

function clearDerived(db: EchoDB, entryId: string): void {
  db.prepare("DELETE FROM translations WHERE entry_id = ?").run(entryId);
  db.prepare("DELETE FROM journal_entry_topics WHERE entry_id = ?").run(entryId);
  db.prepare("DELETE FROM mood_contexts WHERE entry_id = ?").run(entryId);
  db.prepare("DELETE FROM entities WHERE entry_id = ?").run(entryId);
  db.prepare("DELETE FROM embeddings WHERE entry_id = ?").run(entryId);
  db.prepare("DELETE FROM journal_entry_tags WHERE entry_id = ? AND source = 'suggestion'").run(entryId);
}

function replaceFts(db: EchoDB, entryId: string, userId: string, content: string): void {
  db.prepare("DELETE FROM journal_fts WHERE entry_id = ?").run(entryId);
  db.prepare("INSERT INTO journal_fts (entry_id, user_id, body) VALUES (?, ?, ?)").run(entryId, userId, content);
}

function replaceUserTags(db: EchoDB, entryId: string, userId: string, labels: string[]): void {
  db.prepare("DELETE FROM journal_entry_tags WHERE entry_id = ? AND source = 'user'").run(entryId);
  const clean = [...new Set(labels.map((label) => label.replace(/^#/, "").trim().toLowerCase()).filter((label) => label.length > 0 && label.length <= 40))].slice(0, 20);
  for (const label of clean) linkTag(db, entryId, userId, label, "user");
}

function linkTag(db: EchoDB, entryId: string, userId: string, label: string, source: "user" | "suggestion"): void {
  const existing = db.prepare("SELECT id FROM tags WHERE user_id = ? AND label = ?").get(userId, label) as { id: string } | undefined;
  const tagId = existing?.id ?? createId();
  if (!existing) db.prepare("INSERT INTO tags (id, user_id, label) VALUES (?, ?, ?)").run(tagId, userId, label);
  db.prepare("INSERT OR IGNORE INTO journal_entry_tags (entry_id, tag_id, user_id, source) VALUES (?, ?, ?, ?)").run(entryId, tagId, userId, source);
}

function labelsFor(db: EchoDB, entryId: string, userId: string, source: string): string[] {
  const rows = db.prepare(`
    SELECT t.label FROM journal_entry_tags jet JOIN tags t ON t.id = jet.tag_id
    WHERE jet.entry_id = ? AND jet.user_id = ? AND jet.source = ?
    ORDER BY t.label
  `).all(entryId, userId, source) as { label: string }[];
  return rows.map((row) => row.label);
}

function recordSync(db: EchoDB, userId: string, entityId: string, op: string, status: string): void {
  db.prepare("INSERT INTO sync_operations (id, user_id, entity_id, op, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    createId(),
    userId,
    entityId,
    op,
    status,
    new Date().toISOString(),
  );
}

function group<T extends Record<string, string>>(rows: T[], idKey: keyof T, valueKey: keyof T): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const id = row[idKey];
    const list = map.get(id) ?? [];
    list.push(row[valueKey]);
    map.set(id, list);
  }
  return map;
}

function toExport(db: EchoDB, userId: string, entry: EntryRecord): ExportEntry {
  const detail = entryDetail(db, userId, entry.id);
  return {
    id: entry.id,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    originalContent: entry.original_content,
    originalLanguage: entry.original_language,
    sourceType: entry.source_type,
    translation: detail?.translation?.content ?? null,
    translationLanguage: detail?.translation?.language ?? null,
    topics: detail?.topics.map((topic) => topic.label) ?? [],
    tags: detail?.tags ?? [],
    emotionalThemes: detail?.emotionalContext?.themes ?? [],
  };
}
