import type {
  CompactionPort,
  Config,
  SessionState,
  TelemetrySink,
} from "./types.ts";
export class CompactionScheduler {
  private stopped = false;
  private readonly jobs = new Set<Promise<void>>();
  constructor(
    private readonly config: Config,
    private readonly port: CompactionPort,
    private readonly sink: TelemetrySink,
    private readonly now: () => number = Date.now,
    private readonly id: () => string = () =>
      `msg_${crypto.randomUUID().replaceAll("-", "")}`,
  ) {}
  consider(s: SessionState): void {
    if (
      this.stopped ||
      !this.config.enabled ||
      this.config.mode !== "enforce" ||
      !s.decision?.crossed
    )
      return;
    const c = s.compaction,
      time = this.now();
    if (
      c.phase !== "idle" ||
      !c.armed ||
      c.consecutiveFailures >= this.config.safety.maxConsecutiveFailures
    )
      return;
    if (
      c.lastAttempt !== undefined &&
      time - c.lastAttempt < this.config.safety.cooldownMs
    )
      return;
    c.phase = "requesting";
    c.lastAttempt = time;
    c.requestId = this.id();
    c.before = s.usage.current?.tokens;
    c.beforeModel = s.model;
    c.beforeConfidence = s.usage.current?.confidence;
    c.armed = false;
    this.emit("compaction.requesting", s);
    // Hooks only record and schedule. Never await admission from inside a runtime hook.
    const requestId = c.requestId;
    const job = new Promise<void>((resolve) => setTimeout(resolve, 0))
      .then(async () => {
        if (this.stopped || c.phase !== "requesting") return;
        try {
          await this.port.compact(s.sessionId, requestId);
          // Started/ended may arrive before the admission response.
          if (c.phase === "requesting") c.phase = "accepted";
          this.emit("compaction.accepted", s);
        } catch {
          if (c.phase === "requesting") {
            c.phase = "uncertain";
            c.blockedReason = "admission-outcome-unknown";
            c.failures++;
            c.consecutiveFailures++;
            this.emit("compaction.uncertain", s);
          }
        }
      })
      .finally(() => this.jobs.delete(job));
    this.jobs.add(job);
  }
  lifecycle(
    s: SessionState,
    event: "started" | "ended" | "failed",
    at: number,
  ): void {
    const c = s.compaction;
    if (event === "started") {
      if (c.phase !== "requesting" && c.phase !== "accepted") {
        c.before = s.usage.current?.tokens;
        c.beforeModel = s.model;
        c.beforeConfidence = s.usage.current?.confidence;
      }
      c.phase = "running";
      c.armed = false;
      c.lastAttempt = at;
    } else if (event === "ended") {
      c.phase = "awaiting-measurement";
      c.lastCompleted = at;
      c.count++;
      c.consecutiveFailures = 0;
      delete s.usage.current;
    } else {
      c.failures++;
      c.consecutiveFailures++;
      c.lastAttempt = at;
      c.armed = true;
      c.phase =
        c.consecutiveFailures >= this.config.safety.maxConsecutiveFailures
          ? "blocked"
          : "idle";
      c.blockedReason = "compaction-failed";
      delete s.usage.current; // Do not retry against the same old measurement.
    }
    this.emit(`compaction.${event}`, s);
  }
  measured(s: SessionState): void {
    const c = s.compaction,
      m = s.usage.current;
    if (!m) return;
    if (c.phase === "awaiting-measurement") {
      // Only compare like-for-like reported requests, not a serialized fallback.
      if (m.confidence !== "reported" || m.at < (c.lastCompleted ?? 0)) return;
      if (
        c.beforeModel !== m.model ||
        c.before === undefined ||
        c.beforeConfidence !== "reported"
      ) {
        c.phase = "blocked";
        c.blockedReason = "reclaim-unverifiable";
      } else if (c.before - m.tokens < this.config.safety.minReclaimTokens) {
        c.phase = "blocked";
        c.blockedReason = "insufficient-reclaim";
      } else {
        c.phase = "idle";
        c.armed = false;
        delete c.blockedReason;
      }
    }
    const resetAt =
      (s.decision?.threshold ?? 0) - this.config.safety.minReclaimTokens;
    if (
      m.tokens <= resetAt &&
      (c.phase === "idle" ||
        (c.phase === "blocked" && c.blockedReason !== "compaction-failed"))
    ) {
      c.armed = true;
      c.phase = "idle";
      delete c.blockedReason;
    }
  }
  tick(s: SessionState): void {
    const c = s.compaction;
    if (
      (c.phase === "accepted" ||
        c.phase === "running" ||
        c.phase === "requesting") &&
      this.now() - (c.lastAttempt ?? this.now()) >
        this.config.safety.pendingTimeoutMs
    ) {
      c.phase = "uncertain";
      c.blockedReason = "completion-event-timeout";
      this.emit("compaction.uncertain", s);
    }
  }
  private emit(type: string, session: SessionState) {
    this.sink.emit({ type, time: this.now(), session });
  }
  async flush(): Promise<void> {
    await Promise.all(this.jobs);
  }
  stop(): void {
    this.stopped = true;
  }
}
