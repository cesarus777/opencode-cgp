/** Disposable connection probe. Only this fixture creates sessions; the dashboard is read-only. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { OpenCode } from "@opencode/client";
import { connectDashboard } from "../src/dashboard/connection.ts";
import { isPerformanceBatch, isPerformanceResult } from "../src/rpc.ts";

if (process.env.GUARD_DASHBOARD_HOST !== "1") {
  console.log(
    "SKIP: set GUARD_DASHBOARD_HOST=1 to run the disposable dashboard connection spike",
  );
  process.exit(0);
}
const root = await mkdtemp(join(tmpdir(), "guard-dashboard-spike-"));
const directory = join(root, "project");
const password = crypto.randomUUID();
await mkdir(directory);
await writeFile(
  join(directory, "opencode.json"),
  JSON.stringify({
    plugins: [
      {
        package: resolve("dist"),
        options: {
          mode: "observe",
          telemetry: { enabled: false },
          history: { enabled: true, path: join(root, "history") },
        },
      },
    ],
  }),
);
const host = Bun.spawn(
  [
    process.env.GUARD_DASHBOARD_BINARY ?? "opencode",
    "serve",
    "--hostname",
    "127.0.0.1",
    "--port",
    "0",
  ],
  {
    cwd: directory,
    env: {
      ...process.env,
      OPENCODE_PASSWORD: password,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state"),
    },
    stdout: Bun.file(join(root, "server.log")),
    stderr: Bun.file(join(root, "errors.log")),
  },
);
const controller = new AbortController();
let subscription: Promise<void> | undefined;
try {
  let url: string | undefined;
  for (let attempt = 0; attempt < 200; attempt++) {
    url = (
      await readFile(join(root, "server.log"), "utf8").catch(() => "")
    ).match(/server listening on (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    if (url) break;
    assert.equal(host.exitCode, null, "host exited before listening");
    await Bun.sleep(50);
  }
  assert.ok(url, "host readiness timeout");
  const signal = AbortSignal.timeout(30000);
  const connection = await connectDashboard({
    directory,
    server: url,
    password,
  });
  const info = await connection.info(signal);
  const registration = join(root, "service.json");
  // Reproduce the public background-service registration without replacing the user's service.
  await writeFile(
    registration,
    JSON.stringify({ url, pid: info.pid, version: info.version, password }),
    { mode: 0o600 },
  );
  const local = await connectDashboard({
    directory,
    serviceFile: registration,
  });
  assert.equal((await local.info(signal)).pid, info.pid);
  const writer = OpenCode.make({
    baseUrl: url,
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const plugins = await writer.plugin.list(
      { location: { directory } },
      { signal },
    );
    if (
      plugins.data.some(
        (p) => p.id === "context-guard" && p.state.status === "active",
      )
    )
      break;
    await Bun.sleep(100);
  }
  const rootSession = await writer.session.create(
    { location: { directory } },
    { signal },
  );
  const child = await writer.session.create(
    { location: { directory }, parentID: rootSession.id },
    { signal },
  );
  await writer.session.create({ location: { directory } }, { signal });
  const page = await connection.listSessions(
    { parentID: null, limit: 1 },
    signal,
  );
  assert.equal(page.data.length, 1);
  assert.ok(page.cursor?.next, "root pagination cursor");
  const next = await connection.listSessions(
    { parentID: null, limit: 1, cursor: page.cursor.next },
    signal,
  );
  assert.equal(next.data.length, 1);
  assert.notEqual(page.data[0]?.id, next.data[0]?.id);
  assert.ok(
    (
      await connection.listSessions({ parentID: rootSession.id }, signal)
    ).data.some((row) => row.id === child.id),
  );
  const monitor = await connection.monitor(signal);
  assert.equal(monitor.version, 2);
  const changed: unknown[] = [];
  subscription = (async () => {
    for await (const value of monitor.transport.subscribe(
      directory,
      controller.signal,
    )) {
      assert.ok(isPerformanceBatch(value));
      changed.push(value);
    }
  })();
  await Bun.sleep(250);
  const baseline = await monitor.transport.read(
    directory,
    [rootSession.id, child.id],
    signal,
  );
  assert.ok(isPerformanceResult(baseline));
  assert.equal(baseline.upserts.length, 2);
  assert.ok(
    baseline.upserts.every((row) => row.measurement === undefined),
    "unmeasured sessions remain unknown",
  );
  for (let attempt = 0; attempt < 100 && !changed.length; attempt++)
    await Bun.sleep(50);
  assert.ok(changed.length, "standalone location-scoped changed event");
  const to = Date.now();
  const history = await connection.history(
    {
      schemaVersion: 1,
      sessionId: child.id,
      from: to - 300000,
      to,
      maxPoints: 500,
    },
    signal,
  );
  assert.equal(history.enabled, true);
  assert.equal(history.metadata.completeness, "bounded-retention");
  assert.ok(
    !JSON.stringify({ baseline, changed, history }).includes(password),
    "credentials excluded from scalar contracts",
  );
  console.log(
    `PASS: OpenCode ${info.version}: explicit URL/auth, Service.discover/headers, root pagination, children, monitor v2 read/events, history and unknown usage; native TUI closed`,
  );
} catch {
  // Raw SDK/host errors can contain response data. Keep failure output scalar.
  throw new Error(
    "Dashboard connection spike failed; no host output or credentials printed",
  );
} finally {
  controller.abort();
  host.kill("SIGTERM");
  const timer = setTimeout(() => host.kill("SIGKILL"), 3000);
  try {
    await host.exited;
    await subscription;
  } finally {
    clearTimeout(timer);
    await rm(root, { recursive: true, force: true });
  }
}
