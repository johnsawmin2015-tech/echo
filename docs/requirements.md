# Requirements

Echo lets a person write or speak, in Burmese or English or both, and keeps the original exactly. Organization is added beside the entry, after it is saved.

| Feature | Acceptance | Where it is checked |
| --- | --- | --- |
| Save without waiting for AI | Create returns the entry while processing is still pending | API test `saves before AI processing` |
| Original stays untouched | Translation lives in its own field and its own screen section | API test and the journal editor |
| Burmese and mixed text | Language detection and curated translations match the labeled set | `packages/core/test/eval.test.ts` |
| Topics and tags | Topics come from the writing. Tags are added by the person. Suggestions are optional | Topic tests and the editor |
| Emotional themes | Descriptive labels, hidden when the setting is off, absent on neutral text | Core and pipeline tests |
| Search | Keyword, semantic, and hybrid modes, plus topic and language filters | Core retrieval eval and the Search screen |
| Ask | Grounded quotes or an explicit refusal. No invented memories | Core memory tests |
| Offline | The web journal writes locally when signed out or offline | Web store |
| Sync conflict | Both copies are kept | API sync test and the editor conflict banner |
| Export and deletion | JSON, Markdown, and CSV export. Account deletion removes that user's rows | API test |
| Isolation | One account cannot read another account's journal | API isolation test |
| Voice | Record or paste a transcript, edit it, then save | Voice screen |

Post-MVP, not in this build: a year review, goals tracking, and a hosted Burmese speech model. Those need evaluation evidence before they can be called ready.
