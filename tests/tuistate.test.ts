import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import { createGuardState, sameLocation } from "../src/tui/state.ts";
import { session } from "./fixtures/session.ts";
import { retainedHistory } from "./fixtures/history.ts";
import { SnapshotStore } from "../src/snapshot.ts";
import { parseConfig } from "../src/config.ts";
import { HistoryFailure } from "../src/historyclient.ts";

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await Bun.sleep(2);
  }
  throw new Error("State did not settle");
}

test("native history uses the owning location and sanitizes missing RPC and incompatible responses", async () => {
  const info = session("r");
  const baseline = new SnapshotStore(
    parseConfig({ enabled: false }),
    () => new Map(),
  ).read({ schemaVersion: 1, sessionIds: [] });
  let response: unknown = retainedHistory("r");
  let failure: unknown;
  let location: unknown;
  const state = createGuardState({
    client: {
      session: { get: async () => info, list: async () => ({ data: [] }) },
      rpc: (definition: { id: string }) => ({
        read: async (_input: unknown, options: { location: unknown }) => {
          if (definition.id.includes("history")) {
            location = options.location;
            if (failure) throw failure;
            return response;
          }
          return baseline;
        },
        events: {
          subscribe: async function* (
            _name: string,
            { signal }: { signal: AbortSignal },
          ) {
            await new Promise<void>((resolve) => {
              signal.addEventListener("abort", () => resolve(), { once: true });
              if (signal.aborted) resolve();
            });
          },
        },
      }),
    },
    data: {
      session: { get: () => info, status: () => "idle" },
      listen: () => () => {},
    },
    storage: { store: () => [{ expanded: [] }, async () => {}] },
  } as unknown as Plugin.Context);
  const consumer = state.acquire("r");
  try {
    await until(() => state.complete());
    expect(state.historyLocation("r")).toContain("/test");
    expect(
      await state.history("r", 0, 1000000, new AbortController().signal),
    ).toEqual(retainedHistory("r"));
    expect(location).toEqual(info.location);
    failure = { type: "rpc.method_not_found", message: "private-canary" };
    try {
      await state.history("r", 0, 1000000, new AbortController().signal);
      throw new Error("Expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryFailure);
      if (error instanceof HistoryFailure)
        expect(error.reason).toBe("unsupported");
      expect(String(error)).not.toContain("private-canary");
    }
    failure = undefined;
    response = retainedHistory("foreign");
    await expect(
      state.history("r", 0, 1000000, new AbortController().signal),
    ).rejects.toThrow("History incompatible");
    await expect(
      state.history("unknown", 0, 1000000, new AbortController().signal),
    ).rejects.toThrow("History unavailable");
  } finally {
    consumer.release();
    state.dispose();
  }
});
test("sidebar and panel share one visible transport and repeated disposal aborts work", async () => {
  let reads = 0,
    active = 0,
    listeners = 0;
  const info = session("r");
  const context = {
    client: {
      session: {
        get: async () => info,
        list: async () => ({ data: [], cursor: { next: null } }),
      },
      rpc: () => ({
        read: async () => {
          reads++;
          return {
            schemaVersion: 1,
            epoch: "e",
            sequence: 0,
            generatedAt: 100,
            health: {
              enabled: true,
              mode: "observe",
              enforcement: "observing",
              reasons: [],
              staleMs: 1000,
              maxSessions: 1024,
            },
            upserts: [],
            removed: [],
            unavailable: [{ sessionId: "r", reason: "not-monitored" }],
          };
        },
        events: {
          subscribe: async function* (
            _name: string,
            { signal }: { signal: AbortSignal },
          ) {
            active++;
            try {
              await new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else
                  signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  });
              });
            } finally {
              active--;
            }
          },
        },
      }),
    },
    data: {
      session: { get: () => info, status: () => "idle" },
      listen: () => {
        listeners++;
        return () => {
          listeners--;
        };
      },
    },
    storage: { store: () => [{ expanded: [] }, async () => {}] },
  } as unknown as Plugin.Context;
  const state = createGuardState(context);
  expect(reads).toBe(0);
  expect(listeners).toBe(0);
  const sidebar = state.acquire("r"),
    panel = state.acquire("r");
  await until(() => state.connection() === "live");
  expect(active).toBe(1);
  expect(reads).toBe(2);
  sidebar.release();
  expect(active).toBe(1);
  panel.release();
  await until(() => active === 0);
  expect(listeners).toBe(0);
  for (let i = 0; i < 1000; i++) {
    const consumer = state.acquire("r");
    consumer.release();
  }
  await Bun.sleep(5);
  expect(active).toBe(0);
  expect(listeners).toBe(0);
  expect(state.rows().length).toBe(0);
  state.dispose();
});

test("workspace identity handles canonical directory aliases and rejects another workspace", () => {
  expect(
    sameLocation(
      { directory: "/alias", workspaceID: "w" },
      { directory: "/canonical", workspaceID: "w" },
    ),
  ).toBe(true);
  expect(
    sameLocation(
      { directory: "/same", workspaceID: "one" },
      { directory: "/same", workspaceID: "two" },
    ),
  ).toBe(false);
  expect(sameLocation({ directory: "/one" }, { directory: "/two" })).toBe(
    false,
  );
});

for (const available of [false, true])
  test(`state selects ${available ? "v2 performance" : "v1 fallback"} with one subscription`, async () => {
    const info = session("r"),
      definitions: string[] = [],
      subscribed: string[] = [];
    const context = {
      client: {
        session: {
          get: async () => info,
          list: async () => ({ data: [], cursor: { next: null } }),
        },
        rpc: (definition: { id: string }) => ({
          read: async () => {
            definitions.push(definition.id);
            if (!available && definition.id.endsWith("v2"))
              throw new Error("Unknown RPC");
            return {
              schemaVersion: 1,
              epoch: "e",
              sequence: 0,
              generatedAt: 100,
              health: {
                enabled: true,
                mode: "observe",
                enforcement: "observing",
                reasons: [],
                staleMs: 1000,
                maxSessions: 1024,
              },
              upserts: [],
              removed: [],
              unavailable: [{ sessionId: "r", reason: "not-monitored" }],
            };
          },
          events: {
            subscribe: async function* (
              _name: string,
              { signal }: { signal: AbortSignal },
            ) {
              subscribed.push(definition.id);
              await new Promise<void>((resolve) => {
                if (signal.aborted) resolve();
                else
                  signal.addEventListener("abort", () => resolve(), {
                    once: true,
                  });
              });
            },
          },
        }),
      },
      data: {
        session: { get: () => info, status: () => "idle" },
        listen: () => () => {},
      },
      storage: { store: () => [{ expanded: [] }, async () => {}] },
    } as unknown as Plugin.Context;
    const state = createGuardState(context),
      consumer = state.acquire("r");
    try {
      await until(() => state.connection() === "live");
      expect(definitions[0]).toBe("context-guard.monitor.v2");
      expect(definitions.at(-1)).toBe(
        `context-guard.monitor.v${available ? 2 : 1}`,
      );
      expect(subscribed).toEqual([
        `context-guard.monitor.v${available ? 2 : 1}`,
      ]);
    } finally {
      consumer.release();
      state.dispose();
    }
  });

function deferred<T>() {
  let finish: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    finish = done;
  });
  return {
    promise,
    resolve(value: T) {
      if (!finish) throw new Error("Deferred promise was not initialized");
      finish(value);
    },
  };
}

test("inventory progress settles reactively, suppresses duplicate continuation, and rejects obsolete route results", async () => {
  const root = session("r");
  const gate = deferred<void>();
  let held = true,
    fail = false,
    listCalls = 0;
  const context = {
    client: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => {
          if (sessionID === "fatal")
            throw new Error("private initial discovery failure");
          return session(sessionID);
        },
        list: async ({ parentID }: { parentID: string }) => {
          listCalls++;
          if (held) await gate.promise;
          if (fail) throw new Error("private failure must not reach status");
          return {
            data:
              parentID === "r"
                ? Array.from({ length: 1100 }, (_, i) => session(`c${i}`, "r"))
                : [],
            cursor: { next: null },
          };
        },
      },
      rpc: () => ({
        read: async () => {
          throw new Error("unavailable");
        },
      }),
    },
    data: {
      session: {
        get: (id: string) => (id === "r" ? root : undefined),
        status: () => "idle",
      },
      listen: () => () => {},
    },
    storage: { store: () => [{ expanded: [] }, async () => {}] },
  } as unknown as Plugin.Context;
  const state = createGuardState(context);
  const consumer = state.acquire("r");
  try {
    expect(state.inventoryStatus().scanning).toBe(true);
    state.loadMore();
    expect(state.inventoryStatus().limit).toBe(1024);
    held = false;
    gate.resolve();
    await until(() => !state.inventoryStatus().scanning);
    expect(state.inventoryStatus().discovered).toBe(1024);
    expect(state.inventoryStatus().canLoadMore).toBe(true);
    state.loadMore();
    state.loadMore();
    expect(state.inventoryStatus().scanning).toBe(true);
    await until(() => !state.inventoryStatus().scanning);
    expect(state.inventoryStatus().limit).toBe(2048);
    expect(state.inventoryStatus().discovered).toBe(1101);
    expect(state.inventoryStatus().pending).toBeGreaterThan(0);
    expect(listCalls).toBe(101);
    fail = true;
    state.refresh();
    await until(() => !state.inventoryStatus().scanning);
    expect(state.inventoryStatus().damaged).toBe(true);
    expect(state.complete()).toBe(false);
    expect(JSON.stringify(state.inventoryStatus())).not.toContain("private");
    fail = false;
    consumer.update("new-route");
    await until(() => !state.inventoryStatus().scanning);
    expect(state.inventoryStatus().discovered).toBe(1);
    expect(state.inventoryStatus().limit).toBe(1024);
    expect(state.complete()).toBe(true);
    consumer.update("fatal");
    await until(() => !state.inventoryStatus().scanning);
    expect(state.inventoryStatus().failed).toBe(true);
    expect(state.complete()).toBe(false);
    consumer.update("recovered");
    await until(() => state.complete());
    expect(state.inventoryStatus().failed).toBe(false);
  } finally {
    consumer.release();
    state.dispose();
  }

  const old = deferred<ReturnType<typeof session>>();
  const staleState = createGuardState({
    ...context,
    client: {
      ...context.client,
      session: {
        ...context.client.session,
        get: ({ sessionID }: { sessionID: string }) =>
          sessionID === "old"
            ? old.promise
            : Promise.resolve(session(sessionID)),
      },
    },
  } as unknown as Plugin.Context);
  const staleConsumer = staleState.acquire("old");
  try {
    staleConsumer.update("new");
    await until(() => staleState.complete());
    old.resolve(session("old"));
    await Bun.sleep(5);
    expect(staleState.rows().map((row) => row.node.sessionId)).toEqual(["new"]);
    expect(staleState.inventoryStatus().scanning).toBe(false);
  } finally {
    staleConsumer.release();
    staleState.dispose();
  }
});
