/** Authenticated synthetic provider + standalone CLI PTY; native TUI is never launched. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { OpenCode } from "@opencode/client";
import {
  performanceRpc,
  historyRpc,
  isPerformanceResult,
  isHistoryResult,
} from "../src/rpc.ts";

if (process.env.GUARD_DASHBOARD_HOST !== "1") {
  console.log(
    "SKIP: set GUARD_DASHBOARD_HOST=1 for the standalone synthetic-provider PTY smoke",
  );
  process.exit(0);
}
const root = await mkdtemp(join(tmpdir(), "guard-terminal-live-"));
const project = join(root, "project");
await mkdir(project);
const password = crypto.randomUUID(),
  canary = `private-${crypto.randomUUID()}`;
const env = {
  ...process.env,
  OPENCODE_PASSWORD: password,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_CACHE_HOME: join(root, "cache"),
  XDG_STATE_HOME: join(root, "state"),
};
const binary = process.env.GUARD_DASHBOARD_BINARY ?? "opencode";
const runtime = process.env.GUARD_DASHBOARD_BUN ?? process.execPath;
const version = Bun.spawnSync([binary, "--version"], { cwd: project, env })
  .stdout.toString()
  .trim();
assert.match(version, /v2\.(?:0\.29|1\.2)$/);
let serial = 0;
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body: unknown = await req.json();
    const model =
      body &&
      typeof body === "object" &&
      "model" in body &&
      typeof body.model === "string"
        ? body.model
        : "alpha";
    const id = ++serial;
    return new Response(
      new ReadableStream({
        async start(controller) {
          const chunk = (
            delta: object,
            finish: string | null = null,
            usage?: object,
          ) =>
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ id: `synthetic-${id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`,
              ),
            );
          await Bun.sleep(200);
          chunk({ role: "assistant", reasoning_content: canary });
          for (let i = 0; i < 20; i++) {
            await Bun.sleep(150);
            chunk({ content: `${canary} ` });
          }
          chunk({}, "stop", {
            prompt_tokens: 1200,
            completion_tokens: 80,
            completion_tokens_details: { reasoning_tokens: 20 },
          });
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  },
});
let host: ReturnType<typeof Bun.spawn> | undefined;
let tty: ReturnType<typeof Bun.spawn> | undefined;
let upstream = "";
let client: ReturnType<typeof OpenCode.make>;
const location = { directory: project };
const ids: string[] = [];
let streams = 0,
  historyReads = 0;
async function until(check: () => Promise<boolean>) {
  for (let i = 0; i < 300; i++) {
    if (await check()) return;
    await Bun.sleep(100);
  }
  throw new Error("Standalone live scalar assertion timed out");
}
async function stop() {
  host?.kill("SIGTERM");
  const timer = setTimeout(() => host?.kill("SIGKILL"), 3000);
  try {
    await host?.exited;
  } finally {
    clearTimeout(timer);
  }
}
async function start() {
  await writeFile(join(root, "server.log"), "");
  host = Bun.spawn(
    [binary, "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: project,
      env,
      stdout: Bun.file(join(root, "server.log")),
      stderr: Bun.file(join(root, "errors.log")),
    },
  );
  await until(async () => {
    const url = (await readFile(join(root, "server.log"), "utf8")).match(
      /server listening on (http:\/\/127\.0\.0\.1:\d+)/,
    )?.[1];
    assert.equal(host?.exitCode, null);
    if (url) upstream = url;
    return Boolean(url);
  });
  client = OpenCode.make({
    baseUrl: upstream,
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
  });
  await until(async () =>
    (await client.plugin.list({ location })).data.some(
      (p) => p.id === "context-guard" && p.state.status === "active",
    ),
  );
  return client;
}
const proxy = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/__test/")) {
      const action = url.pathname.slice(8);
      if (action === "counts") return Response.json({ streams, historyReads });
      if (action === "prompt") {
        await Promise.all(
          ids.map((sessionID) =>
            client.session.prompt({ sessionID, text: canary }),
          ),
        );
      } else if (action === "stop") await stop();
      else if (action === "start") {
        await start();
        await Promise.all(
          ids.map((sessionID) =>
            client.session.prompt({ sessionID, text: canary }),
          ),
        );
      } else if (action === "verify") {
        for (const id of ids) {
          const result = await client
            .rpc(performanceRpc)
            .read({ schemaVersion: 1, sessionIds: [id] }, { location });
          assert.ok(isPerformanceResult(result));
          assert.ok(
            result.upserts[0]?.performance?.partial,
            "restart remains partial",
          );
          const to = Date.now();
          const history = await client.rpc(historyRpc).read(
            {
              schemaVersion: 1,
              sessionId: id,
              from: to - 300000,
              to,
              maxPoints: 500,
            },
            { location },
          );
          assert.ok(isHistoryResult(history));
          const requests = history.data.series.flatMap((s) => s.requests);
          assert.ok(requests.length >= 2);
          assert.equal(
            new Set(requests.map((r) => r.requestId)).size,
            requests.length,
          );
        }
      }
      return Response.json({ ok: true });
    }
    const body = req.method === "POST" ? await req.arrayBuffer() : undefined;
    if (body && new TextDecoder().decode(body).includes(historyRpc.id))
      historyReads++;
    // Public SSE route; count connection attempts without retaining any payload.
    if (url.pathname.includes("event")) streams++;
    try {
      const response = await fetch(upstream + url.pathname + url.search, {
        method: req.method,
        headers: req.headers,
        ...(body ? { body } : {}),
        signal: req.signal,
      });
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("unavailable", { status: 503 });
    }
  },
});
try {
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      model: "synthetic/alpha",
      update: "disable",
      share: "disabled",
      snapshots: false,
      providers: {
        synthetic: {
          package: version.includes("2.1.2")
            ? "@opencode/ai/providers/openai-compatible"
            : "@ai-sdk/openai-compatible",
          name: "Synthetic",
          settings: {
            baseURL: `http://127.0.0.1:${provider.port}/v1`,
            apiKey: canary,
          },
          models: Object.fromEntries(
            ["alpha", "beta"].map((id) => [
              id,
              {
                name: id,
                limit: { context: 136000, input: 128000, output: 8000 },
                capabilities: { tools: true },
              },
            ]),
          ),
        },
      },
      compaction: { auto: false },
      plugins: [
        {
          package: resolve("dist"),
          options: {
            mode: "observe",
            metrics: { sampleIntervalMs: 100 },
            history: { enabled: true, path: join(root, "history") },
            telemetry: { path: join(root, "diagnostics.jsonl") },
          },
        },
      ],
    }),
  );
  const writer = await start();
  console.log(`Host ready: ${version}; terminal runtime ${runtime}`);
  const parent = await writer.session.create({
    location,
    title: canary,
    model: { providerID: "synthetic", id: "alpha" },
  });
  ids.push(parent.id);
  for (const id of ["alpha", "beta"])
    ids.push(
      (
        await writer.session.create({
          location,
          parentID: parent.id,
          title: canary,
          model: { providerID: "synthetic", id },
        })
      ).id,
    );
  await Promise.all(
    ids.map((sessionID) => client.session.prompt({ sessionID, text: canary })),
  );
  await until(async () => {
    const result = await client
      .rpc(performanceRpc)
      .read({ schemaVersion: 1, sessionIds: ids }, { location });
    return (
      isPerformanceResult(result) &&
      result.upserts.length === 3 &&
      result.upserts.every((r) => (r.performance?.completedRequests ?? 0) >= 1)
    );
  });
  const config = join(root, "terminal.json");
  await writeFile(
    config,
    JSON.stringify({
      runtime,
      capture: resolve(".artifacts/dashboard-terminal-frame.txt"),
      cli: resolve(process.env.GUARD_DASHBOARD_CLI ?? "dist/cli.js"),
      project,
      url: `http://127.0.0.1:${proxy.port}`,
      password,
      canary,
      ids,
      env,
    }),
    { mode: 0o600 },
  );
  tty = Bun.spawn(
    ["python3", resolve("scripts/fixtures/dashboard-terminal.py"), config],
    { stdout: "inherit", stderr: "inherit" },
  );
  assert.equal(await tty.exited, 0, "standalone PTY smoke");
  const diagnostics = await readFile(
    join(root, "diagnostics.jsonl"),
    "utf8",
  ).catch(() => "");
  assert.ok(!diagnostics.includes(canary) && !diagnostics.includes(password));
  console.log(
    `PASS: ${version}; standalone authenticated built CLI, populated root/concurrent children, all metrics/windows, navigation, resize, restart recovery, privacy and terminal restoration`,
  );
} catch {
  throw new Error(
    "Standalone terminal live smoke failed; host content and credentials suppressed",
  );
} finally {
  tty?.kill();
  await stop();
  proxy.stop(true);
  provider.stop(true);
  await rm(root, { recursive: true, force: true });
}
