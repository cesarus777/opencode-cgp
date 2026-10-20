// Opt-in actual OpenCode binary check, executed inside the clean consumer.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import {
  monitorRpc,
  performanceRpc,
  historyRpc,
  isResult,
  isPerformanceResult,
  isHistoryResult,
} from "@cesarus777/opencode-cgp/rpc";
const root = process.cwd();
for (const mode of ["observe", "enforce"] as const) {
  const isolated = join(root, `host-${mode}`);
  const project = join(isolated, "project");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      plugins: [
        {
          package: resolve("node_modules/@cesarus777/opencode-cgp/dist"),
          options: { mode, telemetry: { enabled: false } },
        },
      ],
    }),
  );
  const log = join(isolated, "server.log");
  const password = crypto.randomUUID();
  const child = Bun.spawn(
    ["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: project,
      env: {
        ...process.env,
        OPENCODE_PASSWORD: password,
        XDG_CONFIG_HOME: join(isolated, "config"),
        XDG_DATA_HOME: join(isolated, "data"),
        XDG_STATE_HOME: join(isolated, "state"),
        XDG_CACHE_HOME: join(isolated, "cache"),
      },
      stdout: Bun.file(log),
      stderr: Bun.file(join(isolated, "errors.log")),
    },
  );
  try {
    let url: string | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      const content = await readFile(log, "utf8").catch(() => "");
      url = content.match(
        /server listening on (http:\/\/127\.0\.0\.1:\d+)/,
      )?.[1];
      if (url) break;
      if (child.exitCode !== null)
        throw new Error(`OpenCode exited ${child.exitCode}`);
      await Bun.sleep(50);
    }
    assert.ok(url, "OpenCode server did not start");
    const client = OpenCode.make({
      baseUrl: url,
      headers: { Authorization: `Basic ${btoa(`opencode:${password}`)}` },
    });
    let ready = false;
    let failures: string[] = [];
    for (let attempt = 0; attempt < 100; attempt++) {
      const plugins = await client.plugin.list({
        location: { directory: project },
      });
      ready = plugins.data.some(
        (plugin) =>
          plugin.id === "context-guard" && plugin.state.status === "active",
      );
      failures = plugins.data.flatMap((plugin) =>
        plugin.state.status === "failed" ? [plugin.state.error] : [],
      );
      if (ready || failures.length) break;
      await Bun.sleep(100);
    }
    assert.ok(ready, `Built plugin was not registered: ${failures.join("; ")}`);
    const snapshot = await client.rpc(monitorRpc).read(
      { schemaVersion: 1, sessionIds: [] },
      {
        location: { directory: project },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.ok(isResult(snapshot));
    assert.equal(snapshot.health.mode, mode);
    const performance = await client.rpc(performanceRpc).read(
      { schemaVersion: 1, sessionIds: [] },
      {
        location: { directory: project },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.ok(isPerformanceResult(performance));
    const session = await client.session.create({
      location: { directory: project },
    });
    const history = await client.rpc(historyRpc).read(
      {
        schemaVersion: 1,
        sessionId: session.id,
        from: Date.now() - 60000,
        to: Date.now(),
        maxPoints: 16,
      },
      { location: { directory: project }, signal: AbortSignal.timeout(10000) },
    );
    assert.ok(isHistoryResult(history));
    await client.session.remove({ sessionID: session.id });
    console.log(
      `PASS: actual OpenCode server registers packed JavaScript and serves monitor v1/v2 and history v1 RPC in ${mode} mode`,
    );
  } finally {
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    await child.exited;
    clearTimeout(force);
  }
}
