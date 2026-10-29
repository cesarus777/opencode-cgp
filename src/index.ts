import { Plugin } from "@opencode/plugin";
import { setup } from "./adapter.ts";
import type { TelemetrySink } from "./types.ts";
export default Plugin.define({
  id: "context-guard",
  setup: (ctx, injectedSink?: TelemetrySink) =>
    setup({ ...ctx, historyRpc: ctx.rpc, analyticsRpc: ctx.rpc }, injectedSink),
});
