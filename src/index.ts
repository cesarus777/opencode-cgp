import { Plugin } from "@opencode/plugin";
import { setup } from "./adapter.ts";
export default Plugin.define({ id: "context-guard", setup });
