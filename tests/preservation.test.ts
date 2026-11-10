import { test, expect } from "bun:test";
import {
  constructCheckpoint,
  selectProtected,
  transcriptLimit,
} from "../src/preservation.ts";
import {
  checkpointResult,
  readCheckpoint,
  assembledText,
} from "../src/checkpoint.ts";
import { captureTarget, verifyTokens } from "../src/verification.ts";
import { parseConfig } from "../src/config.ts";
import { encodeRecovery, decodeRecovery } from "../src/recovery.ts";
import { project } from "../src/snapshot.ts";
import { isResult } from "../src/rpc.ts";
import type { CompactionVerification, SessionState } from "../src/types.ts";
const user = (id: string, text: string) => ({ id, type: "user", text });
const answer = (id: string, text: string, complete = true) => ({
  id,
  type: "assistant",
  text,
  complete,
});
const source = () =>
  selectProtected([
    user("u1", "Original\n请求🙂"),
    answer("a1", "one"),
    user("u2", "Latest\n<<<Guard:test>>>"),
    answer("a2", "Answer\nαβ"),
  ]);
function verification(): CompactionVerification {
  return {
    completionId: "end1",
    completedAt: 20,
    tokens: "pending",
    protection: "pending",
    warnings: [],
    target: 100,
    comparison: ">=",
    model: "p/m",
  };
}
function state(): SessionState {
  return {
    sessionId: "s",
    model: "p/m",
    lastSeen: 30,
    sequence: 1,
    active: false,
    limits: { context: 200, input: 150, output: 10 },
    usage: {
      cumulativeScope: "unknown",
      peak: 0,
      modelRequests: 0,
      toolCalls: 0,
      countersSince: 0,
    },
    compaction: {
      phase: "idle",
      count: 1,
      failures: 0,
      consecutiveFailures: 0,
      armed: false,
      verification: verification(),
    },
  };
}
test("preservation defaults on and has a strict opt-out", () => {
  expect(parseConfig().compaction.preserve.enabled).toBe(true);
  expect(
    parseConfig({ compaction: { preserve: { enabled: false } } }).compaction
      .preserve.enabled,
  ).toBe(false);
  expect(() =>
    parseConfig({ compaction: { preserve: { enabled: "yes" } } }),
  ).toThrow();
});
test("exact Unicode multiline sections and delimiter collisions survive native metadata roundtrip", () => {
  const s = source(),
    c = constructCheckpoint(s, "Middle", "test");
  expect(c.text).toContain("<<<Guard:test>>>_");
  const result = checkpointResult(s, "Middle", "test");
  expect(readCheckpoint(result.summary, result.metadata)).toEqual({
    originalId: s.originalId,
    original: s.original,
    middle: "Middle",
    latest: s.latest,
  });
  expect(
    readCheckpoint(result.summary.replace("请求", "changed"), result.metadata),
  ).toBeUndefined();
});
test("repeated compaction carries the middle and moves the previous latest once", () => {
  const s = source(),
    cp = {
      originalId: s.originalId,
      original: s.original,
      middle: "Old middle",
      latest: s.latest,
    };
  const next = selectProtected([
    { id: "cp", type: "compaction", text: "native summary", checkpoint: cp },
    user("u3", "new"),
    answer("a3", "new answer"),
  ]);
  expect(next.original).toBe(s.original);
  expect(next.middle).toBe(`Old middle\n\n${s.latest}`);
  expect(next.latest).toBe("User:\nnew\n\nAssistant:\nnew answer");
  const again = selectProtected([
    { id: "cp", type: "compaction", checkpoint: cp },
  ]);
  expect(again.middle).toBe("Old middle");
  expect(again.latest).toBe(s.latest);
});
test("overlapping first/latest, pending tool work, and revert boundaries", () => {
  const history = [
    user("u1", "original"),
    answer("a1", "done"),
    user("u2", "pending"),
    answer("tool", "tool call", false),
  ];
  const s = selectProtected(history);
  expect(s.original).toBe("original");
  expect(s.latest).toBe("User:\noriginal\n\nAssistant:\ndone");
  expect(s.middle).toContain("pending");
  expect(selectProtected(history, "u2").middle).toBe("");
  expect(() => selectProtected(history, "missing")).toThrow();
});
test("unavailable history, opaque history, untrusted summaries and oversized input fail closed", () => {
  expect(() => selectProtected([])).toThrow();
  expect(() =>
    selectProtected([
      { id: "cp", type: "compaction", complete: true },
      user("u", "recent"),
      answer("a", "done"),
    ]),
  ).toThrow();
  expect(() =>
    selectProtected([
      user("u", "x"),
      answer("a", "y"),
      { id: "cp", type: "compaction", opaque: true },
    ]),
  ).toThrow();
  expect(() =>
    selectProtected([user("u", "x".repeat(transcriptLimit)), answer("a", "y")]),
  ).toThrow();
  expect(() => constructCheckpoint(source(), " \n", "id")).toThrow();
});
test("assembled comparisons inspect text rather than JSON escaping or reasoning", () => {
  expect(
    assembledText([
      {
        role: "user",
        content: [
          { type: "text", text: "a\n🙂" },
          { type: "reasoning", text: "private" },
        ],
      },
    ]),
  ).toEqual(["a\n🙂"]);
});
for (const type of ["tokens", "ratio", "remaining"] as const)
  test(`${type} target uses captured threshold and exact comparison semantics`, () => {
    const s = state(),
      config = parseConfig({
        defaults: {
          threshold: {
            type,
            value: type === "ratio" ? 0.5 : type === "tokens" ? 100 : 50,
          },
        },
        safety: { minReclaimTokens: 1 },
      });
    const target = captureTarget(s, config);
    for (const delta of [-1, 0, 1]) {
      const v = { ...verification(), ...target };
      verifyTokens(v, {
        started: 21,
        at: 30,
        now: 30,
        staleMs: 100,
        model: "p/m",
        tokens: (target.target ?? 0) + delta,
      });
      expect(v.tokens).toBe(
        delta > 0 || (delta === 0 && type !== "remaining")
          ? "failed"
          : "verified",
      );
    }
  });
test("missing usage, model switches, stale data, and missing starts never confirm success", () => {
  for (const patch of [
    { tokens: undefined },
    { model: "p/new" },
    { now: 1000 },
    { started: undefined },
  ]) {
    const v = verification();
    const input = {
      started: 21,
      at: 30,
      now: 30,
      staleMs: 10,
      model: "p/m",
      tokens: 1,
      ...patch,
    };
    verifyTokens(v, {
      at: input.at,
      now: input.now,
      staleMs: input.staleMs,
      model: input.model,
      ...(input.started === undefined ? {} : { started: input.started }),
      ...(input.tokens === undefined ? {} : { tokens: input.tokens }),
    });
    expect(v.tokens).toBe("unverified");
  }
  const v = verification();
  verifyTokens(v, {
    started: 19,
    at: 30,
    now: 30,
    staleMs: 100,
    model: "p/m",
    tokens: 1,
  });
  expect(v.tokens).toBe("pending");
});
test("restart retains warnings and makes pending checks unverified; scalar snapshots accept optional verification", () => {
  const s = state();
  const rows = decodeRecovery(
    encodeRecovery([{ sessionId: "s", compaction: s.compaction }]),
    10,
  );
  expect(rows[0]?.compaction.verification?.tokens).toBe("unverified");
  expect(rows[0]?.compaction.verification?.warnings).toContain(
    "verification-unverified",
  );
  const row = project(s, parseConfig(), 30);
  expect(
    isResult({
      schemaVersion: 1,
      epoch: "e",
      sequence: 1,
      generatedAt: 30,
      health: {
        enabled: true,
        mode: "observe",
        enforcement: "observing",
        reasons: [],
        staleMs: 100,
        maxSessions: 10,
      },
      upserts: [row],
      removed: [],
      unavailable: [],
    }),
  ).toBe(true);
  expect(JSON.stringify(row)).not.toContain("Original");
  expect(Object.isFrozen(row.compaction.verification?.warnings)).toBe(true);
});

test("all Guard formats retain warnings in narrow layouts and show unavailable verification explicitly", async () => {
  const { sidebarFamily } = await import("./fixtures/sidebar.ts");
  const { mainLines } = await import("../src/tui/compactformat.ts");
  const { panelRowLines } = await import("../src/tui/panelformat.ts");
  const { detailLines, cells } = await import("../src/tui/format.ts");
  const { terminalDetail, overviewRowLines } = await import(
    "../src/dashboard/terminalview.ts"
  );
  const base = sidebarFamily()[0];
  if (!base?.snapshot) throw new Error("Missing fixture");
  const row = {
    ...base,
    snapshot: {
      ...base.snapshot,
      compaction: {
        ...base.snapshot.compaction,
        verification: {
          ...verification(),
          protection: "failed" as const,
          tokens: "failed" as const,
          measuredTokens: 140000,
          warnings: [
            "protected-text-changed",
            "token-target-exceeded",
            "preservation-fallback",
          ] as const,
        },
      },
    },
  };
  for (const width of [20, 35, 80]) {
    const sidebar = mainLines(row, width, 0);
    expect(sidebar.join(" ")).toContain("Protected text");
    expect(sidebar.every((line) => cells(line) <= width)).toBe(true);
    expect(panelRowLines(row, width, true).join(" ")).toContain(
      "Protected text",
    );
  }
  const dashboardRow = {
    ...row,
    inventoryStale: false,
    liveStale: false,
    performanceFreshness: "missing" as const,
    performanceAvailable: false,
    measurementAgeMs: 0,
  };
  expect(terminalDetail(dashboardRow).join("\n")).toContain(
    "compaction.verification.measuredTokens: 140000",
  );
  expect(
    overviewRowLines(dashboardRow, 35, true, "root", 1).join(" "),
  ).toContain("Protected text");
  expect(detailLines(base, 80).join(" ")).toContain("protection unavailable");
});

test("a first unfinished tool turn preserves the original without inventing a complete exchange", () => {
  const s = selectProtected([
    user("u", "Original active request"),
    answer("a", "incomplete tool", false),
  ]);
  expect(s.original).toBe("Original active request");
  expect(s.latest).toBe("");
  expect(s.middle).toContain("incomplete tool");
});
