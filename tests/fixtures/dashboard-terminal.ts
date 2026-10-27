import { DashboardController } from "../../src/dashboard/controller.ts";
import type { DashboardPort } from "../../src/dashboard/port.ts";
import type { ContextSnapshot } from "../../src/snapshot.ts";

export function terminalFixture() {
  const counts = { streams: 0, history: 0, aborted: 0 };
  const now = 1000000;
  const snapshots: ContextSnapshot[] = [
    "root-long-identifier-研究",
    "child-a",
    "child-b",
  ].map((sessionId, i) => ({
    sessionId,
    ...(i ? { parentId: "root-long-identifier-研究" } : {}),
    revision: 1,
    observedAt: now,
    agent: "build",
    model: "synthetic/alpha",
    measurement: {
      tokens: 700,
      at: now,
      model: "synthetic/alpha",
      provenance: "provider-normalized",
      confidence: "reported",
      scope: "completed-request",
    },
    capacityTokens: 1000,
    policy: {
      id: "defaults",
      configured: { type: "ratio", value: 0.8 },
      triggerTokens: 800,
      comparison: ">=",
      crossed: false,
      reason: "below-threshold",
    },
    compaction: { phase: i === 1 ? "blocked" : "uncertain", armed: false },
    cumulativeScope: "unknown",
    lastObservedActive: true,
    performance: {
      sessionCreatedAt: now - 10000,
      observedSince: now - 5000,
      at: now,
      status: "streaming",
      liveTps: 12,
      estimatedOutputTokens: 24,
      modelOutputTokens: 50,
      modelDurationMs: 2000,
      completedRequests: 1,
      tokenSource: "estimated",
      partial: true,
    },
  }));
  const port = (directory: string): DashboardPort => ({
    location: { directory },
    atLocation: port,
    async listSessions(input) {
      return {
        data: snapshots
          .filter((s) => (s.parentId ?? null) === (input.parentID ?? null))
          .map((s) => ({
            sessionId: s.sessionId,
            directory,
            ...(s.parentId ? { parentId: s.parentId } : {}),
          })),
      };
    },
    async activeSessions(ids) {
      return ids;
    },
    async monitor() {
      return {
        version: 2,
        transport: {
          async read() {
            return {
              schemaVersion: 1,
              epoch: "test",
              sequence: 1,
              generatedAt: now,
              health: {
                enabled: true,
                mode: "observe",
                enforcement: "observing",
                reasons: [],
                staleMs: 1000,
                maxSessions: 100,
              },
              upserts: snapshots,
              removed: [],
              unavailable: [],
            };
          },
          async *subscribe(_directory, signal) {
            counts.streams++;
            await new Promise<void>((done) => {
              signal.addEventListener(
                "abort",
                () => {
                  counts.aborted++;
                  done();
                },
                { once: true },
              );
              if (signal.aborted) done();
            });
          },
        },
      };
    },
    async history(input) {
      counts.history++;
      return {
        schemaVersion: 1,
        generatedAt: now,
        enabled: true,
        truncated: false,
        metadata: {
          schema: 1,
          retainedBytes: 100,
          skippedBytes: 0,
          malformedRecords: 0,
          completeness: "bounded-retention",
        },
        data: {
          schema: 1,
          maxPoints: 500,
          omittedSessions: 0,
          gaps: [
            {
              time: now - 500,
              sessionId: input.sessionId,
              reason: "event-stream-gap",
            },
          ],
          series: [
            {
              sessionId: input.sessionId,
              agents: ["build"],
              models: ["synthetic/alpha"],
              originalPoints: 20,
              points: [
                {
                  time: now - 1000,
                  breakBefore: false,
                  partial: true,
                  liveTps: 12,
                  averageModelTps: 25,
                  averageSessionTps: 5,
                  sessionOutputTokens: 50,
                },
                { time: now, breakBefore: true, partial: true },
              ],
              requests: [
                {
                  time: now - 1000,
                  requestId: "full-request-id",
                  started: now - 3000,
                  outputTokens: 50,
                  durationMs: 2000,
                  tps: 25,
                  ttftMs: 200,
                  partial: true,
                },
              ],
            },
          ],
        },
      };
    },
  });
  const controller = new DashboardController(port("/project"), {
    now: () => now,
    elapsed: () => 0,
    refreshIntervalMs: 0,
  });
  return { controller, counts, snapshots };
}
