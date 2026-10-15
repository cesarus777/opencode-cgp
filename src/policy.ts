import type {
  Config,
  Identity,
  Measurement,
  ModelLimits,
  Threshold,
  Decision,
} from "./types.ts";
// Linear wildcard matching avoids regex backtracking from configurable selectors.
export function glob(pattern: string, text: string): boolean {
  let p = 0,
    t = 0,
    star = -1,
    retry = 0;
  while (t < text.length) {
    if (pattern[p] === "?" || pattern[p] === text[t]) {
      p++;
      t++;
    } else if (pattern[p] === "*") {
      star = p++;
      retry = t;
    } else if (star >= 0) {
      p = star + 1;
      t = ++retry;
    } else return false;
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
export class PolicyResolver {
  constructor(private readonly config: Config) {}
  resolve(identity: Identity): { threshold: Threshold; policy: string } {
    let result = {
      threshold: this.config.defaults.threshold,
      policy: "defaults",
    };
    this.config.policies.forEach((p, i) => {
      const m = p.match;
      if (m.role && m.role !== (identity.parentId ? "subagent" : "main"))
        return;
      if (m.agent && (!identity.agent || !glob(m.agent, identity.agent)))
        return;
      if (m.model && (!identity.model || !glob(m.model, identity.model)))
        return;
      result = { threshold: p.threshold, policy: `policies[${i}]` };
    });
    return result;
  }
}
export function usableInput(
  limits?: ModelLimits,
  reserve?: number,
): number | undefined {
  if (!limits) return undefined;
  const valid = (n: number | undefined): n is number =>
    n !== undefined && Number.isFinite(n) && n > 0;
  const output = reserve ?? (valid(limits.output) ? limits.output : undefined);
  const contextBudget =
    valid(limits.context) && output !== undefined
      ? Math.max(0, limits.context - output)
      : undefined;
  if (valid(limits.input))
    return contextBudget === undefined
      ? limits.input
      : Math.min(limits.input, contextBudget);
  return contextBudget;
}
export function evaluateThreshold(
  threshold: Threshold,
  measurement: Measurement | undefined,
  limits: ModelLimits | undefined,
  now: number,
  staleMs: number,
  model: string | undefined,
  policy: string,
  reserve?: number,
): Decision {
  const budget = usableInput(limits, reserve);
  const base: Decision = {
    crossed: false,
    reason: "missing-usage",
    policy,
    ...(budget === undefined ? {} : { budget }),
  };
  const trigger =
    threshold.type === "tokens"
      ? threshold.value
      : budget === undefined
        ? undefined
        : threshold.type === "ratio"
          ? Math.ceil(budget * threshold.value)
          : budget - threshold.value;
  if (trigger !== undefined) base.threshold = trigger;
  if (!measurement) return base;
  if (model !== measurement.model) return { ...base, reason: "model-changed" };
  if (!Number.isFinite(measurement.tokens) || measurement.tokens < 0)
    return { ...base, reason: "invalid-usage" };
  if (now - measurement.at > staleMs || measurement.at > now)
    return { ...base, reason: "stale-usage" };
  if (budget !== undefined && budget > 0)
    base.percentage = (measurement.tokens / budget) * 100;
  if (trigger === undefined) return { ...base, reason: "missing-model-budget" };
  if (trigger <= 0) return { ...base, reason: "incompatible-model-budget" };
  const crossed =
    threshold.type === "remaining"
      ? measurement.tokens > trigger
      : measurement.tokens >= trigger;
  return {
    ...base,
    crossed,
    reason: crossed ? "threshold-crossed" : "below-threshold",
  };
}
