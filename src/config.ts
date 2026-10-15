import type { Config, Match, Policy, Threshold } from "./types.ts";
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${path}: expected object`);
  return value as Record<string, unknown>;
}
function keys(o: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(o))
    if (!allowed.includes(key))
      throw new Error(`${path}.${key}: unknown option`);
}
function number(v: unknown, fallback: number, path: string, min = 0): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min)
    throw new Error(`${path}: expected integer >= ${min}`);
  return v;
}
function bool(v: unknown, fallback: boolean, path: string): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") throw new Error(`${path}: expected boolean`);
  return v;
}
function selector(v: unknown, path: string): string {
  if (
    typeof v !== "string" ||
    !v.length ||
    v.length > 256 ||
    /[\[\]{}\\]/.test(v)
  )
    throw new Error(`${path}: expected selector (only * and ? wildcards)`);
  return v;
}
function threshold(v: unknown, path: string): Threshold {
  const o = object(v, path);
  keys(o, ["type", "value"], path);
  if (o.type !== "tokens" && o.type !== "ratio" && o.type !== "remaining")
    throw new Error(`${path}.type: invalid threshold`);
  if (
    typeof o.value !== "number" ||
    !Number.isFinite(o.value) ||
    o.value <= 0 ||
    (o.type === "ratio" ? o.value > 1 : !Number.isSafeInteger(o.value))
  )
    throw new Error(`${path}.value: invalid threshold`);
  return { type: o.type, value: o.value };
}
export function parseConfig(value: unknown = {}): Config {
  const o = object(value, "options");
  keys(
    o,
    ["enabled", "mode", "defaults", "policies", "safety", "telemetry"],
    "options",
  );
  if (o.mode !== undefined && o.mode !== "observe" && o.mode !== "enforce")
    throw new Error("mode: expected observe or enforce");
  const d = object(o.defaults ?? {}, "defaults");
  keys(d, ["threshold"], "defaults");
  const s = object(o.safety ?? {}, "safety");
  keys(
    s,
    [
      "cooldownMs",
      "minReclaimTokens",
      "maxConsecutiveFailures",
      "pendingTimeoutMs",
      "staleMs",
      "maxSessions",
      "sessionTtlMs",
      "outputReserveTokens",
    ],
    "safety",
  );
  const t = object(o.telemetry ?? {}, "telemetry");
  keys(t, ["enabled", "jsonl", "path", "maxBytes"], "telemetry");
  if (
    t.path !== undefined &&
    (typeof t.path !== "string" || !t.path.startsWith("/"))
  )
    throw new Error("telemetry.path: expected absolute path");
  if (
    o.policies !== undefined &&
    (!Array.isArray(o.policies) || o.policies.length > 256)
  )
    throw new Error("policies: expected array of at most 256 policies");
  const policies: Policy[] = ((o.policies as unknown[] | undefined) ?? []).map(
    (v, i) => {
      const p = object(v, `policies[${i}]`);
      keys(p, ["match", "threshold"], `policies[${i}]`);
      const m = object(p.match, "match");
      keys(m, ["role", "model", "agent"], "match");
      if (!Object.keys(m).length)
        throw new Error("match: at least one selector required");
      const match: Match = {};
      if (m.role !== undefined) {
        if (m.role !== "main" && m.role !== "subagent")
          throw new Error("match.role: invalid");
        match.role = m.role;
      }
      if (m.model !== undefined) {
        match.model = selector(m.model, "match.model");
        if (!match.model.includes("/"))
          throw new Error("match.model: use provider/model");
      }
      if (m.agent !== undefined) match.agent = selector(m.agent, "match.agent");
      return { match, threshold: threshold(p.threshold, "threshold") };
    },
  );
  const config: Config = {
    enabled: bool(o.enabled, true, "enabled"),
    mode: o.mode ?? "observe",
    defaults: {
      threshold: threshold(
        d.threshold ?? { type: "tokens", value: 131072 },
        "defaults.threshold",
      ),
    },
    policies,
    safety: {
      cooldownMs: number(s.cooldownMs, 60000, "cooldownMs"),
      minReclaimTokens: number(s.minReclaimTokens, 8192, "minReclaimTokens"),
      maxConsecutiveFailures: number(
        s.maxConsecutiveFailures,
        3,
        "maxConsecutiveFailures",
        1,
      ),
      pendingTimeoutMs: number(
        s.pendingTimeoutMs,
        300000,
        "pendingTimeoutMs",
        1,
      ),
      staleMs: number(s.staleMs, 300000, "staleMs", 1),
      maxSessions: number(s.maxSessions, 1024, "maxSessions", 1),
      sessionTtlMs: number(s.sessionTtlMs, 86400000, "sessionTtlMs", 1),
      ...(s.outputReserveTokens === undefined
        ? {}
        : {
            outputReserveTokens: number(
              s.outputReserveTokens,
              0,
              "outputReserveTokens",
            ),
          }),
    },
    telemetry: {
      enabled: bool(t.enabled, true, "telemetry.enabled"),
      jsonl: bool(t.jsonl, true, "telemetry.jsonl"),
      maxBytes: number(t.maxBytes, 8 * 1024 * 1024, "maxBytes", 4096),
      ...(typeof t.path === "string" ? { path: t.path } : {}),
    },
  };
  for (const policy of [config.defaults, ...config.policies]) {
    if (
      policy.threshold.type === "tokens" &&
      config.safety.minReclaimTokens >= policy.threshold.value
    )
      throw new Error(
        "minReclaimTokens must be smaller than each absolute threshold",
      );
  }
  if (!config.telemetry.jsonl && config.telemetry.path)
    throw new Error("telemetry.path requires jsonl");
  return config;
}
