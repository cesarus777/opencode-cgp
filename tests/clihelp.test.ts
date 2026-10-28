import { expect, test } from "bun:test";

async function help(...args: string[]) {
  const child = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test("entry-point help names the installed command and explains how to open the plugin", async () => {
  for (const args of [[], ["--help"], ["-h"], ["help"]]) {
    const result = await help(...args);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: context-guard");
    expect(result.stdout).toContain("/context-guard");
    expect(result.stdout).toContain("dashboard tui");
  }
});

test("command help works before paths, connections or terminal runtime are checked", async () => {
  for (const topic of ["models", "metrics", "charts", "dashboard"]) {
    for (const args of [[topic], [topic, "--help"], ["help", topic]]) {
      const result = await help(...args);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`Usage: context-guard ${topic}`);
      expect(result.stdout).toContain("Options\n");
      expect(result.stdout).toContain("Example");
    }
  }
  for (const args of [
    ["dashboard", "tui", "-h"],
    ["dashboard", "tui", "--server", "--help"],
    ["metrics", "/nonexistent/history", "-h"],
    ["models", "/nonexistent/history", "--help"],
    ["charts", "/nonexistent/history", "--help"],
    ["/nonexistent/events.jsonl", "--help"],
    ["help", "journal"],
  ]) {
    const result = await help(...args);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage: context-guard");
  }
});

test("unknown help topics produce an actionable error without reading a journal", async () => {
  const result = await help("help", "unknown");
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("Use context-guard --help");
  expect(result.stderr).not.toContain("ENOENT");
});
