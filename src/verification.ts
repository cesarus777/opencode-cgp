import { PolicyResolver, evaluateThreshold } from "./policy.ts";
import type {
  Config,
  CompactionVerification,
  CompactionWarning,
  SessionState,
} from "./types.ts";

export function captureTarget(s: SessionState, config: Config) {
  const policy = new PolicyResolver(config).resolve(s);
  const decision = evaluateThreshold(
    policy.threshold,
    undefined,
    s.limits,
    0,
    0,
    s.model,
    policy.policy,
    config.safety.outputReserveTokens,
  );
  return {
    ...(decision.threshold !== undefined && decision.threshold > 0
      ? { target: decision.threshold }
      : {}),
    comparison:
      policy.threshold.type === "remaining" ? (">" as const) : (">=" as const),
    ...(s.model ? { model: s.model } : {}),
  };
}
export function addWarning(v: CompactionVerification, code: CompactionWarning) {
  if (!v.warnings.includes(code)) v.warnings.push(code);
}
export function verifyTokens(
  v: CompactionVerification,
  input: {
    started?: number;
    at: number;
    model: string;
    tokens?: number;
    now: number;
    staleMs: number;
  },
) {
  if (v.tokens !== "pending" || input.at <= v.completedAt) return;
  if (input.started === undefined) {
    v.tokens = "unverified";
    addWarning(v, "verification-unverified");
    return;
  }
  if (input.started <= v.completedAt) return;
  v.checkedAt = input.at;
  if (
    input.tokens === undefined ||
    v.target === undefined ||
    v.model !== input.model ||
    input.now - input.at > input.staleMs ||
    input.at > input.now
  ) {
    v.tokens = "unverified";
    addWarning(v, "verification-unverified");
    return;
  }
  v.measuredTokens = input.tokens;
  v.tokens = (
    v.comparison === ">" ? input.tokens > v.target : input.tokens >= v.target
  )
    ? "failed"
    : "verified";
  if (v.tokens === "failed") addWarning(v, "token-target-exceeded");
}

/** Narrow and copy scalar data from storage; never spread untrusted records. */
export function decodeVerification(
  value: unknown,
): CompactionVerification | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const v = value as Record<string, unknown>;
  const statuses = ["pending", "verified", "failed", "unverified", "disabled"];
  if (
    typeof v.completionId !== "string" ||
    v.completionId.length > 512 ||
    typeof v.completedAt !== "number" ||
    !Number.isSafeInteger(v.completedAt) ||
    v.completedAt < 0 ||
    !statuses.includes(String(v.protection)) ||
    !statuses.includes(String(v.tokens)) ||
    !Array.isArray(v.warnings)
  )
    return;
  const warnings: CompactionWarning[] = [];
  for (const code of [
    "protected-text-changed",
    "preservation-fallback",
    "token-target-exceeded",
    "verification-unverified",
  ] as const)
    if (v.warnings.includes(code)) warnings.push(code);
  const result: CompactionVerification = {
    completionId: v.completionId,
    completedAt: v.completedAt,
    protection: v.protection as CompactionVerification["protection"],
    tokens: v.tokens as CompactionVerification["tokens"],
    warnings,
  };
  for (const key of ["target", "checkedAt", "measuredTokens"] as const)
    if (
      typeof v[key] === "number" &&
      Number.isSafeInteger(v[key]) &&
      v[key] >= 0
    )
      result[key] = v[key];
  if (v.comparison === ">" || v.comparison === ">=")
    result.comparison = v.comparison;
  if (typeof v.model === "string" && v.model.length <= 512)
    result.model = v.model;
  return result;
}
