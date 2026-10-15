/** Opt-in evidence collector. Never invokes private wait APIs or modifies user config. */
import { OpenCode } from "@opencode/client";
const baseUrl = process.env.GUARD_SERVER_URL,
  directory = process.env.GUARD_TEST_DIRECTORY;
const modelName = process.env.GUARD_TEST_MODEL;
if (!baseUrl || !directory || !modelName) {
  console.log(
    "SKIP: set GUARD_SERVER_URL, GUARD_TEST_DIRECTORY and GUARD_TEST_MODEL=provider/model. See docs/testing.md.",
  );
  process.exit(0);
}
const slash = modelName.indexOf("/");
if (slash < 1) throw new Error("GUARD_TEST_MODEL must be provider/model");
const client = OpenCode.make({
  baseUrl,
  ...(process.env.GUARD_AUTHORIZATION
    ? { headers: { Authorization: process.env.GUARD_AUTHORIZATION } }
    : {}),
});
const abort = new AbortController(),
  seen: { type: string; sessionId: string; at: number }[] = [];
const ids = new Set<string>();
const stream = (async () => {
  for await (const event of client.event.subscribe({ signal: abort.signal })) {
    if (
      "created" in event &&
      "sessionID" in event.data &&
      ids.has(event.data.sessionID) &&
      [
        "session.step.started",
        "session.step.ended",
        "session.tool.called",
        "session.compaction.started",
        "session.compaction.ended",
        "session.compaction.failed",
        "session.execution.succeeded",
        "session.execution.failed",
      ].includes(event.type)
    ) {
      const row = {
        type: event.type,
        sessionId: event.data.sessionID,
        at: event.created,
      };
      seen.push(row);
      console.log(JSON.stringify(row));
    }
  }
})().catch((error) => {
  if (!abort.signal.aborted) throw error;
});
let parentId: string | undefined;
try {
  const parent = await client.session.create({
    title: "Context Guard disposable validation",
    location: { directory },
    model: {
      providerID: modelName.slice(0, slash),
      id: modelName.slice(slash + 1),
    },
  });
  parentId = parent.id;
  ids.add(parent.id);
  const child = await client.session.create({
    parentID: parent.id,
    title: "Context Guard active child",
    location: { directory },
    model: {
      providerID: modelName.slice(0, slash),
      id: modelName.slice(slash + 1),
    },
  });
  ids.add(child.id);
  await client.session.prompt({
    sessionID: child.id,
    text: "Perform 12 sequential read-only shell tool calls. Each call must run only: printf context-guard-step. Do not combine calls. After each call, briefly record the step number and continue. After all 12, reply DONE. Do not write files or use the network.",
  });
  const deadline = Date.now() + 180000;
  while (
    Date.now() < deadline &&
    !seen.some(
      (e) =>
        e.sessionId === child.id && e.type.startsWith("session.execution."),
    )
  )
    await Bun.sleep(200);
  const timeline = seen.filter((e) => e.sessionId === child.id);
  const compact = timeline.findIndex(
    (e) => e.type === "session.compaction.ended",
  );
  const toolsBefore = timeline
    .slice(0, compact)
    .some((e) => e.type === "session.tool.called");
  const continuation = timeline
    .slice(compact + 1)
    .some((e) => e.type === "session.step.started");
  const finished = timeline.findIndex(
    (e) => e.type === "session.execution.succeeded",
  );
  if (compact < 0 || !toolsBefore || !continuation || finished < compact)
    throw new Error(
      "Active-child acceptance criterion NOT demonstrated. Inspect trace/config/model tool compliance; no success inferred from admission.",
    );
  console.log(
    "PASS: child compacted after tools, continued, then completed. Confirm journal provenance and policy in the configured test location.",
  );
} finally {
  abort.abort();
  await stream;
  if (parentId) await client.session.remove({ sessionID: parentId });
}
