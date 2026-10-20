import type { ContextSnapshot } from "./snapshot.ts";
export type ExecutionStatus =
  | "running"
  | "idle"
  | "completed"
  | "failed"
  | "unknown";
export interface SessionNode {
  readonly sessionId: string;
  readonly parentId?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly status: ExecutionStatus;
  readonly interrupted?: boolean;
}
export interface GuardRow {
  readonly node: SessionNode;
  readonly snapshot?: ContextSnapshot;
  readonly depth: number;
  readonly current: boolean;
  readonly freshness: "fresh" | "stale" | "missing" | "invalid";
  readonly pressure: "normal" | "near" | "crossed" | "unknown";
  readonly pressureRatio?: number;
  readonly utilizationPercent?: number;
  readonly triggerDeltaTokens?: number;
  readonly hidden: number;
}
export function metric(
  snapshot: ContextSnapshot | undefined,
  now: number,
  staleMs: number,
) {
  const m = snapshot?.measurement;
  const freshness = !m
    ? "missing"
    : m.model !== snapshot?.model || m.at > now
      ? "invalid"
      : now - m.at > staleMs
        ? "stale"
        : "fresh";
  const t = snapshot?.policy.triggerTokens;
  const valid = freshness === "fresh" && m !== undefined;
  const displayable = valid || (freshness === "stale" && m !== undefined);
  const pressureRatio =
    valid && t !== undefined && t > 0 ? m.tokens / t : undefined;
  const crossed =
    valid &&
    t !== undefined &&
    t > 0 &&
    (snapshot?.policy.comparison === ">" ? m.tokens > t : m.tokens >= t);
  return {
    freshness,
    pressure:
      pressureRatio === undefined
        ? "unknown"
        : crossed
          ? "crossed"
          : pressureRatio >= 0.9
            ? "near"
            : "normal",
    ...(pressureRatio === undefined ? {} : { pressureRatio }),
    ...(displayable && snapshot?.capacityTokens && snapshot.capacityTokens > 0
      ? { utilizationPercent: (m.tokens / snapshot.capacityTokens) * 100 }
      : {}),
    ...(valid && t !== undefined ? { triggerDeltaTokens: t - m.tokens } : {}),
  } as const;
}
export function familyRows(
  nodes: readonly SessionNode[],
  snapshots: ReadonlyMap<string, ContextSnapshot>,
  current: string,
  now: number,
  staleMs: number,
  expanded: ReadonlySet<string> = new Set(),
  limit = 1024,
  timing?: (id: string) => { now: number; staleMs: number },
  stableOrder: readonly string[] = [],
): GuardRow[] {
  const byId = new Map(nodes.map((n) => [n.sessionId, n]));
  const children = new Map<string, SessionNode[]>();
  for (const n of byId.values()) {
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : "";
    const list = children.get(parent) ?? [];
    list.push(n);
    children.set(parent, list);
  }
  const metrics = new Map(
    [...byId.keys()].map((id) => [
      id,
      metric(
        snapshots.get(id),
        timing?.(id).now ?? now,
        timing?.(id).staleMs ?? staleMs,
      ),
    ]),
  );
  const protectedIds = new Set<string>();
  let ancestor = byId.get(current);
  while (ancestor && !protectedIds.has(ancestor.sessionId)) {
    protectedIds.add(ancestor.sessionId);
    ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
  }
  const scores = new Map<string, number>(),
    sensitive = new Map<string, boolean>(),
    sizes = new Map<string, number>();
  const calculate = (n: SessionNode, seen: Set<string>): number => {
    if (seen.has(n.sessionId)) return -1;
    if (scores.has(n.sessionId)) return scores.get(n.sessionId) ?? -1;
    const path = new Set(seen).add(n.sessionId),
      m = metrics.get(n.sessionId);
    let score = m?.pressureRatio ?? -1,
      size = 1;
    let keep =
      protectedIds.has(n.sessionId) ||
      n.status === "running" ||
      m?.pressure === "crossed" ||
      ["blocked", "uncertain"].includes(
        snapshots.get(n.sessionId)?.compaction.phase ?? "",
      );
    for (const child of children.get(n.sessionId) ?? []) {
      score = Math.max(score, calculate(child, path));
      size += sizes.get(child.sessionId) ?? 0;
      keep ||= sensitive.get(child.sessionId) ?? false;
    }
    scores.set(n.sessionId, score);
    sizes.set(n.sessionId, size);
    sensitive.set(n.sessionId, keep);
    return score;
  };
  for (const n of byId.values()) calculate(n, new Set());
  const visited = new Set<string>(),
    rows: GuardRow[] = [];
  const visit = (n: SessionNode, depth: number) => {
    if (visited.has(n.sessionId) || rows.length >= limit || depth > 64) return;
    visited.add(n.sessionId);
    const snapshot = snapshots.get(n.sessionId),
      m = metrics.get(n.sessionId) ?? metric(undefined, now, staleMs);
    const collapsed =
      n.status === "completed" &&
      !sensitive.get(n.sessionId) &&
      !expanded.has(n.sessionId);
    rows.push({
      node: n,
      ...(snapshot ? { snapshot } : {}),
      depth,
      current: n.sessionId === current,
      ...m,
      hidden: collapsed ? (sizes.get(n.sessionId) ?? 1) - 1 : 0,
    });
    if (collapsed) {
      const pending = [...(children.get(n.sessionId) ?? [])];
      while (pending.length) {
        const child = pending.pop();
        if (!child || visited.has(child.sessionId)) continue;
        visited.add(child.sessionId);
        pending.push(...(children.get(child.sessionId) ?? []));
      }
    }
    if (!collapsed)
      for (const child of sorted(children.get(n.sessionId) ?? []))
        visit(child, depth + 1);
  };
  const ranks = new Map(stableOrder.map((id, i) => [id, i]));
  const sorted = (items: SessionNode[]) =>
    [...items].sort(
      (a, b) =>
        (stableOrder.length
          ? (ranks.get(a.sessionId) ?? Infinity) -
            (ranks.get(b.sessionId) ?? Infinity)
          : 0) ||
        (scores.get(b.sessionId) ?? -1) - (scores.get(a.sessionId) ?? -1) ||
        a.sessionId.localeCompare(b.sessionId),
    );
  for (const n of sorted(children.get("") ?? [])) visit(n, 0);
  // Cyclic/orphan inventories remain inspectable without inventing an edge.
  for (const n of byId.values())
    if (!visited.has(n.sessionId) && rows.length < limit) visit(n, 0);
  return rows;
}
export interface ExecutionEvidence {
  readonly startedAt?: number;
  readonly terminalAt?: number;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
}
export function executionStatus(
  known: boolean,
  nativeRunning: boolean,
  evidence: ExecutionEvidence,
): ExecutionStatus {
  if (
    nativeRunning ||
    (evidence.startedAt !== undefined &&
      evidence.startedAt > (evidence.terminalAt ?? -1))
  )
    return "running";
  if (
    evidence.outcome &&
    (evidence.terminalAt ?? -1) >= (evidence.startedAt ?? -1)
  )
    return evidence.outcome === "succeeded"
      ? "completed"
      : evidence.outcome === "failed"
        ? "failed"
        : "unknown";
  return known ? "idle" : "unknown";
}
