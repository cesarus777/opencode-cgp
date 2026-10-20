import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildChartData,
  downsamplePoints,
  type ChartPoint,
} from "../src/charts.ts";
import { renderChartReport } from "../src/chartreport.ts";
import { PerformanceHistory, type HistoryRecord } from "../src/history.ts";
import type { PerformanceSnapshot } from "../src/performance.ts";
import { historyChartLines, sparkline } from "../src/tui/chartformat.ts";
import { cells } from "../src/tui/format.ts";

function observation(
  id: string,
  time: number,
  overrides: Partial<PerformanceSnapshot> = {},
  type: HistoryRecord["type"] = "sample",
): HistoryRecord {
  return {
    schema: 1,
    recordId: `${id}-${time}-${type}`,
    type,
    sessionId: id,
    agent: "build",
    model: "p/m",
    time,
    performance: {
      sessionCreatedAt: 0,
      observedSince: 1000,
      at: time,
      status: "streaming",
      partial: false,
      liveTps: 10,
      averageModelTps: 20,
      averageSessionTps: 5,
      sessionOutputTokens: 100,
      estimatedOutputTokens: 20,
      modelOutputTokens: 100,
      modelDurationMs: 5000,
      completedRequests: 1,
      tokenSource: "estimated",
      ...overrides,
    },
  };
}
const metadata = {
  schema: 1,
  retainedBytes: 0,
  skippedBytes: 0,
  malformedRecords: 0,
  completeness: "bounded-retention",
};

test("charts separate same-named sessions, sort observations, deduplicate requests and retain captured models", () => {
  const request = observation(
    "root",
    3000,
    {
      requestId: "r",
      requestStartedAt: 1000,
      streamEndedAt: 2000,
      requestAgent: "review",
      requestModel: "p/old",
      requestOutputTokens: 100,
      ttftMs: 250,
      tokenSource: "reported",
    },
    "request",
  );
  const data = buildChartData([
    request,
    observation("child", 2000),
    observation("root", 1000),
    request,
    { ...request, recordId: "duplicate-request" },
  ]);
  expect(data.series).toHaveLength(2);
  const root = data.series.find((s) => s.sessionId === "root");
  expect(root?.points.map((p) => p.time)).toEqual([1000, 3000]);
  expect(root?.requests).toHaveLength(1);
  expect(root?.requests[0]).toMatchObject({
    tps: 100,
    durationMs: 1000,
    agent: "review",
    model: "p/old",
    ttftMs: 250,
  });
});
test("gaps, restart/model transitions and unsampled idle periods break curves without invented zeroes", () => {
  const data = buildChartData([
    observation("r", 1000),
    {
      schema: 1,
      recordId: "gap",
      type: "gap",
      sessionId: "__history__",
      time: 1500,
      event: "history-records-dropped",
    },
    observation("r", 2000),
    observation("r", 6000),
    observation("r", 7000, { observedSince: 6500 }),
    observation("r", 8000, { observedSince: 6500, requestModel: "p/new" }),
  ]);
  expect(data.gaps).toHaveLength(1);
  expect(data.series[0]?.points.map((p) => p.breakBefore)).toEqual([
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(data.series[0]?.points).toHaveLength(5);
});
test("downsampling bounds points, preserves peaks and propagates skipped gap boundaries", () => {
  const points: ChartPoint[] = Array.from({ length: 10000 }, (_, i) => ({
    time: i * 1000,
    liveTps: i === 423 ? 900 : 10,
    averageModelTps: i === 600 ? 1000 : 20,
    partial: false,
    breakBefore: i === 0 || i === 500,
  }));
  const sampled = downsamplePoints(points, 100);
  expect(sampled.length).toBeLessThanOrEqual(100);
  expect(sampled.some((p) => p.liveTps === 900)).toBe(true);
  expect(sampled.some((p) => p.averageModelTps === 1000)).toBe(true);
  expect(sampled.find((p) => p.time >= 500000)?.breakBefore).toBe(true);
  expect(sampled.at(-1)?.time).toBe(points.at(-1)?.time);
  expect(() => downsamplePoints([], 1)).toThrow();
});
test("unknown request usage stays unknown and session limits are explicit", () => {
  const records = [
    observation(
      "a",
      1000,
      { requestId: "a", requestStartedAt: 0, streamEndedAt: 500 },
      "request",
    ),
    observation("b", 2000),
  ];
  expect(buildChartData(records).series[0]?.requests[0]?.tps).toBeUndefined();
  const data = buildChartData(records, { maxSessions: 1 });
  expect(data.omittedSessions).toBe(1);
  expect(data.series[0]?.sessionId).toBe("b");
  expect(
    buildChartData(records, { sessionId: "a", maxSessions: 1 }).series[0]
      ?.sessionId,
  ).toBe("a");
});
test("terminal sparklines align timestamps and preserve missing data and explicit gaps", () => {
  const result = sparkline(
    [{ time: 0, value: 0 }, { time: 4000, value: 100 }, { time: 8000 }],
    0,
    10000,
    11,
    [6000],
  );
  expect(result).toEqual({ line: "▁   █ ┆    ", min: 0, max: 100 });
  const data = buildChartData([
    observation("r", 1000),
    observation("r", 2000, { partial: true }),
  ]);
  for (const width of [8, 16, 35, 80]) {
    const lines = historyChartLines(
      {
        schemaVersion: 1,
        generatedAt: 2000,
        enabled: true,
        truncated: false,
        metadata,
        data,
      },
      width,
      0,
      10000,
    );
    expect(lines.every((line) => cells(line) <= width)).toBe(true);
    expect(lines.join(" ")).toContain("TTFT");
  }
});
test("HTML is self-contained, escapes script-breaking identities and embeds executable JavaScript", () => {
  const hostile = '</script><script>alert("secret")</script>';
  const html = renderChartReport({
    data: buildChartData([observation(hostile, 1000)]),
    metadata,
  });
  expect(html).not.toContain(hostile);
  expect(html).toContain("\\u003c/script");
  expect(html).toContain("connect-src 'none'");
  expect(html).not.toMatch(/<script[^>]+src=/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  // Syntax-check the browser script without invoking DOM operations.
  expect(() => new Function(scripts[0]?.[1] ?? "")).not.toThrow();
});
test("CLI generates scoped reports, preserves the archive, and requires explicit overwrite", async () => {
  const path = await mkdtemp(join(tmpdir(), "guard-chart-"));
  try {
    const archive = join(path, "history"),
      output = join(path, "report.html");
    const sink = new PerformanceHistory(archive, {
      enabled: true,
      retentionDays: 7,
      maxBytes: 65536,
    });
    sink.emit(observation("root", 1000));
    sink.emit(observation("child", 2000));
    await sink.flush();
    async function run(...args: string[]) {
      const child = Bun.spawn(
        ["bun", "src/cli.ts", "charts", archive, "--output", output, ...args],
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
    expect((await run("--session", "root")).code).toBe(0);
    const html = await readFile(output, "utf8");
    expect(html).toContain('"sessionId":"root"');
    expect(html).not.toContain('"sessionId":"child"');
    expect((await stat(output)).mode & 0o777).toBe(0o600);
    expect((await run()).code).not.toBe(0);
    expect((await run("--force")).code).toBe(0);
    expect((await run("--max-points", "-1")).stderr).toContain("--max-points");
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
