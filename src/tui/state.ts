import type { Plugin } from "@opencode/plugin/tui";
import type { SessionInfo } from "@opencode/client";
import { createSignal } from "solid-js";
import {
  monitorRpc,
  performanceRpc,
  isPerformanceResult,
  historyRpc,
  isHistoryResult,
} from "../rpc.ts";
import {
  executionStatus,
  familyRows,
  type ExecutionEvidence,
  type SessionNode,
  type GuardRow,
} from "../family.ts";
import { ContextTraceStore } from "./contextchart.ts";
import { SnapshotClient } from "./transport.ts";
import { discoverFamily, type Inventory } from "./inventory.ts";
export function createGuardState(context: Plugin.Context) {
  const contextTraces = new ContextTraceStore();
  const [version, setVersion] = createSignal(0);
  const notify = () => {
    setVersion((n) => n + 1);
    scheduleExpiry();
  };
  const rpc = context.client.rpc(monitorRpc);
  const liveRpc = context.client.rpc(performanceRpc);
  const clients = new Map<string, SnapshotClient>();
  let inventory: Inventory | undefined,
    currentId = "",
    controller: AbortController | undefined;
  let scanGeneration = 0,
    scanning = false,
    maxNodes = 1024;
  let scanFailed = false;
  const consumers = new Map<symbol, string>();
  const [preferences, savePreferences] = context.storage.store<{
    expanded: string[];
  }>("context-guard.ui.v1", { initial: { expanded: [] } });
  const expanded = new Set<string>(
    Array.isArray(preferences.expanded)
      ? preferences.expanded
          .filter((id) => typeof id === "string" && id.length <= 512)
          .slice(0, 1024)
      : [],
  );
  const evidence = new Map<string, ExecutionEvidence>();
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleExpiry() {
    clearTimeout(expiryTimer);
    if (!consumers.size) return;
    let delay = Infinity;
    for (const client of clients.values())
      for (const row of client.rows.values()) {
        if (!row.measurement || !client.health) continue;
        const remaining =
          row.measurement.at + client.health.staleMs + 1 - client.now();
        if (remaining > 0) delay = Math.min(delay, remaining);
      }
    if (Number.isFinite(delay))
      expiryTimer = setTimeout(notify, Math.min(2147483647, Math.ceil(delay)));
  }
  let ageTimer: ReturnType<typeof setInterval> | undefined,
    scanTimer: ReturnType<typeof setInterval> | undefined,
    eventTimer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  function select() {
    const id = [...consumers.values()].at(-1);
    if (!id || id === currentId) return;
    controller?.abort();
    scanGeneration++;
    scanning = false;
    for (const c of clients.values()) c.stop();
    clients.clear();
    currentId = id;
    inventory = undefined;
    evidence.clear();
    maxNodes = 1024;
    let scanFailed = false;
    notify();
    void scan();
  }
  async function scan(more = false) {
    if (scanning || !currentId || !consumers.size) return;
    scanning = true;
    const generation = ++scanGeneration;
    controller?.abort();
    controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15000),
    ]);
    try {
      const next = await discoverFamily(
        context.client,
        currentId,
        signal,
        (id) => context.data.session.get(id),
        maxNodes,
        more ? inventory : undefined,
      );
      if (signal.aborted || generation !== scanGeneration) return;
      inventory = next;
      scanFailed = false;
      for (const id of evidence.keys())
        if (!next.sessions.has(id)) evidence.delete(id);
      const groups = new Map<string, { ids: string[] }>();
      for (const s of next.sessions.values()) {
        const key = locationKey(s.location),
          group = groups.get(key) ?? { ids: [] as string[] };
        group.ids.push(s.id);
        groups.set(key, group);
      }
      for (const [key, c] of clients)
        if (!groups.has(key)) {
          c.stop();
          clients.delete(key);
        }
      for (const [key, group] of groups) {
        const sample = next.sessions.get(group.ids[0] ?? "");
        if (!sample) continue;
        let c = clients.get(key);
        if (!c) {
          const location = sample.location;
          // Probe once per location. A failed v2 probe falls back to the unchanged v1 contract.
          let selectedRpc: typeof rpc | typeof liveRpc = rpc;
          try {
            const probe = await liveRpc.read(
              { schemaVersion: 1, sessionIds: [] },
              { location, signal },
            );
            if (isPerformanceResult(probe)) selectedRpc = liveRpc;
          } catch {
            /* Older servers expose only v1. */
          }
          if (signal.aborted || generation !== scanGeneration) return;
          const source = selectedRpc;
          c = new SnapshotClient(
            {
              read: (_key, ids, requestSignal) =>
                source.read(
                  { schemaVersion: 1, sessionIds: ids },
                  { location, signal: requestSignal },
                ),
              subscribe: async function* (_key, requestSignal) {
                for await (const event of source.events.subscribe("changed", {
                  signal: requestSignal,
                })) {
                  if (event.location && sameLocation(event.location, location))
                    yield event.data;
                }
              },
            },
            notify,
          );
          clients.set(key, c);
          c.start(key, group.ids);
        } else c.setIds(group.ids);
      }
      notify();
    } catch {
      if (generation === scanGeneration && !controller?.signal.aborted) {
        scanFailed = true;
        notify();
      }
    } finally {
      if (generation === scanGeneration) scanning = false;
    }
  }
  function acquire(id: string) {
    const token = Symbol();
    consumers.set(token, id);
    if (consumers.size === 1) {
      ageTimer = setInterval(notify, 1000);
      scanTimer = setInterval(() => {
        void scan();
      }, 30000);
      unlisten = context.data.listen(({ details: event }) => {
        if (
          !("sessionID" in event.data) ||
          !inventory?.sessions.has(event.data.sessionID)
        ) {
          if (event.type !== "session.created") return;
        }
        if (
          "created" in event &&
          "sessionID" in event.data &&
          event.type.startsWith("session.execution.")
        ) {
          const id = event.data.sessionID,
            previous = evidence.get(id) ?? {};
          if (event.type === "session.execution.started")
            evidence.set(id, {
              ...previous,
              startedAt: Math.max(previous.startedAt ?? 0, event.created),
            });
          if (
            [
              "session.execution.succeeded",
              "session.execution.failed",
              "session.execution.interrupted",
            ].includes(event.type) &&
            event.created >= (previous.terminalAt ?? 0)
          ) {
            const outcome =
              event.type === "session.execution.succeeded"
                ? "succeeded"
                : event.type === "session.execution.failed"
                  ? "failed"
                  : "interrupted";
            evidence.set(id, {
              ...previous,
              terminalAt: event.created,
              outcome,
            });
          }
          notify();
        }
        if (
          [
            "session.created",
            "session.deleted",
            "session.model.selected",
            "session.agent.selected",
          ].includes(event.type)
        ) {
          clearTimeout(eventTimer);
          eventTimer = setTimeout(() => {
            void scan();
          }, 100);
        }
      });
    }
    select();
    return {
      update(next: string) {
        consumers.set(token, next);
        select();
      },
      release() {
        consumers.delete(token);
        if (consumers.size) select();
        else stop();
      },
    };
  }
  function stop() {
    controller?.abort();
    scanGeneration++;
    scanning = false;
    for (const c of clients.values()) c.stop();
    clients.clear();
    clearTimeout(expiryTimer);
    clearInterval(ageTimer);
    clearInterval(scanTimer);
    clearTimeout(eventTimer);
    unlisten?.();
    unlisten = undefined;
    inventory = undefined;
    evidence.clear();
    currentId = "";
  }
  function rows(stableOrder: readonly string[] = [], allDescendants = false) {
    version();
    const snapshots = new Map(
      [...clients.values()].flatMap((c) => [...c.rows]),
    );
    const nodes: SessionNode[] = [...(inventory?.sessions.values() ?? [])].map(
      (original) => {
        const s: SessionInfo =
          context.data.session.get(original.id) ?? original;
        const observed = evidence.get(s.id) ?? {};
        const metadataAt = s.time.idle ?? 0;
        const e: ExecutionEvidence =
          s.outcome && metadataAt >= (observed.terminalAt ?? 0)
            ? { ...observed, outcome: s.outcome, terminalAt: metadataAt }
            : observed;
        return {
          sessionId: s.id,
          ...(s.parentID ? { parentId: s.parentID } : {}),
          ...(s.agent ? { agent: s.agent } : {}),
          ...(s.model ? { model: `${s.model.providerID}/${s.model.id}` } : {}),
          ...(e.outcome === "interrupted" ? { interrupted: true } : {}),
          status: executionStatus(
            true,
            context.data.session.status(s.id) === "running",
            e,
          ),
        };
      },
    );
    const c =
      [...clients.values()].find((c) => c.rows.has(currentId)) ??
      clients.values().next().value;
    return familyRows(
      nodes,
      snapshots,
      currentId,
      c?.now() ?? Date.now(),
      c?.health?.staleMs ?? 300000,
      allDescendants ? new Set(nodes.map((node) => node.sessionId)) : expanded,
      maxNodes,
      (id) => {
        const session = inventory?.sessions.get(id);
        const client = session
          ? clients.get(locationKey(session.location))
          : undefined;
        return {
          now: client?.now() ?? Date.now(),
          staleMs: client?.health?.staleMs ?? 300000,
        };
      },
      stableOrder,
    );
  }
  return {
    version,
    acquire,
    async history(id: string, from: number, to: number, signal: AbortSignal) {
      const info = inventory?.sessions.get(id);
      if (!info) throw new Error("Session location unavailable");
      const result = await context.client
        .rpc(historyRpc)
        .read(
          { schemaVersion: 1, sessionId: id, from, to, maxPoints: 240 },
          { location: info.location, signal },
        );
      if (!isHistoryResult(result))
        throw new Error("Incompatible history service");
      return result;
    },
    rows,
    contextTrace: (row: GuardRow | undefined) => contextTraces.update(row),
    dispose() {
      stop();
      contextTraces.clear();
    },
    age(id: string) {
      version();
      const c = [...clients.values()].find((c) => c.rows.has(id));
      const m = c?.rows.get(id)?.measurement;
      return c && m ? c.now() - m.at : 0;
    },
    health() {
      version();
      return (
        [...clients.values()].find((c) => c.rows.has(currentId))?.health ??
        clients.values().next().value?.health
      );
    },
    connection() {
      version();
      return clients.size
        ? ([...clients.values()]
            .map((c) => c.connection)
            .find((c) => c !== "live") ?? "live")
        : scanFailed
          ? "unavailable"
          : "loading";
    },
    complete() {
      version();
      return inventory?.complete ?? false;
    },
    refresh() {
      void scan();
      for (const c of clients.values()) void c.refresh();
    },
    loadMore() {
      maxNodes = Math.min(2048, maxNodes + 1024);
      void scan(true);
    },
    expand(id: string) {
      if (expanded.has(id)) expanded.delete(id);
      else if (expanded.size < 1024) expanded.add(id);
      void savePreferences((draft) => {
        draft.expanded = [...expanded];
      }).catch(() => {});
      notify();
    },
  };
}
export type GuardState = ReturnType<typeof createGuardState>;

export function locationKey(location: {
  directory: string;
  workspaceID?: string;
}): string {
  return JSON.stringify([location.directory, location.workspaceID ?? null]);
}
export function sameLocation(
  a: { directory: string; workspaceID?: string },
  b: { directory: string; workspaceID?: string },
): boolean {
  if (a.workspaceID && b.workspaceID) return a.workspaceID === b.workspaceID;
  return a.directory === b.directory;
}
