import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createApp } from "./app.js";
import { log } from "./logger.js";
import { openDatabase } from "./repository.js";
import { processDueJobs } from "./worker.js";

const databasePath = process.env.ECHO_DB ?? "./data/echo.sqlite";
const dataDir = process.env.ECHO_DATA_DIR ?? "./data";
const port = Number(process.env.PORT ?? 8787);
const db = openDatabase(databasePath);
const app = createApp(db, { dataDir });

const server = createServer((request, response) => {
  void handle(request, response);
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const host = request.headers.host ?? `127.0.0.1:${port}`;
    const url = `http://${host}${request.url ?? "/"}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const result = await app.fetch(new Request(url, { method: request.method, headers, body: hasBody ? body : undefined }));
    response.statusCode = result.status;
    result.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    log("error", "http_error", { name: error instanceof Error ? error.name : "Error" });
    response.statusCode = 500;
    response.end(JSON.stringify({ error: "Something went wrong. Your writing is saved.", code: "server_error" }));
  }
}

server.listen(port, () => {
  log("info", "api_listening", { port });
});

setInterval(() => {
  processDueJobs(db);
}, 2000);
