import type {
  ContextSnapshot,
  SnapshotBatch,
  SnapshotReadResult,
  MonitorHealth,
} from "../snapshot.ts";
import { isBatch, isResult } from "../rpc.ts";
export interface SnapshotTransport {
  read(
    location: string,
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<unknown>;
  subscribe(location: string, signal: AbortSignal): AsyncIterable<unknown>;
}
export type Connection =
  | "loading"
  | "live"
  | "reconnecting"
  | "unavailable"
  | "incompatible";
export class SnapshotClient {
  readonly rows = new Map<string, ContextSnapshot>();
  health: MonitorHealth | undefined;
  connection: Connection = "loading";
  private epoch: string | undefined;
  private sequence = -1;
  private revisions = new Map<string, number>();
  private baselines = new Map<string, number>();
  private controller: AbortController | undefined;
  private generation = 0;
  private ids: readonly string[] = [];
  private location = "";
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private reading: Promise<void> | undefined;
  private buffered: SnapshotBatch[] = [];
  private overflow = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private serverAt = 0;
  private receivedAt = 0;
  private refreshAgain = false;
  private subscriptionActive = false;
  constructor(
    private readonly transport: SnapshotTransport,
    private readonly changed: () => void,
    private readonly elapsed = () => performance.now(),
  ) {}
  now() {
    return this.serverAt + Math.max(0, this.elapsed() - this.receivedAt);
  }
  setIds(ids: readonly string[]) {
    const next = [...new Set(ids)].slice(0, 2048);
    if (JSON.stringify(next) === JSON.stringify(this.ids)) return;
    this.ids = next;
    const selected = new Set(next);
    for (const id of new Set([
      ...this.revisions.keys(),
      ...this.baselines.keys(),
    ]))
      if (!selected.has(id)) {
        this.revisions.delete(id);
        this.baselines.delete(id);
        this.rows.delete(id);
      }
    if (this.reading) this.refreshAgain = true;
    else void this.refresh();
  }
  start(location: string, ids: readonly string[]) {
    this.stop();
    this.location = location;
    this.ids = [...new Set(ids)].slice(0, 2048);
    this.rows.clear();
    this.revisions.clear();
    this.baselines.clear();
    this.health = undefined;
    this.epoch = undefined;
    this.sequence = -1;
    this.failures = 0;
    this.connection = "loading";
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    void this.supervise(generation, controller.signal);
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, 15000);
    void this.refresh();
  }
  private merge(
    batch: SnapshotBatch,
    baseline = false,
    requested: readonly string[] = [],
  ) {
    if (this.epoch !== batch.epoch) {
      if (!baseline) {
        this.connection = "reconnecting";
        this.refreshAgain = true;
        return;
      }
      this.rows.clear();
      this.revisions.clear();
      this.baselines.clear();
      this.epoch = batch.epoch;
      this.sequence = -1;
    }
    if (!baseline && batch.sequence > this.sequence + 1) {
      this.connection = "reconnecting";
      this.refreshAgain = true;
    }
    if (batch.sequence >= this.sequence) {
      this.sequence = batch.sequence;
      this.health = batch.health;
      this.serverAt = batch.generatedAt;
      this.receivedAt = this.elapsed();
    }
    const selected = new Set(
      baseline ? requested.filter((id) => this.ids.includes(id)) : this.ids,
    );
    for (const row of batch.upserts)
      if (
        selected.has(row.sessionId) &&
        (baseline ||
          batch.sequence > (this.baselines.get(row.sessionId) ?? -1)) &&
        row.revision > (this.revisions.get(row.sessionId) ?? -1)
      ) {
        this.rows.set(row.sessionId, row);
        this.revisions.set(row.sessionId, row.revision);
      }
    for (const row of batch.removed)
      if (
        selected.has(row.sessionId) &&
        (baseline ||
          batch.sequence > (this.baselines.get(row.sessionId) ?? -1)) &&
        row.revision > (this.revisions.get(row.sessionId) ?? -1)
      ) {
        this.rows.delete(row.sessionId);
        this.revisions.set(row.sessionId, row.revision);
      }
    this.changed();
  }
  refresh(): Promise<void> {
    if (this.reading) return this.reading;
    const controller = this.controller,
      generation = this.generation,
      location = this.location;
    if (!controller) return Promise.resolve();
    clearTimeout(this.retryTimer);
    const requestedIds = [...this.ids];
    this.reading = (async () => {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(5000),
      ]);
      const chunks: string[][] = [];
      for (let i = 0; i < requestedIds.length; i += 128)
        chunks.push(requestedIds.slice(i, i + 128));
      if (!chunks.length) chunks.push([]);
      const results: { ids: string[]; result: SnapshotReadResult }[] = [];
      for (let i = 0; i < chunks.length; i += 2) {
        const reads = await Promise.all(
          chunks.slice(i, i + 2).map(async (ids) => {
            // Race cancellation too: a faulty/missing service must not retain the read forever.
            const value = await abortable(
              this.transport.read(location, ids, signal),
              signal,
            );
            if (generation !== this.generation)
              throw new Error("Obsolete read");
            if (!isResult(value)) {
              this.connection = "incompatible";
              throw new Error("Incompatible snapshot");
            }
            const answered = [
              ...value.upserts.map((row) => row.sessionId),
              ...value.unavailable.map((row) => row.sessionId),
            ];
            if (
              value.removed.length ||
              answered.length !== ids.length ||
              new Set(answered).size !== ids.length ||
              answered.some((id) => !ids.includes(id))
            )
              throw new Error("Incomplete snapshot read");
            return { ids, result: value };
          }),
        );
        results.push(...reads);
      }
      if (generation !== this.generation || signal.aborted) return;
      if (new Set(results.map((r) => r.result.epoch)).size !== 1)
        throw new Error("Epoch changed during read");
      for (const { ids, result } of results) {
        this.merge(result, true, ids);
        for (const missing of result.unavailable)
          if (this.ids.includes(missing.sessionId))
            this.rows.delete(missing.sessionId);
        for (const id of ids)
          if (this.ids.includes(id)) this.baselines.set(id, result.sequence);
      }
      const buffered = this.buffered;
      this.buffered = [];
      if (buffered.some((b) => b.epoch !== this.epoch) || this.overflow) {
        this.overflow = false;
        throw new Error("Stream changed during read");
      }
      for (const batch of buffered) this.merge(batch);
      this.failures = 0;
      this.connection =
        this.refreshAgain || !this.subscriptionActive ? "reconnecting" : "live";
      this.changed();
    })()
      .catch(() => {
        if (generation === this.generation && !controller.signal.aborted) {
          this.buffered = [];
          this.overflow = false;
          if (this.connection !== "incompatible")
            this.connection = this.rows.size ? "reconnecting" : "unavailable";
          this.changed();
          this.retryTimer = setTimeout(
            () => {
              void this.refresh();
            },
            Math.min(30000, 1000 * 2 ** Math.min(this.failures++, 5)),
          );
        }
      })
      .finally(() => {
        if (generation === this.generation) {
          this.reading = undefined;
          if (this.refreshAgain) {
            this.refreshAgain = false;
            void this.refresh();
          }
        }
      });
    return this.reading;
  }
  private async supervise(generation: number, signal: AbortSignal) {
    let retry = 0;
    while (!signal.aborted && generation === this.generation) {
      try {
        this.subscriptionActive = true;
        if (retry)
          queueMicrotask(() => {
            if (generation === this.generation && !signal.aborted)
              void this.refresh();
          });
        for await (const value of this.transport.subscribe(
          this.location,
          signal,
        )) {
          if (signal.aborted || generation !== this.generation) return;
          if (!isBatch(value)) {
            this.connection = "incompatible";
            this.changed();
            continue;
          }
          if (this.reading || !this.epoch) {
            if (this.buffered.length < 256) this.buffered.push(value);
            else this.overflow = true;
          } else {
            this.merge(value);
            if (this.refreshAgain) {
              this.refreshAgain = false;
              void this.refresh();
            }
          }
          retry = 0;
        }
      } catch {
        /* EOF and errors both require a fresh read. */
      }
      if (signal.aborted || generation !== this.generation) return;
      this.subscriptionActive = false;
      this.connection = "reconnecting";
      this.changed();
      await this.refresh();
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          resolve();
        };
        const timer = setTimeout(
          finish,
          Math.min(30000, 1000 * 2 ** Math.min(retry++, 5)),
        );
        signal.addEventListener("abort", finish, { once: true });
        if (signal.aborted) finish();
      });
    }
  }
  stop() {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    clearInterval(this.refreshTimer);
    clearTimeout(this.retryTimer);
    this.reading = undefined;
    this.buffered = [];
    this.overflow = false;
    this.refreshAgain = false;
  }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("Snapshot request cancelled"));
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
