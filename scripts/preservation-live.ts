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

const binary =
  process.argv[2] ?? process.env.GUARD_SYNTHETIC_BINARY ?? "opencode";
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
let failGeneration = false;
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
      if (
        failGeneration &&
        JSON.stringify(body).includes(
          "Summarize the following intermediate conversation",
        )
      )
        return Response.json(
          {
            error: {
              message: "Synthetic generation unavailable",
              type: "invalid_request_error",
            },
          },
          { status: 400 },
        );
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
        lastContent.includes(
          "Summarize the following intermediate conversation",
        ) ||
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
      if (body.stream === false)
        return Response.json({
          id: `synthetic-${responseId}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Intermediate work summarized.",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 5 },
        });
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
          await Bun.sleep(20);
          chunk({ role: "assistant", reasoning_content: secret });
          for (let i = 0; i < 8; i++) {
            await Bun.sleep(10);
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
    [binary, "serve", "--hostname", "127.0.0.1", "--port", "0"],
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
  const version = Bun.spawnSync([binary, "--version"], {
    cwd: project,
    env,
  }).stdout.toString();
  assert.match(version, /opencode v2\.(?:0\.29|1\.2)\s*$/);
  console.log(version.trim());
  if (version.includes("v2.1.2"))
    providerPackage = "@opencode/ai/providers/openai-compatible";
  await config();
  let { client } = await start();
  const location = { directory: project };
  const session = await client.session.create({
    location,
    model: { providerID: "synthetic", id: "alpha" },
  });
  const read = async () => {
    const result = await client
      .rpc(performanceRpc)
      .read({ schemaVersion: 1, sessionIds: [session.id] }, { location });
    assert.ok(isPerformanceResult(result));
    return result.upserts[0];
  };
  async function prompt(text: string) {
    await client.session.prompt({ sessionID: session.id, text });
    await waitFor(
      async () =>
        (await client.session.context({ sessionID: session.id })).some(
          (m) => m.type === "user" && m.text === text,
        ),
      "prompt recorded",
    );
    await waitFor(async () => {
      const messages = await client.session.context({ sessionID: session.id });
      const userIndex = messages.findLastIndex(
        (m) => m.type === "user" && m.text === text,
      );
      return messages
        .slice(userIndex + 1)
        .some(
          (m) =>
            m.type === "assistant" &&
            m.finish === "stop" &&
            m.time.completed !== undefined,
        );
    }, "answer completed");
  }
  const original = "Original request — exact\n请求🙂 " + secret;
  await prompt(original);
  await prompt("Latest request\n" + secret);
  for (let i = 0; i < 2; i++) {
    const before = (await read())?.compaction.count ?? 0;
    await client.session.compact({ sessionID: session.id });
    await waitFor(
      async () => ((await read())?.compaction.count ?? 0) > before,
      "custom compaction completion",
    );
    const messages = await client.session.context({ sessionID: session.id });
    const checkpoint = messages.findLast(
      (m) => m.type === "compaction" && m.status === "completed",
    );
    assert.ok(
      checkpoint?.type === "compaction" && checkpoint.status === "completed",
    );
    assert.ok(
      checkpoint.summary.includes(original),
      "verbatim original in checkpoint",
    );
    assert.ok(
      checkpoint.metadata?.guardPreservation,
      "versioned native metadata",
    );
    await prompt("Continue after checkpoint " + i);
    await waitFor(
      async () => (await read())?.compaction.verification?.tokens !== "pending",
      "token verification",
    );
    const verification = (await read())?.compaction.verification;
    assert.equal(verification?.protection, "verified");
    assert.equal(verification.tokens, "verified");
    console.log(
      "PASS: exact checkpoint, assembled context, provider target, continuation " +
        i,
    );
    if (i === 0) {
      await stop();
      ({ client } = await start());
      console.log("PASS: host restart between compactions");
    }
  }
  // Native pending work continues after a custom checkpoint; do not protect an unfinished tool call.
  toolNext = true;
  await client.session.prompt({
    sessionID: session.id,
    text: "Pending tool request " + secret,
  });
  await waitFor(
    async () =>
      (await client.session.context({ sessionID: session.id })).some(
        (m) =>
          m.type === "assistant" && m.content.some((p) => p.type === "tool"),
      ),
    "tool interaction",
  );
  const beforePending = (await read())?.compaction.count ?? 0;
  await client.session.compact({ sessionID: session.id });
  await waitFor(
    async () => ((await read())?.compaction.count ?? 0) > beforePending,
    "compaction with pending work",
  );
  await waitFor(
    async () =>
      (await read())?.compaction.verification?.protection === "verified",
    "native continuation after checkpoint",
  );
  console.log("PASS: custom compaction with native tool continuation");
  contextTokens = 140000;
  await prompt("Measure above target " + secret);
  // This measurement may follow the automatic continuation; use a new compaction to capture the next request.
  const beforeHigh = (await read())?.compaction.count ?? 0;
  await client.session.compact({ sessionID: session.id });
  await waitFor(
    async () => ((await read())?.compaction.count ?? 0) > beforeHigh,
    "target compaction",
  );
  await prompt("Measure high after compaction " + secret);
  await waitFor(
    async () => (await read())?.compaction.verification?.tokens === "failed",
    "target warning",
  );
  assert.ok(
    (await read())?.compaction.verification?.warnings.includes(
      "token-target-exceeded",
    ),
  );
  console.log("PASS: above-target warning from provider usage");
  failGeneration = true;
  const beforeFallback = (await read())?.compaction.count ?? 0;
  await client.session.compact({ sessionID: session.id });
  await waitFor(
    async () => ((await read())?.compaction.count ?? 0) > beforeFallback,
    "native fallback completion",
  );
  assert.ok(
    (await read())?.compaction.verification?.warnings.includes(
      "preservation-fallback",
    ),
  );
  console.log(
    "PASS: generation failure falls back to native compaction with explicit warning",
  );
  const journal = await readFile(join(root, "diagnostics.jsonl"), "utf8");
  assert.ok(
    !journal.includes(secret),
    "no protected text or summary in diagnostics",
  );
  console.log(
    "PASS: synthetic preservation validation; genuine provider unverified",
  );
} finally {
  await stop();
  provider.stop(true);
  if (process.env.GUARD_KEEP_VALIDATION) console.log("Artifacts: " + root);
  else await rm(root, { recursive: true, force: true });
}
