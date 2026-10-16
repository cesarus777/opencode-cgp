/** Observational transport smoke; no prompts, compactions or configuration writes. */
import { OpenCode } from "@opencode/client";
import { monitorRpc, isResult, isBatch } from "../src/rpc.ts";
const baseUrl = process.env.GUARD_SERVER_URL,
  directory = process.env.GUARD_TEST_DIRECTORY,
  sessionId = process.env.GUARD_TEST_SESSION;
if (!baseUrl || !directory || !sessionId) {
  console.log(
    "SKIP: TUI transport needs GUARD_SERVER_URL, GUARD_TEST_DIRECTORY and GUARD_TEST_SESSION (disposable session).",
  );
  process.exit(0);
}
const client = OpenCode.make({
  baseUrl,
  ...(process.env.GUARD_AUTHORIZATION
    ? { headers: { Authorization: process.env.GUARD_AUTHORIZATION } }
    : {}),
});
const rpc = client.rpc(monitorRpc),
  controller = new AbortController();
const stream = (async () => {
  for await (const event of rpc.events.subscribe("changed", {
    signal: controller.signal,
  })) {
    if (event.location?.directory === directory && !isBatch(event.data))
      throw new Error("Invalid changed payload");
  }
})().catch(() => {
  if (!controller.signal.aborted) throw new Error("RPC subscription failed");
});
try {
  const result = await rpc.read(
    { schemaVersion: 1, sessionIds: [sessionId] },
    { location: { directory }, signal: AbortSignal.timeout(5000) },
  );
  if (!isResult(result)) throw new Error("Invalid read payload");
  console.log(
    `PASS: bounded RPC read; ${result.upserts.length} monitored, ${result.unavailable.length} unknown. Interactive terminal and event delivery require manual validation.`,
  );
} finally {
  controller.abort();
  await stream;
}
