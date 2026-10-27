import type { DashboardPort, DashboardSession } from "./port.ts";

export interface InventoryLimits {
  readonly maxNodes: number;
  readonly maxPages: number;
  readonly maxDepth: number;
}
export type InventoryNotice =
  | "node-limit"
  | "page-limit"
  | "depth-limit"
  | "repeated-cursor"
  | "inventory-unavailable"
  | "foreign-location"
  | "invalid-hierarchy";
export interface DashboardInventory {
  readonly sessions: readonly DashboardSession[];
  readonly complete: boolean;
  readonly pages: number;
  readonly notices: readonly InventoryNotice[];
}
export const inventoryLimits: InventoryLimits = Object.freeze({
  maxNodes: 1024,
  maxPages: 100,
  maxDepth: 64,
});
export function validateInventoryLimits(limits: InventoryLimits): void {
  if (
    !Number.isInteger(limits.maxNodes) ||
    limits.maxNodes < 1 ||
    limits.maxNodes > 2048 ||
    !Number.isInteger(limits.maxPages) ||
    limits.maxPages < 1 ||
    limits.maxPages > 100 ||
    !Number.isInteger(limits.maxDepth) ||
    limits.maxDepth < 0 ||
    limits.maxDepth > 64
  )
    throw new Error("Invalid dashboard inventory limits");
}

/** Bounded breadth-first discovery of a whole location, without transcript reads. */
export async function discoverInventory(
  port: Pick<DashboardPort, "location" | "listSessions">,
  signal: AbortSignal,
  limits: InventoryLimits = inventoryLimits,
): Promise<DashboardInventory> {
  validateInventoryLimits(limits);
  const sessions = new Map<string, DashboardSession>();
  const notices = new Set<InventoryNotice>();
  const queue: {
    parent: string | null;
    depth: number;
    cursor?: string;
    cursors: readonly string[];
  }[] = [{ parent: null, depth: 0, cursors: [] }];
  let pages = 0;
  while (queue.length && pages < limits.maxPages) {
    signal.throwIfAborted();
    const branch = queue.shift();
    if (!branch) break;
    try {
      pages++;
      const page = await port.listSessions(
        {
          parentID: branch.parent,
          limit: 100,
          ...(branch.cursor ? { cursor: branch.cursor } : {}),
        },
        signal,
      );
      signal.throwIfAborted();
      for (const session of page.data) {
        if (session.directory !== port.location.directory) {
          notices.add("foreign-location");
          continue;
        }
        if (
          (session.parentId ?? null) !== branch.parent ||
          sessions.has(session.sessionId)
        ) {
          notices.add("invalid-hierarchy");
          continue;
        }
        if (sessions.size >= limits.maxNodes) {
          notices.add("node-limit");
          return {
            sessions: [...sessions.values()],
            complete: false,
            pages,
            notices: [...notices],
          };
        }
        sessions.set(session.sessionId, session);
        if (branch.depth < limits.maxDepth)
          queue.push({
            parent: session.sessionId,
            depth: branch.depth + 1,
            cursors: [],
          });
        else notices.add("depth-limit");
      }
      const cursor = page.cursor?.next;
      if (cursor) {
        if (cursor === branch.cursor || branch.cursors.includes(cursor))
          notices.add("repeated-cursor");
        else
          queue.unshift({
            ...branch,
            cursor,
            cursors: [...branch.cursors, cursor],
          });
      }
    } catch {
      signal.throwIfAborted();
      notices.add("inventory-unavailable");
    }
  }
  if (queue.length) notices.add("page-limit");
  return {
    sessions: [...sessions.values()],
    complete: !notices.size,
    pages,
    notices: [...notices],
  };
}
