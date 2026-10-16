import type { OpenCodeClient, SessionInfo } from "@opencode/client";
interface Branch {
  readonly id: string;
  readonly depth: number;
  readonly cursor?: string;
  readonly cursors: readonly string[];
}
export interface Inventory {
  readonly sessions: ReadonlyMap<string, SessionInfo>;
  readonly complete: boolean;
  readonly rootId: string;
  readonly pages: number;
  readonly pending: readonly Branch[];
  readonly scanned: ReadonlySet<string>;
  readonly damaged: boolean;
}
export async function discoverFamily(
  client: Pick<OpenCodeClient, "session">,
  currentId: string,
  signal: AbortSignal,
  cached: (id: string) => SessionInfo | undefined,
  maxNodes = 1024,
  previous?: Inventory,
): Promise<Inventory> {
  const sessions = new Map(previous?.sessions);
  let damaged = previous?.damaged ?? false,
    pages = 0,
    rootId = previous?.rootId ?? currentId;
  const get = async (id: string) =>
    cached(id) ?? client.session.get({ sessionID: id }, { signal });
  if (!previous) {
    let current = await get(currentId);
    for (let depth = 0; depth <= 64; depth++) {
      if (signal.aborted) throw signal.reason;
      if (sessions.has(current.id) || sessions.size >= maxNodes) {
        damaged = true;
        break;
      }
      sessions.set(current.id, current);
      rootId = current.id;
      if (!current.parentID) break;
      if (depth === 64) {
        damaged = true;
        break;
      }
      try {
        current = await get(current.parentID);
      } catch {
        if (signal.aborted) throw signal.reason;
        damaged = true;
        break;
      }
    }
  }
  const queue: Branch[] = previous
    ? [...previous.pending]
    : [{ id: rootId, depth: 0, cursors: [] }];
  const scanned = new Set(previous?.scanned);
  while (queue.length && pages < 100) {
    const next = queue.shift();
    if (!next) break;
    if (!next.cursor && scanned.has(next.id)) {
      damaged = true;
      continue;
    }
    if (signal.aborted) throw signal.reason;
    try {
      pages++;
      const response = await client.session.list(
        {
          parentID: next.id,
          limit: 100,
          order: "desc",
          ...(next.cursor ? { cursor: next.cursor } : {}),
        },
        { signal },
      );
      let capped = false;
      for (const child of response.data) {
        if (child.parentID !== next.id || child.id === next.id) {
          damaged = true;
          continue;
        }
        if (!sessions.has(child.id) && sessions.size >= maxNodes) {
          capped = true;
          break;
        }
        sessions.set(child.id, child);
        // Ancestors already in the map still need their descendants scanned.
        if (
          !scanned.has(child.id) &&
          !queue.some((branch) => branch.id === child.id)
        ) {
          if (next.depth < 64)
            queue.push({ id: child.id, depth: next.depth + 1, cursors: [] });
          else damaged = true;
        }
      }
      if (capped) {
        queue.unshift(next);
        break;
      }
      const cursor = response.cursor?.next;
      if (cursor) {
        if (next.cursors.includes(cursor) || cursor === next.cursor)
          damaged = true;
        else
          queue.unshift({
            ...next,
            cursor,
            cursors: [...next.cursors, cursor],
          });
      } else scanned.add(next.id);
    } catch {
      if (signal.aborted) throw signal.reason;
      damaged = true;
    }
  }
  return {
    sessions,
    complete: !damaged && !queue.length,
    rootId,
    pages: (previous?.pages ?? 0) + pages,
    pending: queue,
    scanned,
    damaged,
  };
}
