import { decodeVerification } from "./verification.ts";
import type { CompactionState } from "./types.ts";
export interface Recovery {
  sessionId: string;
  compaction: CompactionState;
  sequence?: number;
}
function record(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function nonnegative(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}
// Persist only safety state, in one bounded plugin-storage value. Never persist content.
export function decodeRecovery(v: unknown, max: number): Recovery[] {
  if (!Array.isArray(v)) return [];
  const result: Recovery[] = [];
  for (const item of v.slice(0, max)) {
    if (
      !record(item) ||
      typeof item.sessionId !== "string" ||
      !record(item.compaction)
    )
      continue;
    const c = item.compaction;
    if (
      !nonnegative(c.count) ||
      !nonnegative(c.failures) ||
      !nonnegative(c.consecutiveFailures) ||
      typeof c.armed !== "boolean"
    )
      continue;
    const phase =
      c.phase === "idle" || c.phase === "blocked" ? c.phase : "uncertain";
    const compaction: CompactionState = {
      phase,
      armed: c.armed,
      count: c.count,
      failures: c.failures,
      consecutiveFailures: c.consecutiveFailures,
    };
    if (nonnegative(c.lastAttempt)) compaction.lastAttempt = c.lastAttempt;
    if (nonnegative(c.lastCompleted))
      compaction.lastCompleted = c.lastCompleted;
    if (typeof c.requestId === "string") compaction.requestId = c.requestId;
    if (typeof c.blockedReason === "string")
      compaction.blockedReason = c.blockedReason;
    if (phase === "uncertain")
      compaction.blockedReason = "restart-needs-lifecycle-evidence";
    const verification = decodeVerification(c.verification);
    if (verification) {
      if (verification.protection === "pending")
        verification.protection = "unverified";
      if (verification.tokens === "pending") verification.tokens = "unverified";
      if (
        (verification.protection === "unverified" ||
          verification.tokens === "unverified") &&
        !verification.warnings.includes("verification-unverified")
      )
        verification.warnings.push("verification-unverified");
      compaction.verification = verification;
    }
    result.push({
      sessionId: item.sessionId,
      compaction,
      ...(nonnegative(item.sequence) ? { sequence: item.sequence } : {}),
    });
  }
  return result;
}
export function encodeRecovery(rows: Recovery[]) {
  return rows.map(({ sessionId, compaction: c, sequence }) => ({
    sessionId,
    sequence: sequence ?? -1,
    compaction: {
      ...(c.verification
        ? {
            verification: {
              ...c.verification,
              warnings: [...c.verification.warnings],
            },
          }
        : {}),
      requestId: c.requestId ?? null,
      phase: c.phase,
      armed: c.armed,
      count: c.count,
      failures: c.failures,
      consecutiveFailures: c.consecutiveFailures,
      lastAttempt: c.lastAttempt ?? null,
      lastCompleted: c.lastCompleted ?? null,
      blockedReason: c.blockedReason ?? null,
    },
  }));
}
