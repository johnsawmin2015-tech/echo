import { redactForLog } from "@echo/core";

export const logs: string[] = [];

export function log(level: "info" | "error", message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...(redactForLog(fields) as Record<string, unknown>),
  });
  logs.push(line);
  if (process.env.NODE_ENV === "test") return;
  if (level === "error") console.error(line);
  else console.log(line);
}
