import { test, expect } from "bun:test";
import type { OpenCodeEvent, SessionInfo } from "@opencode/client";
import { setup, type Host } from "../src/adapter.ts";
import type { TelemetryEvent } from "../src/types.ts";
const zero = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};
class EventQueue {
  private queue: OpenCodeEvent[] = [];
  private wake: (() => void) | undefined;
  push(event: OpenCodeEvent) {
    this.queue.push(event);
    this.wake?.();
  }
  async *subscribe(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<OpenCodeEvent> {
    while (!options?.signal?.aborted) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        const finish = () => {
          options?.signal?.removeEventListener("abort", finish);
          this.wake = undefined;
          resolve();
        };
        this.wake = finish;
        options?.signal?.addEventListener("abort", finish, { once: true });
      });
    }
  }
}
async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for adapter");
}
function fixture(mode: "enforce" | "observe" = "enforce") {
  const events = new EventQueue(),
    logs: TelemetryEvent[] = [],
    calls: { id: string; sessionID: string }[] = [];
  const sessions = new Map<string, SessionInfo>();
  let disposed = 0;
  let state: Awaited<ReturnType<Host["storage"]["get"]>>;
  const add = (id: string, parentID?: string) =>
    sessions.set(id, {
      id,
      ...(parentID ? { parentID } : {}),
      projectID: "proj_test",
      agent: "build",
      model: { providerID: "local", id: "deepseek" },
      cost: 0,
      tokens: { ...zero, input: 900000 },
      time: { created: 1, updated: 1 },
      location: { directory: "/test" },
    });
  const host: Host = {
    app: { version: "2.0.29" },
    location: { directory: "/test" },
    options: { mode, telemetry: { enabled: false } },
    storage: {
      get: async () => state,
      set: async (_k, value) => {
        state = structuredClone(value);
      },
    },
    model: {
      list: async () => ({ location: { directory: "/test" }, data: [] }),
    },
    session: {
      hook: async () => ({
        dispose: async () => {
          disposed++;
        },
      }),
      get: async ({ sessionID }) => {
        const s = sessions.get(sessionID);
        if (!s) throw new Error("unknown session");
        return structuredClone(s);
      },
      compact: async ({ sessionID, id, delivery }) => {
        expect(delivery).toBe("steer");
        expect(state).toBeDefined();
        if (!id) throw new Error("Missing idempotency key");
        calls.push({ id, sessionID });
        return {
          id,
          sessionID,
          type: "compaction",
          payload: {},
          delivery: "steer",
          time: { created: Date.now() },
        };
      },
    },
    event: events,
  };
  const sink = { emit: (e: TelemetryEvent) => logs.push(structuredClone(e)) };
  let seq = 0;
  const base = (sessionID: string) => ({
    id: `evt_${++seq}`,
    created: Date.now(),
    durable: { aggregateID: sessionID, seq, version: 1 as const },
    location: { directory: "/test" },
  });
  const step = (id: string, used: number, messageID: string) => {
    events.push({
      ...base(id),
      type: "session.step.started",
      data: {
        sessionID: id,
        assistantMessageID: messageID,
        agent: "build",
        model: { providerID: "local", id: "deepseek" },
        started: Date.now(),
      },
    });
    events.push({
      ...base(id),
      type: "session.step.ended",
      data: {
        sessionID: id,
        assistantMessageID: messageID,
        finish: "tool-calls",
        cost: 0,
        tokens: { ...zero, input: used },
      },
    });
  };
  return {
    host,
    sink,
    logs,
    calls,
    events,
    add,
    step,
    base,
    disposed: () => disposed,
    state: () => state,
  };
}
test("V2 adapter monitors active nested children and observes completion separately from admission", async () => {
  const f = fixture();
  f.add("ses_parent");
  f.add("ses_child", "ses_parent");
  f.add("ses_nested", "ses_child");
  const cleanup = await setup(f.host, f.sink);
  try {
    f.step("ses_child", 150000, "msg_one");
    f.step("ses_nested", 160000, "msg_two");
    await until(() => f.calls.length === 2);
    expect(f.calls.map((c) => c.sessionID).sort()).toEqual([
      "ses_child",
      "ses_nested",
    ]);
    const accepted = f.logs.find((e) => e.type === "compaction.accepted");
    expect(accepted?.session?.compaction.count).toBe(0);
    expect(accepted?.session?.active).toBe(true); // No idle event was sent.
    f.events.push({
      ...f.base("ses_child"),
      type: "session.compaction.started",
      data: {
        sessionID: "ses_child",
        reason: "manual",
        recent: "",
        inputID: f.calls[0]?.id ?? "msg_missing",
      },
    });
    f.events.push({
      ...f.base("ses_child"),
      type: "session.compaction.ended",
      data: {
        sessionID: "ses_child",
        reason: "manual",
        model: { providerID: "local", id: "deepseek" },
        text: "SECRET SUMMARY",
        recent: "SECRET RECENT",
      },
    });
    f.step("ses_child", 20000, "msg_continuation");
    await until(() =>
      f.logs.some(
        (e) => e.session?.usage.current?.requestId === "msg_continuation",
      ),
    );
    const last = f.logs
      .filter((e) => e.session?.sessionId === "ses_child")
      .at(-1)?.session;
    expect(last?.compaction.count).toBe(1);
    expect(last?.usage.cumulative?.input).toBe(900000);
    expect(last?.usage.current?.tokens).toBe(20000);
    expect(JSON.stringify(f.logs)).not.toContain("SECRET");
    expect(f.calls.length).toBe(2);
  } finally {
    await cleanup();
  }
  expect(f.disposed()).toBe(2);
});
test("observe adapter tracks subagents without admission", async () => {
  const f = fixture("observe");
  f.add("ses_child", "ses_parent");
  const cleanup = await setup(f.host, f.sink);
  try {
    f.step("ses_child", 200000, "msg_one");
    await until(() => f.logs.some((e) => e.type === "would-compact"));
    expect(f.calls.length).toBe(0);
  } finally {
    await cleanup();
  }
});
test("reload preserves unresolved compaction suppression", async () => {
  const f = fixture();
  f.add("ses_child", "ses_parent");
  let cleanup = await setup(f.host, f.sink);
  f.step("ses_child", 200000, "msg_first");
  await until(() => f.calls.length === 1);
  await cleanup();
  cleanup = await setup(f.host, f.sink);
  try {
    f.step("ses_child", 210000, "msg_after_restart");
    await until(() =>
      f.logs.some(
        (e) => e.session?.usage.current?.requestId === "msg_after_restart",
      ),
    );
    expect(f.calls.length).toBe(1);
    expect(f.logs.at(-1)?.session?.compaction.phase).toBe("uncertain");
  } finally {
    await cleanup();
  }
});
test("an event for a different location cannot trigger compaction", async () => {
  const f = fixture();
  f.add("ses_other");
  const cleanup = await setup(f.host, f.sink);
  try {
    f.events.push({
      ...f.base("ses_other"),
      location: { directory: "/other" },
      type: "session.step.started",
      data: {
        sessionID: "ses_other",
        assistantMessageID: "msg_other",
        agent: "build",
        model: { providerID: "local", id: "deepseek" },
        started: Date.now(),
      },
    });
    f.step("ses_other", 10, "msg_local");
    await until(() =>
      f.logs.some((e) => e.session?.usage.current?.requestId === "msg_local"),
    );
    expect(f.calls.length).toBe(0);
    expect(f.logs.at(-1)?.session?.usage.modelRequests).toBe(1);
  } finally {
    await cleanup();
  }
});
test("storage read failure does not overwrite unknown durable safety state or admit work", async () => {
  const f = fixture();
  f.add("ses_child", "ses_parent");
  let writes = 0;
  f.host.storage = {
    get: async () => {
      throw new Error("storage offline");
    },
    set: async () => {
      writes++;
    },
  };
  const cleanup = await setup(f.host, f.sink);
  try {
    f.step("ses_child", 200000, "msg_one");
    await until(() => f.logs.some((e) => e.type === "compaction.uncertain"));
    expect(f.calls.length).toBe(0);
    expect(writes).toBe(0);
  } finally {
    await cleanup();
  }
});
test("unexpected event-stream EOF reports degraded enforcement", async () => {
  const f = fixture();
  f.host.event = { subscribe: async function* () {} };
  const cleanup = await setup(f.host, f.sink);
  try {
    await until(() => f.logs.some((e) => e.type === "event-stream-gap"));
  } finally {
    await cleanup();
  }
});
test("malformed stored safety state disables admission without overwriting it", async () => {
  const f = fixture();
  f.add("ses_child", "ses_parent");
  let writes = 0;
  f.host.storage = {
    get: async () => [{ sessionId: "ses_child", compaction: {} }],
    set: async () => {
      writes++;
    },
  };
  const cleanup = await setup(f.host, f.sink);
  try {
    f.step("ses_child", 200000, "msg_one");
    await until(() => f.logs.some((e) => e.type === "compaction.uncertain"));
    expect(f.calls.length).toBe(0);
    expect(writes).toBe(0);
  } finally {
    await cleanup();
  }
});
