# Security notes

Journal text is private and untrusted.

## Controls in this build

- Passwords are stored with scrypt and a random salt. Comparison uses a timing-safe check.
- Session tokens are 32 random bytes. Only their SHA-256 hash is stored.
- The browser keeps the token in session storage, not in the URL.
- Routes that read or change a journal require the token and include `user_id` in the query.
- A second account cannot read, search, or ask about the first account's entries. This is covered by `services/api/test/api.test.ts`.
- Text such as `'); DROP TABLE users; --` is stored as a journal body. The account still exists afterward.
- Audio uploads must match an audio content type and a known file signature. HTML payloads are rejected. Files are written outside the web app and downloaded only by the owner.
- Account deletion removes the user row, cascaded journal data, the full-text index, and audio files.
- Logs pass through a redaction step. Content, translation, password, token, and transcript fields are replaced before a line is recorded.
- API errors return a short message. Provider and database errors are not copied into the response.
- Sign-in is rate limited per client address.
- Emotional themes are descriptive labels. The product copy does not call them a diagnosis, and the user can turn them off.
- Memory answers cannot follow an instruction embedded in a journal entry, because retrieval only sees that user's entries and the answer is quoted from those entries.

## Deployment expectations

Terminate TLS in front of the API. Set `ECHO_ORIGIN` to the real site origin. Keep `ECHO_DB` and the audio directory on encrypted disks. The hashing embedder and glossary translator do not send journal text to a third party. If a hosted model is configured later, that provider becomes part of the privacy boundary and should be disclosed in Settings.

## Reviewed issues

No critical isolation or injection failure showed up in the automated tests. Remaining risk is operational: the web journal is readable by anything else that can run script on the origin, because the device copy is in local storage. The mobile app should move that copy to the platform secure store before a store release.
