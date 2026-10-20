import type { ChartData } from "./charts.ts";
import type { readPerformanceHistory } from "./history.ts";

type ReportMetadata = Awaited<
  ReturnType<typeof readPerformanceHistory>
>["metadata"];
interface ChartReport {
  data: ChartData;
  metadata: ReportMetadata;
  agent?: string;
  model?: string;
  from?: number;
  to?: number;
}

/** Offline, self-contained SVG report. Generated identities only enter text nodes or escaped JSON. */
export function renderChartReport(report: ChartReport): string {
  const payload = JSON.stringify(report).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob: data:; connect-src 'none'">
<title>Context Guard · Performance history</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0b1120;color:#e2e8f0}*{box-sizing:border-box}body{max-width:1600px;margin:auto;padding:28px}h1{font-size:28px;letter-spacing:-.03em;margin:8px 0}h2{font-size:16px;margin:0}p{color:#a8b5cb;line-height:1.6;margin:8px 0}.eyebrow{color:#7dd3fc;font-size:12px;letter-spacing:.13em;text-transform:uppercase}.toolbar,.stats,.charts{display:grid;gap:14px;margin-top:22px}.toolbar{grid-template-columns:2fr 1fr 1fr 1.4fr 1.4fr auto;align-items:end}label{font-size:12px;color:#a8b5cb;display:grid;gap:7px}select,input,button{background:#172338;border:1px solid #33435a;border-radius:7px;color:inherit;padding:10px;min-width:0;font:inherit}button{cursor:pointer;font-size:12px}button:hover,button:focus-visible{border-color:#7dd3fc}select:focus-visible,input:focus-visible{outline:2px solid #7dd3fc}.stats{grid-template-columns:repeat(4,1fr)}.stat,.chart{background:#111c2e;border:1px solid #26354e;border-radius:12px;padding:18px}.stat strong{font-size:24px;display:block;margin-top:7px}.stat span{font-size:12px;color:#a8b5cb}.charts{grid-template-columns:repeat(2,minmax(0,1fr))}.charthead{display:flex;justify-content:space-between;align-items:center;gap:10px}.chart p{font-size:12px;min-height:38px}.chart svg{display:block;width:100%;height:auto}.notice{padding:12px 15px;border-left:3px solid #fbbf24;background:#201f2d;font-size:13px;margin-top:15px}.legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px;font-size:12px}.legend span{overflow-wrap:anywhere}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:7px}.empty{padding:30px;text-align:center;color:#a8b5cb}.tooltip{position:fixed;z-index:5;pointer-events:none;background:#e2e8f0;color:#0b1120;border-radius:7px;padding:10px;max-width:360px;white-space:pre-wrap;font-size:12px;box-shadow:0 8px 30px #0008}footer{margin-top:25px;font-size:12px;color:#a8b5cb}svg circle:focus{outline:none;stroke:white;stroke-width:3}@media(max-width:1000px){.toolbar{grid-template-columns:repeat(2,minmax(0,1fr))}.charts{grid-template-columns:1fr}}@media(max-width:600px){body{padding:16px}.stats{grid-template-columns:repeat(2,1fr)}}@media print{button,.toolbar,.tooltip{display:none}body{padding:0}.chart{break-inside:avoid}.charts{grid-template-columns:1fr}}
</style></head><body>
<header><span class="eyebrow">Context Guard / Local analysis</span><h1>Performance history</h1><p>Compare agent instances over time. All timestamps are UTC. This report is an offline snapshot of retained metrics.</p></header>
<section class="toolbar" aria-label="Chart filters">
<label>Session instance<select id="session"></select></label><label>Agent<select id="agent"></select></label><label>Model<select id="model"></select></label>
<label>From (UTC)<input id="from" type="datetime-local" step="1"></label><label>To (UTC)<input id="to" type="datetime-local" step="1"></label><button id="reset">Reset filters</button>
</section>
<div id="notice" class="notice" role="status"></div><section id="stats" class="stats" aria-label="Request statistics"></section>
<div id="legend" class="legend"></div><main id="charts" class="charts"></main>
<footer>Live TPS uses a character estimate; TTFT includes output publication delay. Dashed curves mark estimates or partial observations. Gaps and missing samples are never filled with zero. Request statistics use retained matching requests; average curves retain the session's original cumulative totals. Agent/model filters select observations, not recomputed lifetime averages. Exported SVGs reflect the current filters. Regenerate this report to include new history.</footer>
<div id="tooltip" class="tooltip" hidden role="tooltip"></div>
<script id="chart-data" type="application/json">${payload}</script>
<script>(${chartClient.toString()})(JSON.parse(document.getElementById("chart-data").textContent));</script>
</body></html>`;
}

// Keep the client self-contained: its compiled function is embedded in the report.
function chartClient(report: ChartReport) {
  const { data, metadata } = report;
  const element = <T extends HTMLElement>(
    id: string,
    kind: { new (): T },
  ): T => {
    const node = document.getElementById(id);
    if (!(node instanceof kind))
      throw new Error(`Missing report element ${id}`);
    return node;
  };
  const session = element("session", HTMLSelectElement),
    agent = element("agent", HTMLSelectElement),
    model = element("model", HTMLSelectElement);
  const from = element("from", HTMLInputElement),
    to = element("to", HTMLInputElement);
  const charts = element("charts", HTMLElement),
    stats = element("stats", HTMLElement),
    legend = element("legend", HTMLElement);
  const notice = element("notice", HTMLElement),
    tooltip = element("tooltip", HTMLElement);
  const color = (index: number) =>
    `hsl(${(index * 137.508 + 195) % 360}, 78%, 68%)`;
  const date = (value: number) => {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d.toISOString() : String(value);
  };
  const number = (n: number | undefined, digits = 1) =>
    n === undefined
      ? "Unavailable"
      : n.toLocaleString("en-US", { maximumFractionDigits: digits });
  function options(
    select: HTMLSelectElement,
    values: { value: string; label: string }[],
  ) {
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v.value;
      o.textContent = v.label;
      select.append(o);
    }
  }
  options(session, [
    { value: "*", label: "Compare sessions (up to 12)" },
    ...data.series.map((s) => ({
      value: s.sessionId,
      label: `${s.agents.join(", ") || "Agent"} · ${s.sessionId}`,
    })),
  ]);
  options(agent, [
    { value: "*", label: "All agents" },
    ...[...new Set(data.series.flatMap((s) => s.agents))]
      .sort()
      .map((v) => ({ value: v, label: v })),
  ]);
  options(model, [
    { value: "*", label: "All models" },
    ...[...new Set(data.series.flatMap((s) => s.models))]
      .sort()
      .map((v) => ({ value: v, label: v })),
  ]);
  function reset() {
    session.value = data.series[0]?.sessionId ?? "*";
    agent.value = report.agent ?? "*";
    model.value = report.model ?? "*";
    from.value =
      report.from === undefined ? "" : date(report.from).slice(0, 19);
    to.value = report.to === undefined ? "" : date(report.to).slice(0, 19);
  }
  type Point = {
    time: number;
    agent?: string;
    model?: string;
    partial: boolean;
  };
  const timestamp = (value: string) =>
    value ? Date.parse(`${value}Z`) : undefined;
  function matches(
    p: Point,
    start: number | undefined,
    end: number | undefined,
  ) {
    return (
      (agent.value === "*" || p.agent === agent.value) &&
      (model.value === "*" || p.model === model.value) &&
      (start === undefined || p.time >= start) &&
      (end === undefined || p.time <= end)
    );
  }
  const ns = "http://www.w3.org/2000/svg";
  function svgNode<K extends keyof SVGElementTagNameMap>(
    name: K,
    attrs: Record<string, string | number> = {},
    text?: string,
  ) {
    const n = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs))
      n.setAttribute(key, String(value));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function showTooltip(text: string, x: number, y: number) {
    tooltip.textContent = text;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(8, Math.min(x + 12, window.innerWidth - 370))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(y + 12, window.innerHeight - tooltip.offsetHeight - 10))}px`;
  }
  const definitions = [
    {
      key: "liveTps",
      title: "Live TPS",
      unit: "tokens / second",
      description:
        "Estimated text + reasoning throughput in the rolling collection window.",
      requests: false,
      estimated: true,
    },
    {
      key: "averageModelTps",
      title: "Average model throughput",
      unit: "tokens / second",
      description:
        "Session output / matched model-request time, including TTFT and excluding subsequent tool time.",
      requests: false,
      estimated: false,
    },
    {
      key: "averageSessionTps",
      title: "Average session throughput",
      unit: "tokens / second",
      description:
        "Session output / elapsed session lifetime, including tools and idle time.",
      requests: false,
      estimated: false,
    },
    {
      key: "ttftMs",
      title: "Time to first output",
      unit: "seconds",
      description:
        "One point per request with observed text/reasoning output. Includes publication delay.",
      requests: true,
      estimated: true,
    },
    {
      key: "tps",
      title: "Completed request throughput",
      unit: "tokens / second",
      description:
        "Reported output + reasoning / request duration. Requests are never joined into a continuous curve.",
      requests: true,
      estimated: false,
    },
    {
      key: "sessionOutputTokens",
      title: "Cumulative output",
      unit: "tokens",
      description:
        "Authoritative session output + reasoning totals. Lifecycle and sample records are snapshots, not increments.",
      requests: false,
      estimated: false,
    },
  ] as const;
  function render() {
    tooltip.hidden = true;
    charts.replaceChildren();
    stats.replaceChildren();
    legend.replaceChildren();
    const start = timestamp(from.value),
      end = timestamp(to.value);
    if (
      (start !== undefined && !Number.isFinite(start)) ||
      (end !== undefined && !Number.isFinite(end)) ||
      (start !== undefined && end !== undefined && start > end)
    ) {
      notice.textContent = "Choose a valid time range with From before To.";
      return;
    }
    const selected = data.series.filter(
      (s) =>
        ((session.value === "*" || s.sessionId === session.value) &&
          s.points.some((p) => matches(p, start, end))) ||
        ((session.value === "*" || s.sessionId === session.value) &&
          s.requests.some((p) => matches(p, start, end))),
    );
    const visible = selected.slice(0, 12);
    const requests = visible.flatMap((s) =>
      s.requests.filter((r) => matches(r, start, end)),
    );
    const matched = requests.filter(
      (r) =>
        r.outputTokens !== undefined &&
        r.durationMs !== undefined &&
        r.durationMs > 0,
    );
    const duration = matched.reduce((sum, r) => sum + (r.durationMs ?? 0), 0),
      tokens = matched.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);
    const ttfts = requests
      .flatMap((r) => (r.ttftMs === undefined ? [] : [r.ttftMs]))
      .sort((a, b) => a - b);
    const percentile = (q: number) =>
      ttfts.length
        ? (ttfts[Math.max(0, Math.ceil(ttfts.length * q) - 1)] ?? 0) / 1000
        : undefined;
    for (const [label, value] of [
      ["Matched / observed requests", `${matched.length} / ${requests.length}`],
      [
        "Retained request throughput",
        duration ? `${number((tokens * 1000) / duration)} t/s` : "Unavailable",
      ],
      [
        "Median observed TTFT",
        ttfts.length ? `${number(percentile(0.5), 2)}s` : "Unavailable",
      ],
      [
        "95th percentile TTFT",
        ttfts.length ? `${number(percentile(0.95), 2)}s` : "Unavailable",
      ],
    ]) {
      const box = document.createElement("div");
      box.className = "stat";
      const name = document.createElement("span"),
        valueNode = document.createElement("strong");
      name.textContent = label ?? "";
      valueNode.textContent = value ?? "";
      box.append(name, valueNode);
      stats.append(box);
    }
    const gaps = data.gaps.filter(
      (g) =>
        (g.sessionId === "__history__" ||
          visible.some((s) => s.sessionId === g.sessionId)) &&
        (start === undefined || g.time >= start) &&
        (end === undefined || g.time <= end),
    );
    const notes = [
      `Bounded retained history: ${metadata.retainedFrom === undefined ? "empty archive" : `segments since ${date(metadata.retainedFrom)}`}.`,
      `${gaps.length} recorded gap markers.`,
    ];
    if (metadata.skippedBytes)
      notes.push(
        `${number(metadata.skippedBytes, 0)} bytes excluded by the read limit.`,
      );
    if (metadata.malformedRecords)
      notes.push(
        `${metadata.malformedRecords} malformed/partial records skipped.`,
      );
    if (data.omittedGaps)
      notes.push(
        `${data.omittedGaps} older gap markers omitted; curve discontinuities remain preserved.`,
      );
    if (data.omittedSessions)
      notes.push(
        `${data.omittedSessions} sessions omitted from the report limit; regenerate with --session to inspect one.`,
      );
    if (selected.length > 12)
      notes.push(
        `Showing 12 of ${selected.length} matching sessions; select a session for detail.`,
      );
    if (visible.some((s) => s.originalPoints > s.points.length))
      notes.push(
        `Curves downsampled to at most ${data.maxPoints} observations per session, preserving extrema and gaps.`,
      );
    if (
      visible.some((s) =>
        s.points.some((p) => p.partial && matches(p, start, end)),
      )
    )
      notes.push("Partial timing coverage is present.");
    if (!visible.length) notes.push("No observations match these filters.");
    notice.textContent = notes.join(" ");
    visible.forEach((s, index) => {
      const item = document.createElement("span"),
        dot = document.createElement("i");
      dot.className = "dot";
      dot.style.backgroundColor = color(index);
      item.append(
        dot,
        document.createTextNode(
          `${s.agents.join(", ") || "Agent"} · ${s.sessionId}${s.parentId ? ` (child of ${s.parentId})` : ""}`,
        ),
      );
      legend.append(item);
    });
    const times = visible.flatMap((s) =>
      [...s.points, ...s.requests]
        .filter((p) => matches(p, start, end))
        .map((p) => p.time),
    );
    let minTime = start ?? times.reduce((a, t) => Math.min(a, t), Infinity),
      maxTime = end ?? times.reduce((a, t) => Math.max(a, t), -Infinity);
    if (!Number.isFinite(minTime)) minTime = 0;
    if (!Number.isFinite(maxTime)) maxTime = minTime + 1000;
    if (maxTime <= minTime) maxTime = minTime + 1000;
    for (const def of definitions) {
      const card = document.createElement("section");
      card.className = "chart";
      const heading = document.createElement("div");
      heading.className = "charthead";
      const title = document.createElement("h2");
      title.textContent = def.title;
      const download = document.createElement("button");
      download.textContent = "Save SVG";
      download.setAttribute("aria-label", `Save ${def.title} as SVG`);
      heading.append(title, download);
      const desc = document.createElement("p");
      desc.textContent = def.description;
      card.append(heading, desc);
      charts.append(card);
      type PlotPoint = {
        time: number;
        value?: number;
        partial: boolean;
        breakBefore: boolean;
        requestId?: string;
        agent?: string;
        model?: string;
      };
      const plots: PlotPoint[][] = visible.map((s) => {
        if (def.requests)
          return s.requests
            .filter((p) => matches(p, start, end))
            .map((p) => {
              const raw = def.key === "ttftMs" ? p.ttftMs : p.tps;
              return {
                ...p,
                breakBefore: true,
                ...(raw === undefined
                  ? {}
                  : { value: def.key === "ttftMs" ? raw / 1000 : raw }),
              };
            });
        // Preserve boundaries when filtering removes intervening model/agent observations.
        let skipped = false;
        return s.points.flatMap((p) => {
          if (!matches(p, start, end)) {
            skipped = true;
            return [];
          }
          const key = def.key;
          const value =
            key === "liveTps"
              ? p.liveTps
              : key === "averageModelTps"
                ? p.averageModelTps
                : key === "averageSessionTps"
                  ? p.averageSessionTps
                  : p.sessionOutputTokens;
          const point = {
            ...p,
            breakBefore: p.breakBefore || skipped,
            ...(value === undefined ? {} : { value }),
          };
          skipped = false;
          return [point];
        });
      });
      // Scatter charts retain all request values in the report but bound DOM work.
      const drawn = plots.map((points) => {
        if (!def.requests || points.length <= data.maxPoints) return points;
        const bins = Math.max(1, Math.floor(data.maxPoints / 4)),
          chosen = new Set<number>();
        for (let b = 0; b < bins; b++) {
          const first = Math.floor((b * points.length) / bins),
            last = Math.floor(((b + 1) * points.length) / bins) - 1;
          chosen.add(first);
          chosen.add(last);
          let low = first,
            high = first;
          for (let i = first; i <= last; i++) {
            if (
              (points[i]?.value ?? Infinity) < (points[low]?.value ?? Infinity)
            )
              low = i;
            if (
              (points[i]?.value ?? -Infinity) >
              (points[high]?.value ?? -Infinity)
            )
              high = i;
          }
          chosen.add(low);
          chosen.add(high);
        }
        return [...chosen]
          .sort((a, b) => a - b)
          .flatMap((i) => (points[i] ? [points[i]] : []));
      });
      const maxValue =
        drawn.reduce(
          (maximum, points) =>
            points.reduce((n, p) => Math.max(n, p.value ?? 0), maximum),
          1,
        ) * 1.08;
      const w = 720,
        h = 300,
        left = 64,
        right = 20,
        top = 24,
        bottom = 47;
      const x = (t: number) =>
        left + ((t - minTime) / (maxTime - minTime)) * (w - left - right);
      const y = (v: number) => h - bottom - (v / maxValue) * (h - top - bottom);
      const svg = svgNode("svg", {
        viewBox: `0 0 ${w} ${h}`,
        role: "img",
        "aria-label": `${def.title} over UTC timestamps`,
        xmlns: ns,
      });
      svg.append(
        svgNode("rect", { width: w, height: h, fill: "#111c2e" }),
        svgNode("title", {}, `${def.title}. ${def.description}`),
      );
      svg.append(
        svgNode(
          "text",
          {
            x: left,
            y: 14,
            fill: "#a8b5cb",
            "font-size": 11,
            "font-family": "system-ui,sans-serif",
          },
          def.unit,
        ),
      );
      for (let tick = 0; tick <= 4; tick++) {
        const v = (maxValue * tick) / 4;
        svg.append(
          svgNode("line", {
            x1: left,
            x2: w - right,
            y1: y(v),
            y2: y(v),
            stroke: "#2a3950",
            "stroke-width": 1,
          }),
        );
        svg.append(
          svgNode(
            "text",
            {
              x: left - 8,
              y: y(v) + 4,
              fill: "#a8b5cb",
              "text-anchor": "end",
              "font-size": 11,
              "font-family": "system-ui,sans-serif",
            },
            v >= 10000 ? `${number(v / 1000)}k` : number(v),
          ),
        );
        const t = minTime + ((maxTime - minTime) * tick) / 4;
        const label =
          maxTime - minTime > 86400000
            ? date(t).slice(5, 16).replace("T", " ")
            : date(t).slice(11, 19);
        svg.append(
          svgNode(
            "text",
            {
              x: x(t),
              y: h - 22,
              fill: "#a8b5cb",
              "text-anchor":
                tick === 0 ? "start" : tick === 4 ? "end" : "middle",
              "font-size": 11,
              "font-family": "system-ui,sans-serif",
            },
            label,
          ),
        );
      }
      for (const gap of gaps)
        if (gap.time >= minTime && gap.time <= maxTime) {
          const line = svgNode("line", {
            x1: x(gap.time),
            x2: x(gap.time),
            y1: top,
            y2: h - bottom,
            stroke: "#fb7185",
            "stroke-dasharray": "3 5",
            opacity: 0.65,
          });
          line.append(
            svgNode("title", {}, `${date(gap.time)} · ${gap.reason}`),
          );
          svg.append(line);
        }
      let count = 0;
      drawn.forEach((points, index) => {
        let run: PlotPoint[] = [];
        const flush = () => {
          if (run.length > 1)
            svg.append(
              svgNode("polyline", {
                points: run
                  .map((p) => `${x(p.time)},${y(p.value ?? 0)}`)
                  .join(" "),
                fill: "none",
                stroke: color(index),
                "stroke-width": 1.8,
                ...(def.estimated || run.some((p) => p.partial)
                  ? { "stroke-dasharray": "5 4" }
                  : {}),
              }),
            );
          run = [];
        };
        for (const point of points) {
          if (point.breakBefore || point.value === undefined) flush();
          if (point.value === undefined) continue;
          count++;
          if (!def.requests) run.push(point);
          const label = `${date(point.time)}\n${visible[index]?.sessionId ?? ""}${point.agent ? ` · ${point.agent}` : ""}${point.model ? `\n${point.model}` : ""}\n${def.title}: ${def.estimated ? "~" : ""}${number(point.value, 3)} ${def.unit}${point.requestId ? `\nRequest: ${point.requestId}` : ""}${point.partial ? "\nPartial observation coverage" : ""}`;
          const dot = svgNode("circle", {
            cx: x(point.time),
            cy: y(point.value),
            r: def.requests ? 3 : 2.5,
            fill: color(index),
            tabindex: 0,
            "aria-label": label,
          });
          dot.append(svgNode("title", {}, label));
          dot.addEventListener("mouseenter", (e) =>
            showTooltip(label, e.clientX, e.clientY),
          );
          dot.addEventListener("mouseleave", () => {
            tooltip.hidden = true;
          });
          dot.addEventListener("focus", () => {
            const box = dot.getBoundingClientRect();
            showTooltip(label, box.x, box.y);
          });
          dot.addEventListener("blur", () => {
            tooltip.hidden = true;
          });
          svg.append(dot);
        }
        flush();
      });
      if (!count)
        svg.append(
          svgNode(
            "text",
            {
              x: w / 2,
              y: h / 2,
              fill: "#a8b5cb",
              "text-anchor": "middle",
              "font-size": 14,
              "font-family": "system-ui,sans-serif",
            },
            "No measurements in this selection",
          ),
        );
      card.append(svg);
      download.onclick = () => {
        const blob = new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `context-guard-${def.key}.svg`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
    }
  }
  for (const control of [session, agent, model, from, to])
    control.addEventListener("change", render);
  element("reset", HTMLButtonElement).onclick = () => {
    reset();
    render();
  };
  reset();
  render();
}
