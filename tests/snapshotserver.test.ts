import { expect, test } from "bun:test";
import { serveSnapshots, type SnapshotRpcPort } from "../src/snapshotserver.ts";
import type { RpcHandlers } from "@opencode/plugin/promise/rpc";
import { monitorRpc, isBatch } from "../src/rpc.ts";
import { SnapshotStore } from "../src/snapshot.ts";
import { parseConfig } from "../src/config.ts";

test("failed RPC publication retries the latest queued state and disposal cancels retries", async () => {
  const store = new SnapshotStore(
    parseConfig({ telemetry: { enabled: false } }),
    () => new Map(),
  );
  let attempts = 0,
    disposed = false;
  const emitted: unknown[] = [];
  const rpc: SnapshotRpcPort = {
    register: async () => ({
      events: {
        emit: async (_name, value) => {
          attempts++;
          if (attempts === 1) throw new Error("offline");
          emitted.push(value);
        },
      },
      dispose: async () => {
        disposed = true;
      },
    }),
  };
  const stop = await serveSnapshots(rpc, store);
  store.flush();
  store.degrade("event-stream-gap");
  store.flush();
  for (let i = 0; i < 100 && emitted.length < 2; i++) await Bun.sleep(5);
  expect(emitted.length).toBe(2);
  expect(emitted.every(isBatch)).toBe(true);
  const last = emitted.at(-1);
  expect(isBatch(last) && last.health.enforcement).toBe("suspended");
  await stop();
  expect(disposed).toBe(true);
  const before = attempts;
  store.degrade("capacity-exceeded");
  store.flush();
  await Bun.sleep(110);
  expect(attempts).toBe(before);
});

test("disabled service exposes health without creating any monitor state", async () => {
  let handlers: RpcHandlers<typeof monitorRpc> | undefined;
  const store = new SnapshotStore(
    parseConfig({ enabled: false }),
    () => new Map(),
  );
  const stop = await serveSnapshots(
    {
      register: async (_definition, value) => {
        handlers = value;
        return { events: { emit: async () => {} }, dispose: async () => {} };
      },
    },
    store,
  );
  if (!handlers) throw new Error("Missing registration");
  const context = {
    signal: new AbortController().signal,
    error: () => {
      throw new Error("unused");
    },
  };
  const result = await handlers.read(
    { schemaVersion: 1, sessionIds: ["absent"] },
    context,
  );
  expect(result).toMatchObject({
    health: { enforcement: "disabled" },
    unavailable: [{ sessionId: "absent", reason: "not-monitored" }],
  });
  await expect(
    handlers.read({ schemaVersion: 2, sessionIds: [] }, context),
  ).rejects.toThrow("Invalid snapshot request");
  await stop();
});
