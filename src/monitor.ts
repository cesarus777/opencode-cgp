import { PolicyResolver, evaluateThreshold } from "./policy.ts";
import { CompactionScheduler } from "./scheduler.ts";
import {
  NoopBudgetController,
  type BudgetController,
  type Config,
  type ContextUsage,
  type ContextUsageProvider,
  type Identity,
  type Measurement,
  type ModelLimits,
  type SessionState,
  type TelemetrySink,
  type Tokens,
} from "./types.ts";
export function promptTokens(t: Tokens): number | undefined {
  const fields = [t.input, t.output, t.reasoning, t.cache.read, t.cache.write];
  if (fields.some((x) => !Number.isSafeInteger(x) || x < 0)) return undefined;
  const total = t.input + t.cache.read + t.cache.write;
  return total > 0 && Number.isSafeInteger(total) ? total : undefined;
}
export class ContextMonitor implements ContextUsageProvider {
  readonly sessions = new Map<string, SessionState>();
  private readonly resolver: PolicyResolver;
  constructor(
    private readonly config: Config,
    readonly scheduler: CompactionScheduler,
    private readonly sink: TelemetrySink,
    private readonly now: () => number = Date.now,
    private readonly budget: BudgetController = new NoopBudgetController(),
  ) {
    this.resolver = new PolicyResolver(config);
  }
  touch(identity: Identity, limits?: ModelLimits): SessionState | undefined {
    let s = this.sessions.get(identity.sessionId);
    if (!s) {
      this.cleanup();
      if (this.sessions.size >= this.config.safety.maxSessions) {
        this.sink.emit({
          time: this.now(),
          type: "capacity-exceeded",
          detail: "New session not monitored; increase safety.maxSessions",
        });
        return;
      }
      s = {
        ...identity,
        lastSeen: this.now(),
        sequence: -1,
        active: false,
        usage: {
          cumulativeScope: "unknown",
          peak: 0,
          modelRequests: 0,
          toolCalls: 0,
          countersSince: this.now(),
        },
        compaction: {
          phase: "idle",
          armed: true,
          count: 0,
          failures: 0,
          consecutiveFailures: 0,
        },
      };
      this.sessions.set(identity.sessionId, s);
    }
    if (identity.model && identity.model !== s.model) {
      delete s.usage.current;
      delete s.limits;
    }
    Object.assign(s, identity);
    s.lastSeen = this.now();
    if (limits) s.limits = { ...limits };
    return s;
  }
  accept(s: SessionState, sequence: number): boolean {
    if (sequence <= s.sequence) return false;
    s.sequence = sequence;
    s.lastSeen = this.now();
    return true;
  }
  measure(
    s: SessionState,
    measurement: Measurement,
    cumulative?: Tokens,
  ): void {
    if (s.usage.current && measurement.at < s.usage.current.at) return;
    s.usage.current = measurement;
    s.usage.peak = Math.max(s.usage.peak, measurement.tokens);
    if (cumulative) {
      s.usage.cumulative = cumulative;
      s.usage.cumulativeScope = "session";
    }
    this.evaluate(s);
  }
  evaluate(s: SessionState): void {
    const p = this.resolver.resolve(s);
    s.decision = evaluateThreshold(
      p.threshold,
      s.usage.current,
      s.limits,
      this.now(),
      this.config.safety.staleMs,
      s.model,
      p.policy,
      this.config.safety.outputReserveTokens,
    );
    this.scheduler.measured(s);
    const action = this.budget.evaluate({
      session: s,
      now: this.now(),
      elapsedMs: this.now() - s.usage.countersSince,
    });
    if (action.type !== "continue")
      this.sink.emit({
        time: this.now(),
        type: `budget.${action.type}`,
        session: s,
        detail:
          "Advisory extension; only context policies execute in this release",
      });
    this.sink.emit({
      time: this.now(),
      type:
        this.config.mode === "observe" && s.decision.crossed
          ? "would-compact"
          : "usage",
      session: s,
    });
    this.scheduler.consider(s);
  }
  remove(id: string): void {
    const s = this.sessions.get(id);
    if (s) {
      s.active = false;
      s.compaction.phase = "blocked";
      s.compaction.blockedReason = "session-removed";
      this.sink.emit({ time: this.now(), type: "session.removed", session: s });
      this.sessions.delete(id);
    }
  }
  cleanup(): void {
    for (const [id, s] of this.sessions) {
      this.scheduler.tick(s);
      if (
        !s.active &&
        ["idle", "blocked"].includes(s.compaction.phase) &&
        this.now() - s.lastSeen > this.config.safety.sessionTtlMs
      )
        this.remove(id);
    }
  }
  async getUsage(id: string): Promise<ContextUsage> {
    const s = this.sessions.get(id);
    if (!s) throw new Error("Unknown session");
    return structuredClone(s.usage);
  }
}
