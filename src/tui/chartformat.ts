import type { ChartPoint, ChartRequest } from "../charts.ts";
import type { HistoryChartResult } from "../historycharts.ts";
import { wrap } from "./format.ts";

/** Each cell contains an observed peak, never an interpolated or invented zero. */
export function sparkline(
  points: readonly { time: number; value?: number }[],
  from: number,
  to: number,
  width: number,
  gaps: readonly number[] = [],
): { line: string; min?: number; max?: number } {
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
export function historyChartLines(
  result: HistoryChartResult,
  width: number,
  from: number,
  to: number,
): string[] {
  if (!result.enabled)
    return wrap("History recording is disabled on this server.", width);
  const series = result.data.series[0];
  if (!series) return wrap("No retained measurements in this window.", width);
  const gaps = result.data.gaps.map((g) => g.time);
  const chart = (
    label: string,
    unit: string,
    points: readonly { time: number; value?: number }[],
  ) => {
    const plotted = sparkline(points, from, to, width - 2, gaps);
    return [
      ...wrap(
        `${label}${plotted.min === undefined ? ": unavailable" : ` · ${plotted.min.toFixed(1)}–${plotted.max?.toFixed(1)} ${unit}`}`,
        width,
      ),
      `│${plotted.line}│`,
    ];
  };
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
  return [
    ...chart("Live TPS ~", "t/s", observations("liveTps")),
    "",
    ...chart("Avg model", "t/s", observations("averageModelTps")),
    "",
    ...chart("Avg session", "t/s", observations("averageSessionTps")),
    "",
    ...chart("TTFT ~", "s", requests("ttftMs")),
    "",
    ...chart("Request throughput", "t/s", requests("tps")),
    "",
    ...chart(
      "Cumulative output",
      "tokens",
      observations("sessionOutputTokens"),
    ),
    "",
    ...wrap(
      "UTC time → · observed peaks per column · blank = no sample · ┆ = gap",
      width,
    ),
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
