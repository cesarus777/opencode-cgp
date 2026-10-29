import {
  summarizeModelRequests,
  type CompletedAnalyticsRequest,
  type ModelAnalyticsResult,
  type ModelSummary,
} from "./modelanalytics.ts";
import type { HistoryMetadata } from "./history.ts";

export interface ModelBucket {
  from: number;
  to: number;
  summary?: ModelSummary;
}
export interface AnalyticsRead {
  schemaVersion: 1;
  from: number;
  to: number;
  buckets: number;
  agent?: string;
  model?: string;
  unknownModel?: boolean;
  sort?: "requests" | "tps" | "ttft" | "identity";
  snapshotId?: string;
  modelCursor?: string;
  requestCursor?: string;
}
export interface AnalyticsResult {
  schemaVersion: 1;
  generatedAt: number;
  expiresAt: number;
  snapshotId: string;
  enabled: boolean;
  from: number;
  to: number;
  agent?: string;
  models: ModelSummary[];
  totalModels: number;
  nextModelsCursor?: string;
  selected?: ModelSummary;
  buckets: ModelBucket[];
  requests: CompletedAnalyticsRequest[];
  nextRequestsCursor?: string;
  coverage: ModelAnalyticsResult["coverage"];
  metadata: HistoryMetadata;
  gaps: number[];
  omittedGaps: number;
}

/** Requests belong to half-open completion buckets; rates never average rates. */
export function bucketModelRequests(
  requests: readonly CompletedAnalyticsRequest[],
  from: number,
  to: number,
  count: number,
): ModelBucket[] {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    from >= to ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > 240
  )
    throw new Error("Invalid analytics buckets");
  const groups: CompletedAnalyticsRequest[][] = Array.from(
    { length: count },
    () => [],
  );
  for (const request of requests) {
    if (request.completedAt < from || request.completedAt >= to) continue;
    const index = Math.min(
      count - 1,
      Math.floor(((request.completedAt - from) / (to - from)) * count),
    );
    groups[index]?.push(request);
  }
  return groups.map((group, index) => {
    // Callers select one model before bucketing. Reject accidental mixed series.
    const summaries = summarizeModelRequests(group);
    if (summaries.length > 1) throw new Error("Select one model for buckets");
    const summary = summaries[0];
    return {
      from: from + ((to - from) * index) / count,
      to: from + ((to - from) * (index + 1)) / count,
      ...(summary ? { summary } : {}),
    };
  });
}
