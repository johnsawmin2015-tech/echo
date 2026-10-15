export type ServerJournal = {
  content: string;
  updatedAt: string;
};

export type IncomingJournal = {
  content: string;
  baseUpdatedAt: string | null;
};

export type SyncDecision =
  | { type: "insert" }
  | { type: "unchanged" }
  | { type: "apply_incoming" }
  | { type: "conflict"; serverContent: string; incomingContent: string };

export function resolveSync(server: ServerJournal | null, incoming: IncomingJournal): SyncDecision {
  if (!server) return { type: "insert" };
  if (server.content === incoming.content) return { type: "unchanged" };
  if (incoming.baseUpdatedAt && incoming.baseUpdatedAt === server.updatedAt) {
    return { type: "apply_incoming" };
  }
  return {
    type: "conflict",
    serverContent: server.content,
    incomingContent: incoming.content,
  };
}
