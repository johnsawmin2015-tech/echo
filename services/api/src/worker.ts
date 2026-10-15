import { runPipeline, type StageName } from "@echo/core";
import { log } from "./logger.js";
import { applyPipeline, pendingJobEntryIds, type EchoDB } from "./repository.js";

export function processEntry(db: EchoDB, entryId: string, options?: { failStages?: StageName[] }): void {
  const row = db.prepare(`
    SELECT e.original_content AS content, u.emotional_context_enabled AS enabled
    FROM journal_entries e JOIN users u ON u.id = e.user_id
    WHERE e.id = ?
  `).get(entryId) as { content: string; enabled: number } | undefined;
  if (!row) return;
  const started = Date.now();
  try {
    const result = runPipeline({
      originalContent: row.content,
      emotionalContextEnabled: row.enabled === 1,
      failStages: options?.failStages,
    });
    applyPipeline(db, entryId, result);
    log("info", "ai_job_finished", {
      entryId,
      latencyMs: Date.now() - started,
      translation: result.translation.status,
      topics: result.topics.status,
    });
  } catch (error) {
    log("error", "ai_job_failed", {
      entryId,
      latencyMs: Date.now() - started,
      name: error instanceof Error ? error.name : "Error",
    });
  }
}

export function processDueJobs(db: EchoDB): number {
  const ids = pendingJobEntryIds(db);
  for (const id of ids) processEntry(db, id);
  return ids.length;
}
