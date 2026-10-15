import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { INSUFFICIENT_EVIDENCE, assembleTranscript, detectLanguage, translateText, type MemoryAnswer, type SearchHit } from "@echo/core";
import {
  addTag,
  askJournal,
  clearDevice,
  createEntry,
  deleteAccount,
  deleteEntry,
  exportEntries,
  getState,
  insights,
  keepConflictVersion,
  removeTag,
  reprocess,
  searchEntries,
  setOnline,
  signIn,
  signOut,
  subscribe,
  updateEntry,
  updateSettings,
  type EchoState,
  type LocalEntry,
} from "./store";

type Route =
  | { name: "home" }
  | { name: "write"; id: string | null }
  | { name: "voice" }
  | { name: "search"; topic?: string }
  | { name: "topics" }
  | { name: "insights" }
  | { name: "ask" }
  | { name: "settings" };

const NAV: { name: Route["name"]; label: string }[] = [
  { name: "home", label: "Today" },
  { name: "write", label: "Write" },
  { name: "voice", label: "Voice" },
  { name: "search", label: "Search" },
  { name: "topics", label: "Topics" },
  { name: "insights", label: "Insights" },
  { name: "ask", label: "Ask" },
  { name: "settings", label: "Settings" },
];

function useEcho(): EchoState {
  return useSyncExternalStore(subscribe, getState, getState);
}

export function App() {
  const echo = useEcho();
  const [route, setRoute] = useState<Route>({ name: "home" });

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <>
      <a className="skip" href="#main">Skip to writing</a>
      <div className="shell">
        <aside className="sidebar">
          <button className="brand" onClick={() => setRoute({ name: "home" })}>
            <strong>Echo</strong>
            <span>A private journal</span>
          </button>
          <nav aria-label="Journal">
            {NAV.map((item) => (
              <button
                key={item.name}
                className="nav-button"
                aria-current={route.name === item.name ? "page" : undefined}
                onClick={() => {
                  if (item.name === "write") setRoute({ name: "write", id: null });
                  else if (item.name === "search") setRoute({ name: "search" });
                  else if (item.name === "home") setRoute({ name: "home" });
                  else if (item.name === "voice") setRoute({ name: "voice" });
                  else if (item.name === "topics") setRoute({ name: "topics" });
                  else if (item.name === "insights") setRoute({ name: "insights" });
                  else if (item.name === "ask") setRoute({ name: "ask" });
                  else setRoute({ name: "settings" });
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <main className="stage" id="main">
          <div className="sheet">
            {!echo.online && <p className="banner" role="status">You're offline. New entries stay on this device until you reconnect.</p>}
            {route.name === "home" && <Home echo={echo} open={(id) => setRoute({ name: "write", id })} start={() => setRoute({ name: "write", id: null })} speak={() => setRoute({ name: "voice" })} />}
            {route.name === "write" && <Writer initialId={route.id} openEntry={(id) => setRoute({ name: "write", id })} back={() => setRoute({ name: "home" })} />}
            {route.name === "voice" && <Voice echo={echo} onSaved={(id) => setRoute({ name: "write", id })} />}
            {route.name === "search" && <Search topic={route.topic} open={(id) => setRoute({ name: "write", id })} />}
            {route.name === "topics" && <Topics echo={echo} openTopic={(topic) => setRoute({ name: "search", topic })} />}
            {route.name === "insights" && <Insights echo={echo} />}
            {route.name === "ask" && <Ask open={(id) => setRoute({ name: "write", id })} />}
            {route.name === "settings" && <Settings echo={echo} />}
          </div>
        </main>
      </div>
    </>
  );
}

function Home({ echo, open, start, speak }: { echo: EchoState; open: (id: string) => void; start: () => void; speak: () => void }) {
  const today = echo.entries.filter((entry) => isToday(entry.createdAt));
  return (
    <section>
      <div className="home-head">
        <div>
          <p className="eyebrow">{formatWeekday(new Date())}</p>
          <h1>{formatDay(new Date())}</h1>
        </div>
        <div className="actions">
          <button className="primary" onClick={start}>Write</button>
          <button className="secondary" onClick={speak}>Speak</button>
        </div>
      </div>
      {today.length === 0 ? <p className="lede">Nothing written today. Keep the sentence you would otherwise lose.</p> : today.map((entry) => <EntryButton key={entry.id} entry={entry} onOpen={open} />)}
      {echo.entries.some((entry) => !isToday(entry.createdAt)) && (
        <>
          <h2>Recent</h2>
          <ul className="entry-list">
            {echo.entries.filter((entry) => !isToday(entry.createdAt)).slice(0, 12).map((entry) => (
              <li key={entry.id}><EntryButton entry={entry} onOpen={open} /></li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function EntryButton({ entry, onOpen }: { entry: LocalEntry; onOpen: (id: string) => void }) {
  return (
    <button className="entry-link" onClick={() => onOpen(entry.id)}>
      <span className="meta">{formatWhen(entry.createdAt)}{entry.originalLanguage ? ` · ${languageName(entry.originalLanguage)}` : ""}</span>
      <strong>{preview(entry.originalContent)}</strong>
      <span className="quiet">{entry.topics.map((topic) => topic.label).slice(0, 3).join(" · ") || entry.sourceType}</span>
    </button>
  );
}

function Writer({ initialId, openEntry, back }: { initialId: string | null; openEntry: (id: string) => void; back: () => void }) {
  const echo = useEcho();
  const [entryId, setEntryId] = useState(initialId);
  const existing = echo.entries.find((entry) => entry.id === entryId) ?? null;
  const [text, setText] = useState(existing?.originalContent ?? "");
  const [status, setStatus] = useState(existing ? "Saved" : "Ready");
  const [hideTranslation, setHideTranslation] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setEntryId(initialId);
    const found = getState().entries.find((entry) => entry.id === initialId);
    setText(found?.originalContent ?? "");
    setStatus(found ? "Saved" : "Ready");
    setHideTranslation(false);
  }, [initialId]);

  function scheduleSave(value: string) {
    setText(value);
    if (timer.current) window.clearTimeout(timer.current);
    if (!value.trim()) {
      setStatus("Write something before saving.");
      return;
    }
    setStatus("Saving");
    timer.current = window.setTimeout(() => {
      if (!entryId) {
        const created = createEntry(value, "text");
        setEntryId(created);
        openEntry(created);
      } else {
        updateEntry(entryId, value);
      }
      setStatus("Saved");
    }, 250);
  }

  const translation = existing?.translation;
  const showTranslation = echo.settings.showTranslation && !hideTranslation && translation;

  return (
    <section>
      <div className="screen-head">
        <button className="text-button" onClick={back}>Back</button>
        <p className="status" role="status" aria-live="polite">{status}</p>
      </div>
      {existing?.syncStatus === "conflict" && existing.conflictContent && (
        <div className="banner">
          <p>This entry also changed on another device. Both versions are kept.</p>
          <div className="actions">
            <button className="secondary" onClick={() => keepConflictVersion(existing.id, "device")}>Keep this version</button>
            <button className="secondary" onClick={() => { setText(existing.conflictContent ?? text); keepConflictVersion(existing.id, "other"); }}>Use the other version</button>
          </div>
        </div>
      )}
      <div className="editor">
        <label className="eyebrow" htmlFor="journal-body">Original</label>
        <textarea id="journal-body" className="writing" lang={fieldLanguage(text)} value={text} onChange={(event) => scheduleSave(event.target.value)} placeholder="Write in Burmese, English, or both." autoFocus />
        {showTranslation && (
          <section className="translation" aria-label="Translation">
            <div className="translation-head">
              <h2>{translation.language === "my" ? "Burmese" : "English"}</h2>
              <div className="cluster">
                <button className="text-button" onClick={() => setHideTranslation(true)}>Hide</button>
                <button className="text-button" onClick={() => entryId && reprocess(entryId)}>Regenerate</button>
              </div>
            </div>
            {translation.quality === "approximate" && <p className="quiet">Approximate. The original above is unchanged.</p>}
            <p lang={translation.language === "my" ? "my" : "en"}>{translation.content}</p>
          </section>
        )}
        {existing && existing.processingStatus !== "pending" && !existing.translation && (existing.originalLanguage === "my" || existing.originalLanguage === "mixed") && (
          <p className="quiet">No English translation for this entry. The original is saved as you wrote it.</p>
        )}
        {existing && echo.settings.showTranslation && hideTranslation && <button className="text-button" onClick={() => setHideTranslation(false)}>Show translation</button>}
        {existing && existing.topics.length > 0 && (
          <div className="topics">
            <p className="eyebrow">Topics</p>
            <div className="cluster">
              {existing.topics.map((topic) => <span className="chip" key={topic.slug}>{topic.label}</span>)}
            </div>
          </div>
        )}
        {existing && echo.settings.emotionalContextEnabled && existing.emotionalThemes && existing.emotionalThemes.length > 0 && (
          <p className="quiet">Detected emotional themes: {existing.emotionalThemes.join(", ")}</p>
        )}
        {existing && (
          <form className="cluster" onSubmit={(event) => { event.preventDefault(); addTag(existing.id, tagDraft); setTagDraft(""); }}>
            <label className="quiet" htmlFor="tag-input">Tag</label>
            <input id="tag-input" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} placeholder="exam" />
            <button className="secondary" type="submit">Add tag</button>
          </form>
        )}
        <div className="cluster">
          {existing?.tags.map((tag) => <button className="chip" key={tag} onClick={() => removeTag(existing.id, tag)}>#{tag}</button>)}
          {existing?.suggestedTags.map((tag) => <button className="text-button" key={tag} onClick={() => addTag(existing.id, tag)}>Suggest #{tag}</button>)}
        </div>
        {existing && <button className="danger" onClick={() => { deleteEntry(existing.id); back(); }}>Delete entry</button>}
      </div>
    </section>
  );
}

function Voice({ echo, onSaved }: { echo: EchoState; onSaved: (id: string) => void }) {
  const [status, setStatus] = useState<"idle" | "listening" | "partial" | "final" | "denied" | "failed" | "saving" | "saved">("idle");
  const [failure, setFailure] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const committed = useRef("");
  const generation = useRef(0);
  const supported = typeof window !== "undefined" && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  const detected = transcript.trim() ? detectLanguage(transcript) : null;
  const preview = transcript.trim() ? translateText(transcript) : null;

  function stop() {
    generation.current += 1;
    recognition.current?.stop();
    setStatus((current) => current === "failed" || current === "denied" ? current : "final");
  }

  function begin(languages: string[]) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const language = languages[0];
    if (!Ctor || !language) {
      setFailure(language ? "unavailable" : "language-not-supported");
      setStatus("failed");
      return;
    }
    const sessionId = generation.current + 1;
    generation.current = sessionId;
    const session = new Ctor();
    session.lang = language;
    session.continuous = true;
    session.interimResults = true;
    session.onresult = (event) => {
      if (sessionId !== generation.current) return;
      const finals: string[] = [];
      let interimText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        const piece = event.results[index][0]?.transcript ?? "";
        if (event.results[index].isFinal) finals.push(piece);
        else interimText += piece;
      }
      setTranscript(assembleTranscript(committed.current, [...finals, interimText]));
      setFailure(null);
      setStatus(interimText ? "partial" : "listening");
    };
    session.onerror = (event) => {
      if (sessionId !== generation.current) return;
      if (event.error === "aborted") return;
      if (event.error === "language-not-supported" && languages.length > 1) {
        begin(languages.slice(1));
        return;
      }
      setFailure(event.error);
      setStatus(event.error === "not-allowed" || event.error === "service-not-allowed" ? "denied" : "failed");
    };
    session.onend = () => {
      if (sessionId !== generation.current) return;
      setStatus((current) => current === "failed" || current === "denied" ? current : "final");
    };
    recognition.current = session;
    setStatus("listening");
    setFailure(null);
    try {
      session.start();
    } catch {
      setFailure("start-failed");
      setStatus("failed");
    }
  }

  function start() {
    committed.current = transcript.trim();
    const previous = recognition.current;
    generation.current += 1;
    previous?.stop();
    begin(echo.settings.speechLanguage === "my" ? ["my-MM", "my"] : ["en-US"]);
  }

  return (
    <section className="voice-card">
      <p className="eyebrow">Voice</p>
      <h1>Speak</h1>
      <div className="cluster">
        <button className={echo.settings.speechLanguage === "my" ? "primary" : "secondary"} onClick={() => updateSettings({ speechLanguage: "my" })}>Burmese</button>
        <button className={echo.settings.speechLanguage === "en" ? "primary" : "secondary"} onClick={() => updateSettings({ speechLanguage: "en" })}>English</button>
      </div>
      <button className="voice-orb" data-state={status} aria-pressed={status === "listening" || status === "partial"} onClick={() => status === "listening" || status === "partial" ? stop() : start()}>
        {status === "listening" || status === "partial" ? "Stop" : "Speak"}
      </button>
      <p role="status" aria-live="polite">{voiceMessage(status, failure, echo.settings.speechLanguage, supported)}</p>
      <label className="eyebrow" htmlFor="transcript">Transcript</label>
      <textarea
        id="transcript"
        className="writing"
        lang={fieldLanguage(transcript)}
        value={transcript}
        onChange={(event) => {
          if (status === "listening" || status === "partial") recognition.current?.stop();
          committed.current = event.target.value;
          setTranscript(event.target.value);
          setFailure(null);
          setStatus(event.target.value.trim() ? "final" : "idle");
        }}
      />
      {detected && <p className="quiet">Detected {languageName(detected)}.</p>}
      {preview?.translated && (
        <section className="translation" aria-label="Translation">
          <h2>{preview.language === "my" ? "Burmese" : "English"}</h2>
          {preview.quality === "approximate" && <p className="quiet">Approximate. The transcript above stays as you said it.</p>}
          <p lang={preview.language === "my" ? "my" : "en"}>{preview.text}</p>
        </section>
      )}
      {transcript.trim() && preview && !preview.translated && (detected === "my" || detected === "mixed") && (
        <p className="quiet">No English translation for this transcript. It will be saved as you said it.</p>
      )}
      <div className="actions">
        <button className="primary" onClick={() => {
          if (!transcript.trim()) return;
          setStatus("saving");
          const id = createEntry(transcript.trim(), "voice");
          setStatus("saved");
          onSaved(id);
        }}>Save entry</button>
        <button className="secondary" onClick={() => { committed.current = ""; setTranscript(""); setFailure(null); setStatus("idle"); }}>Clear</button>
      </div>
    </section>
  );
}

function Search({ topic, open }: { topic?: string; open: (id: string) => void }) {
  const echo = useEcho();
  const [query, setQuery] = useState(topic ? "" : "");
  const [mode, setMode] = useState<"hybrid" | "keyword" | "semantic">("hybrid");
  const [language, setLanguage] = useState<"" | "my" | "en" | "mixed">("");
  const hits = useMemo(() => {
    if (!query.trim() && !topic) return [];
    return searchEntries(query || topic || "", { topic, mode, language: language || undefined });
  }, [query, topic, mode, language, echo.entries]);

  return (
    <section>
      <p className="eyebrow">Search</p>
      <h1>Find a memory</h1>
      <div className="search">
        <label className="quiet" htmlFor="search-box">Search your journal</label>
        <input id="search-box" type="search" value={query} placeholder="running, software engineering, university" onChange={(event) => setQuery(event.target.value)} />
        <div className="cluster">
          <select aria-label="Search mode" value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
            <option value="hybrid">Exact and semantic</option>
            <option value="keyword">Exact</option>
            <option value="semantic">Semantic</option>
          </select>
          <select aria-label="Language" value={language} onChange={(event) => setLanguage(event.target.value as typeof language)}>
            <option value="">Any language</option>
            <option value="my">Burmese</option>
            <option value="en">English</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
        {topic && <p className="quiet">Filtered by topic: {topic}</p>}
      </div>
      {query.trim() && hits.length === 0 && <p>No entries matched.</p>}
      <ul className="entry-list">
        {hits.map((hit) => <SearchRow key={hit.id} hit={hit} echo={echo} open={open} />)}
      </ul>
    </section>
  );
}

function SearchRow({ hit, echo, open }: { hit: SearchHit; echo: EchoState; open: (id: string) => void }) {
  const entry = echo.entries.find((item) => item.id === hit.id);
  if (!entry) return null;
  return (
    <li>
      <button className="entry-link" onClick={() => open(entry.id)}>
        <span className="meta">{formatWhen(entry.createdAt)}</span>
        <strong>{hit.excerpt}</strong>
      </button>
    </li>
  );
}

function Topics({ echo, openTopic }: { echo: EchoState; openTopic: (topic: string) => void }) {
  const counts = new Map<string, { label: string; count: number }>();
  for (const entry of echo.entries) {
    for (const topic of entry.topics) {
      const current = counts.get(topic.slug) ?? { label: topic.label, count: 0 };
      current.count += 1;
      counts.set(topic.slug, current);
    }
  }
  const topics = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
  return (
    <section>
      <p className="eyebrow">Topics</p>
      <h1>What keeps returning</h1>
      {topics.length === 0 ? <p>Topics appear after you write. They are separate from tags you choose.</p> : (
        <ul className="entry-list">
          {topics.map(([slug, topic]) => (
            <li key={slug}>
              <button className="entry-link" onClick={() => openTopic(slug)}>
                <strong>{topic.label}</strong>
                <span className="quiet">{topic.count} {topic.count === 1 ? "entry" : "entries"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Insights({ echo }: { echo: EchoState }) {
  const report = insights();
  void echo;
  return (
    <section>
      <p className="eyebrow">Insights</p>
      <h1>A quiet count</h1>
      <div className="insight-grid">
        <article><span className="quiet">Entries this month</span><strong>{report.entriesThisMonth}</strong></article>
        <article><span className="quiet">Writing streak</span><strong>{report.writingStreak}</strong></article>
        <article><span className="quiet">Words</span><strong>{report.wordCount}</strong></article>
        <article><span className="quiet">Voice / text</span><strong>{report.voiceEntries}/{report.textEntries}</strong></article>
      </div>
      <p>{report.mostActiveDay ? `Most of your entries land on ${report.mostActiveDay}.` : "Write a few entries and a rhythm will show up here."}</p>
      {report.topics.length > 0 && <p>Most discussed: {report.topics.map((topic) => topic.topic).join(", ")}.</p>}
      <p className="quiet">{report.disclaimer}</p>
    </section>
  );
}

function Ask({ open }: { open: (id: string) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null);

  return (
    <section>
      <p className="eyebrow">Ask</p>
      <h1>Ask your journal</h1>
      <p className="lede">Answers stay inside what you wrote. If the evidence is thin, Echo says so.</p>
      <form className="ask-form" onSubmit={(event) => { event.preventDefault(); if (question.trim()) setAnswer(askJournal(question.trim())); }}>
        <label htmlFor="question">Question</label>
        <input id="question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="When did I first talk about software engineering?" />
        <button className="primary" type="submit">Look it up</button>
      </form>
      {answer && (
        <article className="answer">
          <p>{answer.answer}</p>
          {answer.answer === INSUFFICIENT_EVIDENCE ? null : (
            <ul className="entry-list">
              {answer.sources.map((source) => (
                <li key={source.entryId}>
                  <button className="entry-link" onClick={() => open(source.entryId)}>
                    <span className="meta">{formatWhen(source.createdAt)}</span>
                    <strong>{source.excerpt}</strong>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </article>
      )}
    </section>
  );
}

function Settings({ echo }: { echo: EchoState }) {
  const [email, setEmail] = useState(echo.settings.email ?? "");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState("");

  function download(format: "json" | "markdown" | "csv") {
    const blob = new Blob([exportEntries(format)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `echo.${format === "markdown" ? "md" : format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="stack">
      <div>
        <p className="eyebrow">Settings</p>
        <h1>Privacy</h1>
      </div>
      <label className="choice">
        <input type="checkbox" checked={echo.settings.emotionalContextEnabled} onChange={(event) => updateSettings({ emotionalContextEnabled: event.target.checked })} />
        Show detected emotional themes
      </label>
      <label className="choice">
        <input type="checkbox" checked={echo.settings.showTranslation} onChange={(event) => updateSettings({ showTranslation: event.target.checked })} />
        Show translations under the original
      </label>
      <div className="auth">
        <h2>{echo.token ? "Sync" : "Optional sync"}</h2>
        <p className="quiet">{echo.token ? `Signed in as ${echo.settings.email}.` : "The journal works on this device without an account. Sign in to sync."}</p>
        {!echo.token && (
          <form className="stack" onSubmit={async (event) => {
            event.preventDefault();
            const mode = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "register" ? "register" : "login";
            const error = await signIn(email, password, mode);
            setMessage(error ?? "Signed in.");
          }}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
            <div className="actions">
              <button className="primary" type="submit" value="login">Sign in</button>
              <button className="secondary" type="submit" value="register">Create account</button>
            </div>
          </form>
        )}
        {echo.token && <button className="secondary" onClick={() => void signOut()}>Sign out</button>}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="actions">
        <button className="secondary" onClick={() => download("json")}>Export JSON</button>
        <button className="secondary" onClick={() => download("markdown")}>Export Markdown</button>
        <button className="secondary" onClick={() => download("csv")}>Export CSV</button>
      </div>
      <button className="danger" onClick={() => { if (window.confirm("Remove every journal entry from this device?")) clearDevice(); }}>Remove from this device</button>
      <form className="stack" onSubmit={async (event) => {
        event.preventDefault();
        if (confirm !== "delete") {
          setMessage("Type delete to confirm account deletion.");
          return;
        }
        const error = await deleteAccount();
        setMessage(error ?? "The account and its journals were deleted.");
      }}>
        <label htmlFor="confirm-delete">Delete account</label>
        <input id="confirm-delete" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Type delete" />
        <button className="danger" type="submit">Delete account</button>
      </form>
    </section>
  );
}

function preview(content: string): string {
  const line = content.trim().split("\n")[0] ?? "";
  return line.length > 90 ? `${line.slice(0, 89)}…` : line;
}

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(date);
}

function formatWhen(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

function fieldLanguage(text: string): "my" | "en" {
  const detected = detectLanguage(text);
  return detected === "en" ? "en" : "my";
}

function voiceMessage(status: string, failure: string | null, language: "my" | "en", supported: boolean): string {
  if (!supported || failure === "unavailable") return "Speech recognition isn't available in this browser. Paste a transcript instead.";
  if (failure === "language-not-supported" && language === "my") {
    return "This browser can't transcribe Burmese speech. Paste what you said, or switch to English. Echo still detects the language and translates the text.";
  }
  if (failure === "language-not-supported") return "This browser can't transcribe that language. You can type the entry instead.";
  if (failure === "not-allowed" || failure === "service-not-allowed" || status === "denied") {
    return "Microphone permission was denied. You can paste a transcript instead.";
  }
  if (failure === "network") return "Speech recognition needs a network connection. You can type, and the journal still saves offline.";
  if (failure === "no-speech") return "No speech was heard. Try again, or type the entry.";
  if (failure === "audio-capture") return "No microphone was found. You can type the entry instead.";
  if (status === "failed") return "Speech recognition stopped. You can type the entry instead.";
  if (status === "listening" || status === "partial") return "Listening. The transcript updates while you speak.";
  if (status === "final") return "Review the transcript, then save.";
  if (status === "saving") return "Saving";
  if (status === "saved") return "Saved";
  return "Tap the button and speak. You can edit the transcript before saving.";
}

function languageName(code: string): string {
  if (code === "my") return "Burmese";
  if (code === "en") return "English";
  if (code === "mixed") return "Burmese and English";
  return "Language unknown";
}
