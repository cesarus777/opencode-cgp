import type { HistoryChartResult } from "./historycharts.ts";
import { isHistoryResult } from "./rpc.ts";

export type HistoryFailureReason =
  | "unsupported"
  | "timeout"
  | "incompatible"
  | "rejected"
  | "unavailable";

/** Only approved codes cross the presentation boundary, never server messages. */
export class HistoryFailure extends Error {
  constructor(readonly reason: HistoryFailureReason) {
    super(`History ${reason}`);
  }
}

export function historyFailure(
  error: unknown,
  signal?: AbortSignal,
): HistoryFailure {
  if (
    (signal?.aborted &&
      signal.reason instanceof DOMException &&
      signal.reason.name === "TimeoutError") ||
    (error instanceof DOMException && error.name === "TimeoutError")
  )
    return new HistoryFailure("timeout");
  if (error instanceof HistoryFailure) return error;
  const code =
    typeof error === "object" && error !== null && "type" in error
      ? error.type
      : undefined;
  return new HistoryFailure(
    code === "rpc.unavailable" || code === "rpc.method_not_found"
      ? "unsupported"
      : code === "rpc.invalid_output"
        ? "incompatible"
        : code === "rpc.invalid_input"
          ? "rejected"
          : "unavailable",
  );
}

export function checkedHistory(
  value: unknown,
  sessionId: string,
): HistoryChartResult {
  if (
    !isHistoryResult(value) ||
    value.data.series.some((series) => series.sessionId !== sessionId)
  )
    throw new HistoryFailure("incompatible");
  return value;
}

export function historyStatusLines(input: {
  status: "idle" | "loading" | "ready" | "disabled" | "unavailable";
  reason?: HistoryFailureReason;
  stale?: boolean;
  loadedAt?: number;
}): string[] {
  const messages: Record<HistoryFailureReason, string> = {
    unsupported:
      "History service is unavailable in this server location. Check that the owning server has a plugin version with chart history. Press r to check again.",
    timeout: "History request timed out. Press r to retry.",
    incompatible:
      "History response is incompatible. Check client/server plugin versions. Press r to retry.",
    rejected:
      "History request was rejected. Check client/server plugin versions. Press r to retry.",
    unavailable: "History could not be loaded. Press r to retry.",
  };
  return [
    ...(input.status === "loading"
      ? [
          input.loadedAt === undefined
            ? "Loading retained history…"
            : "Updating history · showing previous results",
        ]
      : input.status === "disabled"
        ? [
            "History recording is disabled in this server location. Press r to check again after configuration changes.",
          ]
        : input.status === "unavailable"
          ? [messages[input.reason ?? "unavailable"]]
          : []),
    ...(input.stale && input.loadedAt !== undefined
      ? [
          `Showing previous results · last loaded ${new Date(input.loadedAt).toISOString()}`,
        ]
      : []),
  ];
}
