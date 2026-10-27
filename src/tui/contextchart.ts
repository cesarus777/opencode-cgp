import type { GuardRow } from "../family.ts";

export interface ContextSample {
  readonly at: number;
  readonly tokens?: number;
  /** Display-only carry-forward; never a new measurement. */
  readonly held?: boolean;
  readonly compacted?: boolean;
}
export interface ContextTrace {
  readonly sessionId: string;
  readonly model: string | undefined;
  readonly capacity: number | undefined;
  readonly samples: readonly ContextSample[];
  readonly lastCompleted?: number;
  readonly pendingCompleted?: number;
}

/** Bounded display history. Raw usage and enforcement remain in the snapshot. */
export function updateContextTrace(
  previous: ContextTrace | undefined,
  row: GuardRow | undefined,
): ContextTrace {
  const snapshot = row?.snapshot;
  const sessionId = row?.node.sessionId ?? "";
  const sameSession = previous?.sessionId === sessionId;
  const model =
    snapshot?.model ??
    row?.node.model ??
    (sameSession ? previous?.model : undefined);
  const capacity =
    snapshot?.capacityTokens ??
    (sameSession && model === previous?.model ? previous?.capacity : undefined);
  const compatible =
    sameSession && previous?.model === model && previous.capacity === capacity;
  const samples = compatible ? previous.samples : [];
  const completed =
    snapshot?.compaction.lastCompleted ??
    (compatible ? previous.lastCompleted : undefined);
  let pending = compatible ? previous.pendingCompleted : undefined;
  if (completed !== undefined && completed !== previous?.lastCompleted)
    pending = completed;
  const measurement = snapshot?.measurement;
  const valid =
    (row?.freshness === "fresh" || row?.freshness === "stale") &&
    measurement &&
    Number.isFinite(measurement.tokens) &&
    measurement.tokens >= 0;
  const at = measurement?.at ?? snapshot?.observedAt;
  let next = samples;
  if (at !== undefined && Number.isFinite(at)) {
    const last = samples.at(-1);
    // Ignore delayed observations, including old data arriving after compaction.
    if (!last || at >= last.at) {
      const reset =
        valid &&
        ((at === last?.at && last.compacted === true) ||
          (pending !== undefined &&
            measurement.at >= pending &&
            measurement.confidence === "reported" &&
            measurement.scope === "completed-request" &&
            snapshot?.compaction.phase !== "running"));
      const waiting = pending !== undefined && !reset;
      const tokens =
        valid && !waiting
          ? Math.max(reset ? 0 : (last?.tokens ?? 0), measurement.tokens)
          : last?.tokens;
      const held =
        tokens !== undefined &&
        (!valid || waiting || tokens !== measurement.tokens);
      const sample: ContextSample = {
        at,
        ...(tokens === undefined ? {} : { tokens }),
        ...(held ? { held: true } : {}),
        ...(reset || (at === last?.at && last.compacted)
          ? { compacted: true }
          : {}),
      };
      if (reset) pending = undefined;
      if (!last || (at > last.at && sample.tokens !== last.tokens)) {
        next = [...samples, sample].slice(-96);
      } else if (
        sample.at !== last.at ||
        sample.tokens !== last.tokens ||
        sample.held !== last.held ||
        sample.compacted !== last.compacted
      ) {
        // Unchanged/held observations update the latest column instead of
        // consuming history space with repeated levels.
        next = [...samples.slice(0, -1), sample];
      }
    }
  }
  return {
    sessionId,
    model,
    capacity,
    samples: next,
    ...(completed === undefined ? {} : { lastCompleted: completed }),
    ...(pending === undefined ? {} : { pendingCompleted: pending }),
  };
}

/** Share traces across sidebar/panel mounts without persisting provider data. */
export class ContextTraceStore {
  private readonly traces = new Map<string, ContextTrace>();
  update(row: GuardRow | undefined): ContextTrace {
    if (!row) return updateContextTrace(undefined, undefined);
    const id = row.node.sessionId;
    const trace = updateContextTrace(this.traces.get(id), row);
    this.traces.delete(id);
    this.traces.set(id, trace);
    if (this.traces.size > 128) {
      const oldest = this.traces.keys().next().value;
      if (oldest !== undefined) this.traces.delete(oldest);
    }
    return trace;
  }
  clear(): void {
    this.traces.clear();
  }
}

export interface ContextChartSegment {
  readonly text: string;
  readonly held: boolean;
  readonly tone: "axis" | "threshold" | "value" | "held";
}
export interface ContextChartLine {
  readonly line: string;
  readonly threshold: boolean;
  readonly segments?: readonly ContextChartSegment[];
}

/** Fixed capacity scale; held levels preserve bar geometry and render in a muted color. */
export function contextChart(
  samples: readonly ContextSample[],
  capacity: number | undefined,
  trigger: number | undefined,
  width: number,
  now?: number,
): ContextChartLine[] {
  if (
    capacity === undefined ||
    !Number.isFinite(capacity) ||
    capacity <= 0 ||
    width < 4
  )
    return [];
  const height = 8;
  const gutter = width >= 16 ? 4 : 0;
  const size = Math.max(1, Math.min(96, width - gutter - 2));
  const last = samples.at(-1);
  const paused =
    now !== undefined && last?.tokens !== undefined && now - last.at > 2500;
  const values = samples
    .slice(-size)
    .map((sample, index, visible) =>
      paused && index === visible.length - 1
        ? { ...sample, held: true }
        : sample,
    );
  const offset = size - values.length;
  const thresholdRow =
    trigger !== undefined &&
    Number.isFinite(trigger) &&
    trigger >= 0 &&
    trigger <= capacity
      ? Math.round((1 - trigger / capacity) * (height - 1))
      : -1;
  const blocks = " ▁▂▃▄▅▆▇█";
  const lines = Array.from({ length: height }, (_, row) => {
    const threshold = row === thresholdRow;
    const axis = gutter
      ? (row === 0 ? "100%" : row === height - 1 ? "0%" : "").padStart(gutter)
      : "";
    const plot = Array.from({ length: size }, (_, col) => {
      const sample = values[col - offset];
      const value = sample?.tokens;
      const fill =
        value === undefined
          ? 0
          : Math.max(
              0,
              Math.min(
                8,
                Math.ceil(
                  (Math.min(value / capacity, 1) * height -
                    (height - row - 1)) *
                    8,
                ),
              ),
            );
      const tone = sample?.held ? ("held" as const) : ("value" as const);
      if (fill > 0) return { text: blocks[fill] ?? " ", tone };
      if (threshold) return { text: "┄", tone: "threshold" as const };
      if (value === 0 && row === height - 1) return { text: "▁", tone };
      return { text: " ", tone: "axis" as const };
    });
    const line = `${axis}│${plot.map((cell) => cell.text).join("")}│`;
    const segments: ContextChartSegment[] = [
      { text: `${axis}│`, held: false, tone: "axis" },
    ];
    for (const cell of plot) {
      const { text, tone } = cell;
      const held = tone === "held";
      const previous = segments.at(-1);
      if (previous?.tone === tone)
        segments[segments.length - 1] = {
          text: previous.text + text,
          held,
          tone,
        };
      else segments.push({ text, held, tone });
    }
    segments.push({ text: "│", held: false, tone: "axis" });
    return { line, threshold, segments };
  });
  lines.push({
    line: `${" ".repeat(gutter)}└${"─".repeat(size)}┘`,
    threshold: false,
    segments: [
      {
        text: `${" ".repeat(gutter)}└${"─".repeat(size)}┘`,
        held: false,
        tone: "axis",
      },
    ],
  });
  return lines;
}
