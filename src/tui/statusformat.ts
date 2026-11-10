import type { GuardRow } from "../family.ts";
import type { MonitorHealth } from "../snapshot.ts";
import type { Connection } from "./transport.ts";
import { tokens } from "./quantity.ts";

/** A stored reading's confidence is independent of its freshness and scope. */
export function freshnessLabel(row: GuardRow | undefined): string | undefined {
  switch (row?.freshness) {
    case "fresh":
      return undefined;
    case "stale":
      return "Measurement out of date";
    case "invalid":
      return "Usage unavailable";
    default:
      return "Usage unknown";
  }
}

export function measurementLabel(
  row: GuardRow | undefined,
  ageMs?: number,
): string {
  const m = row?.snapshot?.measurement;
  if (!m || row?.freshness === "missing") return "Usage unknown";
  if (row?.freshness === "invalid") return "Usage unavailable";
  const age =
    ageMs === undefined
      ? ""
      : ` · measured ${Math.floor(Math.max(0, ageMs) / 1000)}s ago`;
  return `${m.confidence === "reported" ? "Provider reported" : "Estimated"}${age}${row?.freshness === "stale" ? " · out of date" : ""}`;
}

export function measurementExplanation(row: GuardRow): readonly string[] {
  const m = row.snapshot?.measurement;
  if (!m || row.freshness === "missing") return ["No measurement available."];
  if (row.freshness === "invalid")
    return ["Measurement cannot be used for this session."];
  return [
    m.scope === "completed-request"
      ? "Usage from the last completed request; not the next request's size."
      : "Usage for the prepared request; not a completed request.",
    m.provenance === "serialized-estimate"
      ? "Estimate from serialized request content."
      : "Provider usage includes input and cache tokens.",
  ];
}

export function verificationWarnings(
  row: GuardRow | undefined,
  compact = false,
): string[] {
  const v = row?.snapshot?.compaction.verification;
  if (!v) return [];
  return v.warnings.map((code) => {
    switch (code) {
      case "protected-text-changed":
        return compact
          ? "Protected text changed"
          : "Protected text is missing or changed after compaction.";
      case "preservation-fallback":
        return compact
          ? "Preservation unavailable"
          : "Preservation unavailable; native compaction used.";
      case "token-target-exceeded":
        return compact
          ? "Still above target"
          : v.tokens !== "failed"
            ? "An earlier compaction exceeded its token target; verification remains unresolved."
            : `Post-compaction usage ${v.measuredTokens ?? "?"} tokens still reaches target ${v.target ?? "?"} (${v.comparison ?? ">="}). Intervening work may contribute to this reading.`;
      case "verification-unverified":
        return compact
          ? "Compaction unverified"
          : "Compaction verification is unverified; lifecycle or comparable provider usage is unavailable.";
    }
  });
}

export function compactionLabel(
  row: GuardRow | undefined,
  compact = false,
): string | undefined {
  const warnings = verificationWarnings(row, compact);
  const phase = row?.snapshot?.compaction.phase;
  if (warnings.length)
    return (
      warnings.join(" · ") +
      (phase === "running"
        ? " · " + (compact ? "Compacting" : "Compaction running")
        : "")
    );
  if (!phase || phase === "idle") return undefined;
  if (compact)
    return {
      requesting: "Requesting",
      accepted: "Waiting",
      running: "Compacting",
      "awaiting-measurement": "Checking",
      blocked: "Retry held",
      uncertain: "Unconfirmed",
    }[phase];
  return {
    requesting: "Requesting compaction",
    accepted: "Compaction request accepted · waiting to start",
    running: "Compaction running",
    "awaiting-measurement": "Compaction ended · checking context reduction",
    blocked: "Automatic compaction retry suppressed",
    uncertain: "Completion unconfirmed · automatic retry suppressed",
  }[phase];
}

/** Only translate reasons with established semantics; unknown codes stay in diagnostics. */
export function reasonExplanation(reason: string): string {
  switch (reason) {
    case "below-threshold":
      return "Context is below the policy threshold.";
    case "threshold-crossed":
      return "Context reached the policy threshold; this does not guarantee compaction.";
    case "missing-usage":
      return "No measurement available for the policy decision.";
    case "model-changed":
      return "The measurement belongs to a different model.";
    case "invalid-usage":
      return "The measurement cannot be used for the policy decision.";
    case "stale-usage":
      return "The policy measurement is out of date.";
    case "missing-model-budget":
      return "Model capacity is unavailable for this threshold.";
    case "incompatible-model-budget":
      return "The threshold is incompatible with model capacity.";
    case "compaction-failed":
      return "Compaction failed; automatic retries are limited after repeated failures.";
    case "reclaim-unverifiable":
      return "Context reduction could not be verified with comparable provider readings.";
    case "insufficient-reclaim":
      return "Measured context reduction was below the required minimum.";
    case "admission-outcome-unknown":
      return "Whether the compaction request was accepted is unconfirmed.";
    case "completion-event-timeout":
      return "No confirming completion event arrived within the waiting period.";
    case "restart-needs-lifecycle-evidence":
      return "The previous request needs confirming lifecycle evidence after restart.";
    case "event-stream-gap":
      return "Automatic requests are suspended after an event gap; reload required.";
    case "persistence-unavailable":
      return "Safety storage is unavailable; repair storage and reload.";
    case "capacity-exceeded":
      return "Monitoring limit reached; some sessions are unavailable.";
    case "model-metadata-unavailable":
      return "Some model limits are unavailable.";
    default:
      return "See diagnostic codes.";
  }
}

export const contextHistoryLegend = [
  "Recent samples → now · ┄ threshold",
  "Dim = last known context",
] as const;

export function pressureLabel(row: GuardRow | undefined): string {
  if (row?.freshness !== "fresh") return "Threshold pressure unknown";
  switch (row.pressure) {
    case "crossed":
      return "Threshold reached";
    case "near":
      return "Near threshold";
    case "normal":
      return "Below threshold";
    default:
      return "Threshold pressure unknown";
  }
}

export function thresholdDistance(
  row: GuardRow | undefined,
  compact = false,
): string {
  const delta = row?.triggerDeltaTokens;
  if (
    row?.freshness !== "fresh" ||
    row.pressure === "unknown" ||
    delta === undefined ||
    !Number.isFinite(delta)
  )
    return "pressure unknown";
  if (delta === 0)
    return row.pressure === "crossed"
      ? "Threshold reached"
      : "At threshold · requires more";
  if (compact)
    return `${tokens(Math.abs(delta))} ${delta < 0 ? "over" : "below"}${row.pressure === "near" ? " · Near threshold" : delta < 0 ? " · Threshold reached" : ""}`;
  return `${tokens(Math.abs(delta))} ${Math.abs(delta) === 1 ? "token" : "tokens"} ${delta < 0 ? "over" : "below"} threshold`;
}

export function guardStatusLines(
  health: MonitorHealth | undefined,
  compact = false,
): readonly string[] {
  switch (health?.enforcement) {
    case "observing":
      return compact
        ? ["Observing", "No Guard compact"]
        : ["Observing · Guard won't request compaction"];
    case "available":
      return compact
        ? ["Guard requests", "enabled"]
        : ["Guard automatic requests enabled"];
    case "disabled":
      return ["Guard disabled"];
    case "suspended": {
      const gap = health.reasons.includes("event-stream-gap");
      const storage = health.reasons.includes("persistence-unavailable");
      return compact
        ? [
            "Guard suspended",
            ...(storage ? ["Storage: repair"] : []),
            ...(gap
              ? ["Reload required"]
              : storage
                ? ["Then reload"]
                : ["See Details"]),
          ]
        : [
            "Guard suspended" +
              (storage
                ? " · safety storage unavailable; repair storage and reload"
                : "") +
              (gap ? " · reload required" : storage ? "" : " · see Details"),
          ];
    }
    default:
      return ["Guard status unknown"];
  }
}

export function panelStatus(health: MonitorHealth | undefined): string {
  return guardStatusLines(health).join(" · ");
}

export function connectionLabel(
  connection: Connection,
  compact = false,
): string {
  switch (connection) {
    case "loading":
      return "Connecting";
    case "live":
      return "Live";
    case "reconnecting":
      return "Reconnecting";
    case "unavailable":
      return compact ? "Unavailable" : "Connection unavailable";
    case "incompatible":
      return compact ? "Unsupported" : "Monitoring unsupported";
  }
}

/** A client connection loss is not evidence that server enforcement stopped. */
export function connectionNotice(
  connection: Connection,
  retainedMeasurements: boolean,
  compact = false,
): string | undefined {
  if (connection === "live") return undefined;
  return retainedMeasurements
    ? compact
      ? "Last data shown"
      : "Showing last received measurements"
    : compact
      ? "No measurements"
      : "No measurements available";
}

export function monitorStatusLines(
  connection: Connection,
  health: MonitorHealth | undefined,
  retainedMeasurements: boolean,
  compact = false,
): readonly string[] {
  const notice = connectionNotice(connection, retainedMeasurements, compact);
  const reasons = health?.reasons ?? [];
  const limited = reasons.includes("capacity-exceeded");
  const model = reasons.includes("model-metadata-unavailable");
  const attention = health?.enforcement !== "suspended" && reasons.length > 0;
  return [
    ...(health && connection !== "live"
      ? [compact ? "Last known:" : "Last known Guard:"]
      : []),
    ...guardStatusLines(health, compact),
    ...(attention
      ? compact
        ? [limited ? "Monitor limit" : model ? "Limits unknown" : "See Details"]
        : [
            ...(limited
              ? ["Monitoring limit reached · some sessions unavailable"]
              : []),
            ...(model
              ? ["Some model limits unavailable · context may be unknown"]
              : []),
            ...(!limited && !model
              ? ["Guard needs attention · see Details"]
              : []),
          ]
      : []),
    ...(notice ? [notice] : []),
  ];
}
