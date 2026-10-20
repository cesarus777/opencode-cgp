import { createEffect, createSignal, onCleanup, For } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardState } from "./state.ts";
import { historyChartLines } from "./chartformat.ts";
import type { HistoryChartResult } from "../historycharts.ts";
import { wrap } from "./format.ts";
export function HistoryCharts(props: {
  sessionId: string;
  windowMs: number;
  refresh: number;
  width: number;
  state: GuardState;
  context: Plugin.Context;
}) {
  const [result, setResult] = createSignal<HistoryChartResult>();
  const [status, setStatus] = createSignal("Loading retained history...");
  const [range, setRange] = createSignal({ from: 0, to: 0 });
  createEffect(() => {
    const id = props.sessionId,
      windowMs = props.windowMs;
    props.refresh;
    let pending = false,
      disposed = false;
    let controller: AbortController | undefined;
    setResult(undefined);
    async function read() {
      if (pending || disposed) return;
      pending = true;
      controller = new AbortController();
      const to = Date.now(),
        from = Math.max(0, to - windowMs);
      try {
        const next = await props.state.history(
          id,
          from,
          to,
          AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
        );
        if (!disposed) {
          setResult(next);
          setRange({ from, to });
          setStatus("");
        }
      } catch {
        if (!disposed)
          setStatus(
            "History unavailable. The owning server must support chart history RPC. Press r to retry.",
          );
      } finally {
        pending = false;
      }
    }
    void read();
    const timer = setInterval(() => {
      void read();
    }, 5000);
    onCleanup(() => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
    });
  });
  const lines = () => {
    const current = result();
    return current
      ? historyChartLines(
          current,
          Math.max(4, props.width),
          range().from,
          range().to,
        )
      : [];
  };
  return (
    <box flexDirection="column">
      <For each={wrap(`Performance charts · ${props.sessionId}`, props.width)}>
        {(line) => <text fg={props.context.theme.text.base}>{line}</text>}
      </For>
      <For each={wrap(status(), props.width)}>
        {(line) => <text fg={props.context.theme.text.muted}>{line}</text>}
      </For>
      <For each={lines()}>
        {(line) => (
          <text fg={props.context.theme.text.base}>{line || " "}</text>
        )}
      </For>
    </box>
  );
}
