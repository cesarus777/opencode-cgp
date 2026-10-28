import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { aggregateModels } from "../src/modelanalytics.ts";
import type { HistoryRecord } from "../src/history.ts";
import type { PerformanceSnapshot } from "../src/performance.ts";

function request(
  id: string,
  changes: Partial<PerformanceSnapshot> = {},
  record: Partial<HistoryRecord> = {},
): HistoryRecord {
  return {
    schema: 1,
    recordId: id,
    type: "request",
    sessionId: "root",
    time: 9000,
    model: "p/current-model",
    ...record,
    performance: {
      sessionCreatedAt: 0,
      observedSince: 1000,
      at: 9000,
      status: "idle",
      partial: false,
      estimatedOutputTokens: 99999,
      modelOutputTokens: 88888,
      modelDurationMs: 99999,
      completedRequests: 50,
      tokenSource: "reported",
      requestId: id,
      requestModel: "p/a",
      requestAgent: "build",
      requestStartedAt: 1000,
      streamEndedAt: 2000,
      requestOutputTokens: 100,
      ttftMs: 100,
      ...changes,
    },
  };
}
const options = { location: "/location" };

test("model summaries weight request durations across sessions and compute exact TTFT statistics", () => {
  const records = [
    request("a"),
    request(
      "b",
      { streamEndedAt: 4000, requestOutputTokens: 30, ttftMs: 300 },
      { sessionId: "child" },
    ),
    request("c", { requestModel: "p/b", requestOutputTokens: 200 }),
  ];
  const result = aggregateModels(records, options);
  expect(result.models[0]).toMatchObject({
    model: "p/a",
    sessions: 2,
    completedRequests: 2,
    tpsRequests: 2,
    ttftRequests: 2,
    outputTokens: 130,
    durationMs: 4000,
    averageTps: 32.5,
    meanTtftMs: 200,
    medianTtftMs: 200,
    p95TtftMs: 300,
  });
  expect(result.models[1]?.averageTps).toBe(200);
  expect(result.coverage.partial).toBe(false);
  expect(result.models.some((row) => row.model === "p/current-model")).toBe(
    false,
  );
});

test("duplicate facts reconcile without order dependence and conflicts exclude one identity", () => {
  const a = request("a");
  const missing = request("a", { tokenSource: "unavailable" });
  const duplicate = request("a", {}, { recordId: "duplicate" });
  const conflict = request("bad", { requestOutputTokens: 200 });
  const records = [a, missing, duplicate, request("bad"), conflict];
  const result = aggregateModels(records, options);
  expect(result.models[0]?.completedRequests).toBe(1);
  expect(result.models[0]?.outputTokens).toBe(100);
  expect(result.coverage).toMatchObject({
    duplicateRecords: 3,
    conflictingRequests: 1,
    partial: true,
  });
  expect(aggregateModels([...records].reverse(), options)).toEqual(result);
});

test("completion-time windows are half open and attribution uses each request model and agent", () => {
  const result = aggregateModels(
    [
      request("before", { streamEndedAt: 1999 }),
      request("included", { streamEndedAt: 2000 }),
      request("end", { streamEndedAt: 3000 }),
      request("other", { requestModel: "p/b" }),
      request("agent", { requestAgent: "explore" }),
    ],
    { ...options, from: 2000, to: 3000, model: "p/a", agent: "build" },
  );
  expect(result.models[0]?.completedRequests).toBe(1);
  expect(result.models[0]?.outputTokens).toBe(100);
});

test("incomplete, invalid, tool-only and estimated requests keep independent denominators", () => {
  const waiting = request("waiting");
  if (!waiting.performance) throw new Error("Missing fixture");
  const { streamEndedAt: _ended, ...waitingPerformance } = waiting.performance;
  const tool = request("tool");
  if (!tool.performance) throw new Error("Missing fixture");
  const { ttftMs: _ttft, ...toolPerformance } = tool.performance;
  const result = aggregateModels(
    [
      { ...waiting, performance: waitingPerformance },
      request("invalid", { streamEndedAt: 1000 }),
      { ...tool, performance: toolPerformance },
      request("estimate", { tokenSource: "estimated", partial: true }),
      request("zero", { requestOutputTokens: 0, ttftMs: 0 }),
      request("badttft", { ttftMs: 2000 }),
    ],
    options,
  );
  expect(result.models[0]).toMatchObject({
    completedRequests: 4,
    tpsRequests: 3,
    ttftRequests: 2,
    partialRequests: 1,
    excludedTpsRequests: 1,
    excludedTtftRequests: 2,
    outputTokens: 200,
    durationMs: 3000,
    meanTtftMs: 50,
    medianTtftMs: 50,
    p95TtftMs: 100,
  });
  expect(result.coverage).toMatchObject({
    incompleteRequests: 1,
    invalidTimingRequests: 1,
    partial: true,
  });
});

test("legacy and unknown model attribution remain separate and session totals never enter analytics", () => {
  const legacy = request("legacy");
  if (!legacy.performance) throw new Error("Missing fixture");
  const { requestModel: _model, ...performance } = legacy.performance;
  const unknown: HistoryRecord = {
    ...legacy,
    sessionId: "other",
    model: "",
    performance,
  };
  const result = aggregateModels(
    [
      { ...legacy, performance },
      unknown,
      request("sample", {}, { type: "sample" }),
    ],
    options,
  );
  expect(result.models).toHaveLength(2);
  expect(result.models[0]?.model).toBeUndefined();
  expect(result.models[1]).toMatchObject({
    model: "p/current-model",
    legacyAttributionRequests: 1,
    outputTokens: 100,
  });
  expect(result.coverage.partial).toBe(true);
  expect(aggregateModels([], options).models).toEqual([]);
});

test("analytics includes more than 500 requests and 128 sessions without chart downsampling", () => {
  const records = Array.from({ length: 1200 }, (_, i) =>
    request(String(i), {}, { sessionId: `s${i}` }),
  );
  const result = aggregateModels(records, options);
  expect(result.models[0]).toMatchObject({
    completedRequests: 1200,
    sessions: 1200,
    averageTps: 100,
  });
  expect(result.coverage.partial).toBe(false);
  const limited = aggregateModels(records, { ...options, maxRequests: 500 });
  expect(limited.models[0]?.completedRequests).toBe(500);
  expect(limited.coverage).toMatchObject({
    scannedRecords: 500,
    unscannedRecords: 700,
    partial: true,
  });
});

test("TTFT percentiles use nearest rank and estimates never supply missing reported tokens", () => {
  const records = Array.from({ length: 20 }, (_, i) =>
    request(String(i), {
      ttftMs: (i + 1) * 10,
      tokenSource: "estimated",
    }),
  );
  const result = aggregateModels(records, options);
  expect(result.models[0]).toMatchObject({
    tpsRequests: 0,
    excludedTpsRequests: 20,
    ttftRequests: 20,
    meanTtftMs: 105,
    medianTtftMs: 105,
    p95TtftMs: 190,
  });
  expect(result.models[0]?.averageTps).toBeUndefined();
});

test("conflicting timing or model facts are excluded and arbitrary input fields never reach summaries", () => {
  const records = [
    request("time"),
    request("time", { streamEndedAt: 3000 }),
    request("model"),
    request("model", { requestModel: "p/b" }),
    {
      ...request("ok"),
      prompt: "PRIVATE-PROMPT",
      toolResult: "PRIVATE-TOOL-RESULT",
    },
  ];
  const result = aggregateModels(records, options);
  expect(result.models[0]?.completedRequests).toBe(1);
  expect(result.coverage.conflictingRequests).toBe(2);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(aggregateModels([...records].reverse(), options)).toEqual(result);
});

test("restart request identities, retry attempts, gaps and invalid identity records remain explicit", () => {
  const result = aggregateModels(
    [
      request("same"),
      request("same", { requestStartedAt: 1500 }),
      request("gap", {}, { type: "gap" }),
      request("missing", { requestId: "" }),
    ],
    options,
  );
  expect(result.models[0]?.completedRequests).toBe(2);
  expect(result.coverage).toMatchObject({
    gapRecords: 1,
    missingIdentityRecords: 1,
    partial: true,
  });
  expect(() => aggregateModels([], { ...options, maxRequests: 0 })).toThrow();
  expect(() => aggregateModels([], { ...options, from: 10, to: 1 })).toThrow();
});

test("models CLI exports filtered JSON/CSV, completion ranges and archive coverage without mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "guard-models-"));
  try {
    const records = [request("a"), request("b", { requestModel: "p/b" })];
    const source =
      records.map((record) => JSON.stringify(record)).join("\n") +
      '\n{"partial":';
    const file = join(directory, "1000-abc.jsonl");
    await writeFile(file, source);
    async function run(...args: string[]) {
      const child = Bun.spawn(
        ["bun", "src/cli.ts", "models", directory, ...args],
        { stdout: "pipe", stderr: "pipe" },
      );
      const stdout = new Response(child.stdout).text(),
        stderr = new Response(child.stderr).text();
      return {
        code: await child.exited,
        stdout: await stdout,
        stderr: await stderr,
      };
    }
    const json = await run(
      "--model",
      "p/a",
      "--from",
      "2000",
      "--to",
      "2001",
      "--json",
    );
    expect(json.code).toBe(0);
    const result = JSON.parse(json.stdout);
    expect(result.models).toHaveLength(1);
    expect(result.models[0].completedRequests).toBe(1);
    expect(result.metadata).toMatchObject({
      malformedRecords: 1,
      partial: true,
      timeBasis: "stream-completion-[from,to)",
    });
    expect(json.stdout).not.toContain("requestId");
    const csv = await run("--model", "p/b", "--csv");
    expect(csv.code).toBe(0);
    expect(csv.stdout).toContain('"p/b"');
    expect(csv.stdout).not.toContain('"p/a"');
    expect(JSON.parse(csv.stderr).malformedRecords).toBe(1);
    for (const args of [
      ["--model"],
      ["--unknown"],
      ["--csv", "--json"],
      ["--from", "3000", "--to", "1"],
    ])
      expect((await run(...args)).code).not.toBe(0);
    expect(await Bun.file(file).text()).toBe(source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
