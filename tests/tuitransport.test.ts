import { mkdtemp, mkdir, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "bun:test";
import {
  SnapshotClient,
  type SnapshotTransport,
} from "../src/tui/transport.ts";
import type { SnapshotBatch, SnapshotReadResult } from "../src/snapshot.ts";
import { monitorRpc } from "../src/rpc.ts";
import { Host } from "@opencode/plugin/host";
import { OpenCode } from "@opencode/client";
function batch(sequence = 1, epoch = "e"): SnapshotReadResult {
  return {
    schemaVersion: 1,
    epoch,
    sequence,
    generatedAt: 100,
    health: {
      enabled: true,
      mode: "observe",
      enforcement: "observing",
      reasons: [],
      staleMs: 1000,
      maxSessions: 100,
    },
    upserts: [
      {
        sessionId: "s",
        revision: sequence,
        observedAt: 100,
        policy: {
          id: "defaults",
          configured: { type: "tokens", value: 100 },
          comparison: ">=",
          reason: "missing-usage",
          crossed: false,
        },
        compaction: { phase: "idle", armed: true },
        cumulativeScope: "unknown",
        lastObservedActive: false,
      },
    ],
    removed: [],
    unavailable: [],
  };
}
class Queue {
  values: SnapshotBatch[] = [];
  wake: (() => void) | undefined;
  push(value: SnapshotBatch) {
    this.values.push(value);
    this.wake?.();
  }
  async *stream(signal: AbortSignal) {
    while (!signal.aborted) {
      const value = this.values.shift();
      if (value) {
        yield value;
        continue;
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          signal.removeEventListener("abort", done);
          this.wake = undefined;
          resolve();
        };
        this.wake = done;
        signal.addEventListener("abort", done, { once: true });
      });
    }
  }
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await Bun.sleep(2);
  }
  throw new Error("timeout");
}
test("public package resolver finds server, RPC and TUI entries without importing renderer", () => {
  const entries = Host.resolve({ directory: process.cwd() });
  expect(entries.server).toEndWith("server.ts");
  expect(entries.tui).toEndWith("tui.tsx");
  expect(entries.rpc).toEndWith("rpc.ts");
  const rpc = OpenCode.make({ baseUrl: "http://127.0.0.1:1" }).rpc(monitorRpc);
  expect(typeof rpc.read).toBe("function");
});
test("bootstrap buffers newer event, ignores duplicates and repairs sequence gaps", async () => {
  const queue = new Queue();
  let reads = 0,
    resolve: ((v: unknown) => void) | undefined;
  const transport: SnapshotTransport = {
    read: async () => {
      reads++;
      return reads === 1
        ? new Promise((r) => {
            resolve = r;
          })
        : batch(5);
    },
    subscribe: (_l, s) => queue.stream(s),
  };
  const client = new SnapshotClient(transport, () => {});
  client.start("/test", ["s"]);
  const { unavailable: _, ...event } = batch(2);
  queue.push(event);
  await Bun.sleep(5);
  resolve?.(batch(1));
  await until(() => client.connection === "live");
  expect(client.rows.get("s")?.revision).toBe(2);
  queue.push(event);
  await Bun.sleep(5);
  expect(client.rows.get("s")?.revision).toBe(2);
  queue.push({
    ...event,
    sequence: 5,
    upserts: [{ ...event.upserts[0]!, revision: 5 }],
  });
  await until(() => reads >= 2);
  expect(client.rows.get("s")?.revision).toBe(5);
  client.stop();
});
test("switching locations aborts previous requests and delayed responses cannot contaminate current view", async () => {
  const queue = new Queue();
  let resolve: ((v: unknown) => void) | undefined;
  const client = new SnapshotClient(
    {
      read: async (location) =>
        location === "A"
          ? new Promise((r) => {
              resolve = r;
            })
          : batch(2, "B"),
      subscribe: (_l, s) => queue.stream(s),
    },
    () => {},
  );
  client.start("A", ["s"]);
  client.start("B", ["s"]);
  await until(() => client.connection === "live");
  resolve?.(batch(10, "A"));
  await Bun.sleep(5);
  expect(client.rows.get("s")?.revision).toBe(2);
  client.stop();
});
test("read chunks are <=128 with <=2 concurrent requests and unknown requested rows disappear", async () => {
  let active = 0,
    peak = 0,
    requested = 0;
  const queue = new Queue();
  const client = new SnapshotClient(
    {
      read: async (_l, ids) => {
        expect(ids.length).toBeLessThanOrEqual(128);
        active++;
        peak = Math.max(peak, active);
        requested += ids.length;
        await Bun.sleep(2);
        active--;
        return {
          ...batch(1),
          upserts: [],
          unavailable: ids.map((sessionId) => ({
            sessionId,
            reason: "not-monitored",
          })),
        };
      },
      subscribe: (_l, s) => queue.stream(s),
    },
    () => {},
  );
  client.start(
    "/test",
    Array.from({ length: 300 }, (_, i) => String(i)),
  );
  await until(() => client.connection === "live");
  expect(requested).toBe(300);
  expect(peak).toBe(2);
  expect(client.rows.size).toBe(0);
  client.stop();
});
test("client age uses server time plus monotonic elapsed and malformed data remains usable", async () => {
  let clock = 50;
  const queue = new Queue();
  const client = new SnapshotClient(
    { read: async () => batch(), subscribe: (_l, s) => queue.stream(s) },
    () => {},
    () => clock,
  );
  client.start("/test", ["s"]);
  await until(() => client.connection === "live");
  clock += 1234;
  expect(client.now()).toBe(1334);
  client.stop();
});

test("new selection during a pending read is reconciled and late unavailable events cannot resurrect rows", async () => {
  const queue = new Queue();
  let resolve: ((value: unknown) => void) | undefined,
    reads = 0;
  const client = new SnapshotClient(
    {
      read: async (_location, ids) => {
        reads++;
        if (reads === 1)
          return new Promise((r) => {
            resolve = r;
          });
        return {
          ...batch(4),
          upserts: [],
          unavailable: ids.map((sessionId) => ({
            sessionId,
            reason: "not-monitored",
          })),
        };
      },
      subscribe: (_l, signal) => queue.stream(signal),
    },
    () => {},
  );
  client.start("A", ["s"]);
  client.setIds(["s", "new"]);
  resolve?.(batch(1));
  await until(() => reads >= 2 && client.connection === "live");
  expect(client.rows.size).toBe(0);
  const { unavailable: _, ...event } = batch(4);
  queue.push(event);
  await Bun.sleep(5);
  expect(client.rows.size).toBe(0);
  client.stop();
});

test("a gap buffered during bootstrap triggers another read rather than claiming continuity", async () => {
  const queue = new Queue();
  let reads = 0,
    resolve: ((value: unknown) => void) | undefined;
  const client = new SnapshotClient(
    {
      read: async () =>
        ++reads === 1
          ? new Promise((r) => {
              resolve = r;
            })
          : batch(5),
      subscribe: (_l, s) => queue.stream(s),
    },
    () => {},
  );
  client.start("A", ["s"]);
  const { unavailable: _, ...event } = batch(5);
  queue.push(event);
  await Bun.sleep(5);
  resolve?.(batch(1));
  await until(() => reads >= 2 && client.connection === "live");
  expect(client.rows.get("s")?.revision).toBe(5);
  client.stop();
});

test("obsolete malformed reads cannot mark a new location incompatible", async () => {
  const queue = new Queue();
  let resolve: ((value: unknown) => void) | undefined;
  const client = new SnapshotClient(
    {
      read: async (location) =>
        location === "A"
          ? new Promise((r) => {
              resolve = r;
            })
          : batch(2, "B"),
      subscribe: (_l, s) => queue.stream(s),
    },
    () => {},
  );
  client.start("A", ["s"]);
  client.start("B", ["s"]);
  await until(() => client.connection === "live");
  resolve?.({ invalid: true });
  await Bun.sleep(5);
  expect(client.connection).toBe("live");
  client.stop();
});

test("server and core entries import when renderer dependencies are unavailable", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "-e",
      `import { plugin } from "bun";
    plugin({ name: "reject-renderer", setup(build) { build.onResolve({ filter: new RegExp("^(?:@opentui|solid-js|@opencode/theme)") }, () => { throw new Error("Renderer import on server"); }); } });
    const server = await import("./server.ts"); const core = await import("./src/core.ts");
    if (server.default.id !== "context-guard" || typeof core.familyRows !== "function") process.exit(1);`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
});

test("installed package export resolution finds all three runtime entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "guard-package-"));
  try {
    await mkdir(join(directory, "node_modules"));
    await symlink(
      process.cwd(),
      join(directory, "node_modules/opencode-context-guard"),
      "dir",
    );
    const entries = Host.resolve({ directory, name: "opencode-context-guard" });
    expect(entries.server).toEndWith("src/index.ts");
    expect(entries.tui).toEndWith("src/tui.tsx");
    expect(entries.rpc).toEndWith("src/rpc.ts");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bootstrap buffer overflow discards the partial stream and a read repairs it", async () => {
  const queue = new Queue();
  let reads = 0,
    resolve: ((value: unknown) => void) | undefined;
  const client = new SnapshotClient(
    {
      read: async () =>
        ++reads === 1
          ? new Promise((r) => {
              resolve = r;
            })
          : batch(300),
      subscribe: (_l, s) => queue.stream(s),
    },
    () => {},
  );
  client.start("A", ["s"]);
  for (let sequence = 1; sequence <= 260; sequence++) {
    const { unavailable: _, ...event } = batch(sequence);
    queue.push(event);
  }
  await Bun.sleep(10);
  resolve?.(batch(1));
  await until(
    () =>
      client.connection === "reconnecting" ||
      client.connection === "unavailable",
  );
  await client.refresh();
  expect(client.connection).toBe("live");
  expect(client.rows.get("s")?.revision).toBe(300);
  client.stop();
});

test("unexpected subscription EOF stays reconnecting while retaining the last known row", async () => {
  const client = new SnapshotClient(
    { read: async () => batch(), subscribe: async function* () {} },
    () => {},
  );
  client.start("A", ["s"]);
  await until(() => client.rows.has("s"));
  await Bun.sleep(5);
  expect(client.connection).toBe("reconnecting");
  expect(client.rows.size).toBe(1);
  client.stop();
});
