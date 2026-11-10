import type { StyledText } from "@opentui/core";
import { cells, clip, quantity, wrap } from "../tui/format.ts";
import {
  compactionLabel,
  measurementLabel,
  pressureLabel,
  thresholdDistance,
} from "../tui/statusformat.ts";
import { metricPlot } from "../tui/chartformat.ts";
import { historyStatusLines } from "../historyclient.ts";
import { historyObservations, terminalDetail } from "./terminalview.ts";
import type { DashboardRow, DashboardView } from "./view.ts";

type Role =
  | "text"
  | "muted"
  | "heading"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "selected";
export interface TerminalSpan {
  readonly text: string;
  readonly role: Role;
}
export type TerminalLine = readonly TerminalSpan[];
const span = (text: string, role: Role = "text"): TerminalSpan => ({
  text,
  role,
});
const line = (text: string, role: Role = "text"): TerminalLine => [
  span(text, role),
];
export const plainLine = (value: TerminalLine) =>
  value.map((part) => part.text).join("");

/** Styles apply after sanitizing, wrapping and clipping; controls remain data. */
export function decorateTerminal(frame: string): TerminalLine[] {
  return frame.split("\n").map((text, index) => {
    const role: Role = text.startsWith("> ")
      ? "selected"
      : /Guard suspended|Agent failed|\bFAIL\b|\bFAILED\b/.test(text)
        ? "danger"
        : /[Ss]tale|[Rr]econnect|unknown|unavailable|unconfirmed|[Nn]ear threshold|[Tt]hreshold reached|suppressed/.test(
              text,
            )
          ? "warning"
          : index === 0 ||
              /^(Diagnostic codes|All snapshot|Exact |History:|Models|Agent \/ model)/.test(
                text,
              )
            ? "heading"
            : /^(Location:|Known |[?]|Enter detail|2 detail|Left\/Right|blank =|Retention )/.test(
                  text,
                )
              ? "muted"
              : "text";
    return line(text, role);
  });
}

/** Native terminal slots, never RGB palettes or terminal color detection. */
export function terminalStyler(
  api: Pick<
    typeof import("@opentui/core"),
    "RGBA" | "StyledText" | "TextAttributes"
  >,
) {
  const { RGBA, StyledText, TextAttributes: attrs } = api;
  const foreground = RGBA.defaultForeground();
  const background = RGBA.defaultBackground();
  const roles = {
    text: { fg: foreground, attributes: attrs.NONE },
    muted: { fg: foreground, attributes: attrs.DIM },
    heading: { fg: foreground, attributes: attrs.BOLD },
    accent: { fg: RGBA.fromIndex(6), attributes: attrs.BOLD },
    success: { fg: RGBA.fromIndex(2), attributes: attrs.NONE },
    warning: { fg: RGBA.fromIndex(3), attributes: attrs.NONE },
    danger: { fg: RGBA.fromIndex(1), attributes: attrs.BOLD },
    selected: { fg: foreground, attributes: attrs.BOLD | attrs.INVERSE },
  };
  return (lines: readonly TerminalLine[]): StyledText =>
    new StyledText(
      lines.flatMap((parts, index) => [
        ...(index
          ? [
              {
                __isChunk: true as const,
                text: "\n",
                fg: foreground,
                bg: background,
                attributes: attrs.NONE,
              },
            ]
          : []),
        ...parts.map((part) => ({
          __isChunk: true as const,
          text: part.text,
          bg: background,
          ...roles[part.role],
        })),
      ]),
    );
}

function fit(parts: TerminalLine, width: number): TerminalLine {
  const result: TerminalSpan[] = [];
  let left = width;
  for (const part of parts) {
    if (left <= 0) break;
    const text = clip(part.text, left);
    result.push(span(text, part.role));
    left -= cells(text);
  }
  if (left > 0) result.push(span(" ".repeat(left)));
  return result;
}

function box(
  title: string,
  content: readonly TerminalLine[],
  width: number,
  height = content.length + 2,
): TerminalLine[] {
  const label = ` ${clip(title, width - 6)} `;
  return [
    [
      span("╭─", "muted"),
      span(label, "accent"),
      span("─".repeat(Math.max(0, width - cells(label) - 3)) + "╮", "muted"),
    ],
    ...Array.from({ length: Math.max(0, height - 2) }, (_, i) => [
      span("│ ", "muted"),
      ...fit(content[i] ?? [], width - 4),
      span(" │", "muted"),
    ]),
    line("╰" + "─".repeat(width - 2) + "╯", "muted"),
  ];
}

function beside(
  left: readonly TerminalLine[],
  right: readonly TerminalLine[],
  width: number,
): TerminalLine[] {
  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => [
    ...fit(left[i] ?? [], width),
    span("  "),
    ...(right[i] ?? []),
  ]);
}

function pressureRole(row: DashboardRow): Role {
  return row.freshness !== "fresh" || row.pressure === "unknown"
    ? "muted"
    : row.pressure === "crossed"
      ? "danger"
      : row.pressure === "near"
        ? "warning"
        : "success";
}

function occupancy(row: DashboardRow): string {
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  return `${valid && row.snapshot?.measurement?.confidence === "approximate" ? "~" : ""}${valid && row.utilizationPercent !== undefined ? Math.round(row.utilizationPercent) : "?"}%`;
}

function meter(row: DashboardRow, width: number): TerminalLine {
  if (
    row.freshness === "missing" ||
    row.freshness === "invalid" ||
    row.utilizationPercent === undefined
  )
    return line("Context unavailable", "muted");
  const used = Math.round(
    (Math.max(0, Math.min(100, row.utilizationPercent)) / 100) * width,
  );
  const trigger = row.snapshot?.policy.triggerTokens;
  const capacity = row.snapshot?.capacityTokens;
  const marker =
    trigger !== undefined &&
    capacity !== undefined &&
    capacity > 0 &&
    trigger >= 0 &&
    trigger <= capacity
      ? Math.min(width - 1, Math.floor((trigger / capacity) * width))
      : -1;
  return Array.from({ length: width }, (_, i) =>
    span(
      i === marker ? "┆" : i < used ? "━" : "─",
      i === marker || i >= used ? "muted" : pressureRole(row),
    ),
  );
}

/** Virtualized session tree; only the visible identities are formatted. */
export function workspaceTree(
  view: DashboardView,
  width: number,
  height: number,
): TerminalLine[] {
  const selected = view.rows.findIndex(
    (row) => row.node.sessionId === view.selectedSessionId,
  );
  const count = Math.max(1, Math.floor((height - 4) / 3));
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(count / 2), view.rows.length - count),
  );
  const content: TerminalLine[] = [
    line(
      `${view.inventory.monitored} monitored · ${view.inventory.active} active`,
      "muted",
    ),
    [],
  ];
  for (
    let index = start;
    index < Math.min(view.rows.length, start + count);
    index++
  ) {
    const row = view.rows[index];
    if (!row) continue;
    const chosen = row.node.sessionId === view.selectedSessionId;
    const prefix = `${chosen ? ">" : " "} #${index + 1} ${row.depth ? " ".repeat(Math.min(row.depth - 1, 3)) + "└ " : ""}`;
    content.push(
      line(
        clip(prefix + (row.node.agent ?? "unknown agent"), width - 4),
        chosen ? "selected" : "heading",
      ),
    );
    const state =
      row.node.status === "failed"
        ? "FAIL"
        : row.node.status === "running"
          ? "RUN"
          : row.node.status === "completed"
            ? "DONE"
            : row.node.status === "idle"
              ? "IDLE"
              : "?";
    content.push([
      span(`  ${occupancy(row)} `, pressureRole(row)),
      span(
        state,
        state === "FAIL" ? "danger" : state === "RUN" ? "success" : "muted",
      ),
      span(
        row.freshness === "fresh"
          ? ` · ${clip(row.node.model ?? "?", Math.max(1, width - 21))}`
          : ` · ${row.freshness}`,
        "muted",
      ),
    ]);
    content.push([]);
  }
  if (!view.rows.length) content.push(line("No matching sessions", "muted"));
  return box(
    `SESSIONS ${view.rows.length ? `${start + 1}–${Math.min(view.rows.length, start + count)}/${view.rows.length}` : "0"}`,
    content,
    width,
    height,
  );
}

function summary(view: DashboardView, width: number): TerminalLine[] {
  const row = view.selected;
  if (!row)
    return [line("No selected session; choose one in overview.", "muted")];
  const snapshot = row.snapshot;
  const valid = row.freshness === "fresh" || row.freshness === "stale";
  const contextWidth = Math.floor((width - 2) * 0.56);
  const performanceWidth = width - contextWidth - 2;
  const p = snapshot?.performance;
  const fresh =
    row.performanceAvailable && row.performanceFreshness === "fresh";
  const rate = (n: number | undefined) =>
    n === undefined || !Number.isFinite(n) ? "?" : n.toFixed(1);
  const context = box(
    "CONTEXT",
    [
      line(
        `${row.freshness === "stale" ? "Last measured " : ""}${occupancy(row)} occupied`,
        pressureRole(row),
      ),
      line(
        `${quantity(valid ? snapshot?.measurement?.tokens : undefined)} / ${quantity(snapshot?.capacityTokens)} tokens`,
      ),
      [],
      meter(row, contextWidth - 4),
      line(`┆ trigger ${quantity(snapshot?.policy.triggerTokens)}`, "muted"),
      line(pressureLabel(row), pressureRole(row)),
      line(thresholdDistance(row)),
      line(measurementLabel(row, row.measurementAgeMs), "muted"),
    ],
    contextWidth,
  );
  const performance = box(
    "PERFORMANCE",
    [
      [
        span(
          fresh
            ? p?.status === "waiting"
              ? "waiting"
              : `~${rate(p?.liveTps)}`
            : "?",
          "accent",
        ),
        span(" live TPS"),
      ],
      line(
        `${fresh && p?.ttftMs !== undefined ? "~" + (p.ttftMs / 1000).toFixed(2) + "s" : "?"} TTFT`,
      ),
      [],
      line(`${fresh ? rate(p?.averageModelTps) : "?"} avg model TPS`),
      line(`${fresh ? rate(p?.averageSessionTps) : "?"} avg session TPS`),
      line(
        `performance ${fresh ? (p?.status ?? "unknown") : row.performanceFreshness}`,
        fresh ? "text" : "warning",
      ),
      line(
        p?.partial ? "Partial timing coverage" : "~ estimated / approximate",
        "muted",
      ),
      line("TPS: tokens/sec · TTFT: delay", "muted"),
    ],
    performanceWidth,
  );
  return [
    line(
      clip(
        `${row.node.agent ?? "unknown agent"} / ${row.node.model ?? "unknown model"}`,
        width,
      ),
      "heading",
    ),
    line(clip(`Session ID: ${row.node.sessionId}`, width), "muted"),
    ...beside(context, performance, contextWidth),
    ...wrap(
      compactionLabel(row) ?? "No compaction request in progress.",
      width,
    ).map((text) =>
      line(
        text,
        snapshot?.compaction.phase === "blocked" ||
          snapshot?.compaction.phase === "uncertain"
          ? "warning"
          : "text",
      ),
    ),
    line(
      `Completed compactions: ${quantity(snapshot?.compaction.count)} · admission is not completion`,
      "muted",
    ),
  ];
}

function overviewHistory(view: DashboardView, width: number): TerminalLine[] {
  const h = view.history;
  const observations = historyObservations(view, 0);
  const status = historyStatusLines(h)
    .flatMap((text) => wrap(text, width - 4))
    .map((text) => line(text, "warning"));
  if (!h.result?.enabled || h.from === undefined || h.to === undefined) {
    return box(
      "RETAINED LIVE TPS",
      [
        ...status,
        line("3 history · load retained measurements", "muted"),
        line("Recorded samples appear here after opening History.", "muted"),
      ],
      width,
    );
  }
  const gaps = [
    ...h.result.data.gaps.map((gap) => gap.time),
    ...h.result.data.series.flatMap((series) =>
      series.points
        .filter((point) => point.breakBefore)
        .map((point) => point.time),
    ),
  ];
  return box(
    `RETAINED LIVE TPS / ${h.windowMs / 60000} MINUTES`,
    [
      ...status,
      line(
        `${new Date(h.from).toISOString()} → ${new Date(h.to).toISOString()}`,
        "muted",
      ),
      ...metricPlot(
        observations.map((p) => ({
          time: p.time,
          ...(p.value === undefined ? {} : { value: p.value }),
        })),
        h.from,
        h.to,
        width - 4,
        gaps,
      ).map((text) => line(text, "accent")),
      line("Blank = no sample · ┆ gap · ~ estimated", "muted"),
      ...(h.summary?.partial
        ? [line("Partial timing coverage", "warning")]
        : []),
      line("3 history · inspect exact samples and range", "muted"),
    ],
    width,
  );
}

export function workspaceContent(
  view: DashboardView,
  width: number,
  notices: readonly string[],
): TerminalLine[] {
  return [
    ...(view.screen === "overview" && notices.length > 2
      ? [...notices.slice(0, 1), `${notices.length} notices · see Details`]
      : notices
    )
      .flatMap((text) =>
        view.screen === "overview" ? [clip(text, width)] : wrap(text, width),
      )
      .map((text) => line(text, "warning")),
    ...summary(view, width),
    [],
    ...(view.screen === "detail"
      ? decorateTerminal(
          terminalDetail(view.selected)
            .flatMap((text) => wrap(text, width))
            .join("\n"),
        )
      : overviewHistory(view, width)),
  ];
}

export function workspaceFrame(
  header: readonly string[],
  view: DashboardView,
  width: number,
  height: number,
  content: readonly TerminalLine[],
  scroll: number,
  footer: string,
): TerminalLine[] {
  const leftWidth = Math.min(34, Math.floor(width * 0.27));
  const bodyHeight = height - header.length - 3;
  const right = content.slice(scroll, scroll + bodyHeight);
  const tree = workspaceTree(view, leftWidth, bodyHeight);
  return [
    ...decorateTerminal(header.join("\n")),
    [
      span(" 1 Overview ", view.screen === "overview" ? "selected" : "muted"),
      span("  2 Detail ", view.screen === "detail" ? "selected" : "muted"),
      span("  3 History   4 Models", "muted"),
    ],
    ...beside(tree, right, leftWidth),
    line("─".repeat(width), "muted"),
    line(clip(footer, width), "muted"),
  ].map((parts) => fit(parts, width));
}

export function workspaceWidth(width: number): number {
  return width - Math.min(34, Math.floor(width * 0.27)) - 2;
}
