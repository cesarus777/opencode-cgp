import { expect, test } from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  appendFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PerformanceHistory, readPerformanceHistory } from "../src/history.ts";
import { PerformanceTracker } from "../src/performance.ts";
async function fixture(run: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), "guard-metrics-"));
  try {
    await run(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
test("history rotates within disk cap, expires on restart and reports retention boundaries", async () =>
  fixture(async (path) => {
    let now = 1000;
    const reports: string[] = [];
    const config = { enabled: true, retentionDays: 7, maxBytes: 4096 };
    const h = new PerformanceHistory(
      path,
      config,
      () => now,
      (event) => reports.push(event),
    );
    await h.initialize();
    for (let i = 0; i < 60; i++) {
      now++;
      h.emit({
        schema: 1,
        recordId: `r${i}`,
        time: now,
        type: "sample",
        sessionId: "root",
      });
    }
    await h.flush();
    const files = await readdir(path);
    let total = 0;
    for (const name of files) total += (await stat(join(path, name))).size;
    expect(total).toBeLessThanOrEqual(4096);
    expect(reports).toContain("history-truncated");
    const data = await readPerformanceHistory(path);
    expect(data.records.length).toBeGreaterThan(0);
    expect(data.records.length).toBeLessThan(60);
    now += 8 * 86400000;
    await new PerformanceHistory(path, config, () => now).initialize();
    expect(await readdir(path)).toEqual([]);
  }));
test("history contains scalar projections only, filters timestamps and ignores truncated or unapproved records", async () =>
  fixture(async (path) => {
    const t = new PerformanceTracker(2, 2000, () => 1500);
    t.observe("root", 1000, 0);
    t.start("root", "req", "build", "p/m", 1000);
    t.delta("root", "req", "delta", 1400, "SECRET RESPONSE".length);
    const performance = t.snapshot("root");
    if (!performance) throw new Error("No snapshot");
    const h = new PerformanceHistory(
      path,
      { enabled: true, retentionDays: 7, maxBytes: 65536 },
      () => 1500,
    );
    const extra = { secret: "SECRET PROMPT", ...performance };
    h.emit({
      schema: 1,
      recordId: "r",
      time: 1500,
      type: "request",
      sessionId: "root",
      performance: extra,
    });
    h.emit({
      schema: 1,
      recordId: "c",
      time: 1600,
      type: "sample",
      sessionId: "child",
    });
    await h.flush();
    const name = (await readdir(path))[0];
    if (!name) throw new Error("Missing segment");
    const file = join(path, name),
      source = await readFile(file, "utf8");
    expect(source).not.toContain("SECRET");
    expect(source).not.toContain("delta");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    await appendFile(
      file,
      '{"schema":1,"time":1700,"sessionId":"root","prompt":"SECRET"}\n{"schema":',
    );
    const data = await readPerformanceHistory(path, {
      sessionId: "root",
      from: 1400,
      to: 1550,
    });
    expect(data.records).toHaveLength(1);
    expect(data.metadata.malformedRecords).toBe(2);
    expect(
      (await readPerformanceHistory(path, { maxBytes: 1 })).metadata
        .skippedBytes,
    ).toBeGreaterThan(0);
  }));
test("bounded queues expose dropped samples and failed storage is isolated", async () =>
  fixture(async (path) => {
    const reports: string[] = [];
    const h = new PerformanceHistory(
      path,
      { enabled: true, retentionDays: 7, maxBytes: 1000000 },
      () => 1000,
      (e) => reports.push(e),
    );
    for (let i = 0; i < 1000; i++)
      h.emit({
        schema: 1,
        recordId: String(i),
        time: 1000,
        type: "sample",
        sessionId: "r",
      });
    await h.flush();
    expect(reports).toContain("history-records-dropped");
    const result = await readPerformanceHistory(path);
    expect(
      result.records.some(
        (r) => !!r && typeof r === "object" && "type" in r && r.type === "gap",
      ),
    ).toBe(true);
    const name = (await readdir(path))[0];
    if (!name) throw new Error("Missing file");
    const failed = new PerformanceHistory(
      join(path, name),
      { enabled: true, retentionDays: 7, maxBytes: 4096 },
      Date.now,
      (e) => reports.push(e),
    );
    await failed.initialize();
    expect(failed.health().unavailable).toBe(true);
    expect(reports).toContain("history-unavailable");
  }));
