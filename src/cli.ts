#!/usr/bin/env bun
import { readJournal } from "./telemetry.ts";
const args = process.argv.slice(2);
if (!args[0] || args.includes("--help")) {
  console.log(
    "Usage: bun run inspect /absolute/path/to/journal.jsonl [--history] [--json]\nThe ready log reports the location-specific journal path.",
  );
} else {
  const records = await readJournal(args[0]);
  const sessions = new Map<string, Record<string, unknown>>();
  const history: unknown[] = [];
  for (const record of records) {
    history.push(record);
    if (!record || typeof record !== "object" || !("session" in record))
      continue;
    const s = record.session;
    if (
      !s ||
      typeof s !== "object" ||
      !("sessionId" in s) ||
      typeof s.sessionId !== "string"
    )
      continue;
    sessions.set(s.sessionId, { ...s });
  }
  if (args.includes("--history")) console.log(JSON.stringify(history, null, 2));
  else if (args.includes("--json"))
    console.log(JSON.stringify([...sessions.values()], null, 2));
  else for (const s of sessions.values()) console.log(JSON.stringify(s));
}
