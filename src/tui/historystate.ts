import type { HistoryChartResult } from "../historycharts.ts";
import {
  checkedHistory,
  historyFailure,
  type HistoryFailureReason,
} from "../historyclient.ts";

interface Query {
  readonly location: string;
  readonly sessionId: string;
  readonly windowMs: number;
}
export interface HistoryView {
  readonly status: "idle" | "loading" | "ready" | "disabled" | "unavailable";
  readonly reason?: HistoryFailureReason;
  readonly result?: HistoryChartResult;
  readonly from?: number;
  readonly to?: number;
  readonly loadedAt?: number;
  readonly stale: boolean;
}
interface Options {
  read(
    id: string,
    from: number,
    to: number,
    signal: AbortSignal,
  ): Promise<HistoryChartResult>;
  changed(view: HistoryView): void;
  now?: () => number;
  schedule?: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  deadline?: () => AbortSignal;
}

/** One mounted chart, one retained query, one in-flight read and one queued retry. */
export class HistoryState {
  private query: Query | undefined;
  private generation = 0;
  private active: AbortController | undefined;
  private pending = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private view: HistoryView = { status: "idle", stale: false };
  private readonly now;
  private readonly schedule: NonNullable<Options["schedule"]>;
  private readonly cancel: NonNullable<Options["cancel"]>;
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
    this.schedule =
      options.schedule ?? ((callback, ms) => setTimeout(callback, ms));
    this.cancel = options.cancel ?? clearTimeout;
  }
  setQuery(query: Query) {
    if (
      this.stopped ||
      (query.location === this.query?.location &&
        query.sessionId === this.query.sessionId &&
        query.windowMs === this.query.windowMs)
    )
      return;
    this.generation++;
    this.active?.abort();
    this.query = { ...query };
    this.view = { status: "loading", stale: false };
    this.refresh();
  }
  refresh() {
    if (this.stopped || !this.query) return;
    this.clearTimer();
    this.pending = true;
    this.publish({
      ...this.view,
      status: "loading",
      reason: undefined,
      stale: this.view.result !== undefined,
    });
    void this.pump();
  }
  dispose() {
    this.stopped = true;
    this.generation++;
    this.pending = false;
    this.clearTimer();
    this.active?.abort();
  }
  private clearTimer() {
    if (this.timer !== undefined) this.cancel(this.timer);
    this.timer = undefined;
  }
  private publish(
    view: Omit<HistoryView, "reason"> & {
      reason?: HistoryFailureReason | undefined;
    },
  ) {
    const { reason, ...rest } = view;
    this.view = { ...rest, ...(reason === undefined ? {} : { reason }) };
    this.options.changed(this.view);
  }
  private async pump() {
    if (this.stopped || this.active || !this.pending || !this.query) return;
    this.pending = false;
    const query = this.query,
      generation = this.generation;
    const controller = new AbortController();
    this.active = controller;
    const signal = AbortSignal.any([
      controller.signal,
      this.options.deadline?.() ?? AbortSignal.timeout(5000),
    ]);
    const to = Math.max(0, Math.floor(this.now())),
      from = Math.max(0, to - query.windowMs);
    const current = () => !this.stopped && generation === this.generation;
    try {
      const result = checkedHistory(
        await this.options.read(query.sessionId, from, to, signal),
        query.sessionId,
      );
      if (!current()) return;
      if (signal.aborted) throw historyFailure(undefined, signal);
      this.publish({
        status: result.enabled ? "ready" : "disabled",
        result,
        from,
        to,
        loadedAt: this.now(),
        stale: false,
      });
    } catch (error) {
      if (current())
        this.publish({
          ...this.view,
          status: "unavailable",
          reason: historyFailure(error, signal).reason,
          stale: this.view.result !== undefined,
        });
    } finally {
      this.active = undefined;
      if (this.pending) {
        this.publish({
          ...this.view,
          status: "loading",
          reason: undefined,
          stale: this.view.result !== undefined,
        });
        void this.pump();
      } else if (
        current() &&
        (this.view.status === "ready" ||
          this.view.reason === "timeout" ||
          this.view.reason === "unavailable")
      ) {
        this.timer = this.schedule(() => {
          this.timer = undefined;
          this.refresh();
        }, 5000);
      }
    }
  }
}
