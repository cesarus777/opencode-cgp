import type { Stats } from "node:fs";
import { mkdir, readdir, stat, open, unlink } from "node:fs/promises";
import { isPerformanceSnapshot } from "./rpc.ts";
import { join } from "node:path";
import type { Identity, Config } from "./types.ts";
import type { PerformanceSnapshot } from "./performance.ts";

export interface HistoryRecord extends Identity {
  schema: 1;
  recordId: string;
  time: number;
  type: "sample" | "request" | "lifecycle" | "gap" | "terminal";
  performance?: PerformanceSnapshot;
  event?: string;
  droppedRecords?: number;
}
const filename = /^([0-9]+)-[a-f0-9-]+\.jsonl$/;
export async function segments(directory: string) {
  const names = await readdir(directory).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw error;
  });
  return (
    await Promise.all(
      names
        .filter((n) => filename.test(n))
        .map(async (name) => ({
          name,
          time: Number(filename.exec(name)?.[1]),
          ...fileIdentity(await stat(join(directory, name))),
        })),
    )
  ).sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
}
export function fileIdentity(info: Stats) {
  return {
    bytes: info.size,
    dev: info.dev,
    ino: info.ino,
    mtimeMs: info.mtimeMs,
    ctimeMs: info.ctimeMs,
  };
}
export interface ScanOptions {
  now?: () => number;
  yield?: () => Promise<void>;
  chunkBytes?: number;
  onRead?: (bytes: number) => void;
  onParse?: () => void;
}
/** Cooperative scheduling is independent of cancellation. */
export function scanScheduler(signal?: AbortSignal, options: ScanOptions = {}) {
  const now = options.now ?? (() => performance.now());
  const pause =
    options.yield ?? (() => new Promise<void>((done) => setTimeout(done, 0)));
  let started = now();
  return () => {
    signal?.throwIfAborted();
    if (now() - started >= 4)
      return pause().then(() => {
        signal?.throwIfAborted();
        started = now();
      });
  };
}
export function matchesHistory(value: HistoryRecord, filter: HistoryFilter) {
  return !(
    (filter.sessionId !== undefined &&
      value.sessionId !== filter.sessionId &&
      value.sessionId !== "__history__") ||
    (value.type !== "gap" &&
      filter.agent !== undefined &&
      (value.performance?.requestAgent ?? value.agent) !== filter.agent) ||
    (value.type !== "gap" &&
      filter.model !== undefined &&
      (value.performance?.requestModel ?? value.model) !== filter.model) ||
    (filter.from !== undefined && value.time < filter.from) ||
    (filter.to !== undefined && value.time > filter.to)
  );
}
/** Reads captured bytes only. Byte boundaries retain UTF-8 exactly, including tails. */
export async function scanHistorySegment(
  handle: Awaited<ReturnType<typeof open>>,
  size: number,
  filter: HistoryFilter = {},
  options: ScanOptions = {},
  start = 0,
) {
  const records: HistoryRecord[] = [];
  let malformedRecords = 0,
    position = start,
    boundary = start;
  let pending = Buffer.alloc(0);
  const checkpoint = scanScheduler(filter.signal, options);
  function parse(line: Buffer) {
    if (!line.length) return;
    options.onParse?.();
    let value: unknown;
    try {
      value = JSON.parse(line.toString("utf8"));
    } catch {
      malformedRecords++;
      return;
    }
    if (!isHistoryRecord(value)) {
      malformedRecords++;
      return;
    }
    if (matchesHistory(value, filter)) records.push(value);
  }
  while (position < size) {
    {
      const waiting = checkpoint();
      if (waiting) await waiting;
    }
    const buffer = Buffer.alloc(
      Math.min(options.chunkBytes ?? 65536, size - position),
    );
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new Error("Archive changed during read");
    options.onRead?.(bytesRead);
    position += bytesRead;
    const chunk = pending.length
      ? Buffer.concat([pending, buffer.subarray(0, bytesRead)])
      : buffer.subarray(0, bytesRead);
    let offset = 0;
    for (;;) {
      const end = chunk.indexOf(10, offset);
      if (end < 0) break;
      {
        const waiting = checkpoint();
        if (waiting) await waiting;
      }
      parse(chunk.subarray(offset, end));
      offset = end + 1;
    }
    pending = Buffer.from(chunk.subarray(offset));
    boundary = position - pending.length;
  }
  const completeRecords = records.length,
    completeMalformed = malformedRecords;
  {
    const waiting = checkpoint();
    if (waiting) await waiting;
  }
  parse(pending);
  filter.signal?.throwIfAborted();
  return {
    records,
    malformedRecords,
    boundary,
    completeRecords,
    completeMalformed,
  };
}
/** Separate bounded journal; the API accepts only projected scalar measurements. */
export class PerformanceHistory {
  private pending: string[] = [];
  private working: Promise<void> | undefined;
  private active: string | undefined;
  private bytes = 0;
  private started = 0;
  private disabled = false;
  private dropped = 0;
  private droppedTotal = 0;
  constructor(
    readonly path: string,
    private readonly config: Config["history"],
    private readonly now = Date.now,
    private readonly report: (event: string) => void = () => {},
    private readonly changed: (name: string) => void = () => {},
  ) {}
  emit(record: HistoryRecord) {
    if (!this.config.enabled || this.disabled) return;
    // Explicit allowlist also protects callers passing structurally wider objects.
    const line =
      JSON.stringify({
        schema: 1,
        recordId: record.recordId,
        time: record.time,
        type: record.type,
        sessionId: record.sessionId,
        ...(record.parentId ? { parentId: record.parentId } : {}),
        ...(record.agent ? { agent: record.agent } : {}),
        ...(record.model ? { model: record.model } : {}),
        ...(record.event ? { event: record.event } : {}),
        ...(record.droppedRecords === undefined
          ? {}
          : { droppedRecords: record.droppedRecords }),
        ...(record.performance
          ? { performance: scalarPerformance(record.performance) }
          : {}),
      }) + "\n";
    if (
      this.pending.length >= 256 ||
      Buffer.byteLength(line) > Math.min(4 * 1024 * 1024, this.config.maxBytes)
    ) {
      this.dropped++;
      this.droppedTotal++;
      if (this.dropped === 1) this.report("history-records-dropped");
      return;
    }
    this.pending.push(line);
    this.kick();
  }
  private kick() {
    if (this.working || this.disabled) return;
    this.working = this.drain()
      .catch(() => {
        this.disabled = true;
        this.pending = [];
        this.report("history-unavailable");
      })
      .finally(() => {
        this.working = undefined;
        if (this.pending.length) this.kick();
      });
  }
  private async prune(incoming = 0) {
    const files = await segments(this.path);
    let total = files.reduce((n, f) => n + f.bytes, 0);
    let truncated = false;
    for (const file of files) {
      if (
        file.time >= this.now() - this.config.retentionDays * 86400000 &&
        total + incoming <= this.config.maxBytes
      )
        break;
      await unlink(join(this.path, file.name));
      this.changed(file.name);
      if (file.name === this.active) {
        this.active = undefined;
        this.bytes = 0;
      }
      total -= file.bytes;
      truncated = true;
    }
    if (truncated) this.report("history-truncated");
  }
  private gapLine(event: string, droppedRecords?: number) {
    return (
      JSON.stringify({
        schema: 1,
        recordId: crypto.randomUUID(),
        time: this.now(),
        type: "gap",
        sessionId: "__history__",
        event,
        ...(droppedRecords === undefined ? {} : { droppedRecords }),
      }) + "\n"
    );
  }
  private async drain() {
    await mkdir(this.path, { recursive: true, mode: 0o700 });
    await this.prune();
    while (this.pending.length) {
      let line = this.pending.shift();
      if (!line) continue;
      if (this.dropped > 0) {
        this.pending.unshift(line);
        line = this.gapLine("history-records-dropped", this.dropped);
        this.dropped = 0;
      }
      const size = Buffer.byteLength(line);
      const now = this.now();
      if (
        !this.active ||
        this.bytes + size > Math.min(4 * 1024 * 1024, this.config.maxBytes) ||
        now - this.started >= 3600000
      ) {
        this.active = undefined;
        this.bytes = 0;
        await this.prune(size);
        this.started = now;
        this.active = `${now}-${crypto.randomUUID()}.jsonl`;
      } else await this.prune(size);
      // Pruning for the total cap can remove the current segment.
      if (!this.active) {
        this.started = now;
        this.active = `${now}-${crypto.randomUUID()}.jsonl`;
      }
      const file = await open(join(this.path, this.active), "a", 0o600);
      try {
        await file.writeFile(line);
        this.changed(this.active);
      } finally {
        await file.close();
      }
      this.bytes += size;
    }
  }
  health() {
    return { unavailable: this.disabled, droppedRecords: this.droppedTotal };
  }
  async flush() {
    while (this.working) await this.working;
  }
  async initialize() {
    if (!this.config.enabled) return;
    await mkdir(this.path, { recursive: true, mode: 0o700 })
      .then(() => this.prune())
      .catch(() => {
        this.disabled = true;
        this.report("history-unavailable");
      });
  }
}
// Keep this list aligned with the public performance contract, never stringify arbitrary input.
export function scalarPerformance(p: PerformanceSnapshot): PerformanceSnapshot {
  return {
    observedSince: p.observedSince,
    sessionCreatedAt: p.sessionCreatedAt,
    at: p.at,
    status: p.status,
    partial: p.partial,
    estimatedOutputTokens: p.estimatedOutputTokens,
    modelOutputTokens: p.modelOutputTokens,
    modelDurationMs: p.modelDurationMs,
    completedRequests: p.completedRequests,
    tokenSource: p.tokenSource,
    ...Object.fromEntries(
      [
        "sessionOutputTokens",
        "liveTps",
        "averageModelTps",
        "averageSessionTps",
        "ttftMs",
        "latestRequestTps",
        "requestId",
        "requestAgent",
        "requestModel",
        "requestOutputTokens",
        "requestStartedAt",
        "firstOutputAt",
        "streamEndedAt",
      ].flatMap((key) => {
        const value = p[key as keyof PerformanceSnapshot];
        return value === undefined ? [] : [[key, value]];
      }),
    ),
  };
}
export interface HistoryFilter {
  signal?: AbortSignal;
  sessionId?: string;
  agent?: string;
  model?: string;
  from?: number;
  to?: number;
  maxBytes?: number;
}
export interface HistoryMetadata {
  schema: number;
  retainedFrom?: number;
  retainedBytes: number;
  skippedBytes: number;
  malformedRecords: number;
  completeness: string;
}
export async function readPerformanceHistory(
  directory: string,
  filter: HistoryFilter = {},
  options: ScanOptions = {},
) {
  filter.signal?.throwIfAborted();
  const records: HistoryRecord[] = [];
  const files = await segments(directory);
  filter.signal?.throwIfAborted();
  const maxBytes = filter.maxBytes ?? 64 * 1024 * 1024;
  let bytes = 0,
    skippedBytes = 0,
    malformedRecords = 0;
  const selected: typeof files = [];
  for (const file of files.slice().reverse()) {
    if (bytes + file.bytes > maxBytes) {
      skippedBytes += file.bytes;
      continue;
    }
    bytes += file.bytes;
    selected.unshift(file);
  }
  for (const file of selected) {
    filter.signal?.throwIfAborted();
    const handle = await open(join(directory, file.name), "r");
    try {
      const result = await scanHistorySegment(
        handle,
        file.bytes,
        filter,
        options,
      );
      for (const record of result.records) records.push(record);
      malformedRecords += result.malformedRecords;
    } finally {
      await handle.close();
    }
  }
  filter.signal?.throwIfAborted();
  const metadata: HistoryMetadata = {
    schema: 1,
    ...(files[0] ? { retainedFrom: files[0].time } : {}),
    retainedBytes: files.reduce((n, f) => n + f.bytes, 0),
    skippedBytes,
    malformedRecords,
    completeness: "bounded-retention",
  };
  return { metadata, records };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const historyFields = new Set([
  "schema",
  "recordId",
  "time",
  "type",
  "sessionId",
  "parentId",
  "agent",
  "model",
  "event",
  "performance",
  "droppedRecords",
]);
function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!isRecord(value)) return false;
  const r: Record<string, unknown> = value;
  return (
    Object.keys(r).every((k) => historyFields.has(k)) &&
    r.schema === 1 &&
    typeof r.recordId === "string" &&
    typeof r.time === "number" &&
    Number.isSafeInteger(r.time) &&
    r.time >= 0 &&
    typeof r.sessionId === "string" &&
    typeof r.type === "string" &&
    ["sample", "request", "lifecycle", "gap", "terminal"].includes(r.type) &&
    ["parentId", "agent", "model", "event"].every(
      (k) => r[k] === undefined || typeof r[k] === "string",
    ) &&
    (r.performance === undefined || isPerformanceSnapshot(r.performance)) &&
    (r.droppedRecords === undefined ||
      (typeof r.droppedRecords === "number" &&
        Number.isSafeInteger(r.droppedRecords) &&
        r.droppedRecords >= 0))
  );
}
