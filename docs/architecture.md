# Architecture

Echo saves first and understands later.

```text
Person
  ↓
Journal screen
  ↓
Local store
  ↓
Saved
  ↓
Background pipeline
  ├── language
  ├── translation
  ├── topics
  ├── emotional themes
  ├── entities
  └── embedding
```

The screen never waits on a model before it confirms the save.

## Boundaries

`packages/core` is deterministic TypeScript with no network and no database. It owns language detection, the glossary translator, topic classification, emotional themes, hashing embeddings, hybrid search, grounded answers, sync decisions, insights, and export.

`services/api` is the account, journal, audio, sync, and job boundary. Every query is scoped to the signed-in user. AI output is written to its own tables. A user edit stores the previous original in `journal_revisions` and then replaces `original_content`. The pipeline is not allowed to write that column except for the detected language code.

`services/workers` polls pending jobs. The API also schedules a job after each save so a single-process install still finishes the work.

`apps/web` is the journal people use in the browser. It writes locally, runs the same pipeline, and pushes to the API when a session exists.

`apps/mobile` is the Expo client. It writes to SQLite first and fills translation and topics afterward.

## Providers

Speech, translation, embeddings, language-model completion, and file storage are interfaces in `packages/core`. The installed path uses a glossary translator and a hashing embedder. A hosted translator can be placed in front of the glossary; if it fails, the glossary still returns a result and the original entry remains.

## Sync

A push sends the original text and the `remoteUpdatedAt` the device last saw.

- Same text: no change.
- The device edited the version the server still has: apply the edit and keep the previous text as a revision.
- Both sides changed: keep the server text as the current entry, store the incoming text as a preserved revision, and mark the entry as a conflict.

Nothing is discarded.

## Search and memory

Search mixes keyword overlap with cosine similarity on the local embedding, then applies topic, tag, language, and date filters. Full-text search in SQLite is an additional index for the API and is always filtered by user.

Journal questions retrieve entries first. The answer is built only from sentences in those entries. If nothing is strong enough, the answer is exactly: "I couldn't find enough evidence in your journal to answer that confidently."

Journal text is data. It is wrapped as untrusted input for any future model call, and it is never executed as an instruction.

## Data stores

The process you can run uses Node's SQLite, including FTS5. Postgres with pgvector is described in `infrastructure/postgres/schema.sql` for a later hosted deployment. The table split is the same: user content on one side, generated metadata on the other.
