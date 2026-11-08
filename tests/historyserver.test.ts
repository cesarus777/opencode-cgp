import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RpcHandlers } from "@opencode/plugin/promise/rpc";
import { historyRpc, isHistoryResult } from "../src/rpc.ts";
import { serveHistory, type HistoryRpcPort } from "../src/historyserver.ts";
import { PerformanceHistory } from "../src/history.ts";
const context = {
  signal: new AbortController().signal,
  error: () => {
    throw new Error("unused");
  },
};
async function fixture(
  enabled: boolean,
  action: (
    read: RpcHandlers<typeof historyRpc>["read"],
    path: string,
  ) => Promise<void>,
) {
  const path = await mkdtemp(join(tmpdir(), "guard-history-rpc-"));
  let handlers: RpcHandlers<typeof historyRpc> | undefined;
  const port: HistoryRpcPort = {
    register: async (_definition, value) => {
      handlers = value;
      return { dispose: async () => {} };
    },
  };
  const stop = await serveHistory(
    port,
    path,
    enabled,
    () => 5000,
    async (id) => id !== "foreign",
  );
  try {
    if (!handlers) throw new Error("No handlers");
    await action(handlers.read, path);
  } finally {
    await stop();
    await rm(path, { recursive: true, force: true });
  }
}
test("history RPC bounds reads, preserves global gaps and authorizes location without accepting file paths", async () =>
  fixture(true, async (read, path) => {
    const sink = new PerformanceHistory(path, {
      enabled: true,
      retentionDays: 7,
      maxBytes: 65536,
    });
    sink.emit({
      schema: 1,
      recordId: "g",
      time: 1000,
      type: "gap",
      sessionId: "__history__",
      event: "dropped",
    });
    sink.emit({
      schema: 1,
      recordId: "r",
      time: 2000,
      type: "sample",
      sessionId: "root",
      performance: {
        sessionCreatedAt: 0,
        observedSince: 0,
        at: 2000,
        status: "streaming",
        partial: false,
        estimatedOutputTokens: 10,
        modelOutputTokens: 0,
        modelDurationMs: 0,
        completedRequests: 0,
        tokenSource: "estimated",
        liveTps: 10,
      },
    });
    await sink.flush();
    const input = {
      schemaVersion: 1,
      sessionId: "root",
      from: 0,
      to: 5000,
      maxPoints: 100,
    };
    const result = await read(input, context);
    expect(isHistoryResult(result)).toBe(true);
    if (!isHistoryResult(result)) throw new Error("Bad response");
    expect(result.data.series[0]?.points).toHaveLength(1);
    expect(result.data.gaps).toHaveLength(1);
    await expect(read({ ...input, path: "/secret" }, context)).rejects.toThrow(
      "Invalid history request",
    );
    await expect(read({ ...input, to: 8 * 86400000 }, context)).rejects.toThrow(
      "Invalid history request",
    );
    await expect(
      read({ ...input, sessionId: "foreign" }, context),
    ).rejects.toThrow("outside this location");
  }));
test("disabled history returns explicit status without reading the filesystem", async () =>
  fixture(false, async (read) => {
    const result = await read(
      {
        schemaVersion: 1,
        sessionId: "root",
        from: 0,
        to: 5000,
        maxPoints: 100,
      },
      context,
    );
    expect(isHistoryResult(result)).toBe(true);
    if (isHistoryResult(result)) expect(result.enabled).toBe(false);
  }));

test("history forwards service shutdown cancellation and rejects later admission", async () => {
  let handlers: RpcHandlers<typeof historyRpc> | undefined;
  let release = () => {};
  let started = () => {};
  let reads = 0,
    authorizations = 0;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const stop = await serveHistory(
    {
      register: async (_definition, value) => {
        handlers = value;
        return { dispose: async () => {} };
      },
    },
    "/unused",
    true,
    () => 5,
    async () => {
      authorizations++;
      return true;
    },
    async (_path, filter) => {
      reads++;
      if (reads === 1) {
        started();
        await new Promise<void>((resolve, reject) => {
          release = resolve;
          filter?.signal?.addEventListener(
            "abort",
            () => reject(new Error("cancelled")),
            { once: true },
          );
        });
      }
      return {
        records: [],
        metadata: {
          schema: 1,
          retainedBytes: 0,
          skippedBytes: 0,
          malformedRecords: 0,
          completeness: "bounded-retention",
        },
      };
    },
  );
  if (!handlers) throw new Error("No handler");
  const input = {
    schemaVersion: 1,
    sessionId: "s",
    from: 0,
    to: 5,
    maxPoints: 100,
  };
  const pending = handlers.read(input, context);
  await entered;
  await stop();
  await expect(pending).rejects.toThrow("cancelled");
  release();
  await expect(handlers.read(input, context)).rejects.toThrow("stopped");
  expect(authorizations).toBe(1);
});
