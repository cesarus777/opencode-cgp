import type { GuardRow } from "../family.ts";
import { cells, clip, wrap } from "./format.ts";
import { tokens } from "./quantity.ts";
import {
  compactionLabel,
  freshnessLabel,
  measurementLabel,
  thresholdDistance,
} from "./statusformat.ts";
export {
  compactionLabel,
  thresholdDistance,
  panelStatus,
} from "./statusformat.ts";

export const panelStatuses = {
  running: "RUNNING",
  idle: "IDLE",
  completed: "DONE",
  failed: "FAILED",
  unknown: "UNKNOWN",
} as const;

export function panelSummary(
  row: GuardRow | undefined,
  width: number,
  age: number,
  compact = false,
): string[] {
  if (!row) return [clip("No sessions available · r refresh", width)];
  const snapshot = row.snapshot;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const prefix = row.freshness === "stale" ? "Last measured" : "Context";
  const percent = `${row.utilizationPercent === undefined ? "?" : Math.round(row.utilizationPercent)}%`;
  const estimate =
    valid && snapshot?.measurement?.confidence === "approximate" ? "~" : "";
  const identity = `${width < 28 ? ">" : "Selected:"} ${row.node.agent ?? row.node.sessionId}${row.current ? (width < 28 ? " *" : " (current)") : ""}`;
  const threshold = `Threshold ${tokens(snapshot?.policy.triggerTokens)} · ${thresholdDistance(row)}`;
  const occupancy = compact
    ? `${prefix} ${estimate}${percent}`
    : `${prefix} ${estimate}${tokens(valid ? snapshot?.measurement?.tokens : undefined)}/${tokens(snapshot?.capacityTokens)} · ${percent}`;
  return [
    clip(identity, width),
    clip(occupancy, width),
    ...(!compact
      ? [
          clip(
            cells(threshold) <= width ? threshold : thresholdDistance(row),
            width,
          ),
          clip(
            `${row.node.model ?? snapshot?.model ?? "Model unknown"} · ${panelStatuses[row.node.status]}`,
            width,
          ),
          ...wrap(measurementLabel(row, age), width),
        ]
      : []),
  ];
}

function tableLine(
  identity: string,
  status: string,
  context: string,
  threshold: string,
  width: number,
) {
  const pad = (value: string, size: number) => {
    const text = clip(value, size);
    return text + " ".repeat(Math.max(0, size - cells(text)));
  };
  return `${pad(identity, width - 47)} ${pad(status, 8)} ${pad(context, 7)} ${pad(threshold, 29)}`;
}

export function panelRowHeading(label: string, width: number): string {
  return width >= 72
    ? tableLine(label, "State", "Context", "Threshold", width)
    : clip(label, width);
}

export function panelRowLines(
  row: GuardRow,
  width: number,
  selected: boolean,
): string[] {
  const marker = `${selected ? ">" : " "}${row.current ? "*" : " "}`;
  const indent =
    " ".repeat(Math.min(row.depth, Math.floor(width / 24))) +
    (row.depth ? "└ " : "");
  const identity = `${marker} ${indent}${row.node.agent ?? row.node.sessionId}`;
  const percent = `${(row.freshness === "fresh" || row.freshness === "stale") && row.snapshot?.measurement?.confidence === "approximate" ? "~" : ""}${row.utilizationPercent === undefined ? "?" : Math.round(row.utilizationPercent)}%`;
  const status =
    width < 28
      ? {
          running: "RUN",
          idle: "IDLE",
          completed: "DONE",
          failed: "FAIL",
          unknown: "?",
        }[row.node.status]
      : panelStatuses[row.node.status];
  const distance = thresholdDistance(row, true);
  const pad = (value: string, size: number) => {
    const text = clip(value, size);
    return text + " ".repeat(Math.max(0, size - cells(text)));
  };
  const lines =
    width >= 72
      ? [tableLine(identity, status, percent, distance, width)]
      : [
          `${pad(identity, Math.max(1, width - status.length - 1))} ${status}`,
          clip(`${percent} context · ${distance}`, width),
        ];
  const exception = [
    freshnessLabel(row),
    compactionLabel(row),
    row.node.interrupted ? "interrupted" : "",
    row.hidden ? `+${row.hidden} hidden · Space expands` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  if (exception) lines.push(...wrap(exception, width));
  return lines.map((line) => clip(line, width));
}
