#!/usr/bin/env bun
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildChartData } from "./charts.ts";
import { renderChartReport } from "./chartreport.ts";
import { readPerformanceHistory } from "./history.ts";
import { readJournal } from "./telemetry.ts";
const args = process.argv.slice(2);
if (args[0] === "dashboard") {
  const { parseDashboardArgs, dashboardHelp, checkTerminalRuntime } =
    await import("./dashboard/command.ts");
  try {
    const options = parseDashboardArgs(
      args.slice(1),
      process.cwd(),
      process.env,
    );
    if (options === "help") console.log(dashboardHelp);
    else {
      checkTerminalRuntime(
        Bun.version,
        Boolean(process.stdin.isTTY && process.stdout.isTTY),
      );
      const { runTerminal } = await import("./dashboard/terminal.ts");
      await runTerminal(options);
    }
  } catch (error) {
    // Only controlled messages are public; SDK/renderer exceptions may contain secrets.
    const message = error instanceof Error ? error.message : "";
    const safe =
      /^(Use context-guard|Unknown dashboard|Duplicate dashboard|Missing value for --|Explicit servers require|dashboard tui requires|Terminal renderer unavailable|Terminal dashboard stopped|Dashboard directory must|Explicit credentials require|Use an HTTPS|No running|Dashboard server connection failed)/.test(
        message,
      );
    console.error(
      safe
        ? message
        : "Dashboard startup failed; check server, owning directory, authentication and renderer installation",
    );
    process.exitCode = 1;
  }
} else if (!args[0] || args.includes("--help")) {
  console.log(
    "Usage: bun run inspect /absolute/path/to/journal.jsonl [--history] [--json]\nThe ready log reports the location-specific journal path.\nMetrics: inspect metrics /absolute/history-directory [--session ID] [--from ISO-or-ms] [--to ISO-or-ms] [--csv]\nModels: inspect models /absolute/history-directory [--model provider/model] [--agent NAME] [--from ISO-or-ms] [--to ISO-or-ms] [--csv | --json]\nCharts: inspect charts /absolute/history-directory --output report.html [--session ID] [--agent NAME] [--model provider/model] [--from ISO-or-ms] [--to ISO-or-ms] [--max-points 1000] [--force]",
  );
} else if (args[0] === "models") {
  const { inspectModels } = await import("./modelcli.ts");
  await inspectModels(args.slice(1));
} else if (args[0] === "metrics" || args[0] === "charts") {
  const directory = args[1];
  if (!directory || directory.startsWith("--"))
    throw new Error(
      "Usage: inspect metrics /absolute/history-directory [--session ID] [--from ISO-or-ms] [--to ISO-or-ms] [--csv]",
    );
  const option = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0) return undefined;
    const value = args[index + 1];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${name}`);
    return value;
  };
  const timestamp = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const n = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid timestamp");
    return n;
  };
  const sessionId = option("--session"),
    agent = option("--agent"),
    model = option("--model"),
    from = timestamp(option("--from")),
    to = timestamp(option("--to"));
  if (from !== undefined && to !== undefined && from > to)
    throw new Error("--from must precede --to");
  const chart =
    args[0] === "charts" ||
    args.includes("--chart") ||
    args.includes("--output");
  if (chart && args.includes("--csv"))
    throw new Error("Choose charts or CSV export");
  const positiveInteger = (
    name: string,
    fallback: number,
    min: number,
    max: number,
  ) => {
    const raw = option(name),
      n = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(n) || n < min || n > max)
      throw new Error(`${name} must be an integer from ${min} to ${max}`);
    return n;
  };
  const maxPoints = positiveInteger("--max-points", 1000, 16, 5000);
  const maxSessions = positiveInteger("--max-sessions", 128, 1, 1024);
  const result = await readPerformanceHistory(directory, {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(agent === undefined ? {} : { agent }),
    ...(model === undefined ? {} : { model }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  });
  if (chart) {
    const output = resolve(
      option("--chart") ?? option("--output") ?? "context-guard-charts.html",
    );
    if (!output.toLowerCase().endsWith(".html"))
      throw new Error("Chart output must use an .html extension");
    const data = buildChartData(result.records, { maxPoints, maxSessions });
    const report = renderChartReport({
      data,
      metadata: result.metadata,
      ...(agent === undefined ? {} : { agent }),
      ...(model === undefined ? {} : { model }),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
    await writeFile(output, report, {
      flag: args.includes("--force") ? "w" : "wx",
      mode: 0o600,
    });
    console.log(
      `Charts written to ${output} (${data.series.length} session instances). Open this file in a browser. No server or external assets are needed.`,
    );
  } else if (args.includes("--csv")) {
    console.error(JSON.stringify(result.metadata));
    const keys = [
      "recordId",
      "time",
      "type",
      "sessionId",
      "parentId",
      "agent",
      "model",
      "event",
      "at",
      "sessionCreatedAt",
      "sessionOutputTokens",
      "requestId",
      "requestAgent",
      "requestModel",
      "requestOutputTokens",
      "requestStartedAt",
      "firstOutputAt",
      "streamEndedAt",
      "liveTps",
      "averageModelTps",
      "averageSessionTps",
      "ttftMs",
      "latestRequestTps",
      "estimatedOutputTokens",
      "modelOutputTokens",
      "modelDurationMs",
      "completedRequests",
      "observedSince",
      "status",
      "partial",
      "tokenSource",
    ];
    console.log(keys.join(","));
    for (const record of result.records) {
      if (!record || typeof record !== "object") continue;
      const row: Record<string, unknown> = {
        ...record,
        ...("performance" in record &&
        record.performance &&
        typeof record.performance === "object"
          ? record.performance
          : {}),
      };
      console.log(
        keys
          .map(
            (key) => '"' + String(row[key] ?? "").replaceAll('"', '""') + '"',
          )
          .join(","),
      );
    }
  } else console.log(JSON.stringify(result, null, 2));
} else {
  const records = await readJournal(args[0]);
  const sessions = new Map<string, Record<string, unknown>>();
  const history: unknown[] = [];
  for (const record of records) {
    history.push(record);
    if (!record || typeof record !== "object" || !("session" in record))
      continue;
    const s = record.session;
    if (
      !s ||
      typeof s !== "object" ||
      !("sessionId" in s) ||
      typeof s.sessionId !== "string"
    )
      continue;
    sessions.set(s.sessionId, { ...s });
  }
  if (args.includes("--history")) console.log(JSON.stringify(history, null, 2));
  else if (args.includes("--json"))
    console.log(JSON.stringify([...sessions.values()], null, 2));
  else for (const s of sessions.values()) console.log(JSON.stringify(s));
}
