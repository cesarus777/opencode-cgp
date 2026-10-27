import { expect, test } from "bun:test";
import { projectHistory } from "../src/dashboard/view.ts";
import type { HistoryChartResult } from "../src/historycharts.ts";

test("history projection preserves skipped discontinuities and exposes gaps, retention and downsampling without unmatched rates", () => {
  const result: HistoryChartResult = {
    schemaVersion: 1,
    generatedAt: 100,
    enabled: true,
    truncated: true,
    metadata: {
      schema: 1,
      retainedBytes: 1000,
      skippedBytes: 20,
      malformedRecords: 1,
      retainedFrom: 10,
      completeness: "bounded-retention",
    },
    data: {
      schema: 1,
      maxPoints: 500,
      omittedSessions: 0,
      omittedGaps: 2,
      gaps: [{ sessionId: "s", time: 20, reason: "restart" }],
      series: [
        {
          sessionId: "s",
          agents: ["build", "plan"],
          models: ["p/m"],
          originalPoints: 1000,
          points: [
            {
              time: 10,
              agent: "build",
              model: "p/m",
              partial: false,
              breakBefore: false,
              liveTps: 10,
            },
            {
              time: 20,
              agent: "plan",
              model: "p/m",
              partial: true,
              breakBefore: true,
              liveTps: 20,
            },
            {
              time: 30,
              agent: "build",
              model: "p/m",
              partial: false,
              breakBefore: false,
              liveTps: 30,
            },
          ],
          requests: [
            {
              requestId: "unknown-duration",
              started: 10,
              time: 30,
              agent: "build",
              model: "p/m",
              partial: true,
              outputTokens: 1000,
            },
          ],
        },
      ],
    },
  };
  const projected = projectHistory(result, {
    search: "",
    agent: "build",
    model: "p/m",
  });
  expect(
    projected.result.data.series[0]?.points.map((point) => point.breakBefore),
  ).toEqual([false, true]);
  expect(projected.result.metadata.retainedFrom).toBe(10);
  expect(projected.summary).toMatchObject({
    source: "matched-request-records",
    matchedRequests: 0,
    partial: true,
  });
  expect(projected.summary.averageModelTps).toBeUndefined();
  expect(projected.summary.outputTokens).toBeUndefined();
  expect(projected.notices).toContain("history-gaps");
  expect(projected.notices).toContain("downsampled-history");
  expect(projected.notices).toContain("partial-history");
  expect(projected.notices).toContain("bounded-retention");
  expect(result.data.series[0]?.points.length).toBe(3);
});
