/** Synthetic-only first-read comparison. Neither prototype is a production reader. */
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { segments, readPerformanceHistory } from "../src/history.ts";
import { analyzeModelRequests } from "../src/modelanalytics.ts";

export async function timed<T>(work: () => Promise<T>) {
  let last = performance.now(),
    delay = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    delay = Math.max(delay, now - last - 10);
    last = now;
  }, 10);
  const start = performance.now();
  try {
    const result = await work();
    const elapsedMs = performance.now() - start;
    await Bun.sleep(15);
    return { result, elapsedMs, maxTimerDelayMs: delay };
  } finally {
    clearInterval(timer);
  }
}
export async function coldPrototypes(directory: string) {
  const worker = await timed(
    () =>
      new Promise<unknown>((resolve, reject) => {
        const child = new Worker(
          new URL("./dashboard-cold-worker.ts", import.meta.url),
          { workerData: directory },
        );
        const timeout = setTimeout(() => {
          void child.terminate();
          reject(new Error("Prototype worker timed out"));
        }, 30000);
        child.once("message", (value: unknown) => {
          clearTimeout(timeout);
          resolve(value);
          void child.terminate();
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code) => {
          if (code !== 0) {
            clearTimeout(timeout);
            reject(new Error("Prototype worker exited"));
          }
        });
      }),
  );
  const files = await segments(directory);
  if (
    files.length > 256 ||
    files.reduce((n, f) => n + f.bytes, 0) > 64 * 1024 * 1024
  )
    throw new Error("Prototype manifest exceeds bounds");
  const buildStart = performance.now();
  const source = await readPerformanceHistory(directory);
  const analysis = analyzeModelRequests(source.records, {
    location: "/project",
  });
  const manifest: { name: string; size: number; sha256: string }[] = [];
  const offsets: {
    file: number;
    offset: number;
    bytes: number;
    sessionId: string;
    time: number;
    gap: boolean;
  }[] = [];
  for (const [file, segment] of files.entries()) {
    const bytes = await readFile(join(directory, segment.name));
    manifest.push({
      name: segment.name,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      const stop = end < 0 ? bytes.length : end;
      const value: unknown = JSON.parse(
        bytes.subarray(offset, stop).toString(),
      );
      if (
        typeof value !== "object" ||
        value === null ||
        !("sessionId" in value) ||
        typeof value.sessionId !== "string" ||
        !("time" in value) ||
        typeof value.time !== "number"
      )
        throw new Error("Prototype requires synthetic records");
      offsets.push({
        file,
        offset,
        bytes: stop - offset,
        sessionId: value.sessionId,
        time: value.time,
        gap: "type" in value && value.type === "gap",
      });
      offset = stop + 1;
      if (offsets.length > 200000)
        throw new Error("Prototype index exceeds record bound");
    }
  }
  const index = JSON.stringify({
    version: 1,
    manifest,
    offsets,
    metadata: source.metadata,
    analysis,
  });
  if (Buffer.byteLength(index) > 64 * 1024 * 1024)
    throw new Error("Prototype index exceeds byte bound");
  const path = join(directory, "prototype-index");
  await mkdir(path, { mode: 0o700 });
  await writeFile(join(path, "index.json"), index, { mode: 0o600 });
  const indexBuildMs = performance.now() - buildStart;
  // Validate all source bytes before trusting derived facts. A real implementation
  // also needs atomic updates, schema validation, prune policy and recovery tests.
  const indexed = await timed(async () => {
    for (const file of manifest) {
      const bytes = await readFile(join(directory, file.name));
      if (
        bytes.length !== file.size ||
        createHash("sha256").update(bytes).digest("hex") !== file.sha256
      )
        throw new Error("Prototype index integrity mismatch");
    }
    const parsed: unknown = JSON.parse(
      await readFile(join(path, "index.json"), "utf8"),
    );
    return parsed;
  });
  return {
    worker: {
      elapsedMs: worker.elapsedMs,
      maxTimerDelayMs: worker.maxTimerDelayMs,
      includes:
        "worker startup, parse, normalization and full facts structured-clone back to parent",
    },
    index: {
      elapsedMs: indexed.elapsedMs,
      maxTimerDelayMs: indexed.maxTimerDelayMs,
      bytes: Buffer.byteLength(index),
      buildMs: indexBuildMs,
      includes:
        "full source SHA-256 verification and index JSON decode; no production schema or query implementation",
    },
    memory: process.memoryUsage(),
    maxRssKiB: process.resourceUsage().maxRSS,
  };
}
