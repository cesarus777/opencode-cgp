import { expect, test } from "bun:test";
import { HistoryState, type HistoryView } from "../src/tui/historystate.ts";
import type { HistoryChartResult } from "../src/historycharts.ts";
import { retainedHistory } from "./fixtures/history.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function fixture() {
  let now = 1000000;
  let view: HistoryView = { status: "idle", stale: false };
  const calls: {
    id: string;
    signal: AbortSignal;
    task: ReturnType<typeof deferred<HistoryChartResult>>;
  }[] = [];
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  let deadline = new AbortController();
  const state = new HistoryState({
    read: (id, _from, _to, signal) => {
      const task = deferred<HistoryChartResult>();
      calls.push({ id, signal, task });
      return task.promise;
    },
    changed: (next) => {
      view = next;
    },
    now: () => now,
    deadline: () => deadline.signal,
    schedule: (callback, ms) => {
      expect(ms).toBe(5000);
      const timer = setTimeout(() => {}, 2147483647);
      timer.unref();
      timers.set(timer, callback);
      return timer;
    },
    cancel: (timer) => {
      clearTimeout(timer);
      timers.delete(timer);
    },
  });
  const query = { location: "/a", sessionId: "s", windowMs: 300000 };
  return {
    state,
    calls,
    timers,
    query,
    view: () => view,
    advance: () => {
      now += 10000;
    },
    timeout: () => {
      deadline.abort(new DOMException("private-canary", "TimeoutError"));
      deadline = new AbortController();
    },
    tick: () => {
      const next = timers.entries().next().value;
      expect(next).toBeDefined();
      if (next) {
        clearTimeout(next[0]);
        timers.delete(next[0]);
        next[1]();
      }
    },
  };
}

test("native history keeps original range during refresh failure and replaces it only on successful retry", async () => {
  const f = fixture();
  try {
    f.state.setQuery(f.query);
    expect(f.view()).toEqual({ status: "loading", stale: false });
    f.calls[0]?.task.resolve(retainedHistory());
    await flush();
    const original = f.view();
    expect(original).toMatchObject({
      status: "ready",
      from: 700000,
      to: 1000000,
      loadedAt: 1000000,
      stale: false,
    });
    expect(f.timers.size).toBe(1);
    f.advance();
    f.state.refresh();
    expect(f.view()).toMatchObject({
      status: "loading",
      stale: true,
      from: original.from,
      to: original.to,
    });
    f.calls[1]?.task.reject(new Error("private-canary"));
    await flush();
    expect(f.view()).toMatchObject({
      status: "unavailable",
      reason: "unavailable",
      result: original.result,
      loadedAt: original.loadedAt,
      to: original.to,
      stale: true,
    });
    expect(JSON.stringify(f.view())).not.toContain("private-canary");
    f.tick();
    f.calls[2]?.task.resolve(retainedHistory());
    await flush();
    expect(f.view()).toMatchObject({
      status: "ready",
      to: 1010000,
      loadedAt: 1010000,
      stale: false,
    });
    expect(f.view().reason).toBeUndefined();
  } finally {
    f.state.dispose();
  }
  expect(f.timers.size).toBe(0);
});

test("native query changes clear data immediately and discard late success and failure, even A to B to A", async () => {
  for (const fail of [false, true]) {
    const f = fixture();
    try {
      f.state.setQuery(f.query);
      f.state.setQuery({ ...f.query, sessionId: "b" });
      f.state.setQuery(f.query);
      expect(f.calls.length).toBe(1);
      expect(f.calls[0]?.signal.aborted).toBe(true);
      if (fail) f.calls[0]?.task.reject(new Error("private-canary"));
      else f.calls[0]?.task.resolve(retainedHistory());
      await flush();
      expect(f.calls.length).toBe(2);
      expect(f.view()).toEqual({ status: "loading", stale: false });
      f.calls[1]?.task.resolve(retainedHistory());
      await flush();
      for (const changed of [
        { ...f.query, windowMs: 3600000 },
        { ...f.query, location: "/b" },
      ]) {
        f.state.setQuery(changed);
        expect(f.view()).toEqual({ status: "loading", stale: false });
        f.calls.at(-1)?.task.resolve(retainedHistory());
        await flush();
      }
    } finally {
      f.state.dispose();
    }
  }
});

test("native rapid refresh coalesces to one queued read and disposal silences late settlement", async () => {
  const f = fixture();
  f.state.setQuery(f.query);
  for (let i = 0; i < 100; i++) f.state.refresh();
  expect(f.calls.length).toBe(1);
  f.calls[0]?.task.resolve(retainedHistory());
  await flush();
  expect(f.calls.length).toBe(2);
  expect(f.view().status).toBe("loading");
  f.state.dispose();
  const before = f.view();
  expect(f.calls[1]?.signal.aborted).toBe(true);
  f.calls[1]?.task.reject(new Error());
  await flush();
  expect(f.view()).toBe(before);
  expect(f.timers.size).toBe(0);
});

test("native pauses capability and compatibility failures, retries explicitly, and polls valid empty results", async () => {
  for (const type of [
    "rpc.unavailable",
    "rpc.method_not_found",
    "rpc.invalid_output",
    "rpc.invalid_input",
  ]) {
    const f = fixture();
    try {
      f.state.setQuery(f.query);
      f.calls[0]?.task.reject({ type, message: "private-canary" });
      await flush();
      expect(f.view().status).toBe("unavailable");
      expect(f.view().result).toBeUndefined();
      expect(f.timers.size).toBe(0);
      f.state.refresh();
      const empty = retainedHistory();
      empty.data.series = [];
      f.calls[1]?.task.resolve(empty);
      await flush();
      expect(f.view().status).toBe("ready");
      expect(f.timers.size).toBe(1);
      f.state.refresh();
      f.calls[2]?.task.resolve({ ...empty, enabled: false });
      await flush();
      expect(f.view()).toMatchObject({
        status: "disabled",
        stale: false,
        result: { enabled: false },
      });
      expect(f.timers.size).toBe(0);
      f.state.refresh();
      f.calls[3]?.task.resolve(retainedHistory("foreign"));
      await flush();
      expect(f.view().reason).toBe("incompatible");
      expect(f.view().result?.enabled).toBe(false);
    } finally {
      f.state.dispose();
    }
  }
});

test("native timeout is visible and retryable while navigation cancellation is silent", async () => {
  const f = fixture();
  try {
    f.state.setQuery(f.query);
    f.timeout();
    f.calls[0]?.task.reject(new Error("private-canary"));
    await flush();
    expect(f.view()).toMatchObject({
      status: "unavailable",
      reason: "timeout",
      stale: false,
    });
    expect(f.timers.size).toBe(1);
    f.tick();
    f.state.setQuery({ ...f.query, sessionId: "new" });
    f.calls[1]?.task.reject(new Error("abort"));
    await flush();
    expect(f.view()).toEqual({ status: "loading", stale: false });
  } finally {
    f.state.dispose();
  }
});
