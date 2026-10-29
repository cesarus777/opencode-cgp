import { expect, test } from "bun:test";
import {
  aggregateModels,
  analyzeModelRequests,
} from "../src/modelanalytics.ts";
import { bucketModelRequests } from "../src/modelseries.ts";
import { analyticsRequest } from "./fixtures/analytics.ts";

test("model buckets use half-open completion boundaries and sum concurrent matched durations", () => {
  const records = [
    analyticsRequest("a", "p/a", 1000, 100, 2000),
    analyticsRequest("b", "p/a", 3000, 30, 4000),
    analyticsRequest("c", "p/a", 1000, 200, 6000),
    analyticsRequest("outside", "p/a", 1000, 9000, 8000),
  ];
  const options = { location: "/project", from: 2000, to: 8000 };
  const result = analyzeModelRequests(records, options);
  const buckets = bucketModelRequests(result.requests, 2000, 8000, 3);
  expect(buckets.map((b) => b.summary?.completedRequests)).toEqual([1, 1, 1]);
  const combined = bucketModelRequests(result.requests, 2000, 8000, 1)[0]
    ?.summary;
  expect(combined?.averageTps).toBe(66);
  expect(combined?.outputTokens).toBe(330);
  expect(combined).toEqual(aggregateModels(records, options).models[0]);
  expect(result.requests[0]?.startedAt).toBe(1000); // Include its full pre-range duration.
});

test("model buckets preserve metric eligibility and leave empty buckets unknown", () => {
  const record = analyticsRequest("estimated", "p/a", 1000, 100, 2000);
  if (!record.performance) throw new Error("Missing fixture");
  record.performance = { ...record.performance, tokenSource: "estimated" };
  const facts = analyzeModelRequests([record], {
    location: "/project",
  }).requests;
  const buckets = bucketModelRequests(facts, 0, 8000, 4);
  expect(buckets[0]?.summary).toBeUndefined();
  expect(buckets[1]?.summary).toMatchObject({
    completedRequests: 1,
    tpsRequests: 0,
    ttftRequests: 1,
    medianTtftMs: 100,
  });
  expect(buckets[1]?.summary?.averageTps).toBeUndefined();
  expect(() => bucketModelRequests(facts, 0, 8000, 241)).toThrow();
});

test("bucket resolution cannot change CLI totals across more than 500 requests and 128 sessions", () => {
  const records = Array.from({ length: 1200 }, (_, i) =>
    analyticsRequest(`r-${i}`, "p/a", 1000 + i, 10 + i, 5000 + i),
  );
  const result = analyzeModelRequests(records, { location: "/project" });
  for (const count of [1, 16, 120, 240]) {
    const buckets = bucketModelRequests(result.requests, 0, 10000, count);
    expect(
      buckets.reduce((sum, b) => sum + (b.summary?.completedRequests ?? 0), 0),
    ).toBe(1200);
    expect(
      buckets.reduce((sum, b) => sum + (b.summary?.outputTokens ?? 0), 0),
    ).toBe(result.models[0]?.outputTokens ?? -1);
    expect(
      buckets.reduce((sum, b) => sum + (b.summary?.durationMs ?? 0), 0),
    ).toBe(result.models[0]?.durationMs ?? -1);
  }
});
