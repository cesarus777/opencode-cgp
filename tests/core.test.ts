import { parseConfigFileTextToJson } from "typescript";
import { describe, test, expect } from "bun:test";
import {
  parseConfig,
  PolicyResolver,
  evaluateThreshold,
  usableInput,
  glob,
  ContextMonitor,
  CompactionScheduler,
  NoopBudgetController,
  promptTokens,
  estimate,
  type Measurement,
  type TelemetryEvent,
  type Config,
} from "../src/core.ts";
import { decodeRecovery, encodeRecovery } from "../src/recovery.ts";
const model = "local/deepseek";
const limits = { context: 500000, input: 450000, output: 50000 };
const metric = (tokens: number, at = 1000): Measurement => ({
  tokens,
  at,
  model,
  provenance: "provider-normalized",
  confidence: "reported",
  scope: "completed-request",
});
const tokens = {
  input: 100,
  output: 20,
  reasoning: 30,
  cache: { read: 400, write: 50 },
};
function harness(options: unknown = { mode: "enforce" }, fail = false) {
  let now = 1000,
    serial = 0;
  const calls: string[] = [],
    events: TelemetryEvent[] = [];
  const config = parseConfig(options),
    sink = { emit: (e: TelemetryEvent) => events.push(structuredClone(e)) };
  const scheduler = new CompactionScheduler(
    config,
    {
      compact: async (id) => {
        calls.push(id);
        if (fail) throw new Error("ambiguous transport error");
      },
    },
    sink,
    () => now,
    () => `msg_${++serial}`,
  );
  const monitor = new ContextMonitor(config, scheduler, sink, () => now);
  const session = (id = "main", parentId?: string) => {
    const s = monitor.touch(
      {
        sessionId: id,
        model,
        agent: "build",
        ...(parentId ? { parentId } : {}),
      },
      limits,
    );
    if (!s) throw new Error("capacity");
    s.active = true;
    return s;
  };
  return {
    config,
    scheduler,
    monitor,
    session,
    calls,
    events,
    time: (n: number) => {
      now = n;
    },
  };
}
describe("configuration and deterministic policy", () => {
  test("conservative defaults", () => {
    expect(parseConfig().mode).toBe("observe");
    expect(parseConfig().defaults.threshold.value).toBe(131072);
  });
  for (const value of [
    null,
    [],
    { unknown: 1 },
    { mode: "force" },
    { defaults: { extra: 1 } },
    { safety: { cooldownMs: -1 } },
    { telemetry: { jsonl: false, path: "/tmp/x" } },
    { policies: [{ match: {}, threshold: { type: "tokens", value: 10 } }] },
    ...[0, -1, NaN, Infinity, 1.1].map((value) => ({
      defaults: { threshold: { type: "tokens", value } },
    })),
    { defaults: { threshold: { type: "ratio", value: 1.1 } } },
    {
      policies: [
        {
          match: { model: "deepseek" },
          threshold: { type: "tokens", value: 100 },
        },
      ],
    },
  ]) {
    test(`rejects invalid options ${JSON.stringify(value)}`, () =>
      expect(() => parseConfig(value)).toThrow());
  }
  test("last matching policy wins; selectors are ANDed", () => {
    const r = new PolicyResolver(
      parseConfig({
        safety: { minReclaimTokens: 1 },
        policies: [
          {
            match: { role: "subagent" },
            threshold: { type: "tokens", value: 100 },
          },
          {
            match: { model: "local/deepseek*" },
            threshold: { type: "ratio", value: 0.25 },
          },
          {
            match: { agent: "reviewer", role: "subagent" },
            threshold: { type: "tokens", value: 70 },
          },
        ],
      }),
    );
    expect(
      r.resolve({ sessionId: "a", parentId: "p", model, agent: "reviewer" })
        .policy,
    ).toBe("policies[2]");
    expect(r.resolve({ sessionId: "a", model, agent: "reviewer" }).policy).toBe(
      "policies[1]",
    );
    expect(
      r.resolve({ sessionId: "a", parentId: "p", model: "other/model" })
        .threshold.value,
    ).toBe(100);
    expect(r.resolve({ sessionId: "a" }).policy).toBe("defaults");
  });
  test("glob metacharacters are literal except star and question", () => {
    expect(glob("a.b/*?", "a.b/model")).toBe(true);
    expect(glob("a.b/*", "axb/model")).toBe(false);
  });
});
describe("thresholds and usage", () => {
  test("input and reserved context constrain capacity without mutation", () => {
    const frozen = Object.freeze(limits);
    expect(usableInput(frozen)).toBe(450000);
    expect(usableInput({ context: 100, input: 90, output: 20 })).toBe(80);
    expect(usableInput({ context: 0, input: 90, output: 20 })).toBe(90);
    expect(usableInput({ context: 100, output: 0 })).toBeUndefined();
    expect(usableInput(undefined)).toBeUndefined();
    expect(usableInput(limits, 100000)).toBe(400000);
  });
  test.each([
    ["tokens", 100, 100, true],
    ["ratio", 0.25, 112500, true],
    ["remaining", 32768, 417232, false],
    ["remaining", 32768, 417233, true],
  ] as const)("%s boundary", (type, value, used, crossed) => {
    expect(
      evaluateThreshold(
        { type, value },
        metric(used),
        limits,
        1000,
        500,
        model,
        "test",
      ).crossed,
    ).toBe(crossed);
  });
  test("absolute works with missing limits; relative abstains", () => {
    expect(
      evaluateThreshold(
        { type: "tokens", value: 100 },
        metric(100),
        undefined,
        1000,
        500,
        model,
        "p",
      ).crossed,
    ).toBe(true);
    expect(
      evaluateThreshold(
        { type: "ratio", value: 0.5 },
        metric(100),
        undefined,
        1000,
        500,
        model,
        "p",
      ).reason,
    ).toBe("missing-model-budget");
  });
  test("invalid relative budget, stale metrics, and model switching abstain", () => {
    expect(
      evaluateThreshold(
        { type: "remaining", value: 500000 },
        metric(100),
        limits,
        1000,
        500,
        model,
        "p",
      ).reason,
    ).toBe("incompatible-model-budget");
    expect(
      evaluateThreshold(
        { type: "tokens", value: 100 },
        metric(100),
        limits,
        2000,
        500,
        model,
        "p",
      ).reason,
    ).toBe("stale-usage");
    expect(
      evaluateThreshold(
        { type: "tokens", value: 100 },
        metric(100),
        limits,
        1000,
        500,
        "other/model",
        "p",
      ).reason,
    ).toBe("model-changed");
  });
  test("normalized prompt includes both cache categories, excludes output and reasoning", () => {
    expect(promptTokens(tokens)).toBe(550);
    expect(promptTokens({ ...tokens, input: -1 })).toBeUndefined();
    expect(
      promptTokens({
        input: 0,
        output: 0,
        reasoning: 0,
        cache: { read: 0, write: 0 },
      }),
    ).toBeUndefined();
  });
  test("fallback bounded and binary unsupported", () => {
    expect(estimate("abcdef")).toBe(2);
    expect(estimate("abcdef", 3)).toBeUndefined();
    expect(estimate(new Uint8Array(3))).toBeUndefined();
  });
  test("current prompt and cumulative totals are independent; model switch invalidates prompt", () => {
    const h = harness(),
      s = h.session();
    h.monitor.measure(s, metric(100), { ...tokens, input: 999999 });
    expect(s.usage.current?.tokens).toBe(100);
    expect(s.usage.cumulative?.input).toBe(999999);
    h.monitor.touch({ sessionId: s.sessionId, model: "other/model" });
    expect(s.usage.current).toBeUndefined();
    expect(s.limits).toBeUndefined();
  });
});
describe("lifecycle safety", () => {
  test("observe never admits requests", async () => {
    const h = harness({ mode: "observe" });
    h.monitor.measure(h.session(), metric(200000));
    await h.scheduler.flush();
    expect(h.calls).toEqual([]);
    expect(h.events.some((e) => e.type === "would-compact")).toBe(true);
  });
  test("deduplicates concurrent decisions; acceptance is not completion", async () => {
    const h = harness(),
      s = h.session();
    for (let n = 0; n < 10; n++) h.monitor.measure(s, metric(200000));
    await h.scheduler.flush();
    expect(h.calls).toEqual(["main"]);
    expect(s.compaction.phase).toBe("accepted");
    expect(s.compaction.count).toBe(0);
  });
  test("children independently compact while active", async () => {
    const h = harness();
    for (let n = 0; n < 8; n++)
      h.monitor.measure(h.session(`child${n}`, "parent"), metric(200000));
    await h.scheduler.flush();
    expect(h.calls.length).toBe(8);
    expect([...h.monitor.sessions.values()].every((s) => s.active)).toBe(true);
  });
  test("completion, fresh measurement, cooldown and hysteresis", async () => {
    const h = harness(),
      s = h.session();
    h.monitor.measure(s, metric(200000));
    await h.scheduler.flush();
    h.scheduler.lifecycle(s, "started", 1100);
    h.scheduler.lifecycle(s, "ended", 1200);
    expect(s.compaction.phase).toBe("awaiting-measurement");
    expect(s.compaction.count).toBe(1);
    h.time(1300);
    h.monitor.measure(s, metric(50000, 1300));
    expect(s.compaction.phase).toBe("idle");
    h.time(1400);
    h.monitor.measure(s, metric(200000, 1400));
    await h.scheduler.flush();
    expect(h.calls.length).toBe(1);
    h.time(62000);
    h.monitor.measure(s, metric(200000, 62000));
    await h.scheduler.flush();
    expect(h.calls.length).toBe(2);
  });
  test("insufficient reclaim blocks repeated summaries", async () => {
    const h = harness(),
      s = h.session();
    h.monitor.measure(s, metric(200000));
    await h.scheduler.flush();
    h.scheduler.lifecycle(s, "ended", 1100);
    h.time(62000);
    h.monitor.measure(s, metric(199000, 62000));
    await h.scheduler.flush();
    expect(h.calls.length).toBe(1);
    expect(s.compaction.blockedReason).toBe("insufficient-reclaim");
  });
  test("explicit failure retries only after cooldown and fresh metrics; circuit breaker", async () => {
    const h = harness({
        mode: "enforce",
        safety: { maxConsecutiveFailures: 2, cooldownMs: 10 },
      }),
      s = h.session();
    h.monitor.measure(s, metric(200000));
    await h.scheduler.flush();
    h.scheduler.lifecycle(s, "failed", 1000);
    h.time(1011);
    h.monitor.measure(s, metric(200000, 1011));
    await h.scheduler.flush();
    h.scheduler.lifecycle(s, "failed", 1011);
    h.time(2000);
    h.monitor.measure(s, metric(200000, 2000));
    await h.scheduler.flush();
    expect(h.calls.length).toBe(2);
    expect(s.compaction.phase).toBe("blocked");
  });
  test("ambiguous admission and completion timeout never auto-retry", async () => {
    const h = harness({ mode: "enforce" }, true),
      s = h.session();
    h.monitor.measure(s, metric(200000));
    await h.scheduler.flush();
    expect(s.compaction.phase).toBe("uncertain");
    h.time(1000000);
    h.monitor.measure(s, metric(200000, 1000000));
    await h.scheduler.flush();
    expect(h.calls.length).toBe(1);
    const h2 = harness(),
      s2 = h2.session();
    h2.monitor.measure(s2, metric(200000));
    await h2.scheduler.flush();
    h2.time(400000);
    h2.scheduler.tick(s2);
    expect(s2.compaction.phase).toBe("uncertain");
  });
  test("completion arriving before admission response is preserved", async () => {
    const config = parseConfig({ mode: "enforce" });
    let s: ReturnType<ContextMonitor["touch"]>;
    const sink = { emit() {} };
    const scheduler = new CompactionScheduler(
      config,
      {
        compact: async () => {
          if (s) scheduler.lifecycle(s, "ended", 1000);
        },
      },
      sink,
      () => 1000,
    );
    const monitor = new ContextMonitor(config, scheduler, sink, () => 1000);
    s = monitor.touch({ sessionId: "x", model }, limits);
    if (!s) throw new Error();
    monitor.measure(s, metric(200000));
    await scheduler.flush();
    expect(s.compaction.phase).toBe("awaiting-measurement");
  });
  test("duplicates, cleanup, capacity and deletion before dispatch", async () => {
    const h = harness({
        mode: "enforce",
        safety: { maxSessions: 1, sessionTtlMs: 10 },
      }),
      s = h.session();
    expect(h.monitor.accept(s, 10)).toBe(true);
    expect(h.monitor.accept(s, 10)).toBe(false);
    expect(h.monitor.touch({ sessionId: "second" })).toBeUndefined();
    s.active = false;
    h.time(1011);
    h.monitor.cleanup();
    expect(h.monitor.sessions.size).toBe(0);
    const next = h.session();
    h.monitor.measure(next, metric(200000, 1011));
    h.monitor.remove(next.sessionId);
    await h.scheduler.flush();
    expect(h.calls.length).toBe(0);
  });
  test("restart preserves cooldown and treats unresolved work as uncertain", () => {
    const h = harness(),
      s = h.session();
    h.monitor.measure(s, metric(200000));
    const saved = encodeRecovery([
      { sessionId: s.sessionId, compaction: s.compaction },
    ]);
    expect(decodeRecovery(saved, 10)[0]?.compaction.phase).toBe("uncertain");
    expect(decodeRecovery(saved, 10)[0]?.compaction.lastAttempt).toBe(1000);
    h.scheduler.stop();
    expect(decodeRecovery([{ sessionId: "x", compaction: {} }], 10)).toEqual(
      [],
    );
  });
  test("noop budget does not mutate state", () => {
    const h = harness(),
      s = h.session(),
      before = structuredClone(s);
    expect(
      new NoopBudgetController().evaluate({
        session: s,
        now: 1000,
        elapsedMs: 0,
      }),
    ).toEqual({ type: "continue" });
    expect(s).toEqual(before);
  });
});
test("estimated baseline cannot establish reported token reclaim", async () => {
  const h = harness(),
    s = h.session();
  h.monitor.measure(s, {
    ...metric(200000),
    confidence: "approximate",
    provenance: "serialized-estimate",
    scope: "prepared-request",
  });
  await h.scheduler.flush();
  h.scheduler.lifecycle(s, "ended", 1100);
  h.time(1200);
  h.monitor.measure(s, metric(180000, 1200));
  expect(s.compaction.blockedReason).toBe("reclaim-unverifiable");
});
test("sample plugin options pass the actual runtime validator", async () => {
  const sample = await Bun.file("examples/opencode.jsonc").text();
  const result = parseConfigFileTextToJson("opencode.jsonc", sample);
  if (result.error) throw new Error("Invalid JSONC example");
  const parsed: unknown = result.config;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("plugins" in parsed) ||
    !Array.isArray(parsed.plugins)
  )
    throw new Error("Invalid example");
  expect(parseConfig(parsed.plugins[0].options).mode).toBe("observe");
});
