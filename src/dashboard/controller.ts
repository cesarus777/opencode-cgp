import { familyRows, executionStatus } from "../family.ts";
import type { ContextSnapshot, MonitorHealth } from "../snapshot.ts";
import type { HistoryChartResult } from "../historycharts.ts";
import { isHistoryResult } from "../rpc.ts";
import { SnapshotClient, type Connection } from "../tui/transport.ts";
import {
  discoverInventory,
  inventoryLimits,
  validateInventoryLimits,
  type InventoryLimits,
  type InventoryNotice,
} from "./inventory.ts";
import type { DashboardPort, InventoryNode } from "./port.ts";
import {
  immutableView,
  projectHistory,
  historyWindows,
  type DashboardView,
  type DashboardRow,
  type DashboardScreen,
  type DashboardFilters,
  type DashboardHistory,
  type HistoryWindow,
} from "./view.ts";

interface LocationState {
  port: DashboardPort;
  nodes: Map<string, InventoryNode>;
  rows: Map<string, ContextSnapshot>;
  client?: SnapshotClient;
  version?: 1 | 2;
  health?: MonitorHealth;
  serverAt?: number;
  receivedAt?: number;
  connection: Connection;
  complete: boolean;
  stale: boolean;
  pages: number;
  notices: readonly InventoryNotice[];
  selected?: string;
  scanning?: Promise<void>;
  probing?: Promise<void>;
}
interface CachedHistory {
  directory: string;
  valid: boolean;
  result: HistoryChartResult;
  from: number;
  to: number;
}
interface HistoryTask {
  key: string;
  state: LocationState;
  sessionId: string;
  windowMs: HistoryWindow;
  generation: number;
  scope: AbortSignal;
}
export interface DashboardControllerOptions {
  readonly limits?: InventoryLimits;
  readonly now?: () => number;
  readonly elapsed?: () => number;
  /** Zero disables automatic inventory/age ticks for deterministic callers. */
  readonly refreshIntervalMs?: number;
}

/** Shared application state; subscribers never acquire additional upstream streams. */
export class DashboardController {
  private readonly locations = new Map<string, LocationState>();
  private readonly cache = new Map<string, CachedHistory>();
  private readonly listeners = new Set<(view: DashboardView) => void>();
  private readonly limits: InventoryLimits;
  private readonly now: () => number;
  private readonly elapsed: () => number;
  private readonly refreshIntervalMs: number;
  private state: LocationState;
  private scope: AbortController | undefined;
  private running = false;
  private screen: DashboardScreen = "overview";
  private filters: DashboardFilters = { search: "", agent: "", model: "" };
  private windowMs: HistoryWindow = 300000;
  private generation = 0;
  private historyGeneration = 0;
  private pendingHistory: HistoryTask | undefined;
  private historyAbort: AbortController | undefined;
  private historyBusy = false;
  private historyStatus: DashboardHistory["status"] = "idle";
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private ageTimer: ReturnType<typeof setInterval> | undefined;
  private view: DashboardView;

  constructor(port: DashboardPort, options: DashboardControllerOptions = {}) {
    this.limits = { ...(options.limits ?? inventoryLimits) };
    validateInventoryLimits(this.limits);
    this.now = options.now ?? Date.now;
    this.elapsed = options.elapsed ?? (() => performance.now());
    this.refreshIntervalMs = options.refreshIntervalMs ?? 30000;
    if (
      !Number.isSafeInteger(this.refreshIntervalMs) ||
      this.refreshIntervalMs < 0
    )
      throw new Error("Invalid dashboard refresh interval");
    this.state = this.createLocation(port);
    this.locations.set(port.location.directory, this.state);
    this.view = this.buildView();
  }
  private createLocation(port: DashboardPort): LocationState {
    return {
      port,
      nodes: new Map(),
      rows: new Map(),
      connection: "loading",
      complete: false,
      stale: true,
      pages: 0,
      notices: [],
    };
  }
  getView(): DashboardView {
    return this.view;
  }
  subscribe(listener: (view: DashboardView) => void): () => void {
    this.listeners.add(listener);
    listener(this.view);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish() {
    this.view = this.buildView();
    for (const listener of this.listeners) {
      try {
        listener(this.view);
      } catch {
        /* One frontend cannot stop other consumers. */
      }
    }
  }
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.scope = new AbortController();
    if (this.refreshIntervalMs) {
      this.refreshTimer = setInterval(() => {
        void this.refresh();
      }, this.refreshIntervalMs);
      this.ageTimer = setInterval(() => {
        this.publish();
      }, 1000);
    }
    await this.refresh();
  }
  stop() {
    this.running = false;
    this.generation++;
    this.scope?.abort();
    this.scope = undefined;
    this.cancelHistory();
    clearInterval(this.refreshTimer);
    clearInterval(this.ageTimer);
    for (const state of this.locations.values()) {
      state.client?.stop();
      delete state.client;
      delete state.scanning;
      delete state.probing;
      state.stale = true;
      state.connection = "unavailable";
    }
    this.publish();
  }
  async selectLocation(directory: string): Promise<void> {
    if (directory === this.state.port.location.directory) return;
    const port = this.state.port.atLocation(directory);
    this.scope?.abort();
    this.state.client?.stop();
    delete this.state.client;
    delete this.state.scanning;
    delete this.state.probing;
    this.state.stale = true;
    this.state.connection = "reconnecting";
    this.cancelHistory();
    this.generation++;
    const next = this.locations.get(directory) ?? this.createLocation(port);
    this.locations.delete(directory);
    this.locations.set(directory, next);
    this.state = next;
    // Bound inventories and retained snapshots as well as historical responses.
    if (this.locations.size > 4) {
      const oldest = this.locations.keys().next().value;
      if (oldest !== undefined) this.locations.delete(oldest);
    }
    this.scope = this.running ? new AbortController() : undefined;
    this.historyStatus = "idle";
    this.publish();
    if (this.running) await this.refresh();
  }
  selectSession(id: string) {
    if (!this.state.nodes.has(id)) throw new Error("Unknown dashboard session");
    if (id === this.state.selected) return;
    this.state.selected = id;
    this.queueHistory();
    this.publish();
  }
  setScreen(screen: DashboardScreen) {
    if (!["overview", "detail", "history"].includes(screen))
      throw new Error("Invalid dashboard screen");
    if (screen === this.screen) return;
    this.screen = screen;
    this.queueHistory();
    this.publish();
  }
  setWindow(windowMs: HistoryWindow) {
    if (!historyWindows.includes(windowMs))
      throw new Error("Invalid dashboard history window");
    if (windowMs === this.windowMs) return;
    this.windowMs = windowMs;
    this.queueHistory();
    this.publish();
  }
  setFilters(filters: Partial<DashboardFilters>) {
    for (const value of Object.values(filters))
      if (typeof value !== "string" || value.length > 512)
        throw new Error("Invalid dashboard filter");
    this.filters = {
      search: filters.search ?? this.filters.search,
      agent: filters.agent ?? this.filters.agent,
      model: filters.model ?? this.filters.model,
    };
    this.publish();
  }
  async refresh(): Promise<void> {
    if (!this.running || !this.scope) return;
    for (const cached of this.cache.values())
      if (cached.directory === this.state.port.location.directory)
        cached.valid = false;
    this.queueHistory();
    const state = this.state,
      generation = this.generation,
      signal = this.scope.signal;
    await Promise.all([
      this.scan(state, generation, signal),
      this.monitor(state, generation, signal),
    ]);
    if (this.current(state, generation, signal)) await state.client?.refresh();
  }
  private current(
    state: LocationState,
    generation: number,
    signal: AbortSignal,
  ) {
    return (
      this.running &&
      this.state === state &&
      generation === this.generation &&
      !signal.aborted
    );
  }
  private scan(
    state: LocationState,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (state.scanning) return state.scanning;
    state.scanning = (async () => {
      try {
        const scanSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(15000),
        ]);
        const result = await discoverInventory(
          state.port,
          scanSignal,
          this.limits,
        );
        let active: ReadonlySet<string> | undefined;
        try {
          active = new Set(
            await state.port.activeSessions(
              result.sessions.map((session) => session.sessionId),
              scanSignal,
            ),
          );
        } catch {
          /* Retain explicit unknown execution state if public inventory is interrupted. */
        }
        if (!this.current(state, generation, signal)) return;
        const nodes = new Map<string, InventoryNode>();
        for (const session of result.sessions)
          nodes.set(session.sessionId, {
            ...session,
            status: active
              ? executionStatus(true, active.has(session.sessionId), {
                  ...(session.outcome ? { outcome: session.outcome } : {}),
                  ...(session.terminalAt === undefined
                    ? {}
                    : { terminalAt: session.terminalAt }),
                })
              : (state.nodes.get(session.sessionId)?.status ?? "unknown"),
            inventoryStale: active === undefined,
          });
        if (!result.complete)
          for (const [id, node] of state.nodes)
            if (!nodes.has(id) && nodes.size < this.limits.maxNodes)
              nodes.set(id, { ...node, inventoryStale: true });
        state.nodes = nodes;
        state.complete = result.complete && active !== undefined;
        state.stale = !state.complete;
        state.pages = result.pages;
        state.notices = active
          ? result.notices
          : [...new Set([...result.notices, "inventory-unavailable" as const])];
        if (!state.selected || !nodes.has(state.selected)) {
          const previous = state.selected;
          const first = nodes.keys().next().value;
          if (first === undefined) delete state.selected;
          else state.selected = first;
          if (previous !== state.selected) this.queueHistory();
        }
        state.client?.setIds([...nodes.keys()]);
      } catch {
        if (!this.current(state, generation, signal)) return;
        state.complete = false;
        state.stale = true;
        state.nodes = new Map(
          [...state.nodes].map(([id, node]) => [
            id,
            { ...node, inventoryStale: true },
          ]),
        );
        state.notices = ["inventory-unavailable"];
      } finally {
        if (this.current(state, generation, signal)) {
          delete state.scanning;
          this.publish();
        }
      }
    })();
    this.publish();
    return state.scanning;
  }
  private monitor(
    state: LocationState,
    generation: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (state.client) return Promise.resolve();
    if (state.probing) return state.probing;
    state.probing = (async () => {
      try {
        const monitor = await state.port.monitor(signal);
        if (!this.current(state, generation, signal)) return;
        state.version = monitor.version;
        const client = new SnapshotClient(
          monitor.transport,
          () => {
            if (!this.current(state, generation, signal)) return;
            state.connection = client.connection;
            if (client.health) {
              state.rows = new Map(client.rows);
              state.health = client.health;
              state.serverAt = client.now();
              state.receivedAt = this.elapsed();
            }
            this.publish();
          },
          this.elapsed,
        );
        state.client = client;
        client.start(state.port.location.directory, [...state.nodes.keys()]);
      } catch {
        if (this.current(state, generation, signal)) {
          state.connection = state.rows.size ? "reconnecting" : "unavailable";
          this.publish();
        }
      } finally {
        if (this.current(state, generation, signal)) delete state.probing;
      }
    })();
    return state.probing;
  }
  private cacheKey() {
    return JSON.stringify([
      this.state.port.location.directory,
      this.state.selected,
      this.windowMs,
    ]);
  }
  private cancelHistory() {
    this.historyGeneration++;
    this.pendingHistory = undefined;
    this.historyAbort?.abort();
  }
  private queueHistory() {
    this.cancelHistory();
    const sessionId = this.state.selected;
    if (
      !this.running ||
      !this.scope ||
      this.screen !== "history" ||
      !sessionId
    ) {
      this.historyStatus = "idle";
      return;
    }
    const key = this.cacheKey(),
      cached = this.cache.get(key);
    if (cached?.valid) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.historyStatus = cached.result.enabled ? "ready" : "disabled";
      return;
    }
    this.historyStatus = "loading";
    this.pendingHistory = {
      key,
      state: this.state,
      sessionId,
      windowMs: this.windowMs,
      generation: this.historyGeneration,
      scope: this.scope.signal,
    };
    void this.pumpHistory();
  }
  private async pumpHistory(): Promise<void> {
    if (this.historyBusy || !this.pendingHistory) return;
    const task = this.pendingHistory;
    this.pendingHistory = undefined;
    this.historyBusy = true;
    const controller = new AbortController();
    this.historyAbort = controller;
    const signal = AbortSignal.any([
      controller.signal,
      task.scope,
      AbortSignal.timeout(5000),
    ]);
    const to = Math.max(0, Math.floor(this.serverNow()));
    const from = Math.max(0, to - task.windowMs);
    try {
      const result = await task.state.port.history(
        {
          schemaVersion: 1,
          sessionId: task.sessionId,
          from,
          to,
          maxPoints: 500,
        },
        signal,
      );
      if (signal.aborted || task.generation !== this.historyGeneration) return;
      if (
        !isHistoryResult(result) ||
        result.data.series.some((series) => series.sessionId !== task.sessionId)
      )
        throw new Error("Invalid history response");
      this.cache.set(task.key, {
        directory: task.state.port.location.directory,
        valid: true,
        result: structuredClone(result),
        from,
        to,
      });
      if (this.cache.size > 16) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.historyStatus = result.enabled ? "ready" : "disabled";
    } catch {
      if (task.generation === this.historyGeneration && !task.scope.aborted)
        this.historyStatus = "unavailable";
    } finally {
      if (
        task.generation === this.historyGeneration &&
        signal.aborted &&
        !task.scope.aborted
      )
        this.historyStatus = "unavailable";
      this.historyBusy = false;
      if (this.historyAbort === controller) this.historyAbort = undefined;
      if (this.running) this.publish();
      void this.pumpHistory();
    }
  }
  private serverNow() {
    if (this.state.client?.health) return this.state.client.now();
    if (
      this.state.serverAt !== undefined &&
      this.state.receivedAt !== undefined
    )
      return (
        this.state.serverAt +
        Math.max(0, this.elapsed() - this.state.receivedAt)
      );
    return this.now();
  }
  private buildView(): DashboardView {
    const state = this.state,
      now = this.serverNow();
    const nodes = [...state.nodes.values()].map((node) => {
      const snapshot = state.rows.get(node.sessionId);
      const agent = snapshot?.agent ?? node.agent;
      const model = snapshot?.model ?? node.model;
      return {
        sessionId: node.sessionId,
        status: node.status,
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
        ...(node.outcome === "interrupted" ? { interrupted: true } : {}),
      };
    });
    const rows = familyRows(
      nodes,
      state.rows,
      state.selected ?? "",
      now,
      state.health?.staleMs ?? 300000,
      new Set(state.nodes.keys()),
      this.limits.maxNodes,
    ).map((row): DashboardRow => {
      const liveStale = !this.running || state.connection !== "live";
      const measurement = row.snapshot?.measurement;
      let snapshot = row.snapshot;
      if (snapshot && state.version === 1) {
        const { performance: _, ...context } = snapshot;
        snapshot = context;
      }
      const stale = liveStale && row.freshness === "fresh";
      const p = snapshot?.performance;
      const { pressureRatio, triggerDeltaTokens, ...retained } = row;
      return {
        ...(stale
          ? { ...retained, freshness: "stale", pressure: "unknown" }
          : row),
        ...(snapshot ? { snapshot } : {}),
        inventoryStale:
          !this.running ||
          state.stale ||
          (state.nodes.get(row.node.sessionId)?.inventoryStale ?? true),
        liveStale,
        ...(measurement && now >= measurement.at
          ? { measurementAgeMs: now - measurement.at }
          : {}),
        performanceAvailable:
          state.version === 2 && snapshot?.performance !== undefined,
        performanceFreshness: !p
          ? "missing"
          : p.at > now
            ? "invalid"
            : liveStale || now - p.at > (state.health?.staleMs ?? 300000)
              ? "stale"
              : "fresh",
      };
    });
    const search = this.filters.search.toLowerCase();
    const visible = rows.filter(
      (row) =>
        (!search ||
          [row.node.sessionId, row.node.agent, row.node.model].some((value) =>
            value?.toLowerCase().includes(search),
          )) &&
        (!this.filters.agent || row.node.agent === this.filters.agent) &&
        (!this.filters.model || row.node.model === this.filters.model),
    );
    const cached = this.cache.get(this.cacheKey());
    const projected = cached
      ? projectHistory(cached.result, this.filters)
      : undefined;
    const selected = rows.find((row) => row.node.sessionId === state.selected);
    return immutableView<DashboardView>({
      schemaVersion: 1,
      generatedAt: now,
      running: this.running,
      location: state.port.location.directory,
      locations: [...this.locations.keys()],
      screen: this.screen,
      filters: this.filters,
      connection: state.connection,
      ...(state.version === undefined ? {} : { monitorVersion: state.version }),
      ...(state.health ? { health: state.health } : {}),
      inventory: {
        refreshing: state.scanning !== undefined,
        complete: state.complete,
        stale: state.stale,
        pages: state.pages,
        total: rows.length,
        visible: visible.length,
        monitored: rows.filter((row) => row.snapshot).length,
        active: rows.filter((row) => row.node.status === "running").length,
        ...this.limits,
        notices: state.notices,
      },
      rows: visible,
      ...(state.selected ? { selectedSessionId: state.selected } : {}),
      ...(selected ? { selected } : {}),
      history: {
        status: this.historyStatus,
        windowMs: this.windowMs,
        maxWindowMs: 604800000,
        maxPoints: 500,
        stale:
          this.historyStatus === "loading" ||
          this.historyStatus === "unavailable" ||
          !this.running,
        ...(state.selected ? { sessionId: state.selected } : {}),
        ...(cached ? { from: cached.from, to: cached.to } : {}),
        ...(projected
          ? { result: projected.result, summary: projected.summary }
          : {}),
        notices: projected?.notices ?? [
          "bounded-retention",
          "maximum-seven-days",
          "maximum-500-points-and-requests",
        ],
      },
      notices: [
        ...(!state.complete ? ["partial-inventory"] : []),
        ...(state.connection !== "live" ? ["live-data-stale"] : []),
        ...(state.version === 1 ? ["performance-unavailable-v1"] : []),
      ],
    });
  }
}
