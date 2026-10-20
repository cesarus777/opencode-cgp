import type { Tokens } from "./types.ts";

export interface PerformanceSnapshot {
  readonly sessionCreatedAt: number;
  readonly sessionOutputTokens?: number;
  readonly observedSince: number;
  readonly at: number;
  readonly status: "waiting" | "streaming" | "idle" | "unavailable";
  readonly partial: boolean;
  readonly liveTps?: number;
  readonly averageModelTps?: number;
  readonly averageSessionTps?: number;
  readonly ttftMs?: number;
  readonly latestRequestTps?: number;
  readonly requestId?: string;
  readonly requestAgent?: string;
  readonly requestModel?: string;
  readonly requestOutputTokens?: number;
  readonly requestStartedAt?: number;
  readonly firstOutputAt?: number;
  readonly streamEndedAt?: number;
  readonly estimatedOutputTokens: number;
  readonly modelOutputTokens: number;
  readonly modelDurationMs: number;
  readonly completedRequests: number;
  readonly tokenSource: "estimated" | "reported" | "unavailable";
}
interface Request {
  id: string;
  agent: string;
  model: string;
  started: number;
  first?: number;
  ended?: number;
  chars: number;
  settled: boolean;
  output?: number;
  events: Set<string>;
  buckets: Map<number, number>;
}
interface Row {
  observedSince: number;
  created: number;
  cumulative?: number;
  partial: boolean;
  output: number;
  duration: number;
  completed: number;
  sequence: number;
  request?: Request;
  latest?: PerformanceSnapshot;
}
export interface PerformanceCheckpoint {
  sessionId: string;
  observedSince: number;
  created: number;
  output: number;
  duration: number;
  completed: number;
  sequence: number;
}
const valid = (n: number) => Number.isFinite(n) && n >= 0;
const rate = (tokens: number, ms: number) =>
  valid(tokens) && ms > 0 ? (tokens * 1000) / ms : undefined;
export function outputTokens(
  tokens: Pick<Tokens, "output" | "reasoning">,
): number | undefined {
  const n = tokens.output + tokens.reasoning;
  return Number.isSafeInteger(tokens.output) &&
    tokens.output >= 0 &&
    Number.isSafeInteger(tokens.reasoning) &&
    tokens.reasoning >= 0 &&
    Number.isSafeInteger(n)
    ? n
    : undefined;
}

/** Scalar-only collection. No harness types or generated content are retained. */
export class PerformanceTracker {
  private rows = new Map<string, Row>();
  constructor(
    private readonly maxSessions: number,
    private readonly windowMs = 2000,
    private readonly now = Date.now,
  ) {}
  observe(id: string, created: number, cumulative: number | undefined) {
    let row = this.rows.get(id);
    if (!row) {
      if (this.rows.size >= this.maxSessions) return;
      row = {
        observedSince: this.now(),
        created,
        partial: cumulative !== 0,
        output: 0,
        duration: 0,
        completed: 0,
        sequence: -1,
      };
      this.rows.set(id, row);
    }
    if (valid(created)) row.created = created;
    if (cumulative !== undefined && valid(cumulative))
      row.cumulative = cumulative;
  }
  accept(id: string, sequence: number) {
    const row = this.rows.get(id);
    if (!row || sequence <= row.sequence) return false;
    row.sequence = sequence;
    return true;
  }
  start(
    id: string,
    requestId: string,
    agent: string,
    model: string,
    started: number,
  ) {
    const row = this.rows.get(id);
    if (!row || !valid(started)) return;
    const old = row.request;
    if (old?.id === requestId && old.started === started) return;
    if (old && !old.settled) row.partial = true;
    row.request = {
      id: requestId,
      agent,
      model,
      started,
      chars: 0,
      settled: false,
      events: new Set(),
      buckets: new Map(),
    };
  }
  delta(
    id: string,
    requestId: string,
    eventId: string,
    at: number,
    characters: number,
  ) {
    const row = this.rows.get(id),
      r = row?.request;
    if (
      !row ||
      !r ||
      r.id !== requestId ||
      r.settled ||
      r.ended !== undefined ||
      !valid(at) ||
      at < r.started ||
      !valid(characters) ||
      !characters ||
      r.events.has(eventId)
    )
      return;
    // SDK chunks have unique event IDs; ordinals identify blocks, not chunks.
    if (r.events.size >= 256)
      r.events.delete(r.events.values().next().value ?? "");
    r.events.add(eventId);
    r.first = r.first === undefined ? at : Math.min(r.first, at);
    r.chars += characters;
    const bucket = Math.floor(at / 100) * 100;
    r.buckets.set(bucket, (r.buckets.get(bucket) ?? 0) + characters);
    this.prune(r, Math.max(at, this.now()));
    while (r.buckets.size > Math.ceil(this.windowMs / 100) + 2) {
      r.buckets.delete(Math.min(...r.buckets.keys()));
    }
  }
  streamed(id: string, requestId: string, at: number) {
    const row = this.rows.get(id),
      r = row?.request;
    if (!row || !r || r.id !== requestId || r.settled || r.ended !== undefined)
      return;
    if (
      !valid(at) ||
      at <= r.started ||
      (r.first !== undefined && at < r.first)
    ) {
      row.partial = true;
      return;
    }
    r.ended = at;
  }
  settle(id: string, requestId: string, tokens: number | undefined) {
    const row = this.rows.get(id),
      r = row?.request;
    if (!row) return;
    if (!r || r.id !== requestId) {
      row.partial = true;
      return;
    }
    if (r.settled) return;
    r.settled = true;
    if (tokens !== undefined && valid(tokens)) r.output = tokens;
    if (tokens !== undefined && valid(tokens) && r.ended !== undefined) {
      row.output += tokens;
      row.duration += r.ended - r.started;
      row.completed++;
    } else row.partial = true;
    const snapshot = this.snapshot(id);
    if (snapshot) {
      const { latestRequestTps: _previousRate, ...current } = snapshot;
      row.latest = {
        ...current,
        tokenSource: tokens === undefined ? "unavailable" : "reported",
        ...(tokens !== undefined && r.ended !== undefined
          ? { latestRequestTps: (tokens * 1000) / (r.ended - r.started) }
          : {}),
      };
    }
    r.events.clear();
    r.buckets.clear();
  }
  gap(id?: string) {
    for (const [key, row] of this.rows) {
      if (id !== undefined && key !== id) continue;
      row.partial = true;
      delete row.request;
    }
  }
  private prune(r: Request, at: number) {
    for (const time of r.buckets.keys())
      if (time < at - this.windowMs) r.buckets.delete(time);
  }
  snapshot(id: string): PerformanceSnapshot | undefined {
    const row = this.rows.get(id);
    if (!row) return;
    const at = this.now(),
      r = row.request;
    const active = r && !r.settled && r.ended === undefined;
    if (r) this.prune(r, at);
    const live = active
      ? rate(
          [...r.buckets.values()].reduce((a, b) => a + b, 0) / 4,
          Math.min(this.windowMs, at - r.started),
        )
      : 0;
    const averageModelTps = rate(row.output, row.duration);
    const averageSessionTps =
      row.cumulative === undefined
        ? undefined
        : rate(row.cumulative, at - row.created);
    return {
      observedSince: row.observedSince,
      at,
      sessionCreatedAt: row.created,
      ...(row.cumulative === undefined
        ? {}
        : { sessionOutputTokens: row.cumulative }),
      status: active
        ? r.first === undefined
          ? "waiting"
          : "streaming"
        : !r && row.partial
          ? "unavailable"
          : "idle",
      partial: row.partial,
      ...(live === undefined || (!r && row.partial) ? {} : { liveTps: live }),
      ...(averageModelTps === undefined ? {} : { averageModelTps }),
      ...(averageSessionTps === undefined ? {} : { averageSessionTps }),
      ...(r
        ? {
            requestId: r.id,
            requestAgent: r.agent,
            requestModel: r.model,
            requestStartedAt: r.started,
            ...(r.output === undefined
              ? {}
              : { requestOutputTokens: r.output }),
            ...(r.first === undefined
              ? {}
              : { firstOutputAt: r.first, ttftMs: r.first - r.started }),
            ...(r.ended === undefined ? {} : { streamEndedAt: r.ended }),
          }
        : row.latest
          ? {
              ...(row.latest.ttftMs === undefined
                ? {}
                : { ttftMs: row.latest.ttftMs }),
            }
          : {}),
      ...(row.latest?.latestRequestTps === undefined
        ? {}
        : { latestRequestTps: row.latest.latestRequestTps }),
      estimatedOutputTokens: r ? r.chars / 4 : 0,
      modelOutputTokens: row.output,
      modelDurationMs: row.duration,
      completedRequests: row.completed,
      tokenSource:
        r && !r.settled
          ? "estimated"
          : (row.latest?.tokenSource ?? "unavailable"),
    };
  }
  checkpoint(): PerformanceCheckpoint[] {
    return [...this.rows].map(([sessionId, r]) => ({
      sessionId,
      observedSince: r.observedSince,
      created: r.created,
      output: r.output,
      duration: r.duration,
      completed: r.completed,
      sequence: r.sequence,
    }));
  }
  restore(value: unknown) {
    if (!Array.isArray(value)) return;
    for (const item of value.slice(0, this.maxSessions)) {
      if (!item || typeof item !== "object") continue;
      const r: Record<string, unknown> = item;
      if (
        typeof r.sessionId !== "string" ||
        !r.sessionId.length ||
        r.sessionId.length > 512 ||
        ![r.observedSince, r.created, r.output, r.duration, r.completed].every(
          (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
        ) ||
        typeof r.sequence !== "number" ||
        !Number.isSafeInteger(r.sequence) ||
        r.sequence < -1
      )
        continue;
      // Narrow each field before crossing the persisted-data boundary.
      const { observedSince, created, output, duration, completed, sequence } =
        r;
      if (
        typeof observedSince !== "number" ||
        typeof created !== "number" ||
        typeof output !== "number" ||
        typeof duration !== "number" ||
        typeof completed !== "number"
      )
        continue;
      this.rows.set(r.sessionId, {
        observedSince,
        created,
        output,
        duration,
        completed,
        sequence,
        partial: true,
      });
    }
  }
  remove(id: string) {
    this.rows.delete(id);
  }
  ids() {
    return this.rows.keys();
  }
}
