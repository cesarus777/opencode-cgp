/** Opt-in observational comparison. Does not prompt, compact, or read transcripts. */
import { OpenCode } from "@opencode/client";
import { performanceRpc, isPerformanceResult } from "../src/rpc.ts";
import { outputTokens } from "../src/performance.ts";
const baseUrl = process.env.GUARD_SERVER_URL,
  directory = process.env.GUARD_TEST_DIRECTORY,
  sessionID = process.env.GUARD_TEST_SESSION;
if (!baseUrl || !directory || !sessionID) {
  console.log(
    "SKIP: metrics live validation needs GUARD_SERVER_URL, GUARD_TEST_DIRECTORY and GUARD_TEST_SESSION. Start a request in that disposable session during the observation window.",
  );
  process.exit(0);
}
const client = OpenCode.make({
  baseUrl,
  ...(process.env.GUARD_AUTHORIZATION
    ? { headers: { Authorization: process.env.GUARD_AUTHORIZATION } }
    : {}),
});
const rpc = client.rpc(performanceRpc),
  controller = new AbortController();
const request = new Map<
  string,
  { started: number; first?: number; ended?: number }
>();
let verified = false;
const timeout = setTimeout(() => controller.abort(), 60000);
try {
  for await (const event of client.event.subscribe({
    signal: controller.signal,
  })) {
    if (
      !("sessionID" in event.data) ||
      event.data.sessionID !== sessionID ||
      (event.location && event.location.directory !== directory)
    )
      continue;
    if (event.type === "session.step.started")
      request.set(event.data.assistantMessageID, {
        started: event.data.started,
      });
    if (
      event.type === "session.text.delta" ||
      event.type === "session.reasoning.delta"
    ) {
      const r = request.get(event.data.assistantMessageID);
      if (r && r.first === undefined && event.data.delta.length)
        r.first = event.created;
    }
    if (event.type === "session.step.streamed") {
      const r = request.get(event.data.assistantMessageID);
      if (r) r.ended = event.created;
    }
    if (event.type !== "session.step.ended") continue;
    const r = request.get(event.data.assistantMessageID),
      tokens = outputTokens(event.data.tokens);
    if (
      !r ||
      r.ended === undefined ||
      r.ended <= r.started ||
      tokens === undefined
    )
      continue;
    const expectedTps = (tokens * 1000) / (r.ended - r.started),
      expectedTtft = r.first === undefined ? undefined : r.first - r.started;
    const deadline = Date.now() + 5000;
    while (!controller.signal.aborted && Date.now() < deadline) {
      const result = await rpc.read(
        { schemaVersion: 1, sessionIds: [sessionID] },
        {
          location: { directory },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(2000),
          ]),
        },
      );
      if (!isPerformanceResult(result))
        throw new Error("Invalid v2 performance payload");
      const p = result.upserts[0]?.performance;
      if (
        p?.requestId === event.data.assistantMessageID &&
        p.tokenSource === "reported" &&
        p.streamEndedAt === r.ended
      ) {
        if (
          p.latestRequestTps === undefined ||
          Math.abs(p.latestRequestTps - expectedTps) > 0.001 ||
          p.ttftMs !== expectedTtft
        )
          throw new Error(
            "Observed request timing and reported usage differ from plugin projection",
          );
        console.log(
          JSON.stringify({
            result: "PASS",
            sessionID,
            requestId: p.requestId,
            outputTokens: tokens,
            requestTps: expectedTps,
            ttftMs: expectedTtft,
          }),
        );
        verified = true;
        break;
      }
      await Bun.sleep(100);
    }
    if (verified) break;
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
} finally {
  clearTimeout(timeout);
  controller.abort();
}
if (!verified)
  throw new Error(
    "No complete matching request verified in 60 seconds; repeat while a disposable session is generating.",
  );
