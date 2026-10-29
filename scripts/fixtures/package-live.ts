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
  analyticsRpc,
  isAnalyticsResult,
} from "@cesarus777/opencode-cgp/rpc";
const root = process.cwd();
const binary = process.env.GUARD_DASHBOARD_BINARY ?? "opencode";
for (const mode of ["observe", "enforce"] as const) {
  const isolated = join(root, `host-${mode}`);
  const project = join(isolated, "project");
  await mkdir(project, { recursive: true });
  const archive = join(isolated, "history");
  await mkdir(archive, { recursive: true });
  const completedAt = Date.now() - 1000;
  await writeFile(
    join(archive, `${completedAt}-abcdef.jsonl`),
    Array.from({ length: 600 }, (_, i) =>
      JSON.stringify({
        schema: 1,
        recordId: `archived-${i}`,
        type: "request",
        sessionId: `archived-${i}`,
        time: completedAt,
        performance: {
          sessionCreatedAt: completedAt - 1000,
          observedSince: completedAt - 1000,
          at: completedAt,
          status: "idle",
          partial: false,
          estimatedOutputTokens: 0,
          modelOutputTokens: 100,
          modelDurationMs: 1000,
          completedRequests: 1,
          tokenSource: "reported",
          requestId: `r-${i}`,
          requestModel: "synthetic/archive",
          requestAgent: "build",
          requestStartedAt: completedAt - 1000,
          streamEndedAt: completedAt,
          requestOutputTokens: 100,
          ttftMs: 100,
        },
      }),
    ).join("\n") + "\n",
  );
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      plugins: [
        {
          package: resolve("node_modules/@cesarus777/opencode-cgp/dist"),
          options: {
            mode,
            telemetry: { enabled: false },
            history: { path: archive },
          },
        },
      ],
    }),
  );
  const log = join(isolated, "server.log");
  const password = crypto.randomUUID();
  const child = Bun.spawn(
    [binary, "serve", "--hostname", "127.0.0.1", "--port", "0"],
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
    const analytics = await client.rpc(analyticsRpc).read(
      {
        schemaVersion: 1,
        from: completedAt - 60000,
        to: completedAt + 1,
        buckets: 120,
        model: "synthetic/archive",
      },
      {
        location: { directory: project },
        signal: AbortSignal.timeout(10000),
      },
    );
    assert.ok(isAnalyticsResult(analytics));
    assert.equal(analytics.selected?.completedRequests, 600);
    assert.equal(analytics.selected?.sessions, 600);
    assert.equal(analytics.selected?.averageTps, 100);
    assert.equal(analytics.requests.length, 50);
    const other = join(isolated, "other");
    await mkdir(other);
    await assert.rejects(
      client.rpc(analyticsRpc).read(
        {
          schemaVersion: 1,
          from: completedAt - 60000,
          to: completedAt + 1,
          buckets: 120,
        },
        {
          location: { directory: other },
          signal: AbortSignal.timeout(10000),
        },
      ),
    );
    await client.session.remove({ sessionID: session.id });
    console.log(
      `PASS: actual OpenCode server registers packed JavaScript; monitor/history and location-isolated analytics over 600 archived sessions in ${mode} mode`,
    );
  } finally {
    child.kill("SIGTERM");
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    await child.exited;
    clearTimeout(force);
  }
}
