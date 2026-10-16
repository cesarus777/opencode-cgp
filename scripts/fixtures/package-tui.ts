// The host preload supplies shared runtime modules to the installed JS entry.
import assert from "node:assert/strict";
import { testRender } from "@opentui/solid";
import { RGBA } from "@opentui/core";
import { createSignal } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { SlotClaim, KeymapLayer } from "@opencode/plugin/tui/context";
const { default: plugin } = await import("@cesarus777/opencode-cgp/tui");
const [parent, setParent] = createSignal("parent");
let renderAction: (() => import("@opentui/solid").JSX.Element) | undefined;
let layer: (() => KeymapLayer) | undefined;
let registrations = 0,
  opened = "";
const context = {
  app: { version: "2.0.29" },
  client: { rpc: () => ({}) },
  data: { session: { get: () => ({ parentID: parent() }) } },
  storage: { store: () => [{ expanded: [] }, async () => {}] },
  theme: { text: { muted: RGBA.fromHex("#aaaaaa") } },
  keymap: {
    layer(factory: () => KeymapLayer) {
      layer = factory;
    },
  },
  ui: {
    panel: {
      open(name: string) {
        opened = name;
        return true;
      },
    },
    slot(claim: SlotClaim) {
      registrations++;
      if (claim.append === "session.composer.top")
        renderAction = () => claim.render({ sessionID: "child" });
      return () => {
        registrations--;
      };
    },
  },
} as unknown as Plugin.Context;
assert.equal(plugin.id, "context-guard");
const dispose = await plugin.setup(context);
assert.equal(registrations, 3);
assert.equal(layer?.().mode, "global");
assert.ok(renderAction);
const host = await testRender(renderAction, { width: 40, height: 4 });
try {
  await host.renderOnce();
  assert.match(host.captureCharFrame(), /Context Guard: open panel/);
  await host.mockMouse.click(4, 0);
  assert.equal(opened, "context-guard.monitor");
  setParent("");
  await host.renderOnce();
  assert.doesNotMatch(host.captureCharFrame(), /Context Guard: open panel/);
} finally {
  host.renderer.destroy();
  if (typeof dispose === "function") await dispose();
}
assert.equal(registrations, 0);
console.log(
  "PASS: packed TUI initialization, native rendering, host Solid reactivity, click and disposal",
);
