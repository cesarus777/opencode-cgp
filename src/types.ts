export type Threshold = {
  type: "tokens" | "ratio" | "remaining";
  value: number;
};
export interface Match {
  role?: "main" | "subagent";
  model?: string;
  agent?: string;
}
export interface Policy {
  match: Match;
  threshold: Threshold;
}
export interface Config {
  enabled: boolean;
  mode: "observe" | "enforce";
  defaults: { threshold: Threshold };
  policies: Policy[];
  safety: {
    cooldownMs: number;
    minReclaimTokens: number;
    maxConsecutiveFailures: number;
    pendingTimeoutMs: number;
    staleMs: number;
    maxSessions: number;
    sessionTtlMs: number;
    outputReserveTokens?: number;
  };
  telemetry: {
    enabled: boolean;
    jsonl: boolean;
    path?: string;
    maxBytes: number;
  };
}
export interface ModelLimits {
  context: number;
  input?: number;
  output: number;
}
export interface Identity {
  sessionId: string;
  parentId?: string;
  agent?: string;
  model?: string;
}
export interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}
export interface Measurement {
  tokens: number;
  at: number;
  model: string;
  requestId?: string;
  provenance: "provider-normalized" | "serialized-estimate";
  confidence: "reported" | "approximate";
  scope: "completed-request" | "prepared-request";
}
export interface ContextUsage {
  current?: Measurement;
  cumulative?: Tokens;
  cumulativeScope: "session" | "unknown";
  peak: number;
  modelRequests: number;
  toolCalls: number;
  countersSince: number;
}
export interface ContextUsageProvider {
  getUsage(sessionId: string): Promise<ContextUsage>;
}
export type CompactionPhase =
  | "idle"
  | "requesting"
  | "accepted"
  | "running"
  | "awaiting-measurement"
  | "blocked"
  | "uncertain";
export interface CompactionState {
  phase: CompactionPhase;
  count: number;
  failures: number;
  consecutiveFailures: number;
  lastAttempt?: number;
  lastCompleted?: number;
  before?: number | undefined;
  beforeModel?: string | undefined;
  beforeConfidence?: Measurement["confidence"] | undefined;
  requestId?: string;
  blockedReason?: string;
  armed: boolean;
}
export interface Decision {
  crossed: boolean;
  reason: string;
  policy: string;
  threshold?: number;
  budget?: number;
  percentage?: number;
}
export interface SessionState extends Identity {
  usage: ContextUsage;
  compaction: CompactionState;
  limits?: ModelLimits;
  decision?: Decision;
  lastSeen: number;
  lastExecutionEnd?: number;
  sequence: number;
  active: boolean;
}
export type BudgetAction =
  | { type: "continue" }
  | {
      type: "warn" | "compact" | "checkpoint" | "rotate" | "stop";
      reason: string;
    };
export interface BudgetInput {
  session: Readonly<SessionState>;
  now: number;
  elapsedMs: number;
  depth?: number;
  inheritedTokenBudget?: number; // Unknown is not zero.
}
export interface BudgetController {
  evaluate(input: BudgetInput): BudgetAction;
}
export class NoopBudgetController implements BudgetController {
  evaluate(_input: BudgetInput): BudgetAction {
    return { type: "continue" };
  }
}
export interface TelemetryEvent {
  time: number;
  type: string;
  session?: SessionState;
  detail?: string;
}
export interface TelemetrySink {
  emit(event: TelemetryEvent): void;
}
export interface CompactionPort {
  compact(sessionId: string, requestId: string): Promise<void>;
}
