import type { GuardRow } from "../family.ts";
import type { MonitorHealth } from "../snapshot.ts";
import type { Connection } from "./transport.ts";
import { tokens } from "./quantity.ts";

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
