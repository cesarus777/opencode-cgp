import type { AnalyticsRead, AnalyticsResult } from "../modelseries.ts";
import { isAnalyticsResult } from "../rpc.ts";
import { AnalyticsUnavailable, type DashboardPort } from "./port.ts";
import type { HistoryWindow } from "./view.ts";

export interface DashboardModels {
  status:
    | "idle"
    | "loading"
    | "ready"
    | "disabled"
    | "unsupported"
    | "unavailable";
  stale: boolean;
  sort: NonNullable<AnalyticsRead["sort"]>;
  windowMs: HistoryWindow;
  modelPage: number;
  requestPage: number;
  result?: AnalyticsResult;
}

/** Location-scoped request state; it never opens a monitor/event subscription. */
export class ModelsController {
  private port: DashboardPort | undefined;
  private active = false;
  private key = "";
  private agent = "";
  private seedModel = "";
  private selection: string | undefined;
  private resolution = 120;
  private from = 0;
  private to = 1;
  private generation = 0;
  private abort: AbortController | undefined;
  private pending: Promise<void> | undefined;
  private modelPages: (string | undefined)[] = [undefined];
  private requestPages: (string | undefined)[] = [undefined];
  private state: DashboardModels = {
    status: "idle",
    stale: false,
    sort: "requests",
    windowMs: 300000,
    modelPage: 0,
    requestPage: 0,
  };
  constructor(private readonly changed: () => void) {}
  getView(): DashboardModels {
    return this.state;
  }
  configure(
    port: DashboardPort,
    active: boolean,
    windowMs: HistoryWindow,
    agent: string,
    seedModel: string,
    now: number,
  ) {
    const key = JSON.stringify([
      port.location.directory,
      windowMs,
      agent,
      seedModel,
    ]);
    const different = key !== this.key;
    const preserveSelection =
      this.port?.location.directory === port.location.directory &&
      this.agent === agent &&
      this.seedModel === seedModel;
    const entering = active && !this.active;
    if (different || !active) this.cancel();
    this.port = port;
    this.active = active;
    if (different) {
      this.key = key;
      this.agent = agent;
      this.seedModel = seedModel;
      if (!preserveSelection) this.selection = seedModel || undefined;
      this.modelPages = [undefined];
      this.requestPages = [undefined];
      this.state = {
        status: "idle",
        stale: false,
        sort: this.state.sort,
        windowMs,
        modelPage: 0,
        requestPage: 0,
      };
    }
    if (active && (different || entering)) void this.refresh(now);
  }
  cancel() {
    this.generation++;
    this.abort?.abort();
    this.abort = undefined;
    this.pending = undefined;
  }
  stop() {
    this.cancel();
    this.active = false;
    this.state = { ...this.state, stale: Boolean(this.state.result) };
  }
  async refresh(now: number) {
    if (!this.active || !this.port) return;
    if (this.pending) return this.pending;
    this.to = Math.max(1, Math.floor(now));
    this.from = Math.max(0, this.to - this.state.windowMs);
    this.modelPages = [undefined];
    this.requestPages = [undefined];
    this.state = { ...this.state, modelPage: 0, requestPage: 0 };
    return this.query(false);
  }
  setWidth(width: number) {
    const next = Math.max(1, Math.min(120, Math.floor(width) - 10));
    if (next === this.resolution) return;
    this.resolution = next;
    if (this.active && this.state.result) void this.query(true);
  }
  select(model: string) {
    if (!this.active || model === this.selection) return;
    this.selection = model;
    this.requestPages = [undefined];
    this.state = { ...this.state, requestPage: 0 };
    void this.query(true);
  }
  sort() {
    const sorts = ["requests", "tps", "ttft", "identity"] as const;
    this.modelPages = [undefined];
    this.state = {
      ...this.state,
      sort:
        sorts[(sorts.indexOf(this.state.sort) + 1) % sorts.length] ??
        "requests",
      modelPage: 0,
    };
    void this.query(true);
  }
  page(kind: "models" | "requests", direction: -1 | 1) {
    if (this.state.status !== "ready") return;
    const pages = kind === "models" ? this.modelPages : this.requestPages;
    const index =
      kind === "models" ? this.state.modelPage : this.state.requestPage;
    const next =
      kind === "models"
        ? this.state.result?.nextModelsCursor
        : this.state.result?.nextRequestsCursor;
    if ((direction < 0 && index === 0) || (direction > 0 && !next)) return;
    if (direction > 0) pages[index + 1] = next;
    this.state = {
      ...this.state,
      ...(kind === "models"
        ? { modelPage: index + direction, requestPage: 0 }
        : { requestPage: index + direction }),
    };
    if (kind === "models") {
      this.selection = undefined;
      this.requestPages = [undefined];
    }
    void this.query(true);
  }
  private query(reuse: boolean): Promise<void> {
    this.cancel();
    const port = this.port;
    if (!this.active || !port) return Promise.resolve();
    if (!port.analytics) {
      this.state = { ...this.state, status: "unsupported", stale: false };
      this.changed();
      return Promise.resolve();
    }
    const read = port.analytics.bind(port);
    const controller = new AbortController();
    this.abort = controller;
    const generation = this.generation;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(15000),
    ]);
    const modelCursor = this.modelPages[this.state.modelPage];
    const requestCursor = this.requestPages[this.state.requestPage];
    const input: AnalyticsRead = {
      schemaVersion: 1,
      from: this.from,
      to: this.to,
      buckets: this.resolution,
      sort: this.state.sort,
      ...(this.agent ? { agent: this.agent } : {}),
      ...(this.selection === ""
        ? { unknownModel: true }
        : this.selection
          ? { model: this.selection }
          : {}),
      ...(reuse && this.state.result
        ? { snapshotId: this.state.result.snapshotId }
        : {}),
      ...(reuse && modelCursor ? { modelCursor } : {}),
      ...(reuse && requestCursor ? { requestCursor } : {}),
    };
    this.state = {
      ...this.state,
      status: "loading",
      stale: Boolean(this.state.result),
    };
    this.changed();
    const task = Promise.resolve().then(async () => {
      try {
        let result: AnalyticsResult;
        try {
          result = await read(input, signal);
        } catch (error) {
          if (
            !input.snapshotId ||
            signal.aborted ||
            (error instanceof AnalyticsUnavailable &&
              error.reason === "unsupported")
          )
            throw error;
          // A short-lived snapshot may expire while the user inspects a chart.
          const {
            snapshotId: _id,
            modelCursor: _m,
            requestCursor: _r,
            ...fresh
          } = input;
          result = await read(fresh, signal);
          if (generation !== this.generation) return;
          signal.throwIfAborted();
          this.modelPages = [undefined];
          this.requestPages = [undefined];
          this.state = { ...this.state, modelPage: 0, requestPage: 0 };
        }
        if (generation !== this.generation) return;
        signal.throwIfAborted();
        if (
          !isAnalyticsResult(result) ||
          result.from !== input.from ||
          result.to !== input.to ||
          result.agent !== input.agent ||
          result.requests.some((r) => r.location !== port.location.directory)
        )
          throw new Error("Invalid analytics response");
        if (result.selected) this.selection = result.selected.model ?? "";
        this.state = {
          ...this.state,
          result: structuredClone(result),
          status: result.enabled ? "ready" : "disabled",
          stale: false,
        };
      } catch (error) {
        if (generation !== this.generation || controller.signal.aborted) return;
        this.state = {
          ...this.state,
          status:
            error instanceof AnalyticsUnavailable &&
            error.reason === "unsupported" &&
            !this.state.result
              ? "unsupported"
              : "unavailable",
          stale: Boolean(this.state.result),
        };
      } finally {
        if (generation === this.generation) {
          this.pending = undefined;
          this.changed();
        }
      }
    });
    this.pending = task;
    return task;
  }
}
