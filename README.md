# Echo

Echo is a private, multilingual journal. You write or speak. The entry is saved immediately. Translation, topics, emotional themes, and search happen after the save, and they never replace the original.

## Run it

```bash
npm install
npm test
npm run dev
```

The journal opens at http://localhost:5173. The API listens on http://127.0.0.1:8787.

You can write without an account. Sign in from Settings when you want another device to sync.

The phone app lives in `apps/mobile`. Install its dependencies there and start Expo:

```bash
cd apps/mobile
npm install
npx expo start
```

## What is implemented

- Local-first writing in the web app, with a sync account for the API.
- Original text kept apart from translations, topics, tags, and emotional themes.
- Burmese, English, and mixed entries. Curated Burmese phrases translate exactly. Other Burmese is glossed and marked approximate.
- Background processing for language, translation, topics, entities, and embeddings. One failed stage does not erase the others.
- Hybrid search, grounded journal questions, and a refusal when the evidence is thin.
- Offline writing, sync conflicts that keep both copies, export, and account deletion.
- SQLite for the running API. `infrastructure/postgres/schema.sql` is the same model for Postgres and pgvector.

## Honest limits

Speech recognition uses the browser when it is available. There is no evaluated Burmese speech model in this repository, so Burmese speech is not claimed to be production-ready.

The default translation and embedding providers are local and deterministic. A hosted model can be added behind the provider interfaces without changing the journal.

Passwords are hashed. Session tokens are random and stored hashed. The web app keeps the session token in `sessionStorage`. Journal text stays in `localStorage` on this device. Do not log journal bodies; the API redacts them.
