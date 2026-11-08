/** Benchmark-only prototype; excluded from the package runtime entrypoints. */
import { parentPort, workerData } from "node:worker_threads";
import { readPerformanceHistory } from "../src/history.ts";
import { analyzeModelRequests } from "../src/modelanalytics.ts";
const path: unknown = workerData;
if (typeof path !== "string" || !parentPort)
  throw new Error("Invalid prototype worker input");
const source = await readPerformanceHistory(path, {}, { now: () => 0 });
parentPort.postMessage({
  metadata: source.metadata,
  analysis: analyzeModelRequests(source.records, { location: "/project" }),
});
parentPort.close();
