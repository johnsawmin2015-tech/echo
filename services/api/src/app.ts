import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { answerQuestion, userMessage, type SearchMode } from "@echo/core";
import { log } from "./logger.js";
import { createRateLimiter } from "./limits.js";
import { hashPassword, hashToken, newToken, verifyPassword } from "./passwords.js";
import {
  addTag,
  countOwned,
  createEntry,
  documentsFor as userDocuments,
  createSession,
  createUser,
  deleteAccount,
  deleteAudio,
  deleteEntry,
  deleteSession,
  entryDetail,
  exportFor,
  findUserByEmail,
  findUserByToken,
  getEntry,
  insightsFor,
  listEntries,
  listEntriesSince,
  readAudio,
  removeTag,
  requeueEntry,
  saveAudio,
  searchUser,
  updateEntry,
  updateUser,
  type EchoDB,
  type UserRecord,
} from "./repository.js";
import { processEntry } from "./worker.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIO_TYPES = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"]);

export type AppOptions = {
  dataDir?: string;
};

export function createApp(db: EchoDB, options: AppOptions = {}) {
  const dataDir = options.dataDir ?? "./data";
  const authLimit = createRateLimiter(8, 60_000);
  const apiLimit = createRateLimiter(180, 60_000);
  const app = new Hono();
  const origins = new Set((process.env.ECHO_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map((origin) => origin.trim()));

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && origins.has(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Echo-AI");
    c.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Frame-Options", "DENY");
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.onError((error, c) => {
    log("error", "api_error", { path: c.req.path, name: error.name });
    return c.json({ error: userMessage("invalid"), code: "server_error" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true, service: "echo" }));

  app.post("/api/auth/register", async (c) => {
    if (!authLimit(clientKey(c))) return limited(c);
    const body = await readJson(c);
    if (!body) return invalid(c);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const displayName = String(body.displayName ?? "").trim().slice(0, 80);
    if (!EMAIL.test(email) || password.length < 8 || password.length > 200) return invalid(c);
    if (findUserByEmail(db, email)) return c.json({ error: "An account with that email already exists.", code: "invalid" }, 409);
    const user = createUser(db, { email, passwordHash: hashPassword(password), displayName });
    const token = newToken();
    createSession(db, user.id, hashToken(token));
    log("info", "register", { userId: user.id });
    return c.json({ token, user: publicUser(user) }, 201);
  });

  app.post("/api/auth/login", async (c) => {
    if (!authLimit(clientKey(c))) return limited(c);
    const body = await readJson(c);
    if (!body) return invalid(c);
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const user = findUserByEmail(db, email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return c.json({ error: userMessage("unauthorized"), code: "unauthorized" }, 401);
    }
    const token = newToken();
    createSession(db, user.id, hashToken(token));
    return c.json({ token, user: publicUser(user) });
  });

  app.post("/api/auth/logout", (c) => {
    const token = bearer(c);
    if (token) deleteSession(db, hashToken(token));
    return c.json({ ok: true });
  });

  app.get("/api/me", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    return c.json({ user: publicUser(user) });
  });

  app.patch("/api/me", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!apiLimit(user.id)) return limited(c);
    const body = await readJson(c);
    if (!body) return invalid(c);
    const updated = updateUser(db, user.id, {
      displayName: body.displayName === undefined ? undefined : String(body.displayName).trim().slice(0, 80),
      emotionalContextEnabled: body.emotionalContextEnabled === undefined ? undefined : Boolean(body.emotionalContextEnabled),
    });
    return c.json({ user: publicUser(updated!) });
  });

  app.delete("/api/me", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const body = await readJson(c);
    if (!body || body.confirm !== "delete") return invalid(c);
    deleteAccount(db, user.id);
    log("info", "account_deleted", { userId: user.id, remaining: countOwned(db, user.id) });
    return c.json({ deleted: true });
  });

  app.post("/api/journal", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!apiLimit(user.id)) return limited(c);
    const body = await readJson(c);
    if (!body) return invalid(c);
    const content = typeof body.originalContent === "string" ? body.originalContent : "";
    const rejection = validateContent(content);
    if (rejection) return c.json({ error: userMessage(rejection), code: rejection }, 400);
    const sourceType = body.sourceType === "voice" ? "voice" : "text";
    const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : undefined;
    const tags = cleanTags(body.tags);
    const result = createEntry(db, { userId: user.id, id, content, sourceType, tags });
    if (result.type === "forbidden") return c.json({ error: userMessage("invalid"), code: "invalid" }, 409);
    if (result.type === "missing") return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    if (result.type === "conflict") {
      return c.json({
        conflict: true,
        entryId: result.id,
        serverContent: result.serverContent,
        incomingContent: result.incomingContent,
        error: userMessage("conflict"),
      }, 409);
    }
    schedule(c, result.id);
    log("info", "journal_saved", { userId: user.id, entryId: result.id, sourceType });
    return c.json({ saved: true, entryId: result.id }, result.type === "created" ? 201 : 200);
  });

  app.get("/api/journal", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const entries = listEntries(db, user.id, 50).map((entry) => ({
      id: entry.id,
      originalContent: entry.original_content,
      originalLanguage: entry.original_language,
      sourceType: entry.source_type,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      processingStatus: entry.processing_status,
      syncStatus: entry.sync_status,
    }));
    return c.json({ entries });
  });

  app.get("/api/journal/:id", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const detail = entryDetail(db, user.id, c.req.param("id"));
    if (!detail) return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    return c.json(detail);
  });

  app.patch("/api/journal/:id", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!apiLimit(user.id)) return limited(c);
    const body = await readJson(c);
    if (!body) return invalid(c);
    const content = typeof body.originalContent === "string" ? body.originalContent : "";
    const rejection = validateContent(content);
    if (rejection) return c.json({ error: userMessage(rejection), code: rejection }, 400);
    if (typeof body.baseUpdatedAt !== "string") return invalid(c);
    const result = updateEntry(db, {
      userId: user.id,
      id: c.req.param("id"),
      content,
      baseUpdatedAt: body.baseUpdatedAt,
      tags: body.tags === undefined ? undefined : cleanTags(body.tags),
    });
    if (result.type === "missing") return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    if (result.type === "conflict") {
      return c.json({
        conflict: true,
        entryId: result.id,
        serverContent: result.serverContent,
        incomingContent: result.incomingContent,
        updatedAt: result.updatedAt,
        error: userMessage("conflict"),
      }, 409);
    }
    schedule(c, result.id);
    return c.json({ saved: true, entryId: result.id });
  });

  app.delete("/api/journal/:id", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const deleted = deleteEntry(db, user.id, c.req.param("id"));
    if (!deleted) return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    return c.json({ deleted: true });
  });

  app.post("/api/journal/:id/tags", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const body = await readJson(c);
    const label = typeof body?.label === "string" ? body.label : "";
    if (!label.trim() || !addTag(db, user.id, c.req.param("id"), label)) return invalid(c);
    return c.json({ saved: true });
  });

  app.delete("/api/journal/:id/tags/:label", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!removeTag(db, user.id, c.req.param("id"), decodeURIComponent(c.req.param("label")))) {
      return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    }
    return c.json({ deleted: true });
  });

  app.post("/api/journal/:id/reprocess", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!requeueEntry(db, user.id, c.req.param("id"))) return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    schedule(c, c.req.param("id"));
    return c.json({ queued: true });
  });

  app.post("/api/journal/:id/audio", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!apiLimit(user.id)) return limited(c);
    const mime = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (!looksLikeAudio(bytes, mime)) return c.json({ error: "That file can't be saved as audio.", code: "invalid" }, 415);
    const id = saveAudio(db, { userId: user.id, entryId: c.req.param("id"), bytes, mime, dataDir });
    if (!id) return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    return c.json({ saved: true, audioId: id }, 201);
  });

  app.get("/api/audio/:id", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const audio = readAudio(db, user.id, c.req.param("id"));
    if (!audio) return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    const bytes = readFileSync(audio.path);
    return c.body(bytes, 200, { "content-type": audio.mime });
  });

  app.delete("/api/audio/:id", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!deleteAudio(db, user.id, c.req.param("id"))) return c.json({ error: userMessage("not_found"), code: "not_found" }, 404);
    return c.json({ deleted: true });
  });

  app.get("/api/search", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const mode = c.req.query("mode");
    const hits = searchUser(db, user.id, c.req.query("q") ?? "", {
      topic: c.req.query("topic") || undefined,
      tag: c.req.query("tag") || undefined,
      language: (c.req.query("language") as "my" | "en" | "mixed" | "unknown" | undefined) || undefined,
      from: c.req.query("from") || undefined,
      to: c.req.query("to") || undefined,
      mode: mode === "keyword" || mode === "semantic" || mode === "hybrid" ? mode as SearchMode : "hybrid",
      limit: 20,
    });
    return c.json({ hits });
  });

  app.post("/api/ask", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!apiLimit(user.id)) return limited(c);
    const body = await readJson(c);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    if (question.length < 2 || question.length > 500) return invalid(c);
    const answer = answerQuestion(question, userDocuments(db, user.id));
    log("info", "memory_answer", { userId: user.id, sources: answer.sources.length, confidence: answer.confidence });
    return c.json(answer);
  });

  app.get("/api/insights", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    return c.json(insightsFor(db, user.id));
  });

  app.get("/api/topics", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const counts = new Map<string, number>();
    for (const doc of userDocuments(db, user.id)) {
      for (const topic of doc.topics) counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
    return c.json({ topics: [...counts.entries()].map(([slug, count]) => ({ slug, count })).sort((a, b) => b.count - a.count) });
  });

  app.get("/api/export", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const format = c.req.query("format") === "markdown" || c.req.query("format") === "csv" ? c.req.query("format") as "markdown" | "csv" : "json";
    const body = exportFor(db, user.id, format);
    const type = format === "json" ? "application/json" : format === "csv" ? "text/csv" : "text/markdown";
    return c.body(body, 200, { "content-type": `${type}; charset=utf-8` });
  });

  app.post("/api/sync/push", async (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    if (!apiLimit(user.id)) return limited(c);
    const body = await readJson(c);
    const operations = Array.isArray(body?.operations) ? body.operations.slice(0, 100) : [];
    const results = [];
    for (const operation of operations) {
      const entityId = typeof operation?.entityId === "string" ? operation.entityId : "";
      if (!UUID.test(entityId)) {
        results.push({ entityId, status: "invalid" });
        continue;
      }
      if (operation.op === "delete") {
        deleteEntry(db, user.id, entityId);
        results.push({ entityId, status: "deleted" });
        continue;
      }
      const content = typeof operation.payload?.originalContent === "string" ? operation.payload.originalContent : "";
      if (validateContent(content)) {
        results.push({ entityId, status: "invalid" });
        continue;
      }
      const sourceType = operation.payload?.sourceType === "voice" ? "voice" : "text";
      const existing = getEntry(db, user.id, entityId);
      if (!existing) {
        const created = createEntry(db, { userId: user.id, id: entityId, content, sourceType, tags: cleanTags(operation.payload?.tags) });
        if (created.type === "created" || created.type === "ok") {
          schedule(c, entityId);
          results.push({ entityId, status: "saved" });
        } else {
          results.push({ entityId, status: created.type });
        }
        continue;
      }
      const updated = updateEntry(db, {
        userId: user.id,
        id: entityId,
        content,
        baseUpdatedAt: typeof operation.payload?.baseUpdatedAt === "string" ? operation.payload.baseUpdatedAt : null,
        tags: cleanTags(operation.payload?.tags),
      });
      if (updated.type === "ok") {
        schedule(c, entityId);
        results.push({ entityId, status: "saved" });
      } else if (updated.type === "conflict") {
        results.push({ entityId, status: "conflict", serverContent: updated.serverContent, incomingContent: updated.incomingContent });
      } else {
        results.push({ entityId, status: updated.type });
      }
    }
    return c.json({ results });
  });

  app.get("/api/sync/pull", (c) => {
    const user = authed(c);
    if (user instanceof Response) return user;
    const since = c.req.query("since") ?? "1970-01-01T00:00:00.000Z";
    const entries = listEntriesSince(db, user.id, since).map((entry) => entryDetail(db, user.id, entry.id));
    return c.json({ entries });
  });

  function schedule(c: { req: { header: (name: string) => string | undefined } }, entryId: string): void {
    const requested = c.req.header("x-echo-ai");
    const mode = process.env.NODE_ENV === "test"
      ? requested === "inline" || requested === "async" ? requested : "skip"
      : "async";
    if (mode === "skip") return;
    if (mode === "inline") {
      processEntry(db, entryId);
      return;
    }
    setImmediate(() => {
      try {
        processEntry(db, entryId);
      } catch (error) {
        log("error", "ai_job_failed", { entryId, name: error instanceof Error ? error.name : "Error" });
      }
    });
  }

  function authed(c: { req: { header: (name: string) => string | undefined } }): UserRecord | Response {
    const token = bearer(c);
    if (!token) return jsonError(userMessage("unauthorized"), "unauthorized", 401);
    const user = findUserByToken(db, hashToken(token));
    if (!user) return jsonError(userMessage("unauthorized"), "unauthorized", 401);
    return user;
  }

  return app;

  function bearer(c: { req: { header: (name: string) => string | undefined } }): string {
    const header = c.req.header("authorization") ?? "";
    return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  }
}

function clientKey(c: { req: { header: (name: string) => string | undefined } }): string {
  return (c.req.header("x-forwarded-for") ?? "local").split(",")[0].trim();
}

async function readJson(c: { req: { json: () => Promise<unknown>; header: (name: string) => string | undefined } }): Promise<Record<string, unknown> | null> {
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > 1_500_000) return null;
  try {
    const body = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function validateContent(content: string): "empty" | "too_large" | null {
  if (!content.trim()) return "empty";
  if (content.length > 100_000) return "too_large";
  return null;
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tag): tag is string => typeof tag === "string").slice(0, 20);
}

function publicUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    emotionalContextEnabled: user.emotional_context_enabled === 1,
    createdAt: user.created_at,
  };
}

function invalid(c: { json: (body: unknown, status?: number) => Response }): Response {
  return c.json({ error: userMessage("invalid"), code: "invalid" }, 400);
}

function limited(c: { json: (body: unknown, status?: number) => Response }): Response {
  return c.json({ error: userMessage("rate_limited"), code: "rate_limited" }, 429);
}

function jsonError(error: string, code: string, status: number): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function looksLikeAudio(bytes: Uint8Array, mime: string): boolean {
  if (!AUDIO_TYPES.has(mime) || bytes.length < 16 || bytes.length > 25 * 1024 * 1024) return false;
  const head = new TextDecoder().decode(bytes.slice(0, 24)).toLowerCase();
  if (head.includes("<html") || head.includes("<script") || head.includes("<?php")) return false;
  const ebml = bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  const ogg = bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
  const riff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46;
  const id3 = bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]) === "ftyp";
  const mp3 = bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  return ebml || ogg || riff || id3 || ftyp || mp3;
}
