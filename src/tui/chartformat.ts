import type { ChartPoint, ChartRequest } from "../charts.ts";
import type { HistoryChartResult } from "../historycharts.ts";
import { wrap } from "./format.ts";

/** Each cell contains an observed peak, never an interpolated or invented zero. */
function columns(
  points: readonly { time: number; value?: number }[],
  from: number,
  to: number,
  width: number,
  gaps: readonly number[] = [],
) {
  const size = Math.max(1, Math.min(120, Math.floor(width))),
    values: (number | undefined)[] = Array.from({ length: size });
  const column = (time: number) =>
    Math.max(
      0,
      Math.min(
        size - 1,
        Math.floor(((time - from) / Math.max(1, to - from)) * (size - 1)),
      ),
    );
  let min = Infinity,
    max = -Infinity;
  for (const point of points) {
    if (
      point.time < from ||
      point.time > to ||
      point.value === undefined ||
      !Number.isFinite(point.value) ||
      point.value < 0
    )
      continue;
    min = Math.min(min, point.value);
    max = Math.max(max, point.value);
    const i = column(point.time);
    values[i] = Math.max(values[i] ?? -Infinity, point.value);
  }
  for (const time of gaps)
    if (time >= from && time <= to) values[column(time)] = undefined;
  return { values, column, min, max };
}
export function sparkline(
  points: readonly { time: number; value?: number }[],
  from: number,
  to: number,
  width: number,
  gaps: readonly number[] = [],
): { line: string; min?: number; max?: number } {
  const { values, column, min, max } = columns(points, from, to, width, gaps);
  const bars = "▁▂▃▄▅▆▇█";
  const chars = values.map((v) =>
    v === undefined
      ? " "
      : (bars[Math.min(7, Math.floor((v / Math.max(1, max)) * 7))] ?? "▁"),
  );
  for (const time of gaps)
    if (time >= from && time <= to) chars[column(time)] = "┆";
  return { line: chars.join(""), ...(min === Infinity ? {} : { min, max }) };
}

export const chartMetrics = [
  { label: "Live TPS ~", unit: "t/s", key: "liveTps", source: "points" },
  { label: "Avg model", unit: "t/s", key: "averageModelTps", source: "points" },
  {
    label: "Avg session",
    unit: "t/s",
    key: "averageSessionTps",
    source: "points",
  },
  { label: "TTFT ~", unit: "s", key: "ttftMs", source: "requests" },
  { label: "Request throughput", unit: "t/s", key: "tps", source: "requests" },
  {
    label: "Cumulative output",
    unit: "tokens",
    key: "sessionOutputTokens",
    source: "points",
  },
] as const;

/** Plot only observed column peaks; leave missing data and gaps disconnected. */
export function metricPlot(
  points: readonly { time: number; value?: number }[],
  from: number,
  to: number,
  width: number,
  gaps: readonly number[] = [],
): string[] {
  const label = (value: number) =>
    value >= 1000000
      ? `${(value / 1000000).toFixed(1)}M`
      : value >= 1000
        ? `${(value / 1000).toFixed(1)}k`
        : value.toFixed(1);
  const peak = Math.max(
    0,
    ...points
      .filter((p) => p.time >= from && p.time <= to && Number.isFinite(p.value))
      .map((p) => p.value ?? 0),
  );
  const scale = Math.max(1, peak);
  const gutter = width >= 20 ? Math.max(label(scale).length, 3) : 0;
  const { values, column } = columns(
    points,
    from,
    to,
    Math.max(1, width - gutter - 2),
    gaps,
  );
  const gapColumns = new Set(
    gaps.filter((time) => time >= from && time <= to).map(column),
  );
  const height = 6;
  const blocks = " ▁▂▃▄▅▆▇█";
  const lines = Array.from({ length: height }, (_, row) => {
    const axis = gutter
      ? (row === 0 ? label(scale) : row === height - 1 ? "0.0" : "").padStart(
          gutter,
        )
      : "";
    return `${axis}│${values
      .map((value, i) => {
        if (gapColumns.has(i)) return "┆";
        if (value === undefined) return " ";
        const fill = Math.max(
          0,
          Math.min(
            8,
            Math.ceil(((value / scale) * height - (height - row - 1)) * 8),
          ),
        );
        return value === 0 && row === height - 1 ? "▁" : blocks[fill];
      })
      .join("")}│`;
  });
  lines.push(`${" ".repeat(gutter)}└${"─".repeat(values.length)}┘`);
  const start = new Date(from).toISOString().slice(11, 16),
    end = new Date(to).toISOString().slice(11, 16);
  const axisWidth = values.length + 2;
  if (axisWidth >= 11)
    lines.push(
      `${" ".repeat(gutter)}${start}${" ".repeat(axisWidth - 10)}${end}`,
    );
  return lines;
}

export function historyChartLines(
  result: HistoryChartResult,
  width: number,
  from: number,
  to: number,
  metricIndex = 0,
): string[] {
  if (!result.enabled)
    return wrap("History recording is disabled on this server.", width);
  const series = result.data.series[0];
  if (!series) return wrap("No retained measurements in this window.", width);
  const gaps = result.data.gaps.map((g) => g.time);
  const observations = (
    key: keyof Pick<
      ChartPoint,
      | "liveTps"
      | "averageModelTps"
      | "averageSessionTps"
      | "sessionOutputTokens"
    >,
  ) =>
    series.points.map((p) => ({
      time: p.time,
      ...(p[key] === undefined ? {} : { value: p[key] }),
    }));
  const requests = (key: keyof Pick<ChartRequest, "ttftMs" | "tps">) =>
    series.requests.map((p) => ({
      time: p.time,
      ...(p[key] === undefined
        ? {}
        : { value: key === "ttftMs" ? p[key] / 1000 : p[key] }),
    }));
  const metric = chartMetrics[metricIndex] ?? chartMetrics[0];
  const points =
    metric.source === "points"
      ? observations(metric.key)
      : requests(metric.key);
  const plotted = sparkline(points, from, to, width - 2, gaps);
  return [
    ...wrap(
      `‹ ${metric.label} › · ${metricIndex + 1}/${chartMetrics.length}`,
      width,
    ),
    ...wrap(
      plotted.min === undefined
        ? "No measurements for this metric."
        : `${plotted.min.toFixed(1)}–${plotted.max?.toFixed(1)} ${metric.unit} · observed range`,
      width,
    ),
    "",
    ...metricPlot(points, from, to, width, gaps),
    "",
    ...wrap("UTC time → · peaks per column", width),
    ...wrap("blank = no sample · ┆ = gap", width),
    ...wrap(
      `${new Date(from).toISOString()} → ${new Date(to).toISOString()}`,
      width,
    ),
    ...(series.points.some((p) => p.partial)
      ? wrap(
          "Partial timing coverage; averages include only matched model durations.",
          width,
        )
      : []),
    ...(result.truncated
      ? wrap(
          "Downsampled/bounded history; some older requests or gap markers may be omitted.",
          width,
        )
      : []),
    ...(result.metadata.malformedRecords
      ? wrap(
          `${result.metadata.malformedRecords} malformed/partial records skipped.`,
          width,
        )
      : []),
  ];
}
