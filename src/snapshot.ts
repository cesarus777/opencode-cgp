import { PolicyResolver, evaluateThreshold } from "./policy.ts";
import type {
  Config,
  SessionState,
  Measurement,
  ModelLimits,
  Threshold,
  Tokens,
  CompactionPhase,
} from "./types.ts";
export interface ContextSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly observedAt: number;
  readonly parentId?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly measurement?: Readonly<Measurement>;
  readonly limits?: Readonly<ModelLimits>;
  readonly capacityTokens?: number;
  readonly outputReserveTokens?: number;
  readonly policy: {
    readonly id: string;
    readonly configured: Readonly<Threshold>;
    readonly triggerTokens?: number;
    readonly comparison: ">=" | ">";
    readonly reason: string;
    readonly crossed: boolean;
  };
  readonly compaction: {
    readonly phase: CompactionPhase;
    readonly armed: boolean;
    readonly blockedReason?: string;
    readonly lastAttempt?: number;
    readonly lastCompleted?: number;
    readonly cooldownUntil?: number;
  };
  readonly cumulative?: Readonly<Omit<Tokens, "cache">> & {
    readonly cache: Readonly<Tokens["cache"]>;
  };
  readonly cumulativeScope: "session" | "unknown";
  readonly lastObservedActive: boolean;
}
export interface MonitorHealth {
  readonly enabled: boolean;
  readonly mode: "observe" | "enforce";
  readonly enforcement: "observing" | "available" | "suspended" | "disabled";
  readonly reasons: readonly string[];
  readonly staleMs: number;
  readonly maxSessions: number;
}
export interface SnapshotBatch {
  readonly schemaVersion: 1;
  readonly epoch: string;
  readonly sequence: number;
  readonly generatedAt: number;
  readonly health: MonitorHealth;
  readonly upserts: readonly ContextSnapshot[];
  readonly removed: readonly {
    readonly sessionId: string;
    readonly revision: number;
    readonly reason: "deleted" | "evicted";
  }[];
}
export interface SnapshotRead {
  readonly schemaVersion: 1;
  readonly sessionIds: readonly string[];
}
export interface SnapshotReadResult extends SnapshotBatch {
  readonly unavailable: readonly {
    readonly sessionId: string;
    readonly reason: "not-monitored";
  }[];
}
export function project(
  s: SessionState,
  config: Config,
  now: number,
  revision = 0,
): ContextSnapshot {
  const p = new PolicyResolver(config).resolve(s);
  const d = evaluateThreshold(
    p.threshold,
    s.usage.current,
    s.limits,
    now,
    config.safety.staleMs,
    s.model,
    p.policy,
    config.safety.outputReserveTokens,
  );
  const c = s.compaction;
  return freezeSnapshot({
    sessionId: s.sessionId,
    revision,
    observedAt: s.lastSeen,
    ...(s.parentId ? { parentId: s.parentId } : {}),
    ...(s.agent ? { agent: s.agent } : {}),
    ...(s.model ? { model: s.model } : {}),
    ...(s.usage.current
      ? {
          measurement: {
            tokens: s.usage.current.tokens,
            at: s.usage.current.at,
            model: s.usage.current.model,
            provenance: s.usage.current.provenance,
            confidence: s.usage.current.confidence,
            scope: s.usage.current.scope,
            ...(s.usage.current.requestId
              ? { requestId: s.usage.current.requestId }
              : {}),
          },
        }
      : {}),
    ...(s.limits
      ? {
          limits: {
            context: s.limits.context,
            output: s.limits.output,
            ...(s.limits.input === undefined ? {} : { input: s.limits.input }),
          },
        }
      : {}),
    ...(d.budget === undefined ? {} : { capacityTokens: d.budget }),
    ...(config.safety.outputReserveTokens === undefined && !s.limits
      ? {}
      : {
          outputReserveTokens:
            config.safety.outputReserveTokens ?? s.limits?.output ?? 0,
        }),
    policy: {
      id: p.policy,
      configured: { type: p.threshold.type, value: p.threshold.value },
      ...(d.threshold === undefined ? {} : { triggerTokens: d.threshold }),
      comparison: p.threshold.type === "remaining" ? ">" : ">=",
      reason: d.reason,
      crossed: d.crossed,
    },
    compaction: {
      phase: c.phase,
      armed: c.armed,
      ...(c.blockedReason ? { blockedReason: c.blockedReason } : {}),
      ...(c.lastAttempt === undefined
        ? {}
        : {
            lastAttempt: c.lastAttempt,
            cooldownUntil: c.lastAttempt + config.safety.cooldownMs,
          }),
      ...(c.lastCompleted === undefined
        ? {}
        : { lastCompleted: c.lastCompleted }),
    },
    ...(s.usage.cumulative
      ? {
          cumulative: {
            input: s.usage.cumulative.input,
            output: s.usage.cumulative.output,
            reasoning: s.usage.cumulative.reasoning,
            cache: {
              read: s.usage.cumulative.cache.read,
              write: s.usage.cumulative.cache.write,
            },
          },
        }
      : {}),
    cumulativeScope: s.usage.cumulativeScope,
    lastObservedActive: s.active,
  });
}
export class SnapshotStore {
  readonly epoch: string;
  private sequence = 0;
  private revision = 0;
  private rows = new Map<string, ContextSnapshot>();
  private deleted = new Set<string>();
  private dirty = new Set<string>();
  private listeners = new Set<(batch: SnapshotBatch) => void>();
  private healthKey = "";
  private reasons = new Set<string>();
  constructor(
    private readonly config: Config,
    private readonly sessions: () => ReadonlyMap<string, SessionState>,
    private readonly now = Date.now,
    epoch: string = crypto.randomUUID(),
  ) {
    this.epoch = epoch;
  }
  health(): MonitorHealth {
    return {
      enabled: this.config.enabled,
      mode: this.config.mode,
      enforcement: !this.config.enabled
        ? "disabled"
        : this.reasons.has("event-stream-gap") ||
            this.reasons.has("persistence-unavailable")
          ? "suspended"
          : this.config.mode === "observe"
            ? "observing"
            : "available",
      reasons: [...this.reasons].sort(),
      staleMs: this.config.safety.staleMs,
      maxSessions: this.config.safety.maxSessions,
    };
  }
  degrade(
    reason:
      | "event-stream-gap"
      | "persistence-unavailable"
      | "capacity-exceeded"
      | "model-metadata-unavailable",
  ) {
    this.reasons.add(reason);
  }
  recover(reason: "capacity-exceeded" | "model-metadata-unavailable") {
    this.reasons.delete(reason);
  }
  mark(id: string) {
    if (this.dirty.size < this.config.safety.maxSessions) this.dirty.add(id);
  }
  markAll() {
    for (const id of this.sessions().keys()) this.mark(id);
  }
  remove(id: string) {
    if (this.rows.has(id)) this.deleted.add(id);
  }
  listen(fn: (batch: SnapshotBatch) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private batch(
    upserts: readonly ContextSnapshot[],
    removed: SnapshotBatch["removed"],
  ): SnapshotBatch {
    return {
      schemaVersion: 1,
      epoch: this.epoch,
      sequence: this.sequence,
      generatedAt: this.now(),
      health: this.health(),
      upserts,
      removed,
    };
  }
  flush() {
    const upserts: ContextSnapshot[] = [],
      removed: SnapshotBatch["removed"][number][] = [];
    const resident = this.sessions();
    for (const [id, old] of this.rows)
      if (
        old.measurement &&
        old.policy.reason !== "stale-usage" &&
        this.now() - old.measurement.at > this.config.safety.staleMs
      )
        this.mark(id);
    for (const id of resident.keys()) if (!this.rows.has(id)) this.mark(id);
    for (const id of this.dirty) {
      const s = resident.get(id);
      if (!s) continue;
      const next = project(s, this.config, this.now());
      const old = this.rows.get(id);
      if (
        old &&
        JSON.stringify({ ...old, revision: 0 }) === JSON.stringify(next)
      )
        continue;
      const row = freezeSnapshot({ ...next, revision: ++this.revision });
      this.rows.set(id, row);
      upserts.push(row);
    }
    for (const id of this.rows.keys())
      if (!resident.has(id)) {
        this.rows.delete(id);
        removed.push({
          sessionId: id,
          revision: ++this.revision,
          reason: this.deleted.has(id) ? "deleted" : "evicted",
        });
      }
    this.deleted.clear();
    this.dirty.clear();
    const healthKey = JSON.stringify(this.health()),
      changed = healthKey !== this.healthKey;
    this.healthKey = healthKey;
    const changes = [
      ...upserts.map((row) => ({ kind: "upsert" as const, row })),
      ...removed.map((row) => ({ kind: "remove" as const, row })),
    ];
    for (let i = 0; i < Math.max(changes.length, changed ? 1 : 0); i += 128) {
      this.sequence++;
      const slice = changes.slice(i, i + 128);
      const batch = this.batch(
        slice.flatMap((change) =>
          change.kind === "upsert" ? [change.row] : [],
        ),
        slice.flatMap((change) =>
          change.kind === "remove" ? [change.row] : [],
        ),
      );
      for (const fn of this.listeners) {
        try {
          fn(structuredClone(batch));
        } catch {
          /* Observers never affect enforcement. */
        }
      }
    }
  }

  read(input: SnapshotRead): SnapshotReadResult {
    this.flush();
    const ids = [...new Set(input.sessionIds)];
    return structuredClone({
      ...this.batch(
        ids.flatMap((id) => {
          const row = this.rows.get(id);
          return row ? [row] : [];
        }),
        [],
      ),
      unavailable: ids
        .filter((id) => !this.rows.has(id))
        .map((sessionId) => ({ sessionId, reason: "not-monitored" as const })),
    });
  }
}

function freezeSnapshot(row: ContextSnapshot): ContextSnapshot {
  if (row.measurement) Object.freeze(row.measurement);
  if (row.limits) Object.freeze(row.limits);
  Object.freeze(row.policy.configured);
  Object.freeze(row.policy);
  Object.freeze(row.compaction);
  if (row.cumulative) {
    Object.freeze(row.cumulative.cache);
    Object.freeze(row.cumulative);
  }
  return Object.freeze(row);
}
