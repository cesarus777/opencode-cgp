// Copied into a clean tarball consumer; never imports checkout files.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import plugin from "@cesarus777/opencode-cgp";
import server from "@cesarus777/opencode-cgp/server";
import { parseConfig, aggregateModels } from "@cesarus777/opencode-cgp/core";
import { monitorRpc } from "@cesarus777/opencode-cgp/rpc";
import { Host } from "@opencode/plugin/host";
assert.equal(plugin.id, "context-guard");
assert.equal(typeof plugin.setup, "function");
assert.equal(server, plugin);
assert.deepEqual(aggregateModels([], { location: "package-test" }).models, []);
assert.equal(monitorRpc.id, "context-guard.monitor.v1");
assert.ok(!existsSync("node_modules/solid-js"));
const entries = Host.resolve({
  directory: process.cwd(),
  name: "@cesarus777/opencode-cgp",
});
for (const [name, entry] of Object.entries(entries)) {
  assert.ok(
    entry?.includes("/node_modules/@cesarus777/opencode-cgp/dist/"),
    name,
  );
  if (name !== "tui") await Host.load(entry);
}
for (const mode of ["observe", "enforce"] as const) {
  const config = parseConfig({
    mode,
    defaults: { threshold: { type: "tokens", value: 131072 } },
  });
  assert.equal(config.mode, mode);
}
console.log(
  "PASS: V2 package resolver, server/core/RPC imports without renderer peers, configuration",
);
