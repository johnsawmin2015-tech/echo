import { spawn } from "node:child_process";

const api = spawn("npx", ["tsx", "services/api/src/index.ts"], { stdio: "inherit" });
const web = spawn("npm", ["run", "dev", "-w", "@echo/web"], { stdio: "inherit" });

function stop() {
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
