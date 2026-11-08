import { expect, test } from "bun:test";
import { mkdtemp, writeFile, appendFile, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PerformanceArchive } from "../src/archive.ts";
import {
  readPerformanceHistory,
  scanHistorySegment,
  type HistoryRecord,
} from "../src/history.ts";
import { open } from "node:fs/promises";
const record = (id: string, sessionId = "s", time = 5): HistoryRecord => ({
  schema: 1,
  recordId: id,
  time,
  type: "sample",
  sessionId,
});
const line = (id: string, sessionId = "s", time = 5) =>
  JSON.stringify(record(id, sessionId, time));
async function fixture(run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), "guard-archive-test-"));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
test("archive reuses unchanged segments, preserves query order/global gaps and authorizes immutable projections", () =>
  fixture(async (path) => {
    await writeFile(
      join(path, "1-aa.jsonl"),
      [
        line("a"),
        line("b", "other"),
        JSON.stringify({ ...record("gap", "__history__"), type: "gap" }),
        line("c", "s", 7),
      ].join("\n"),
    );
    const archive = new PerformanceArchive(path);
    const first = await archive.read();
    const counts = { ...archive.stats };
    const filtered = await archive.read({ sessionId: "s", from: 5, to: 5 });
    expect(filtered.records.map((r) => r.recordId)).toEqual(["a", "gap"]);
    expect(archive.stats.readBytes).toBe(counts.readBytes);
    expect(archive.stats.parsedRecords).toBe(counts.parsedRecords);
    expect(filtered.revision).toBe(first.revision);
    expect(Object.isFrozen(first.records)).toBe(true);
    expect(Object.isFrozen(first.records[0])).toBe(true);
    archive.dispose();
  }));
test("append replaces valid and malformed tails once and reads only the suffix plus previous tail", () =>
  fixture(async (path) => {
    const name = "1-aa.jsonl",
      file = join(path, name);
    await writeFile(file, line("a") + "\n" + line("tail"));
    const archive = new PerformanceArchive(path);
    await archive.read();
    let bytes = archive.stats.readBytes;
    await appendFile(file, '\n{"schema":');
    archive.invalidate(name);
    let result = await archive.read();
    expect(result.records.map((r) => r.recordId)).toEqual(["a", "tail"]);
    expect(result.metadata.malformedRecords).toBe(1);
    expect(archive.stats.readBytes - bytes).toBe(
      Buffer.byteLength(line("tail") + '\n{"schema":'),
    );
    bytes = archive.stats.readBytes;
    const suffix = line("new").slice('{"schema":'.length);
    await appendFile(file, suffix);
    archive.invalidate(name);
    result = await archive.read();
    expect(result.records.map((r) => r.recordId)).toEqual(["a", "tail", "new"]);
    expect(result.metadata.malformedRecords).toBe(0);
    expect(archive.stats.readBytes - bytes).toBe(
      Buffer.byteLength(line("new")),
    );
    expect(result).toMatchObject(await readPerformanceHistory(path));
    archive.dispose();
  }));
test("replacement, shrink, rewrite, rotation, pruning and bounded eviction match the raw reader", () =>
  fixture(async (path) => {
    const name = "1-aa.jsonl",
      file = join(path, name);
    const archive = new PerformanceArchive(path, {
      maxCacheRecords: 1,
      maxCacheSegments: 1,
    });
    for (const text of [
      line("a"),
      line("b") + "\n" + line("c"),
      "bad",
      line("d"),
    ]) {
      await writeFile(file, text);
      expect(await archive.read()).toMatchObject(
        await readPerformanceHistory(path),
      );
      expect(archive.stats.cacheRecords).toBeLessThanOrEqual(1);
    }
    await writeFile(join(path, "temp"), line("x"));
    await rename(join(path, "temp"), file);
    expect((await archive.read()).records[0]?.recordId).toBe("x");
    await writeFile(join(path, "2-aa.jsonl"), line("y"));
    expect(
      await archive.read({ maxBytes: Buffer.byteLength(line("y")) }),
    ).toMatchObject(
      await readPerformanceHistory(path, {
        maxBytes: Buffer.byteLength(line("y")),
      }),
    );
    await rm(file);
    expect(await archive.read()).toMatchObject(
      await readPerformanceHistory(path),
    );
    archive.invalidate();
    expect(await archive.read()).toMatchObject(
      await readPerformanceHistory(path),
    );
    archive.dispose();
  }));
test("coalesced readers cancel independently; final cancellation/disposal releases the job for retry", () =>
  fixture(async (path) => {
    await writeFile(join(path, "1-aa.jsonl"), line("a") + "\n");
    let release = () => {},
      entered = () => {};
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const archive = new PerformanceArchive(path, {
      now: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
      yield: async () => {
        entered();
        await gate;
      },
    });
    const controller = new AbortController();
    const a = archive.read({ signal: controller.signal });
    const b = archive.read();
    await started;
    controller.abort();
    await expect(a).rejects.toThrow();
    release();
    expect((await b).records).toHaveLength(1);
    expect(archive.stats.parsedRecords).toBe(1);
    const aborted = AbortSignal.abort();
    await expect(archive.read({ signal: aborted })).rejects.toThrow();
    expect((await archive.read()).records).toHaveLength(1);
    archive.dispose();
    await expect(archive.read()).rejects.toThrow("stopped");
  }));
test("streaming handles UTF-8 chunk boundaries, inclusive times and no-signal scheduling without counting abort as malformed", () =>
  fixture(async (path) => {
    const source = line("🙂漢字") + "\n" + line("last", "s", 7) + "\nbad";
    const file = join(path, "1-aa.jsonl");
    await writeFile(file, source);
    let yields = 0;
    const options = {
      chunkBytes: 1,
      now: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
      yield: async () => {
        yields++;
      },
    };
    const result = await readPerformanceHistory(
      path,
      { from: 5, to: 7 },
      options,
    );
    expect(result.records.map((r) => r.recordId)).toEqual(["🙂漢字", "last"]);
    expect(result.metadata.malformedRecords).toBe(1);
    expect(yields).toBeGreaterThan(0);
    const controller = new AbortController();
    const handle = await open(file, "r");
    try {
      await expect(
        scanHistorySegment(
          handle,
          Buffer.byteLength(source),
          { signal: controller.signal },
          { ...options, yield: async () => controller.abort() },
        ),
      ).rejects.toThrow();
    } finally {
      await handle.close();
    }
    await expect(
      readPerformanceHistory("/does-not-exist", {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
  }));

test("unstable revisions retry within a fixed budget and recover after the writer settles", () =>
  fixture(async (path) => {
    const name = "1-aa.jsonl",
      file = join(path, name);
    await writeFile(file, line("a") + "\n");
    let unstable = true;
    const { appendFileSync } = await import("node:fs");
    const archive = new PerformanceArchive(path, {
      onRead: () => {
        if (unstable) appendFileSync(file, line("late") + "\n");
      },
    });
    await expect(archive.read()).rejects.toThrow("changed repeatedly");
    unstable = false;
    expect(await archive.read()).toMatchObject(
      await readPerformanceHistory(path),
    );
    archive.dispose();
  }));

test("History and Models share a location scan while every History cache hit remains authorized", () =>
  fixture(async (path) => {
    const { analyticsRequest } = await import("./fixtures/analytics.ts");
    const { createAnalyticsService } = await import(
      "../src/modelanalyticsserver.ts"
    );
    const { serveHistory } = await import("../src/historyserver.ts");
    const { historyRpc } = await import("../src/rpc.ts");
    await writeFile(
      join(path, "1-aa.jsonl"),
      JSON.stringify(analyticsRequest("a")) + "\n",
    );
    const archive = new PerformanceArchive(path);
    const reader: typeof readPerformanceHistory = (_path, filter) =>
      archive.read(filter);
    let handler:
      | import("@opencode/plugin/promise/rpc").RpcHandlers<
          typeof historyRpc
        >["read"]
      | undefined;
    let allowed = true,
      authorizations = 0;
    const stop = await serveHistory(
      {
        register: async (_definition, handlers) => {
          handler = handlers.read;
          return { dispose: async () => {} };
        },
      },
      path,
      true,
      () => 1000000,
      async () => {
        authorizations++;
        return allowed;
      },
      reader,
    );
    const models = createAnalyticsService(path, "/project", true, {
      read: reader,
      revisioned: true,
    });
    try {
      if (!handler) throw new Error("Missing History registration");
      const request = {
        schemaVersion: 1,
        sessionId: "session-a",
        from: 700000,
        to: 1000000,
        maxPoints: 100,
      };
      const context = {
        signal: new AbortController().signal,
        error: () => {
          throw new Error("unused");
        },
      };
      await Promise.all([
        handler(request, context),
        models.read(
          { schemaVersion: 1, from: 700000, to: 1000000, buckets: 80 },
          context.signal,
        ),
      ]);
      expect(archive.stats.parsedRecords).toBe(1);
      const bytes = archive.stats.readBytes;
      allowed = false;
      await expect(handler(request, context)).rejects.toThrow(
        "outside this location",
      );
      allowed = true;
      await handler(request, context);
      expect(authorizations).toBe(3);
      expect(archive.stats.readBytes).toBe(bytes);
    } finally {
      await stop();
      models.dispose();
      archive.dispose();
    }
  }));

test("last-waiter abort and owner disposal settle callers and release canceled work before retry", () =>
  fixture(async (path) => {
    await writeFile(join(path, "1-aa.jsonl"), line("a") + "\n");
    for (const dispose of [false, true]) {
      let entered = () => {},
        release = () => {};
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const archive = new PerformanceArchive(path, {
        now: (() => {
          let t = 0;
          return () => (t += 5);
        })(),
        yield: async () => {
          entered();
          await gate;
        },
      });
      const controller = new AbortController();
      const pending = archive.read({ signal: controller.signal });
      await started;
      if (dispose) archive.dispose();
      else controller.abort();
      await expect(pending).rejects.toThrow();
      release();
      if (!dispose) expect((await archive.read()).records).toHaveLength(1);
      archive.dispose();
    }
  }));

test("notified concurrent append publishes captured bytes without retry starvation and keeps the suffix for the next revision", () =>
  fixture(async (path) => {
    const name = "1-aa.jsonl",
      file = join(path, name);
    await writeFile(file, line("a") + "\n");
    const { appendFileSync } = await import("node:fs");
    let append = true;
    const archive = new PerformanceArchive(path, {
      onRead: () => {
        if (append) {
          appendFileSync(file, line("b") + "\n");
          archive.invalidate(name);
        }
      },
    });
    const captured = await archive.read();
    expect(captured.records.map((r) => r.recordId)).toEqual(["a"]);
    expect(captured.metadata.retainedBytes).toBe(
      Buffer.byteLength(line("a") + "\n"),
    );
    expect(archive.stats.parsedRecords).toBe(1);
    append = false;
    const before = archive.stats.readBytes;
    const next = await archive.read();
    expect(next.records.map((r) => r.recordId)).toEqual(["a", "b"]);
    expect(next.revision).not.toBe(captured.revision);
    expect(archive.stats.readBytes - before).toBe(
      Buffer.byteLength(line("b") + "\n"),
    );
    expect(captured.records.map((r) => r.recordId)).toEqual(["a"]);
    archive.dispose();
  }));

test("a forced rebuild during a scan cannot reuse an entry committed by that older scan", () =>
  fixture(async (path) => {
    await writeFile(join(path, "1-aa.jsonl"), line("a") + "\n");
    let rebuild = true;
    const archive = new PerformanceArchive(path, {
      onRead: () => {
        if (rebuild) {
          rebuild = false;
          archive.invalidate();
        }
      },
    });
    expect((await archive.read()).records.map((r) => r.recordId)).toEqual([
      "a",
    ]);
    expect(archive.stats.parsedRecords).toBe(2);
    archive.dispose();
  }));
