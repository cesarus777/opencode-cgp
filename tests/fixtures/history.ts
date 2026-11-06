import type { HistoryChartResult } from "../../src/historycharts.ts";

export function retainedHistory(sessionId = "s"): HistoryChartResult {
  return {
    schemaVersion: 1,
    generatedAt: 1000000,
    enabled: true,
    truncated: false,
    metadata: {
      schema: 1,
      retainedBytes: 10,
      skippedBytes: 0,
      malformedRecords: 0,
      completeness: "bounded-retention",
    },
    data: {
      schema: 1,
      maxPoints: 240,
      omittedSessions: 0,
      gaps: [],
      series: [
        {
          sessionId,
          agents: [],
          models: [],
          points: [
            { time: 999000, liveTps: 10, partial: false, breakBefore: false },
          ],
          requests: [],
          originalPoints: 1,
        },
      ],
    },
  };
}
