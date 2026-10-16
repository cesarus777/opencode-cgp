import { Plugin } from "@opencode/plugin/tui";
import { Show } from "solid-js";
import { createGuardState } from "./tui/state.ts";
import { GuardView } from "./tui/sidebar.tsx";
import { GuardPanel } from "./tui/panel.tsx";
export default Plugin.define({
  id: "context-guard",
  setup(context) {
    if (
      typeof context.client?.rpc !== "function" ||
      typeof context.ui?.slot !== "function" ||
      typeof context.ui?.panel?.open !== "function" ||
      typeof context.keymap?.layer !== "function"
    ) {
      throw new Error(
        "Context Guard TUI requires OpenCode 2.0.29 public RPC and panel APIs; use the Guard inspect CLI on unsupported hosts.",
      );
    }
    const state = createGuardState(context),
      unregister: (() => void)[] = [];
    try {
      unregister.push(
        context.ui.slot({
          append: "sidebar.content",
          render: (input) => (
            <GuardView
              sessionID={input.sessionID}
              state={state}
              context={context}
              width={35}
            />
          ),
        }),
      );
      unregister.push(
        context.ui.slot({
          append: "session.panel",
          render: (input) => (
            <Show when={input.name === "context-guard.monitor"}>
              <GuardPanel input={input} state={state} context={context} />
            </Show>
          ),
        }),
      );
      context.keymap.layer(() => ({
        commands: [
          {
            id: "context-guard.show",
            title: "Open Context Guard",
            group: "Context Guard",
            palette: true,
            bind: false,
            slash: { name: "context-guard" },
            run: () => {
              context.ui.panel.open("context-guard.monitor");
            },
          },
        ],
      }));
    } catch (error) {
      for (const dispose of unregister.reverse()) dispose();
      state.dispose();
      throw error;
    }
    return () => {
      for (const dispose of unregister.reverse()) dispose();
      state.dispose();
    };
  },
});
