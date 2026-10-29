import type { HistoryRecord, HistoryMetadata } from "../../src/history.ts";
import { createAnalyticsService } from "../../src/modelanalyticsserver.ts";

export function analyticsRequest(
  id: string,
  model = "provider/alpha",
  duration = 1000,
  tokens = 100,
  completedAt = 990000,
  agent = "build",
): HistoryRecord {
  return {
    schema: 1,
    recordId: id,
    type: "request",
    time: completedAt + 100,
    sessionId: `archived-${id}`,
    model: "provider/current",
    performance: {
      sessionCreatedAt: 0,
      observedSince: 0,
      at: completedAt + 100,
      status: "idle",
      partial: false,
      estimatedOutputTokens: 9999,
      modelOutputTokens: 9999,
      modelDurationMs: 9999,
      completedRequests: 99,
      tokenSource: "reported",
      requestId: id,
      requestModel: model,
      requestAgent: agent,
      requestStartedAt: completedAt - duration,
      streamEndedAt: completedAt,
      requestOutputTokens: tokens,
      ttftMs: 100,
    },
  };
}
export const analyticsMetadata: HistoryMetadata = {
  schema: 1,
  retainedBytes: 100,
  skippedBytes: 0,
  malformedRecords: 0,
  completeness: "bounded-retention",
};
export function analyticsFixture(
  records = [
    analyticsRequest("root"),
    analyticsRequest("child", "provider/alpha", 3000, 30),
    analyticsRequest("other", "provider/beta"),
  ],
) {
  let now = 1000000,
    scans = 0;
  const service = createAnalyticsService(
    "/server-owned/archive",
    "/project",
    true,
    {
      now: () => now,
      read: async (_path, filter) => {
        scans++;
        filter?.signal?.throwIfAborted();
        return {
          metadata: analyticsMetadata,
          records: structuredClone(records),
        };
      },
    },
  );
  return {
    service,
    records,
    scans: () => scans,
    setNow: (value: number) => {
      now = value;
    },
  };
}
