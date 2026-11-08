import { open } from "node:fs/promises";
import { join } from "node:path";
import {
  fileIdentity,
  matchesHistory,
  scanHistorySegment,
  scanScheduler,
  segments,
  type HistoryFilter,
  type HistoryMetadata,
  type HistoryRecord,
  type ScanOptions,
} from "./history.ts";

type Manifest = Awaited<ReturnType<typeof segments>>;
type Segment = Manifest[number];
type Parsed = Awaited<ReturnType<typeof scanHistorySegment>>;
interface Entry extends Parsed {
  file: Segment;
  generation: number;
  sessions: Map<string, number[]>;
  minTime: number;
  maxTime: number;
}
interface InternalSnapshot extends ArchiveSnapshot {
  parts: Entry[];
}
export interface ArchiveSnapshot {
  revision: string;
  metadata: HistoryMetadata;
  records: HistoryRecord[];
  iterateRecords?: () => Iterable<HistoryRecord>;
}
interface ArchiveOptions extends ScanOptions {
  maxCacheBytes?: number;
  maxCacheRecords?: number;
  maxCacheSegments?: number;
}
const signature = (file: Segment) => JSON.stringify(file);
const sameFile = (a: Segment, b: Segment) => a.dev === b.dev && a.ino === b.ino;
function freezeRecord(record: HistoryRecord) {
  if (record.performance) Object.freeze(record.performance);
  return Object.freeze(record);
}

/** Location-owned cache. Metadata validation assumes external writers do not restore timestamps. */
export class PerformanceArchive {
  private entries = new Map<string, Entry>();
  private generation = 0;
  private stopped = false;
  private dirty = new Map<string, number>();
  private forcedGeneration = 0;
  private job:
    | {
        key: number;
        controller: AbortController;
        waiters: number;
        promise: Promise<InternalSnapshot>;
      }
    | undefined;
  readonly stats = {
    readBytes: 0,
    parsedRecords: 0,
    cacheBytes: 0,
    cacheRecords: 0,
  };
  constructor(
    readonly path: string,
    private readonly options: ArchiveOptions = {},
  ) {}
  /** Writer notifications invalidate even metadata-invisible mutations. */
  invalidate(name?: string) {
    this.generation++;
    if (name) {
      if (this.dirty.size >= 256 && !this.dirty.has(name)) {
        this.entries.clear();
        this.dirty.clear();
        this.forcedGeneration = this.generation;
      }
      this.dirty.set(name, this.generation);
    } else {
      this.entries.clear();
      this.dirty.clear();
      this.forcedGeneration = this.generation;
    }
    this.account();
  }
  dispose() {
    this.stopped = true;
    this.job?.controller.abort();
    this.entries.clear();
    this.dirty.clear();
    this.account();
  }
  private account() {
    this.stats.cacheBytes = [...this.entries.values()].reduce(
      (n, e) => n + e.file.bytes,
      0,
    );
    this.stats.cacheRecords = [...this.entries.values()].reduce(
      (n, e) => n + e.records.length,
      0,
    );
  }
  private retain(name: string, entry: Entry) {
    this.entries.delete(name);
    this.entries.set(name, entry);
    this.account();
    while (
      this.entries.size > (this.options.maxCacheSegments ?? 256) ||
      this.stats.cacheBytes >
        (this.options.maxCacheBytes ?? 64 * 1024 * 1024) ||
      this.stats.cacheRecords > (this.options.maxCacheRecords ?? 200000)
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.dirty.delete(oldest);
      this.account();
    }
  }
  private validCapture(expected: Segment, actual: Segment, generation: number) {
    return (
      signature(expected) === signature(actual) ||
      (sameFile(expected, actual) &&
        actual.bytes > expected.bytes &&
        (this.dirty.get(expected.name) ?? -1) > generation)
    );
  }
  private async scan(
    maxBytes: number,
    signal: AbortSignal,
  ): Promise<InternalSnapshot> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        signal.throwIfAborted();
        const generation = this.generation;
        const files = await segments(this.path);
        signal.throwIfAborted();
        const names = new Set(files.map((f) => f.name));
        for (const name of this.entries.keys())
          if (!names.has(name)) {
            this.entries.delete(name);
            this.dirty.delete(name);
          }
        this.account();
        const selected: Manifest = [];
        let bytes = 0,
          skippedBytes = 0,
          malformedRecords = 0;
        for (const file of files.slice().reverse()) {
          if (bytes + file.bytes > maxBytes) {
            skippedBytes += file.bytes;
            continue;
          }
          selected.unshift(file);
          bytes += file.bytes;
        }
        const parts: Entry[] = [];
        let unstable = false;
        for (const file of selected) {
          signal.throwIfAborted();
          const handle = await open(join(this.path, file.name), "r");
          try {
            const captured = {
              name: file.name,
              time: file.time,
              ...fileIdentity(await handle.stat()),
            };
            if (!this.validCapture(file, captured, generation)) {
              unstable = true;
              break;
            }
            const previous = this.entries.get(file.name);
            let entry: Entry;
            if (
              previous &&
              previous.generation >= this.forcedGeneration &&
              !this.dirty.has(file.name) &&
              signature(previous.file) === signature(file)
            ) {
              entry = previous;
            } else {
              // Notifications from this writer are append/prune only. External growth is
              // conservatively reparsed: size alone cannot establish an unchanged prefix.
              const append =
                previous &&
                previous.generation >= this.forcedGeneration &&
                sameFile(previous.file, file) &&
                file.bytes > previous.file.bytes &&
                this.dirty.has(file.name);
              const parsed = await scanHistorySegment(
                handle,
                file.bytes,
                { signal },
                {
                  ...this.options,
                  onRead: (n) => {
                    this.stats.readBytes += n;
                    this.options.onRead?.(n);
                  },
                  onParse: () => {
                    this.stats.parsedRecords++;
                    this.options.onParse?.();
                  },
                },
                append ? previous.boundary : 0,
              );
              entry = {
                ...parsed,
                file,
                generation,
                sessions: new Map(),
                minTime: Infinity,
                maxTime: -Infinity,
              };
              if (append) {
                entry.records = [
                  ...previous.records.slice(0, previous.completeRecords),
                  ...parsed.records,
                ];
                entry.malformedRecords += previous.completeMalformed;
                entry.completeRecords += previous.completeRecords;
                entry.completeMalformed += previous.completeMalformed;
              }
              const checkpoint = scanScheduler(signal, this.options);
              for (const [index, record] of entry.records.entries()) {
                if (index % 64 === 0) {
                  const waiting = checkpoint();
                  if (waiting) await waiting;
                }
                freezeRecord(record);
                entry.minTime = Math.min(entry.minTime, record.time);
                entry.maxTime = Math.max(entry.maxTime, record.time);
                const list = entry.sessions.get(record.sessionId) ?? [];
                list.push(index);
                entry.sessions.set(record.sessionId, list);
              }
              Object.freeze(entry.records);
            }
            const after = {
              name: file.name,
              time: file.time,
              ...fileIdentity(await handle.stat()),
            };
            if (!this.validCapture(file, after, generation)) {
              unstable = true;
              break;
            }
            signal.throwIfAborted();
            this.retain(file.name, entry);
            parts.push(entry);
            malformedRecords += entry.malformedRecords;
          } finally {
            await handle.close();
          }
        }
        signal.throwIfAborted();
        const current = await segments(this.path);
        const currentByName = new Map(current.map((file) => [file.name, file]));
        const originalNames = new Set(files.map((file) => file.name));
        if (
          unstable ||
          this.forcedGeneration > generation ||
          files.some((file) => {
            const actual = currentByName.get(file.name);
            return !actual || !this.validCapture(file, actual, generation);
          }) ||
          current.some(
            (file) =>
              !originalNames.has(file.name) &&
              (this.dirty.get(file.name) ?? -1) <= generation,
          )
        )
          continue;
        // Later notified appends belong to the next revision. Keep their dirty
        // markers so that revision can read only the suffix of this captured one.
        for (const [name, changedAt] of this.dirty)
          if (changedAt <= generation) this.dirty.delete(name);
        const metadata: HistoryMetadata = {
          schema: 1,
          ...(files[0] ? { retainedFrom: files[0].time } : {}),
          retainedBytes: files.reduce((n, f) => n + f.bytes, 0),
          skippedBytes,
          malformedRecords,
          completeness: "bounded-retention",
        };
        Object.freeze(metadata);
        let flattened: HistoryRecord[] | undefined;
        return Object.freeze({
          revision: JSON.stringify([generation, maxBytes, files]),
          metadata,
          parts,
          get records() {
            if (!flattened) {
              flattened = [];
              for (const part of parts)
                for (const record of part.records) flattened.push(record);
              Object.freeze(flattened);
            }
            return flattened;
          },
        });
      } catch (error) {
        signal.throwIfAborted();
        if (
          !(
            error instanceof Error &&
            "code" in error &&
            error.code === "ENOENT"
          )
        )
          throw error;
      }
    }
    throw new Error("Archive changed repeatedly during read; retry later");
  }
  async read(filter: HistoryFilter = {}): Promise<ArchiveSnapshot> {
    filter.signal?.throwIfAborted();
    if (this.stopped) throw new Error("Archive stopped");
    const key = filter.maxBytes ?? 64 * 1024 * 1024;
    // At most one scan; different budgets wait for the current bounded job.
    if (this.job && this.job.key !== key) {
      await this.wait(this.job, filter.signal);
      return this.read(filter);
    }
    if (this.job?.controller.signal.aborted) {
      await this.job.promise.catch(() => {});
      return this.read(filter);
    }
    if (!this.job) {
      const controller = new AbortController();
      const job: NonNullable<PerformanceArchive["job"]> = {
        key,
        controller,
        waiters: 0,
        promise: Promise.resolve().then(() =>
          this.scan(key, controller.signal),
        ),
      };
      job.promise = job.promise.finally(() => {
        if (this.job === job) this.job = undefined;
      });
      this.job = job;
    }
    const snapshot = await this.wait(this.job, filter.signal);
    const parts = snapshot.parts;
    const source = { revision: snapshot.revision, metadata: snapshot.metadata };
    if (
      filter.sessionId === undefined &&
      filter.agent === undefined &&
      filter.model === undefined &&
      filter.from === undefined &&
      filter.to === undefined
    )
      return Object.freeze({
        ...source,
        get records() {
          return snapshot.records;
        },
        *iterateRecords() {
          for (const part of parts)
            for (const record of part.records) yield record;
        },
      });
    const records: HistoryRecord[] = [];
    const checkpoint = scanScheduler(filter.signal, this.options);
    for (const part of parts) {
      if (
        (filter.from !== undefined && part.maxTime < filter.from) ||
        (filter.to !== undefined && part.minTime > filter.to)
      )
        continue;
      const offsets =
        filter.sessionId === undefined
          ? undefined
          : [
              ...(part.sessions.get(filter.sessionId) ?? []),
              ...(filter.sessionId === "__history__"
                ? []
                : (part.sessions.get("__history__") ?? [])),
            ].sort((a, b) => a - b);
      const candidates = offsets
        ? offsets.map((i) => part.records[i]).filter((r) => r !== undefined)
        : part.records;
      for (const record of candidates) {
        {
          const waiting = checkpoint();
          if (waiting) await waiting;
        }
        if (matchesHistory(record, filter)) records.push(record);
      }
    }
    filter.signal?.throwIfAborted();
    Object.freeze(records);
    return Object.freeze({ ...source, records });
  }
  private async wait(
    job: NonNullable<PerformanceArchive["job"]>,
    signal?: AbortSignal,
  ) {
    job.waiters++;
    let onAbort = () => {};
    try {
      return await Promise.race([
        job.promise,
        new Promise<never>((_resolve, reject) => {
          onAbort = () =>
            reject(
              signal?.reason ??
                job.controller.signal.reason ??
                new Error("Archive read cancelled"),
            );
          signal?.addEventListener("abort", onAbort, { once: true });
          job.controller.signal.addEventListener("abort", onAbort, {
            once: true,
          });
          if (signal?.aborted || job.controller.signal.aborted) onAbort();
        }),
      ]);
    } finally {
      signal?.removeEventListener("abort", onAbort);
      job.controller.signal.removeEventListener("abort", onAbort);
      if (--job.waiters === 0) job.controller.abort();
    }
  }
}
