import { isBatch, isResult, isPerformanceResult } from "../src/rpc.ts";
import type { SnapshotBatch } from "../src/snapshot.ts";
import { test, expect } from "bun:test";
import type {
  OpenCodeEvent,
  SessionInfo,
  SessionMessageInfo,
  SessionMessageAssistant,
} from "@opencode/client";
import { setup, type Host } from "../src/adapter.ts";
import type { TelemetryEvent } from "../src/types.ts";
const zero = {
  input: 0,
  output: 0,
  reasoning: 0,
  cache: { read: 0, write: 0 },
};
class EventQueue {
  private ended = false;
  end() {
    this.ended = true;
    this.wake?.();
  }
  private queue: OpenCodeEvent[] = [];
  private wake: (() => void) | undefined;
  push(event: OpenCodeEvent) {
    this.queue.push(event);
    this.wake?.();
  }
  async *subscribe(options?: {
    signal?: AbortSignal;
  }): AsyncIterable<OpenCodeEvent> {
    while (!this.ended && !options?.signal?.aborted) {
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
  const contexts = new Map<string, SessionMessageInfo[]>();
  const contextReads: string[] = [];
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
  let readSnapshot: ((ids: string[]) => Promise<unknown>) | undefined;
  const snapshots: SnapshotBatch[] = [];
  let readPerformance: ((ids: string[]) => Promise<unknown>) | undefined;
  const performanceSnapshots: SnapshotBatch[] = [];
  const storage = new Map<
    string,
    Awaited<ReturnType<Host["storage"]["get"]>>
  >();
  const host: Host = {
    rpc: {
      register: async (definition, handlers) => {
        const read = (ids: string[]) =>
          handlers.read(
            { schemaVersion: 1, sessionIds: ids },
            {
              signal: new AbortController().signal,
              error: () => {
                throw new Error("unused");
              },
            },
          );
        if (definition.id === "context-guard.monitor.v1") readSnapshot = read;
        else if (definition.id === "context-guard.monitor.v2")
          readPerformance = read;
        return {
          events: {
            emit: async (_name, batch) => {
              if (
                definition.id === "context-guard.monitor.v1" &&
                isBatch(batch)
              )
                snapshots.push(batch);
              if (definition.id === "context-guard.monitor.v2") {
                const value: unknown = {
                  ...(batch && typeof batch === "object" ? batch : {}),
                  unavailable: [],
                };
                if (isPerformanceResult(value))
                  performanceSnapshots.push(value);
              }
            },
          },
          dispose: async () => {
            readSnapshot = undefined;
          },
        };
      },
    },
    app: { version: "2.0.29" },
    location: { directory: "/test" },
    options: {
      mode,
      telemetry: { enabled: false },
      history: { enabled: false },
    },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, structuredClone(value));
        if (key === "safety") state = structuredClone(value);
      },
    },
    model: {
      list: async () => ({ location: { directory: "/test" }, data: [] }),
    },
    session: {
      context: async ({ sessionID }) => {
        contextReads.push(sessionID);
        return contexts.get(sessionID) ?? [];
      },
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
    read: (ids: string[]) => {
      if (!readSnapshot) throw new Error("RPC not registered");
      return readSnapshot(ids);
    },
    snapshots,
    performanceSnapshots,
    readPerformance: (ids: string[]) => {
      if (!readPerformance) throw new Error("Performance RPC not registered");
      return readPerformance(ids);
    },
    sessions,
    contexts,
    contextReads,
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
    set: async (key) => {
      if (key === "safety") writes++;
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
    set: async (key) => {
      if (key === "safety") writes++;
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

function storedUsage(
  id: string,
  at = Date.now() - 600000,
): SessionMessageAssistant {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { providerID: "local", id: "deepseek" },
    time: { created: at - 100, completed: at },
    tokens: {
      input: 140000,
      output: 99,
      reasoning: 3,
      cache: { read: 9000, write: 1000 },
    },
    content: [{ type: "text", text: "private transcript content" }],
  };
}

test("snapshot reads restore idle root and child usage once without admitting compaction", async () => {
  const f = fixture();
  f.add("root");
  f.add("child", "root");
  const root = f.sessions.get("root");
  if (!root) throw new Error("Missing fixture");
  delete root.model;
  const message = storedUsage("old");
  f.contexts.set("root", [message]);
  f.contexts.set("child", [message]);
  f.host.model.list = async () => ({
    location: { directory: "/test" },
    data: [
      {
        id: "deepseek",
        modelID: "deepseek",
        providerID: "local",
        name: "Synthetic",
        capabilities: { tools: false, input: ["text"], output: ["text"] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 200000, input: 180000, output: 8000 },
      },
    ],
  });
  const cleanup = await setup(f.host, f.sink);
  try {
    const [v1, v2] = await Promise.all([
      f.read(["root", "child"]),
      f.readPerformance(["child", "root"]),
    ]);
    for (const result of [v1, v2]) {
      if (!isPerformanceResult(result)) throw new Error("Invalid snapshot");
      expect(result.unavailable).toEqual([]);
      expect(result.upserts).toHaveLength(2);
      for (const row of result.upserts) {
        expect(row.measurement?.tokens).toBe(150000);
        expect(row.measurement?.at).toBe(message.time.completed);
        expect(row.capacityTokens).toBe(180000);
        expect(row.policy.reason).toBe("stale-usage");
        expect(row.compaction.phase).toBe("idle");
        expect(row.compaction.count).toBe(0);
      }
      expect(JSON.stringify(result)).not.toContain("private transcript");
    }
    expect(f.contextReads.sort()).toEqual(["child", "root"]);
    expect(f.calls).toHaveLength(0);
    expect(f.logs.some((event) => event.type === "would-compact")).toBe(false);
    f.step("child", 10000, "live");
    await until(() =>
      f.logs.some(
        (event) => event.session?.usage.current?.requestId === "live",
      ),
    );
    const updated = await f.read(["child"]);
    expect(isResult(updated) && updated.upserts[0]?.measurement?.tokens).toBe(
      10000,
    );
  } finally {
    await cleanup();
  }
});

test("recent stored usage above threshold remains observational on read", async () => {
  const f = fixture();
  f.add("root");
  f.contexts.set("root", [storedUsage("recent", Date.now() - 1000)]);
  const cleanup = await setup(f.host, f.sink);
  try {
    const result = await f.read(["root"]);
    expect(isResult(result) && result.upserts[0]?.policy.crossed).toBe(true);
    await Bun.sleep(150);
    expect(f.calls).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

test("bootstrap respects compaction and revert boundaries without reconstructing lifecycle", async () => {
  const f = fixture();
  for (const id of ["compacted", "continued", "reverted"]) f.add(id);
  const before = storedUsage("before");
  const after = { ...storedUsage("after"), tokens: { ...zero, input: 10000 } };
  const compaction: SessionMessageInfo = {
    type: "compaction",
    id: "compaction",
    status: "completed",
    reason: "manual",
    time: { created: Date.now() - 500000 },
    summary: "private summary",
    recent: "private recent",
  };
  f.contexts.set("compacted", [before, compaction]);
  f.contexts.set("continued", [before, compaction, after]);
  f.contexts.set("reverted", [before, after]);
  const reverted = f.sessions.get("reverted");
  if (!reverted) throw new Error("Missing fixture");
  reverted.revert = { messageID: "after" };
  const cleanup = await setup(f.host, f.sink);
  try {
    const result = await f.read(["compacted", "continued", "reverted"]);
    if (!isResult(result)) throw new Error("Invalid snapshot");
    expect(result.unavailable).toEqual([
      { sessionId: "compacted", reason: "not-monitored" },
    ]);
    expect(
      result.upserts.find((row) => row.sessionId === "continued")?.measurement
        ?.tokens,
    ).toBe(10000);
    expect(
      result.upserts.find((row) => row.sessionId === "reverted")?.measurement
        ?.tokens,
    ).toBe(150000);
    expect(result.upserts.every((row) => row.compaction.count === 0)).toBe(
      true,
    );
    expect(JSON.stringify(result)).not.toContain("private");
    expect(f.calls).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

test("snapshot bootstrap cannot refill usage invalidated by an observed compaction", async () => {
  const f = fixture();
  f.add("root");
  f.contexts.set("root", [storedUsage("before")]);
  const cleanup = await setup(f.host, f.sink);
  try {
    f.events.push({
      ...f.base("root"),
      type: "session.compaction.ended",
      data: {
        sessionID: "root",
        reason: "manual",
        model: { providerID: "local", id: "deepseek" },
        text: "summary",
        recent: "recent",
      },
    });
    await until(() =>
      f.logs.some((event) => event.type === "compaction.ended"),
    );
    const result = await f.read(["root"]);
    if (!isResult(result)) throw new Error("Invalid snapshot");
    expect(result.upserts[0]?.compaction.phase).toBe("awaiting-measurement");
    expect(result.upserts[0]?.measurement).toBeUndefined();
    expect(f.contextReads).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

test("usage bootstrap rejects zero, future, old-model, foreign and reverted context", async () => {
  const f = fixture();
  for (const id of [
    "zero",
    "future",
    "model",
    "foreign",
    "reverted",
    "failure",
  ]) {
    f.add(id);
    f.contexts.set(id, [storedUsage(id)]);
  }
  const zeroMessage = storedUsage("zero");
  if (zeroMessage.type !== "assistant") throw new Error("Expected assistant");
  f.contexts.set("zero", [{ ...zeroMessage, tokens: zero }]);
  f.contexts.set("future", [storedUsage("future", Date.now() + 60000)]);
  const model = f.sessions.get("model"),
    foreign = f.sessions.get("foreign"),
    reverted = f.sessions.get("reverted");
  if (!model || !foreign || !reverted) throw new Error("Missing fixture");
  model.model = { providerID: "other", id: "model" };
  foreign.location.directory = "/other";
  reverted.revert = { messageID: "unavailable-boundary" };
  const context = f.host.session.context;
  f.host.session.context = async (input, options) => {
    if (input.sessionID === "failure") throw new Error("private error");
    return context ? context(input, options) : [];
  };
  const cleanup = await setup(f.host, f.sink);
  try {
    const result = await f.read([...f.sessions.keys()]);
    if (!isResult(result)) throw new Error("Invalid snapshot");
    expect(result.upserts).toHaveLength(0);
    expect(result.unavailable).toHaveLength(6);
    expect(f.contextReads).not.toContain("foreign");
    await f.read([...f.sessions.keys()]);
    expect(f.contextReads).toHaveLength(4);
    expect(f.calls).toHaveLength(0);
  } finally {
    await cleanup();
  }
});

test("snapshots publish final scheduler state with telemetry disabled and expose stream suspension", async () => {
  const f = fixture();
  f.add("child", "parent");
  const cleanup = await setup(f.host, f.sink);
  try {
    f.step("child", 150000, "request");
    await until(() => f.calls.length === 1);
    const value = await f.read(["child", "unknown"]);
    if (!isResult(value)) throw new Error("Invalid service result");
    expect(value.upserts[0]?.compaction.phase).toBe("accepted");
    expect(value.upserts[0]?.measurement?.tokens).toBe(150000);
    expect(value.unavailable).toEqual([
      { sessionId: "unknown", reason: "not-monitored" },
    ]);
    expect(f.calls.length).toBe(1);
    await until(() =>
      f.snapshots.some((batch) =>
        batch.upserts.some((row) => row.compaction.phase === "accepted"),
      ),
    );
    f.events.end();
    await until(() =>
      f.logs.some((event) => event.type === "event-stream-gap"),
    );
    const gap = await f.read(["child"]);
    expect(isResult(gap) && gap.health.enforcement).toBe("suspended");
  } finally {
    await cleanup();
  }
});

test("a catalog populated after startup repairs resident capacity without admitting work until another observation", async () => {
  const f = fixture();
  f.host.options = {
    mode: "enforce",
    defaults: { threshold: { type: "ratio", value: 0.75 } },
    telemetry: { enabled: false },
  };
  let available = false,
    catalogReads = 0;
  f.host.model.list = async () => {
    catalogReads++;
    return {
      location: { directory: "/test" },
      data: available
        ? [
            {
              id: "deepseek",
              modelID: "deepseek",
              providerID: "local",
              name: "Synthetic",
              capabilities: { tools: false, input: ["text"], output: ["text"] },
              variants: [],
              time: { released: 0 },
              cost: [],
              status: "active",
              enabled: true,
              limit: { context: 136000, input: 128000, output: 8000 },
            },
          ]
        : [],
    };
  };
  f.add("root");
  const cleanup = await setup(f.host, f.sink);
  try {
    await until(() => catalogReads === 1);
    f.step("root", 96000, "first");
    await until(() => f.logs.some((event) => event.type === "usage"));
    expect(f.calls.length).toBe(0);
    available = true;
    let capacity: number | undefined;
    for (let attempt = 0; attempt < 250; attempt++) {
      const value = await f.read(["root"]);
      if (isResult(value)) capacity = value.upserts[0]?.capacityTokens;
      if (capacity !== undefined) break;
      await Bun.sleep(10);
    }
    expect(capacity).toBe(128000);
    expect(catalogReads).toBe(2);
    expect(f.calls.length).toBe(0);
    f.step("root", 96000, "second");
    await until(() => f.calls.length === 1);
  } finally {
    await cleanup();
  }
});

test("streaming metrics reconcile per child, avoid delta metadata reads and keep v1 rows unchanged", async () => {
  const f = fixture("observe");
  f.add("child", "parent");
  f.add("sibling", "parent");
  let gets = 0,
    writes = 0;
  const get = f.host.session.get,
    set = f.host.storage.set;
  f.host.session.get = async (...args) => {
    gets++;
    return get(...args);
  };
  f.host.storage = {
    get: f.host.storage.get,
    set: async (...args) => {
      writes++;
      return set(...args);
    },
  };
  const stop = await setup(f.host, f.sink);
  try {
    const started = Date.now() - 1000;
    for (const id of ["child", "sibling"])
      f.events.push({
        ...f.base(id),
        type: "session.step.started",
        data: {
          sessionID: id,
          assistantMessageID: id,
          agent: "build",
          model: { providerID: "local", id: "deepseek" },
          started,
        },
      });
    await until(
      () => f.logs.filter((e) => e.type === "session-state").length >= 2,
    );
    const before = gets,
      beforeWrites = writes;
    const delta = {
      id: "delta",
      created: started + 200,
      location: { directory: "/test" },
      type: "session.reasoning.delta" as const,
      data: {
        sessionID: "child",
        assistantMessageID: "child",
        ordinal: 0,
        delta: "SECRET THOUGHT",
      },
    };
    f.events.push(delta);
    f.events.push(delta);
    f.events.push({
      ...delta,
      id: "foreign",
      location: { directory: "/foreign" },
    });
    await Bun.sleep(30);
    expect(gets).toBe(before);
    expect(writes).toBe(beforeWrites);
    const live = await f.readPerformance(["child", "sibling"]);
    expect(isPerformanceResult(live)).toBe(true);
    if (!isPerformanceResult(live)) throw new Error("Invalid v2");
    const child = live.upserts.find(
      (r) => r.sessionId === "child",
    )?.performance;
    expect(child).toMatchObject({
      ttftMs: 200,
      estimatedOutputTokens: "SECRET THOUGHT".length / 4,
      status: "streaming",
    });
    expect(
      live.upserts.find((r) => r.sessionId === "sibling")?.performance
        ?.estimatedOutputTokens,
    ).toBe(0);
    expect(JSON.stringify(live)).not.toContain("SECRET");
    const old = await f.read(["child"]);
    expect(isResult(old)).toBe(true);
    if (!isResult(old)) throw new Error("Invalid v1");
    expect(old.upserts[0]).not.toHaveProperty("performance");
    f.events.push({
      ...f.base("child"),
      created: started + 1000,
      type: "session.step.streamed",
      data: { sessionID: "child", assistantMessageID: "child" },
    });
    f.events.push({
      ...f.base("child"),
      created: started + 9000,
      type: "session.step.ended",
      data: {
        sessionID: "child",
        assistantMessageID: "child",
        finish: "stop",
        cost: 0,
        tokens: { ...zero, input: 100, output: 60, reasoning: 40 },
      },
    });
    await until(() =>
      f.logs.some((e) => e.session?.usage.current?.requestId === "child"),
    );
    const ended = await f.readPerformance(["child"]);
    if (!isPerformanceResult(ended)) throw new Error("Invalid ended v2");
    expect(ended.upserts[0]?.performance).toMatchObject({
      averageModelTps: 100,
      latestRequestTps: 100,
      modelDurationMs: 1000,
      modelOutputTokens: 100,
      completedRequests: 1,
      tokenSource: "reported",
      liveTps: 0,
    });
  } finally {
    await stop();
  }
});

test("performance checkpoints restore aggregates independently of safety storage", async () => {
  const f = fixture("observe");
  f.add("root");
  let stop = await setup(f.host, f.sink);
  const started = Date.now() - 2000;
  f.events.push({
    ...f.base("root"),
    type: "session.step.started",
    data: {
      sessionID: "root",
      assistantMessageID: "r",
      agent: "build",
      model: { providerID: "local", id: "deepseek" },
      started,
    },
  });
  f.events.push({
    ...f.base("root"),
    created: started + 1000,
    type: "session.step.streamed",
    data: { sessionID: "root", assistantMessageID: "r" },
  });
  f.events.push({
    ...f.base("root"),
    type: "session.step.ended",
    data: {
      sessionID: "root",
      assistantMessageID: "r",
      finish: "stop",
      cost: 0,
      tokens: { ...zero, input: 100, output: 50 },
    },
  });
  await until(() =>
    f.logs.some((e) => e.session?.usage.current?.requestId === "r"),
  );
  await stop();
  stop = await setup(f.host, f.sink);
  try {
    f.events.push({
      ...f.base("root"),
      type: "session.execution.started",
      data: { sessionID: "root" },
    });
    await until(() =>
      f.performanceSnapshots.some((b) =>
        b.upserts.some((r) => r.performance?.partial),
      ),
    );
    const restored = await f.readPerformance(["root"]);
    if (!isPerformanceResult(restored)) throw new Error("Invalid restored v2");
    expect(restored.upserts[0]?.performance).toMatchObject({
      averageModelTps: 50,
      partial: true,
      completedRequests: 1,
    });
  } finally {
    await stop();
  }
});
