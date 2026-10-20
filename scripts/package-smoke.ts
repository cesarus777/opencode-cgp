import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  copyFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), "guard-package-"));
let commandNumber = 0;
async function run(command: string[], cwd = root): Promise<string> {
  const output = join(temporary, `${++commandNumber}.stdout`);
  const errors = join(temporary, `${commandNumber}.stderr`);
  console.log(`Checking: ${command.join(" ")}`);
  // File redirection also works on Bun 1.1.34 with newer Node subprocesses,
  // whose pipe output can otherwise be lost by that older Bun version.
  const child = Bun.spawn(command, {
    cwd,
    env: {
      ...process.env,
      NODE_PATH: "",
      NODE_OPTIONS: "",
      npm_config_cache: join(temporary, "npm-cache"),
      npm_config_foreground_scripts: "false",
      npm_config_fetch_retries: "0",
      npm_config_fetch_timeout: "20000",
    },
    stdout: Bun.file(output),
    stderr: Bun.file(errors),
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 180000);
  try {
    const code = await child.exited;
    const stdout = await readFile(output, "utf8");
    const stderr = await readFile(errors, "utf8");
    if (code !== 0)
      throw new Error(
        `${command.join(" ")} exited ${code}\n${stdout}\n${stderr}`,
      );
    if (stderr && command[0] === "bun") console.log(stderr.trim());
    return stdout;
  } finally {
    clearTimeout(deadline);
  }
}

try {
  // npm pack runs prepack, proving this works without existing dist artifacts.
  const packed: unknown = JSON.parse(
    await run(["npm", "pack", "--json", "--pack-destination", temporary]),
  );
  assert.ok(typeof packed === "object" && packed !== null);
  const packs: unknown[] = Object.values(packed);
  assert.equal(packs.length, 1);
  const pack = packs[0];
  assert.ok(typeof pack === "object" && pack !== null);
  assert.ok("filename" in pack && typeof pack.filename === "string");
  assert.ok("files" in pack && Array.isArray(pack.files));
  const packedFiles: unknown[] = pack.files;
  const paths = packedFiles.map((file) => {
    assert.ok(typeof file === "object" && file !== null && "path" in file);
    assert.ok(typeof file.path === "string");
    return file.path;
  });
  for (const path of paths) {
    assert.ok(
      /^(dist\/.*\.(js|d\.ts)|package\.json|README\.md|LICENSE)$/.test(path),
      `Unexpected published file: ${path}`,
    );
  }
  for (const entry of ["index", "core", "rpc", "tui"]) {
    assert.ok(paths.includes(`dist/${entry}.js`));
    assert.ok(paths.includes(`dist/types/${entry}.d.ts`));
  }
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    '{"private":true,"type":"module"}\n',
  );
  await run(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--omit=dev",
      "--omit=optional",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      join(temporary, pack.filename),
    ],
    consumer,
  );
  const installed = join(consumer, "node_modules/@cesarus777/opencode-cgp");
  assert.equal(
    (await lstat(installed)).isSymbolicLink(),
    false,
    "Installation must not link to the checkout",
  );
  for (const path of paths.filter((path) => path.startsWith("dist/"))) {
    const source = await readFile(join(installed, path), "utf8");
    assert.ok(!source.includes(root), `Checkout path in ${path}`);
    assert.ok(
      !/(?:from\s*|import\s*\()["']\.{1,2}\/[^"']*\.(?:ts|tsx)["']/.test(
        source,
      ),
      `Source import in ${path}`,
    );
  }
  await copyFile(
    join(root, "scripts/fixtures/package-server.ts"),
    join(consumer, "server.ts"),
  );
  console.log(await run(["bun", "server.ts"], consumer));
  if (process.env.GUARD_PACKAGE_HOST === "1") {
    await copyFile(
      join(root, "scripts/fixtures/package-live.ts"),
      join(consumer, "live.ts"),
    );
    console.log(await run(["bun", "live.ts"], consumer));
  }
  // Reuse the behavioral suite against the packed default export, including
  // observe/enforce, nested children, compaction lifecycle and recovery.
  const adapter = (await readFile(join(root, "tests/adapter.test.ts"), "utf8"))
    .replace('"../src/rpc.ts"', '"@cesarus777/opencode-cgp/rpc"')
    .replace(
      'import { setup, type Host } from "../src/adapter.ts";',
      'import plugin from "@cesarus777/opencode-cgp"; const setup = plugin.setup;',
    )
    .replace(/import type \{[^}]*\} from "\.\.\/src\/[^";]+";/g, "");
  await writeFile(join(consumer, "adapter.test.ts"), adapter);
  console.log(await run(["bun", "test", "adapter.test.ts"], consumer));
  // The shipped CLI can generate offline charts without renderer peers.
  const archive = join(consumer, "chart-history");
  await mkdir(archive);
  await writeFile(
    join(archive, "1000-12345678-abcd.jsonl"),
    JSON.stringify({
      schema: 1,
      recordId: "sample",
      type: "sample",
      sessionId: "chart-session",
      time: 1000,
      performance: {
        sessionCreatedAt: 0,
        observedSince: 0,
        at: 1000,
        status: "streaming",
        partial: false,
        liveTps: 10,
        estimatedOutputTokens: 10,
        modelOutputTokens: 0,
        modelDurationMs: 0,
        completedRequests: 0,
        tokenSource: "estimated",
      },
    }) + "\n",
  );
  const report = join(consumer, "charts.html");
  console.log(
    await run(
      [
        "bun",
        join(installed, "dist/cli.js"),
        "charts",
        archive,
        "--output",
        report,
      ],
      consumer,
    ),
  );
  assert.ok(
    (await readFile(report, "utf8")).includes('"sessionId":"chart-session"'),
  );
  // Install host modules only after verifying the renderer-free server. Keep
  // host module versions aligned with the repository's tested V2 fixture.
  await run(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "solid-js@1.9.15",
      "@opentui/core@0.5.17",
      "@opentui/solid@0.5.17",
      "@opencode/theme@2.0.29",
    ],
    consumer,
  );
  await writeFile(
    join(consumer, "tui.js"),
    new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(
      await readFile(join(root, "scripts/fixtures/package-tui.ts"), "utf8"),
    ),
  );
  console.log(
    await run(
      [
        "bun",
        "--conditions=browser",
        "--preload",
        "@opentui/solid/runtime-plugin-support",
        "tui.js",
      ],
      consumer,
    ),
  );
  await writeFile(
    join(consumer, "types.ts"),
    `import plugin from "@cesarus777/opencode-cgp";
import server from "@cesarus777/opencode-cgp/server";
import { parseConfig, type Config } from "@cesarus777/opencode-cgp/core";
import { monitorRpc } from "@cesarus777/opencode-cgp/rpc";
import tui from "@cesarus777/opencode-cgp/tui";
const config: Config = parseConfig({mode:"observe"});
[plugin.id, server.setup, monitorRpc.id, tui.setup, config];\n`,
  );
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        target: "ES2023",
        module: "Preserve",
        moduleResolution: "Bundler",
      },
      files: ["types.ts"],
    }),
  );
  console.log(
    await run(
      [
        "bun",
        resolve("node_modules/typescript/bin/tsc"),
        "-p",
        "tsconfig.json",
      ],
      consumer,
    ),
  );
  console.log(
    `PASS: ${paths.length} allowlisted files; clean server, all exports, behavioral suite, host-shared native TUI and consumer declarations.`,
  );
} catch (error) {
  const diagnostics = join(root, ".artifacts");
  await mkdir(diagnostics, { recursive: true });
  await writeFile(join(diagnostics, "package-smoke.log"), String(error));
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
