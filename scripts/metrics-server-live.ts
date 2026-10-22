/** Disposable actual verified V2 host + synthetic SSE provider. Never uses real credentials. */
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  readdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { OpenCode, type OpenCodeEvent } from "@opencode/client";
import {
  monitorRpc,
  performanceRpc,
  historyRpc,
  isResult,
  isPerformanceResult,
  isHistoryResult,
} from "../src/rpc.ts";
import { readPerformanceHistory } from "../src/history.ts";

const root = await mkdtemp(join(tmpdir(), "guard-metrics-live-"));
const project = join(root, "project"),
  archive = join(root, "history");
await mkdir(project);
const secret = `private-canary-${crypto.randomUUID()}`;
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"),
  XDG_STATE_HOME: join(root, "state"),
  XDG_CACHE_HOME: join(root, "cache"),
  OPENCODE_PASSWORD: crypto.randomUUID(),
  OPENCODE_SYNTHETIC_KEY: secret,
};
const authorization = `Basic ${btoa(`opencode:${env.OPENCODE_PASSWORD}`)}`;
type Boundary = Extract<
  OpenCodeEvent,
  {
    type:
      | "session.step.started"
      | "session.step.streamed"
      | "session.step.ended";
  }
>;
const events: Boundary[] = [];
const eventCounts = new Map<string, number>();
const failureTypes: string[] = [];
const deltas = new Map<string, { text: number; reasoning: number }>();
const children = new Set<ReturnType<typeof Bun.spawn>>();
let host: ReturnType<typeof Bun.spawn> | undefined;
let abort = new AbortController();
let subscription: Promise<void> | undefined;
let providerRequests = 0;
let providerPackage = "@ai-sdk/openai-compatible";
let contextTokens: number | undefined;
let toolNext = false,
  enforceTools = 0,
  enforcing = false;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function listen() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body: unknown = await req.json();
      assert.ok(record(body));
      const last: unknown = Array.isArray(body.messages)
        ? body.messages.at(-1)
        : undefined;
      const lastContent = JSON.stringify(record(last) ? last.content : "");
      const tools: string[] = Array.isArray(body.tools)
        ? body.tools.flatMap((entry: unknown) =>
            record(entry) &&
            record(entry.function) &&
            typeof entry.function.name === "string"
              ? [entry.function.name]
              : [],
          )
        : [];
      const summary =
        lastContent.includes("Do not continue the task or call tools.") ||
        lastContent.includes("required summary template");
      const tool =
        !summary && (toolNext || (enforceTools > 0 && tools.length))
          ? tools.find((name) => /^(bash|shell)$/.test(name))
          : undefined;
      if (toolNext) {
        assert.ok(tool, "synthetic tool available");
        toolNext = false;
      }
      if (tool && enforceTools > 0) enforceTools--;
      const responseId = ++providerRequests;
      const model = typeof body.model === "string" ? body.model : "alpha";
      const stream = new ReadableStream({
        async start(controller) {
          const chunk = (
            delta: object,
            finish_reason: string | null = null,
            usage?: object,
          ) =>
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ id: `synthetic-${responseId}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}) })}\n\n`,
              ),
            );
          await Bun.sleep(250);
          chunk({ role: "assistant", reasoning_content: secret });
          for (let i = 0; i < 8; i++) {
            await Bun.sleep(150);
            chunk({
              content: summary
                ? i === 0
                  ? `## Objective\n${secret}\n## Next Move\n1. Continue.\n`
                  : `${secret} `
                : `${secret} `,
            });
          }
          if (tool)
            chunk({
              tool_calls: [
                {
                  index: 0,
                  id: "call_guard_synthetic",
                  type: "function",
                  function: {
                    name: tool,
                    arguments: JSON.stringify({
                      command: `sleep 2; printf '${secret}'`,
                      description: secret,
                    }),
                  },
                },
              ],
            });
          chunk({}, tool ? "tool_calls" : "stop", {
            prompt_tokens: contextTokens ?? (enforcing ? 12000 : 1200),
            completion_tokens: model === "beta" ? 90 : 60,
            completion_tokens_details: { reasoning_tokens: 20 },
          });
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "text/event-stream" },
      });
    },
  });
}
const provider = await (async () => {
  try {
    return listen();
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
})();
const pluginPath = resolve("dist");
async function config(historyEnabled = true, enforce = false) {
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      model: "synthetic/alpha",
      update: "disable",
      share: "disabled",
      snapshots: false,
      providers: {
        synthetic: {
          package: providerPackage,
          env: ["OPENCODE_SYNTHETIC_KEY"],
          name: "Synthetic validation",
          settings: {
            baseURL: `http://127.0.0.1:${provider.port}/v1`,
            apiKey: secret,
          },
          models: Object.fromEntries(
            ["alpha", "beta"].map((id) => [
              id,
              {
                name: id,
                limit: { context: 136000, input: 128000, output: 8000 },
                capabilities: {
                  reasoning: providerPackage.startsWith("@opencode/ai/")
                    ? { supported: true }
                    : true,
                  tools: true,
                },
              },
            ]),
          ),
        },
      },
      compaction: { auto: false, keep: { tokens: 128 } },
      plugins: [
        {
          package: pluginPath,
          options: {
            mode: enforce ? "enforce" : "observe",
            ...(enforce
              ? {
                  defaults: { threshold: { type: "tokens", value: 10000 } },
                  safety: { minReclaimTokens: 128 },
                }
              : {}),
            metrics: { sampleIntervalMs: 100 },
            history: {
              enabled: historyEnabled,
              path: archive,
              maxBytes: 262144,
            },
            telemetry: { path: join(root, "diagnostics.jsonl") },
          },
        },
      ],
    }),
  );
}
async function stop() {
  abort.abort();
  host?.kill("SIGTERM");
  const timer = setTimeout(() => host?.kill("SIGKILL"), 3000);
  try {
    await host?.exited;
    await subscription;
  } finally {
    clearTimeout(timer);
  }
}
async function start() {
  const log = join(root, "server.log");
  await writeFile(log, "");
  host = Bun.spawn(
    ["opencode", "serve", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: project,
      env,
      stdout: Bun.file(log),
      stderr: Bun.file(join(root, "errors.log")),
    },
  );
  let url: string | undefined;
  for (let i = 0; i < 200; i++) {
    url = (await readFile(log, "utf8").catch(() => "")).match(
      /server listening on (http:\/\/127\.0\.0\.1:\d+)/,
    )?.[1];
    if (url) break;
    assert.equal(host.exitCode, null, "host exited before listening");
    await Bun.sleep(50);
  }
  assert.ok(url, "host readiness timeout");
  const client = OpenCode.make({
    baseUrl: url,
    headers: { Authorization: authorization },
  });
  let plugins = await client.plugin.list({ location: { directory: project } });
  for (
    let i = 0;
    i < 100 &&
    !plugins.data.some(
      (p) => p.state.status === "active" || p.state.status === "failed",
    );
    i++
  ) {
    await Bun.sleep(100);
    plugins = await client.plugin.list({ location: { directory: project } });
  }
  assert.ok(
    plugins.data.some(
      (p) => p.id === "context-guard" && p.state.status === "active",
    ),
    JSON.stringify(plugins)
      .replaceAll(secret, "[redacted]")
      .replaceAll(env.OPENCODE_PASSWORD, "[redacted]"),
  );
  abort = new AbortController();
  subscription = (async () => {
    for await (const e of client.event.subscribe({ signal: abort.signal })) {
      eventCounts.set(e.type, (eventCounts.get(e.type) ?? 0) + 1);
      if (
        e.type === "session.execution.failed" ||
        e.type === "session.step.failed"
      )
        failureTypes.push(e.data.error.type);
      // Keep numeric boundaries only, never retain delta content.
      if (
        e.type === "session.step.started" ||
        e.type === "session.step.streamed" ||
        e.type === "session.step.ended"
      )
        events.push(e);
      if (
        e.type === "session.text.delta" ||
        e.type === "session.reasoning.delta"
      ) {
        const counts = deltas.get(e.data.assistantMessageID) ?? {
          text: 0,
          reasoning: 0,
        };
        counts[e.type === "session.text.delta" ? "text" : "reasoning"] +=
          e.data.delta.length;
        deltas.set(e.data.assistantMessageID, counts);
      }
    }
  })().catch((e) => {
    if (!abort.signal.aborted) throw e;
  });
  await Bun.sleep(200);
  return { client, url };
}
async function waitFor(check: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  const version = Bun.spawnSync(["opencode", "--version"], {
    cwd: project,
    env,
  });
  assert.match(version.stdout.toString(), /opencode v2\.(?:0\.29|1\.2)\s*$/);
  console.log(version.stdout.toString().trim());
  if (version.stdout.toString().includes("v2.1.2"))
    providerPackage = "@opencode/ai/providers/openai-compatible";
  await config();
  let { client, url } = await start();
  const location = { directory: project };
  let catalog: unknown;
  await waitFor(async () => {
    const models = (await client.model.list({ location })).data;
    catalog = models.map((m) => ({
      id: m.id,
      providerID: m.providerID,
      enabled: m.enabled,
    }));
    return ["alpha", "beta"].every((id) =>
      models.some(
        (model) =>
          model.providerID === "synthetic" && model.id === id && model.enabled,
      ),
    );
  }, "synthetic provider catalog ready").catch(async (error: unknown) => {
    const providers = await client.provider.list({ location });
    console.error(
      JSON.stringify({
        catalog,
        providers: providers.data.map((p) => ({
          id: p.id,
          package: p.package,
        })),
      }),
    );
    throw error;
  });
  const read = async (ids: string[]) => {
    const result = await client
      .rpc(performanceRpc)
      .read(
        { schemaVersion: 1, sessionIds: ids },
        { location, signal: AbortSignal.timeout(5000) },
      );
    assert.ok(isPerformanceResult(result));
    return result;
  };
  const metrics = async (id: string) => {
    const p = (await read([id])).upserts[0]?.performance;
    assert.ok(p);
    return p;
  };
  const parent = await client.session.create({
    location,
    title: secret,
    model: { providerID: "synthetic", id: "alpha" },
  });
  const child = await client.session.create({
    location,
    parentID: parent.id,
    title: secret,
    model: { providerID: "synthetic", id: "alpha" },
  });
  const nested = await client.session.create({
    location,
    parentID: child.id,
    title: secret,
    model: { providerID: "synthetic", id: "beta" },
  });
  const ids = [parent.id, child.id, nested.id];
  // Run the existing independent timing observer against an actual request.
  const observer = Bun.spawn(["bun", "run", "test:metrics-live"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GUARD_SERVER_URL: url,
      GUARD_TEST_DIRECTORY: project,
      GUARD_TEST_SESSION: parent.id,
      GUARD_AUTHORIZATION: authorization,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.add(observer);
  await Bun.sleep(1000);
  await Promise.all(
    ids.map((sessionID) => client.session.prompt({ sessionID, text: secret })),
  );
  let sawLive = false;
  let startupRows: unknown;
  await waitFor(async () => {
    const rows = (await read(ids)).upserts;
    startupRows = rows.map((r) => ({
      sessionId: r.sessionId,
      model: r.model,
      measurement: r.measurement,
      performance: r.performance,
    }));
    sawLive ||= rows.some(
      (r) =>
        r.performance?.status === "streaming" &&
        (r.performance.liveTps ?? 0) > 0 &&
        r.performance.ttftMs !== undefined,
    );
    return (
      rows.length === 3 &&
      rows.every((r) => r.performance?.completedRequests === 1)
    );
  }, "three completed sessions").catch((error: unknown) => {
    console.error(
      JSON.stringify({
        providerRequests,
        eventCounts: Object.fromEntries(eventCounts),
        failureTypes,
        rows: startupRows,
      }),
    );
    throw error;
  });
  assert.ok(sawLive, "live TPS and TTFT observed");
  const observerCode = await observer.exited;
  assert.equal(observerCode, 0, await new Response(observer.stderr).text());
  console.log((await new Response(observer.stdout).text()).trim());
  const transport = Bun.spawnSync(["bun", "run", "test:tui-live"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GUARD_SERVER_URL: url,
      GUARD_TEST_DIRECTORY: project,
      GUARD_TEST_SESSION: parent.id,
      GUARD_AUTHORIZATION: authorization,
    },
  });
  assert.equal(transport.exitCode, 0, transport.stderr.toString());
  console.log(transport.stdout.toString().trim());
  const rows = (await read(ids)).upserts;
  assert.equal(rows.find((r) => r.sessionId === child.id)?.parentId, parent.id);
  assert.equal(rows.find((r) => r.sessionId === nested.id)?.parentId, child.id);
  assert.equal(
    new Set(rows.map((r) => r.agent)).size,
    1,
    "identical agent names",
  );
  for (const row of rows) {
    const p = row.performance;
    assert.ok(p?.requestId);
    assert.ok((deltas.get(p.requestId)?.text ?? 0) > 0);
    assert.ok((deltas.get(p.requestId)?.reasoning ?? 0) > 0);
    const counts = deltas.get(p.requestId);
    assert.ok(counts);
    assert.equal(p.estimatedOutputTokens, (counts.text + counts.reasoning) / 4);
    assert.equal(p.tokenSource, "reported");
    const start = events.find(
      (e) =>
        e.type === "session.step.started" &&
        e.data.assistantMessageID === p.requestId,
    );
    const end = events.find(
      (e) =>
        e.type === "session.step.streamed" &&
        e.data.assistantMessageID === p.requestId,
    );
    assert.ok(
      start?.type === "session.step.started" &&
        end?.type === "session.step.streamed",
    );
    assert.equal(p.modelDurationMs, end.created - start.data.started);
    assert.equal(p.modelOutputTokens, row.model === "synthetic/beta" ? 90 : 60);
    const settled = events.find(
      (e) =>
        e.type === "session.step.ended" &&
        e.data.assistantMessageID === p.requestId,
    );
    assert.ok(settled?.type === "session.step.ended");
    assert.equal(
      p.modelOutputTokens,
      settled.data.tokens.output + settled.data.tokens.reasoning,
    );
    assert.equal(settled.data.tokens.reasoning, 20);
    assert.equal(
      p.averageModelTps,
      (p.modelOutputTokens * 1000) / p.modelDurationMs,
    );
    assert.ok(p.sessionOutputTokens !== undefined);
    assert.equal(
      p.averageSessionTps,
      (p.sessionOutputTokens * 1000) / (p.at - p.sessionCreatedAt),
    );
  }
  const before = await metrics(parent.id);
  await Bun.sleep(1500);
  const idle = await metrics(parent.id);
  assert.equal(idle.averageModelTps, before.averageModelTps);
  assert.ok(
    idle.averageSessionTps !== undefined &&
      before.averageSessionTps !== undefined,
  );
  assert.ok(idle.averageSessionTps < before.averageSessionTps);
  const v1 = await client
    .rpc(monitorRpc)
    .read({ schemaVersion: 1, sessionIds: ids }, { location });
  assert.ok(isResult(v1));
  assert.ok(v1.upserts.every((r) => !("performance" in r)));
  await client.session.switchModel({
    sessionID: parent.id,
    model: { providerID: "synthetic", id: "beta" },
  });
  await client.session.prompt({ sessionID: parent.id, text: secret });
  await waitFor(
    async () =>
      (await read([parent.id])).upserts[0]?.performance?.completedRequests ===
      2,
    "model change",
  );
  assert.equal(
    (await read([parent.id])).upserts[0]?.performance?.modelOutputTokens,
    150,
  );
  assert.equal(
    (await read([child.id])).upserts[0]?.performance?.modelOutputTokens,
    60,
  );
  const beforeTool = await metrics(parent.id);
  toolNext = true;
  await client.session.prompt({ sessionID: parent.id, text: secret });
  await waitFor(
    async () =>
      (await read([parent.id])).upserts[0]?.performance?.completedRequests ===
      beforeTool.completedRequests + 2,
    "tool then continuation",
  );
  const afterTool = await metrics(parent.id);
  const toolStarts = events
    .filter(
      (e) =>
        e.type === "session.step.started" && e.data.sessionID === parent.id,
    )
    .slice(-2);
  let toolModelMs = 0,
    observedToolMs = 0;
  for (const start of toolStarts) {
    assert.ok(start.type === "session.step.started");
    const streamed = events.find(
      (e) =>
        e.type === "session.step.streamed" &&
        e.data.assistantMessageID === start.data.assistantMessageID,
    );
    const ended = events.find(
      (e) =>
        e.type === "session.step.ended" &&
        e.data.assistantMessageID === start.data.assistantMessageID,
    );
    assert.ok(
      streamed?.type === "session.step.streamed" &&
        ended?.type === "session.step.ended",
    );
    toolModelMs += streamed.created - start.data.started;
    observedToolMs += ended.created - streamed.created;
  }
  assert.ok(observedToolMs >= 1900, "actual tool delay observed");
  assert.equal(
    afterTool.modelDurationMs - beforeTool.modelDurationMs,
    toolModelMs,
  );
  assert.ok(afterTool.sessionOutputTokens !== undefined);
  assert.equal(
    afterTool.averageSessionTps,
    (afterTool.sessionOutputTokens * 1000) /
      (afterTool.at - afterTool.sessionCreatedAt),
  );
  console.log(
    "PASS: actual delayed shell tool excluded from matched model durations, included in session wall time",
  );
  const input = {
    schemaVersion: 1 as const,
    sessionId: parent.id,
    from: Date.now() - 3600000,
    to: Date.now(),
    maxPoints: 16,
  };
  let history = await client.rpc(historyRpc).read(input, { location });
  assert.ok(
    isHistoryResult(history) &&
      history.enabled &&
      history.data.series.length === 1,
  );
  assert.ok(
    history.data.series.every(
      (s) =>
        s.points.length <= input.maxPoints &&
        s.requests.length <= input.maxPoints,
    ),
  );
  const foreign = join(root, "foreign");
  await mkdir(foreign);
  const foreignSession = await client.session.create({
    location: { directory: foreign },
  });
  for (const bad of [
    { ...input, sessionId: foreignSession.id },
    { ...input, from: 0 },
    { ...input, from: input.to + 1 },
  ]) {
    await assert.rejects(
      client
        .rpc(historyRpc)
        .read(bad, { location, signal: AbortSignal.timeout(5000) }),
    );
  }
  for (const bad of [
    { ...input, maxPoints: 501 },
    { ...input, maxPoints: 15 },
    { ...input, sessionId: "" },
    { ...input, from: -1 },
    { ...input, schemaVersion: 2 },
  ]) {
    let rejected = false;
    try {
      const result = await client.rpc.call({
        rpcID: historyRpc.id,
        method: "read",
        location,
        input: bad,
      });
      rejected = "error" in result;
    } catch {
      rejected = true;
    }
    assert.ok(
      rejected,
      `invalid raw RPC input rejected: ${Object.keys(bad).join(",")}`,
    );
  }
  const ignoredPath = await client.rpc.call({
    rpcID: historyRpc.id,
    method: "read",
    location,
    input: { ...input, path: "/definitely-not-the-archive" },
  });
  assert.ok(isHistoryResult(ignoredPath.output));
  assert.deepEqual(ignoredPath.output.data, history.data);
  console.log(
    "LIMITATION: the host strips unknown RPC input properties before the handler; a supplied path is ignored, never followed.",
  );
  console.log(
    "PASS: actual built host, all three RPCs, streaming TPS/TTFT, reported totals, independent hierarchy/model change, idle average, v1 privacy, history ownership/bounds",
  );
  const checkpoint = await metrics(parent.id);
  await stop();
  const expired = `${Date.now() - 8 * 86400000}-aaaaaaaa.jsonl`;
  const excess = `${Date.now() - 86400000}-bbbbbbbb.jsonl`;
  await writeFile(join(archive, expired), "\n");
  await writeFile(join(archive, excess), "\n".repeat(262144));
  await writeFile(
    join(archive, `${Date.now()}-cccccccc.jsonl`),
    JSON.stringify({
      schema: 1,
      recordId: crypto.randomUUID(),
      time: Date.now(),
      type: "gap",
      sessionId: "__history__",
      event: "validation-fixture-gap",
    }) + "\n",
  );
  ({ client, url } = await start());
  assert.ok(!(await readdir(archive)).includes(expired));
  assert.ok(!(await readdir(archive)).includes(excess));
  const gapResponse = await client
    .rpc(historyRpc)
    .read({ ...input, to: Date.now() }, { location });
  assert.ok(isHistoryResult(gapResponse));
  assert.ok(
    gapResponse.data.gaps.some((g) => g.reason === "validation-fixture-gap"),
  );
  assert.ok(gapResponse.metadata.retainedBytes <= 262144);
  console.log(
    "PASS: real archive startup age/cap pruning and RPC gap rendering (seeded retention/gap fixtures)",
  );
  await client.session.prompt({ sessionID: parent.id, text: secret });
  await waitFor(
    async () =>
      (await read([parent.id])).upserts[0]?.performance?.completedRequests ===
      checkpoint.completedRequests + 1,
    "restart checkpoint",
  );
  const restored = await metrics(parent.id);
  assert.ok(restored.partial);
  assert.equal(restored.modelOutputTokens, checkpoint.modelOutputTokens + 90);
  const retained = await readPerformanceHistory(archive);
  assert.ok(
    retained.records.some(
      (r) => r.type === "request" && r.sessionId === child.id,
    ),
  );
  const report = join(root, "report.html");
  const cli = Bun.spawnSync([
    "bun",
    resolve("dist/cli.js"),
    "charts",
    archive,
    "--output",
    report,
  ]);
  assert.equal(cli.exitCode, 0);
  assert.ok((await readFile(report, "utf8")).includes(parent.id));
  if (process.env.GUARD_SYNTHETIC_BROWSER === "1") {
    const artifacts = resolve(".artifacts");
    await mkdir(artifacts, { recursive: true });
    const saved = join(artifacts, "metrics-live-2026-10-20.html");
    await writeFile(saved, await readFile(report), { mode: 0o600 });
    await mkdir(join(root, "firefox"));
    const browser = Bun.spawn(
      [
        "firefox",
        "--headless",
        "--no-remote",
        "--profile",
        join(root, "firefox"),
        "--window-size",
        "1440,1400",
        "--screenshot",
        join(artifacts, "metrics-live-2026-10-20.png"),
        `file://${saved}`,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    children.add(browser);
    const timer = setTimeout(() => browser.kill("SIGKILL"), 30000);
    try {
      assert.equal(
        await browser.exited,
        0,
        await new Response(browser.stderr).text(),
      );
      console.log(
        "PASS: Firefox screenshot of actual server archive report (.artifacts/metrics-live-2026-10-20.png)",
      );
    } finally {
      clearTimeout(timer);
    }
  }
  const diagnostics = await readFile(join(root, "diagnostics.jsonl"), "utf8");
  const archiveText = (
    await Promise.all(
      (await readdir(archive)).map((n) => readFile(join(archive, n), "utf8")),
    )
  ).join("");
  for (const content of [
    diagnostics,
    archiveText,
    JSON.stringify(await read(ids)),
    JSON.stringify(history),
    await readFile(report, "utf8"),
  ]) {
    assert.ok(!content.includes(secret));
    assert.ok(!content.includes(env.OPENCODE_PASSWORD));
  }
  console.log(
    "PASS: restart checkpoint remains partial; retained server archive; built CLI report; prompt/reasoning/output/credential canaries absent",
  );
  if (process.env.GUARD_SYNTHETIC_TUI === "1") {
    await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
    await writeFile(
      join(env.XDG_CONFIG_HOME, "opencode", "cli.json"),
      JSON.stringify({ plugins: [{ package: pluginPath }] }),
    ).catch(async () => {
      await mkdir(join(env.XDG_CONFIG_HOME, "opencode"), { recursive: true });
      await writeFile(
        join(env.XDG_CONFIG_HOME, "opencode", "cli.json"),
        JSON.stringify({ plugins: [{ package: pluginPath }] }),
      );
    });
    const counts = { history: 0, monitor: 0, cancelled: 0, delay: false };
    const proxy = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const incoming = new URL(req.url);
        if (incoming.pathname === "/__validation_counts")
          return Response.json(counts);
        if (incoming.pathname.startsWith("/__validation_context/")) {
          const action = incoming.pathname.split("/").at(-1);
          if (action === "grow" || action === "lower") {
            contextTokens = action === "grow" ? 89600 : 64000;
            await client.session.prompt({ sessionID: parent.id, text: secret });
            await waitFor(
              async () =>
                (await read([parent.id])).upserts[0]?.measurement?.tokens ===
                contextTokens,
              "context chart measurement",
            );
          } else if (action === "permission") {
            await client.session.update({
              sessionID: child.id,
              permissions: [{ action: "*", resource: "*", effect: "ask" }],
            });
            toolNext = true;
            await client.session.prompt({ sessionID: child.id, text: secret });
            await waitFor(
              async () =>
                (await client.permission.list({ sessionID: child.id })).length >
                0,
              "child waiting for permission",
            );
          } else if (action === "resume") {
            await client.session.update({
              sessionID: child.id,
              permissions: [{ action: "*", resource: "*", effect: "allow" }],
            });
            for (const request of await client.permission.list({
              sessionID: child.id,
            }))
              await client.permission.reply({
                sessionID: child.id,
                requestID: request.id,
                decision: "once",
              });
          } else if (action === "child") {
            toolNext = true;
            await client.session.prompt({ sessionID: child.id, text: secret });
          } else if (action === "compact") {
            contextTokens = 12800;
            const before =
              (await read([parent.id])).upserts[0]?.compaction.count ?? 0;
            await client.session.compact({ sessionID: parent.id });
            await waitFor(
              async () =>
                ((await read([parent.id])).upserts[0]?.compaction.count ?? 0) >
                before,
              "manual compaction ended",
            );
            await client.session.prompt({ sessionID: parent.id, text: secret });
            await waitFor(
              async () =>
                (await read([parent.id])).upserts[0]?.measurement?.tokens ===
                12800,
              "post-compaction measurement",
            );
          } else throw new Error("Unknown context validation action");
          return Response.json({ ok: true });
        }
        if (incoming.pathname === "/__validation_delay") {
          counts.delay = true;
          return Response.json({ ok: true });
        }
        const payload =
          req.method === "POST" ? await req.arrayBuffer() : undefined;
        if (payload) {
          const body = new TextDecoder().decode(payload);
          if (
            incoming.pathname.includes(historyRpc.id) ||
            body.includes(historyRpc.id)
          ) {
            counts.history++;
            if (counts.delay) {
              counts.delay = false;
              await new Promise<void>((resolve) => {
                const timer = setTimeout(finish, 4000);
                function finish() {
                  clearTimeout(timer);
                  req.signal.removeEventListener("abort", cancel);
                  resolve();
                }
                function cancel() {
                  counts.cancelled++;
                  finish();
                }
                req.signal.addEventListener("abort", cancel, { once: true });
                if (req.signal.aborted) cancel();
              });
            }
          }
          if (
            incoming.pathname.includes(performanceRpc.id) ||
            body.includes(performanceRpc.id)
          )
            counts.monitor++;
        }
        const response = await fetch(
          url + incoming.pathname + incoming.search,
          {
            method: req.method,
            headers: req.headers,
            ...(payload ? { body: payload } : {}),
            signal: req.signal,
          },
        );
        const headers = new Headers(response.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      },
    });
    try {
      await writeFile(
        join(root, "connection.json"),
        JSON.stringify({
          env,
          url: `http://127.0.0.1:${proxy.port}`,
          project,
          sessionId: parent.id,
          ids,
        }),
        { mode: 0o600 },
      );
      const tty = Bun.spawn(
        [
          "python3",
          resolve("scripts/fixtures/metrics-tui.py"),
          join(root, "connection.json"),
        ],
        { stdout: "inherit", stderr: "inherit" },
      );
      children.add(tty);
      assert.equal(await tty.exited, 0, "actual PTY TUI checks");
    } finally {
      proxy.stop(true);
    }
  }
  contextTokens = undefined;
  await stop();
  await config(false);
  ({ client, url } = await start());
  history = await client
    .rpc(historyRpc)
    .read({ ...input, to: Date.now() }, { location });
  assert.ok(
    isHistoryResult(history) &&
      !history.enabled &&
      history.data.series.length === 0,
  );
  console.log("PASS: disabled history");
  await stop();
  enforcing = true;
  enforceTools = 12;
  await config(true, true);
  ({ client, url } = await start());
  const compaction = Bun.spawn(["bun", "run", "test:live"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GUARD_SERVER_URL: url,
      GUARD_TEST_DIRECTORY: project,
      GUARD_TEST_MODEL: "synthetic/alpha",
      GUARD_AUTHORIZATION: authorization,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.add(compaction);
  const compactionOutput = new Response(compaction.stdout).text();
  const compactionErrors = new Response(compaction.stderr).text();
  const compactionCode = await compaction.exited;
  const compactLog = await compactionOutput;
  if (compactionCode !== 0) console.log(compactLog.trim());
  assert.equal(compactionCode, 0, await compactionErrors);
  assert.ok(compactLog.includes("PASS:"));
  const journal = await readFile(join(root, "diagnostics.jsonl"), "utf8");
  assert.ok(
    !journal.includes(secret) && !journal.includes(env.OPENCODE_PASSWORD),
  );
  const finalHistory = await readPerformanceHistory(archive);
  assert.ok(
    !JSON.stringify(finalHistory).includes(secret),
    "compaction summaries and tool payloads stay out of history",
  );
  assert.ok(
    journal.includes('"type":"compaction.requesting"'),
    "plugin-caused admission provenance",
  );
  console.log(compactLog.trim());
  console.log(
    `PASS: synthetic-provider compaction completed and continued; provider requests: ${providerRequests}. No genuine provider exercised.`,
  );
} finally {
  for (const child of children)
    if (child.exitCode === null) child.kill("SIGTERM");
  const force = setTimeout(() => {
    for (const child of children)
      if (child.exitCode === null) child.kill("SIGKILL");
  }, 3000);
  try {
    await Promise.all([...children].map((child) => child.exited));
    await stop();
  } finally {
    clearTimeout(force);
    provider.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}
