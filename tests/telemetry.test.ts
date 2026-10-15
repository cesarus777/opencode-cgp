import { test, expect } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonlTelemetrySink,
  readJournal,
  defaultPath,
} from "../src/telemetry.ts";
import { parseConfig } from "../src/config.ts";
test("rotating JSONL journal is bounded and inspectable by CLI", async () => {
  const dir = await mkdtemp(join(tmpdir(), "guard-test-")),
    path = join(dir, "events.jsonl");
  try {
    const config = parseConfig({ telemetry: { maxBytes: 4096 } });
    const sink = new JsonlTelemetrySink(path, config.telemetry);
    for (let i = 0; i < 100; i++)
      sink.emit({ time: i, type: "test", detail: "x".repeat(100) });
    await sink.flush();
    expect((await stat(path)).size).toBeLessThanOrEqual(4096);
    expect((await stat(`${path}.1`)).size).toBeLessThanOrEqual(4096);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await readJournal(path)).length).toBeGreaterThan(0);
    const run = Bun.spawn(["bun", "src/cli.ts", path, "--history"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await run.exited).toBe(0);
    expect(await new Response(run.stdout).text()).toContain("test");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("location-specific filenames avoid prompt or directory exposure", () => {
  expect(defaultPath("/secret/repo")).not.toContain("/secret/repo");
  expect(defaultPath("/a")).not.toBe(defaultPath("/b"));
});
