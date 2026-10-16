import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/tui";
import { createGuardState, sameLocation } from "../src/tui/state.ts";
import { session } from "./fixtures/session.ts";

async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await Bun.sleep(2);
  }
  throw new Error("State did not settle");
}
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
  expect(reads).toBe(1);
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
