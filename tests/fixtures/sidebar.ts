import { metric, type GuardRow } from "../../src/family.ts";
import type { ContextSnapshot } from "../../src/snapshot.ts";

export function sidebarFamily(): GuardRow[] {
  return [
    {
      id: "main",
      agent: "Main",
      tokens: 112000,
      trigger: 160000,
      status: "running",
      depth: 0,
    },
    {
      id: "explore",
      parent: "main",
      agent: "explore",
      tokens: 410000,
      trigger: 400000,
      status: "running",
      depth: 1,
    },
    {
      id: "indexer",
      parent: "explore",
      agent: "indexer",
      tokens: 170000,
      trigger: 400000,
      status: "running",
      depth: 2,
    },
    {
      id: "implementor",
      parent: "main",
      agent: "implementor",
      tokens: 275000,
      trigger: 300000,
      status: "running",
      depth: 1,
    },
    {
      id: "reviewer",
      parent: "main",
      agent: "reviewer",
      tokens: 70000,
      trigger: 400000,
      status: "completed",
      depth: 1,
    },
  ].map((item): GuardRow => {
    const snapshot: ContextSnapshot = {
      sessionId: item.id,
      revision: 1,
      observedAt: 1000,
      agent: item.agent,
      model: "deepseek-flash",
      measurement: {
        tokens: item.tokens,
        at: 1000,
        model: "deepseek-flash",
        confidence: "reported",
        provenance: "provider-normalized",
        scope: "completed-request",
      },
      capacityTokens: 500000,
      peakTokens: item.tokens,
      policy: {
        id: "defaults",
        configured: { type: "tokens", value: item.trigger },
        triggerTokens: item.trigger,
        comparison: ">=",
        reason: "below-threshold",
        crossed: item.tokens >= item.trigger,
      },
      compaction: {
        phase: "idle",
        armed: true,
        count: item.id === "main" ? 4 : 0,
      },
      cumulativeScope: "unknown",
      lastObservedActive: item.status === "running",
    };
    return {
      node: {
        sessionId: item.id,
        ...(item.parent ? { parentId: item.parent } : {}),
        agent: item.agent,
        model: "deepseek-flash",
        status: item.status === "completed" ? "completed" : "running",
      },
      snapshot,
      current: item.id === "main",
      depth: item.depth,
      hidden: 0,
      ...metric(snapshot, 4000, 300000),
    };
  });
}
