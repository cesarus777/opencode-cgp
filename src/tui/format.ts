import type { GuardRow } from "../family.ts";
export function quantity(n: number | undefined): string {
  return n === undefined || !Number.isFinite(n)
    ? "?"
    : Math.abs(n) >= 1000000
      ? `${(n / 1000000).toFixed(1)}m`
      : Math.abs(n) >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : String(n);
}
// Sanitize controls and use grapheme boundaries. Wide CJK/emoji occupy two cells;
// combining marks and joiners stay attached to their grapheme.
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function cells(value: string) {
  return [...segmenter.segment(value)].reduce(
    (n, { segment }) => n + graphemeWidth(segment),
    0,
  );
}
function graphemeWidth(s: string) {
  const cp = s.codePointAt(0) ?? 0;
  if (/^[\p{Mark}\u200d\ufe0f]+$/u.test(s)) return 0;
  return /[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(s) ||
    (cp >= 0x1100 &&
      (cp <= 0x115f ||
        (cp >= 0x2329 && cp <= 0x232a) ||
        (cp >= 0x2e80 && cp <= 0xa4cf) ||
        (cp >= 0xac00 && cp <= 0xd7a3) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0xfe10 && cp <= 0xfe6f) ||
        (cp >= 0xff01 && cp <= 0xff60) ||
        cp >= 0x20000))
    ? 2
    : 1;
}
export function clip(value: string, width: number) {
  const clean = sanitize(value);
  if (cells(clean) <= width) return clean;
  let result = "",
    used = 0;
  for (const { segment } of segmenter.segment(clean)) {
    const size = graphemeWidth(segment);
    if (used + size > Math.max(0, width - 3)) break;
    result += segment;
    used += size;
  }
  return width < 3 ? ".".repeat(Math.max(0, width)) : result + "...";
}
const statuses = {
  running: "RUN",
  idle: "IDLE",
  completed: "DONE",
  failed: "FAIL",
  unknown: "?",
} as const;
export function rowLines(row: GuardRow, width: number) {
  const s = row.snapshot,
    m = s?.measurement;
  const prefix = row.current
    ? "* "
    : row.depth > 5
      ? ".../"
      : " ".repeat(Math.min(row.depth, 5)) + "|-";
  const percent =
    row.utilizationPercent === undefined
      ? "?"
      : `${row.utilizationPercent.toFixed(1)}%`;
  const warning =
    row.freshness === "stale"
      ? " STALE"
      : row.pressure === "crossed"
        ? " !! crossed"
        : row.pressure === "near"
          ? " ! near"
          : "";
  const suffix = ` ${statuses[row.node.status]} ${m?.confidence === "approximate" ? "~" : ""}${percent}${warning}`;
  const label = clip(
    `${prefix}${row.node.agent ?? row.node.sessionId}`,
    Math.max(1, width - cells(suffix)),
  );
  return [
    clip(`${label}${suffix}`, width),
    ...performanceLines(row, width),
    ...wrap(
      `${quantity(m?.tokens)}/${quantity(s?.capacityTokens)} input; to ${quantity(row.triggerDeltaTokens)}`,
      width,
    ),
    ...(s && s.compaction.phase !== "idle"
      ? wrap(`compact: ${s.compaction.phase}`, width)
      : []),
    ...(row.node.interrupted ? [clip("interrupted", width)] : []),
    ...(row.hidden ? wrap(`+ ${row.hidden} completed descendants`, width) : []),
  ];
}
export function detailLines(
  row: GuardRow | undefined,
  width: number,
  expanded = false,
  ageMs = 0,
) {
  const s = row?.snapshot,
    m = s?.measurement;
  if (!row) return wrap("Loading session family...", width);
  if (!s)
    return [
      ...wrap(
        `${row.node.agent ?? row.node.sessionId} / ${row.node.model ?? "?"}`,
        width,
      ),
      ...wrap("Guard: not monitored / unavailable", width),
    ];
  const threshold = s.policy.configured;
  const headroom = row.triggerDeltaTokens;
  const lines = [
    `${s.agent ?? "?"} / ${s.model ?? "?"}`,
    ...performanceLines(row, width),
    `${m?.confidence === "approximate" ? "~" : ""}${quantity(m?.tokens)} / ${quantity(s.capacityTokens)} input`,
    `${row.utilizationPercent?.toFixed(1) ?? "?"}% ${row.pressure === "crossed" ? "!! crossed" : row.pressure === "near" ? "! near" : row.freshness.toUpperCase()}`,
    `Trigger ${threshold.type === "ratio" ? `${threshold.value * 100}%` : `${threshold.value} ${threshold.type}`} (${s.policy.comparison})`,
    `Resolved trigger ${s.policy.triggerTokens ?? "?"}`,
    `Until trigger ${quantity(headroom)}`,
    `Compact: ${s.compaction.phase}`,
    `${s.compaction.armed ? "armed" : "disarmed"}${s.compaction.blockedReason ? ` / ${s.compaction.blockedReason}` : ""}`,
    m ? `${m.confidence} ${m.scope}` : "measurement unknown",
    m ? `${Math.floor(Math.max(0, ageMs) / 1000)}s ago; ${row.freshness}` : "",
  ];
  if (expanded)
    lines.push(
      `Policy ${s.policy.id}: ${s.policy.reason}`,
      `Limits in/context/out ${quantity(s.limits?.input)}/${quantity(s.limits?.context)}/${quantity(s.limits?.output)}`,
      `Output reserve ${quantity(s.outputReserveTokens)}`,
      `Provenance ${m?.provenance ?? "?"}`,
      `Cooldown until ${s.compaction.cooldownUntil ?? "?"}`,
      `Cumulative (${s.cumulativeScope})`,
      `Input ${quantity(s.cumulative?.input)} output ${quantity(s.cumulative?.output)}`,
      `Reasoning ${quantity(s.cumulative?.reasoning)}`,
      `Cache read ${quantity(s.cumulative?.cache.read)} write ${quantity(s.cumulative?.cache.write)}`,
    );
  return lines.filter(Boolean).flatMap((line) => wrap(line, width));
}
function sanitize(value: string): string {
  return value
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}
export function wrap(value: string, width: number): string[] {
  const result: string[] = [];
  let part = "";
  for (const word of sanitize(value).split(" ")) {
    if (part && cells(part + " " + word) > width) {
      result.push(part);
      part = "";
    }
    for (const { segment } of segmenter.segment((part ? " " : "") + word)) {
      if (part && cells(part + segment) > width) {
        result.push(part);
        part = "";
      }
      part += cells(segment) <= width ? segment : "?";
    }
  }
  if (part) result.push(part);
  return result;
}

export function performanceLines(row: GuardRow, width: number): string[] {
  const p = row.snapshot?.performance;
  if (!p) return [];
  const value = (n: number | undefined) =>
    n === undefined ? "?" : n.toFixed(1);
  return [
    ...wrap(
      `TPS ${p.status === "waiting" ? "waiting" : `${p.status === "streaming" ? "~" : ""}${value(p.liveTps)}`} · ${p.status}${p.partial ? " · partial" : ""}`,
      width,
    ),
    ...wrap(
      `Avg model ${value(p.averageModelTps)} · Avg session ${value(p.averageSessionTps)}`,
      width,
    ),
    ...wrap(
      `TTFT ${p.ttftMs === undefined ? "?" : `~${(p.ttftMs / 1000).toFixed(2)}s`}${p.latestRequestTps === undefined ? "" : ` · Last ${value(p.latestRequestTps)} t/s`}`,
      width,
    ),
  ];
}
