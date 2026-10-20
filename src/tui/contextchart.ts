import type { GuardRow } from "../family.ts";

export interface ContextSample {
  readonly at: number;
  readonly tokens?: number;
}
export interface ContextTrace {
  readonly sessionId: string;
  readonly model: string | undefined;
  readonly capacity: number | undefined;
  readonly samples: readonly ContextSample[];
}

/** Keep only actual measurements, never copies made by age/render ticks. */
export function updateContextTrace(
  previous: ContextTrace | undefined,
  row: GuardRow | undefined,
): ContextTrace {
  const snapshot = row?.snapshot;
  const model = snapshot?.model ?? row?.node.model;
  const capacity = snapshot?.capacityTokens;
  const sessionId = row?.node.sessionId ?? "";
  const samples =
    previous?.sessionId === sessionId &&
    previous.model === model &&
    previous.capacity === capacity
      ? previous.samples
      : [];
  const measurement = snapshot?.measurement;
  const valid =
    (row?.freshness === "fresh" || row?.freshness === "stale") &&
    measurement &&
    Number.isFinite(measurement.tokens) &&
    measurement.tokens >= 0;
  const at = measurement?.at ?? snapshot?.observedAt;
  let next = samples;
  if (at !== undefined && Number.isFinite(at)) {
    const sample: ContextSample = {
      at,
      ...(valid ? { tokens: measurement.tokens } : {}),
    };
    const last = samples.at(-1);
    if (!last || at > last.at) next = [...samples, sample].slice(-96);
    else if (at === last.at && sample.tokens !== last.tokens)
      next = [...samples.slice(0, -1), sample];
  }
  return { sessionId, model, capacity, samples: next };
}

export interface ContextChartLine {
  readonly line: string;
  readonly threshold: boolean;
}

/** Fixed capacity scale and observation order; no interpolation across missing samples. */
export function contextChart(
  samples: readonly ContextSample[],
  capacity: number | undefined,
  trigger: number | undefined,
  width: number,
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
  const values = samples.slice(-size);
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
      const value = values[col - offset]?.tokens;
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
      if (threshold) return fill > 0 ? "╂" : "┄";
      if (value === 0 && row === height - 1) return "▁";
      return blocks[fill] ?? " ";
    }).join("");
    return { line: `${axis}│${plot}│`, threshold };
  });
  lines.push({
    line: `${" ".repeat(gutter)}└${"─".repeat(size)}┘`,
    threshold: false,
  });
  return lines;
}
