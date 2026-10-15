# ECHO

ECHO is a multilingual voice journal. A person writes or speaks in Burmese, English, or both. The entry is stored immediately. Language detection, translation, topics, emotional themes, and search run afterward, in separate records, and never replace the original.

The product boundary is deliberate: user-authored text is immutable except when the user edits it. Generated metadata can be replaced, hidden, or deleted without changing what the person wrote.

## Capabilities

| Area | Behavior |
| --- | --- |
| Journal | Create, edit, read, and delete text and voice entries. Save is local and does not wait on a model. |
| Language | Detects Burmese, English, mixed Burmese-English, and unknown text at entry level, and by segment where the text has sentence boundaries. |
| Translation | Curated Burmese and English sentences translate exactly. Other Burmese receives a glossary reading marked approximate. If no usable translation exists, none is shown. |
| Organization | Topics are inferred categories. Tags are labels the user adds. Suggested tags are optional. |
| Emotional themes | Descriptive labels only. The feature can be turned off. The product does not diagnose. |
| Search | Keyword match, vector similarity, and metadata filters for topic, tag, language, and date. |
| Ask | Answers are quoted from retrieved entries. If the evidence is insufficient, ECHO refuses instead of inventing a memory. |
| Sync | Optional account. Conflicting edits keep both copies. |
| Privacy operations | JSON, Markdown, and CSV export. Entry, audio, and account deletion. |
| Clients | Web journal in `apps/web`. Expo client in `apps/mobile`, writing to SQLite first. |

## Architecture

```text
Person
  → journal client
  → local store
  → Saved
  → background pipeline
       language
       translation
       topics
       emotional themes
       entities
       embedding
```

`packages/core` is deterministic TypeScript. It has no network and no database. The API, worker, and clients call the same functions.

`services/api` owns accounts, authorization, journal persistence, audio, sync, export, and job scheduling. Every read and write is scoped to the authenticated user. Generated fields live in their own tables.

`services/workers` polls pending jobs. A single-process install also schedules work after each save, so the HTTP response does not wait for the pipeline.

The runnable database is SQLite, including FTS5. `infrastructure/postgres/schema.sql` is the equivalent Postgres model, including pgvector. It is not the process that `npm run api` starts.

Provider interfaces cover speech, translation, embeddings, language-model completion, and object storage. The installed path uses a glossary translator and a local hashing embedder. A hosted translator can be placed ahead of the glossary. If it fails, the glossary remains the fallback and the original entry is unchanged.

Further detail is in [docs/architecture.md](docs/architecture.md).

## Repository layout

```text
apps/web                 Browser journal
apps/mobile              Expo client
packages/core            Language, translation, search, memory, sync rules
services/api             HTTP API and SQLite persistence
services/workers         Background job loop
infrastructure/postgres  Production schema
docs                     Architecture, requirements, security, audit
```

## Requirements

- Node.js 22 or newer. The project is developed on Node.js 24.
- npm workspaces. Dependencies are installed from the repository root.

## Run locally

```bash
npm install
npm test
npm run dev
```

| Surface | Address |
| --- | --- |
| Journal | http://localhost:5173 |
| API | http://127.0.0.1:8787 |

The journal works on the device without an account. Settings contains optional sign-in for sync.

Run the processes separately when needed:

```bash
npm run api
npm run web
npm run typecheck
npm run bench
```

Mobile:

```bash
cd apps/mobile
npm install
npx expo start
```

The mobile package is outside the root workspace so an Expo install does not change the web and API dependency tree.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API listen port |
| `ECHO_DB` | `./data/echo.sqlite` | SQLite file |
| `ECHO_DATA_DIR` | `./data` | Audio and local data directory |
| `ECHO_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Allowed browser origins |
| `NODE_ENV` | unset | `test` changes AI scheduling for the test suite |

`data/` is local state and is not part of the source tree. Terminate TLS in front of the API in any hosted environment. Set `ECHO_ORIGIN` to the real site origin.

## Security

- Passwords are stored with scrypt and a random salt. Comparison is timing-safe.
- Session tokens are random. Only a SHA-256 hash is stored. The browser keeps the token in `sessionStorage`.
- Journal queries include the signed-in user. One account cannot read, search, or ask against another account.
- Journal text is untrusted data. It is not executed as an instruction, and memory answers cannot follow a command embedded in an entry.
- Audio uploads must match an allowed audio type and file signature. Files are stored outside the web root and downloaded only by the owner.
- Logs redact content, translation, password, token, and transcript fields.
- Account deletion removes the user, cascaded journal data, the full-text index, and audio files.

The web client's device copy is in `localStorage`. A shipped mobile build should use the platform secure store. Review [docs/security.md](docs/security.md) before a deployment.

## Verification

```bash
npm test
npm run typecheck
npm run bench
```

The test suite covers language detection, curated translation, topic scores, retrieval, grounded answers, sync conflicts, cross-user isolation, prompt injection, export, account deletion, and rejected audio uploads. The benchmark measures pipeline and search latency on a local corpus.

## Operational limits

- Browser speech recognition is used when the browser provides it. Burmese speech has not been scored on an audio corpus, so it is not claimed as a production speech system. Typed and pasted Burmese is supported.
- Translation outside the curated phrase list is a glossary reading. It is labeled approximate. A missing translation does not block the save.
- Embeddings are a local hashing model so search runs without a network. They are not a hosted semantic model.
- SQLite is the supported local and single-node store. Postgres with pgvector is specified for a later hosted deployment and is not started by the current API process.

## Documentation

- [Architecture](docs/architecture.md)
- [Requirements](docs/requirements.md)
- [Security](docs/security.md)
- [Audit](docs/audit.md)
