import { isAbsolute, resolve } from "node:path";
import { readPerformanceHistory } from "./history.ts";
import { aggregateModels, type ModelSummary } from "./modelanalytics.ts";

export async function inspectModels(args: readonly string[]): Promise<void> {
  const directory = args[0];
  if (!directory || !isAbsolute(directory))
    throw new Error(
      "Usage: inspect models /absolute/history-directory [--model ID] [--agent NAME] [--from ISO-or-ms] [--to ISO-or-ms] [--csv | --json]",
    );
  const values = new Map<string, string>();
  let csv = false,
    json = false;
  for (let i = 1; i < args.length; i++) {
    const name = args[i];
    if (name === "--csv" || name === "--json") {
      if ((name === "--csv" && csv) || (name === "--json" && json))
        throw new Error(`Duplicate option ${name}`);
      if (name === "--csv") csv = true;
      else json = true;
    } else if (
      name &&
      ["--model", "--agent", "--from", "--to"].includes(name)
    ) {
      if (values.has(name)) throw new Error(`Duplicate option ${name}`);
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${name}`);
      values.set(name, value);
    } else throw new Error(`Unknown models option ${name}`);
  }
  if (csv && json) throw new Error("Choose JSON or CSV export");
  const timestamp = (value: string | undefined) => {
    if (value === undefined) return;
    const n = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
    if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid timestamp");
    return n;
  };
  const from = timestamp(values.get("--from")),
    to = timestamp(values.get("--to"));
  if (from !== undefined && to !== undefined && from > to)
    throw new Error("--from must precede --to");
  const model = values.get("--model"),
    agent = values.get("--agent");
  // Completion-time filtering belongs after request reconciliation, not at record write time.
  const history = await readPerformanceHistory(directory);
  const result = aggregateModels(history.records, {
    location: resolve(directory),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(model === undefined ? {} : { model }),
    ...(agent === undefined ? {} : { agent }),
  });
  const metadata = {
    ...history.metadata,
    ...result.coverage,
    partial:
      result.coverage.partial ||
      history.metadata.skippedBytes > 0 ||
      history.metadata.malformedRecords > 0,
    requested: { from, to, model, agent },
    timeBasis: "stream-completion-[from,to)",
    tpsBasis: "reported-output-plus-reasoning-over-summed-request-duration",
    ttftBasis: "observed-approximate-timing",
    percentileMethod: "nearest-rank-p95-midpoint-median",
    notices: [
      "bounded-retention",
      "scan-limit-64-MiB",
      "no-pre-observation-reconstruction",
    ],
  };
  if (!csv) {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          location: result.location,
          metadata,
          models: result.models,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.error(JSON.stringify(metadata));
  const fields: readonly (keyof ModelSummary)[] = [
    "model",
    "sessions",
    "completedRequests",
    "partialRequests",
    "legacyAttributionRequests",
    "tpsRequests",
    "ttftRequests",
    "excludedTpsRequests",
    "excludedTtftRequests",
    "outputTokens",
    "durationMs",
    "averageTps",
    "meanTtftMs",
    "medianTtftMs",
    "p95TtftMs",
  ];
  console.log(fields.join(","));
  for (const row of result.models)
    console.log(
      fields
        .map((field) => `"${String(row[field] ?? "").replaceAll('"', '""')}"`)
        .join(","),
    );
}
