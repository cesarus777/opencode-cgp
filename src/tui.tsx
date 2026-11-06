import { Plugin } from "@opencode/plugin/tui";
import { Show } from "solid-js";
import { createGuardState } from "./tui/state.ts";
import { GuardView } from "./tui/sidebar.tsx";
import { GuardPanel } from "./tui/panel.tsx";
export default Plugin.define({
  id: "context-guard",
  setup(context) {
    const openShortcut: unknown = context.options.openShortcut;
    if (
      openShortcut !== undefined &&
      (typeof openShortcut !== "string" ||
        !openShortcut.trim() ||
        openShortcut.length > 128 ||
        /[\x00-\x1f\x7f-\x9f]/.test(openShortcut))
    ) {
      throw new Error(
        "Context Guard openShortcut must be a nonempty key sequence of at most 128 characters.",
      );
    }
    if (
      typeof context.client?.rpc !== "function" ||
      typeof context.ui?.slot !== "function" ||
      typeof context.ui?.panel?.open !== "function" ||
      typeof context.keymap?.layer !== "function" ||
      typeof context.keymap?.shortcuts !== "function"
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
      // The host's child composer occupies its own input mode and hides the
      // normal prompt/palette shortcuts. Keep panel access on the child route.
      unregister.push(
        context.ui.slot({
          append: "session.composer.top",
          render: (input) => (
            <Show when={context.data.session.get(input.sessionID)?.parentID}>
              <text
                fg={context.theme.text.muted}
                onMouseDown={() =>
                  context.ui.panel.open("context-guard.monitor")
                }
              >
                {`Context Guard: open panel${context.keymap.shortcuts("context-guard.show").length ? ` (${context.keymap.shortcuts("context-guard.show").join(" / ")})` : ""}`}
              </text>
            </Show>
          ),
        }),
      );
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "context-guard.show",
            title: "Open Context Guard",
            group: "Context Guard",
            palette: true,
            ...(typeof openShortcut === "string" ? { bind: openShortcut } : {}),
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
