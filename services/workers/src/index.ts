import { openDatabase } from "../../api/src/repository.ts";
import { processDueJobs } from "../../api/src/worker.ts";

const db = openDatabase(process.env.ECHO_DB ?? "./data/echo.sqlite");

setInterval(() => {
  const processed = processDueJobs(db);
  if (processed > 0 && process.env.NODE_ENV !== "test") {
    console.log(JSON.stringify({ message: "worker_pass", processed }));
  }
}, 2000);
