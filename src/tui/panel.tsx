import type { ScrollBoxRenderable } from "@opentui/core";
import type { Plugin } from "@opencode/plugin/tui";
import type { PanelInput } from "@opencode/plugin/tui/context";
import { createSignal, createMemo, createEffect, onCleanup } from "solid-js";
import type { GuardState } from "./state.ts";
import { GuardView } from "./sidebar.tsx";
export function GuardPanel(props: {
  input: PanelInput;
  state: GuardState;
  context: Plugin.Context;
}) {
  const [inspectId, setInspectId] = createSignal<string>();
  const [selected, setSelected] = createSignal(props.input.sessionID);
  const [order, setOrder] = createSignal<readonly string[]>([]);
  const rows = createMemo(() => props.state.rows(order()));
  const offset = () =>
    Math.max(
      0,
      rows().findIndex((row) => row.node.sessionId === selected()),
    );
  createEffect(() => {
    if (!props.input.focused) setOrder([]);
  });
  createEffect(() => {
    setSelected(props.input.sessionID);
    setOrder([]);
  });
  let scroll: ScrollBoxRenderable | undefined;
  let follow: ((deltaTime: number) => Promise<void>) | undefined;
  function revealSelection() {
    if (follow) props.context.renderer.removeFrameCallback(follow);
    let frames = 0;
    follow = async () => {
      scroll?.scrollChildIntoView(`context-guard.row.${selected()}`);
      if (++frames >= 2 && follow) {
        props.context.renderer.removeFrameCallback(follow);
        follow = undefined;
      } else props.context.renderer.requestRender();
    };
    props.context.renderer.setFrameCallback(follow);
    props.context.renderer.requestRender();
  }
  onCleanup(() => {
    if (follow) props.context.renderer.removeFrameCallback(follow);
  });
  function move(delta: number) {
    setOrder(rows().map((row) => row.node.sessionId));
    const row =
      rows()[Math.max(0, Math.min(rows().length - 1, offset() + delta))];
    if (row) {
      setSelected(row.node.sessionId);
      revealSelection();
    }
  }
  props.context.keymap.layer(() => ({
    enabled: () => props.input.focused,
    commands: [
      {
        id: "context-guard.inspect",
        title: "Inspect selected session",
        bind: "i",
        run: () =>
          setInspectId(inspectId() === selected() ? undefined : selected()),
      },
      {
        id: "context-guard.refresh",
        title: "Refresh Context Guard",
        bind: "r",
        run: () => {
          setOrder([]);
          props.state.refresh();
        },
      },
      {
        id: "context-guard.load-more",
        title: "Load more family",
        bind: "l",
        run: () => props.state.loadMore(),
      },
      {
        id: "context-guard.next",
        bind: "down",
        run: () => move(1),
      },
      {
        id: "context-guard.previous",
        bind: "up",
        run: () => move(-1),
      },
      {
        id: "context-guard.expand",
        bind: "space",
        run: () => {
          const row = rows()[offset()];
          if (row) props.state.expand(row.node.sessionId);
        },
      },
      {
        id: "context-guard.open",
        bind: "return",
        run: () => {
          const row = rows()[offset()];
          if (row) {
            props.input.close();
            props.context.ui.router.navigate({
              type: "session",
              sessionID: row.node.sessionId,
            });
          }
        },
      },
    ],
  }));
  return (
    <scrollbox
      ref={(value) => {
        scroll = value;
      }}
      flexGrow={1}
    >
      <GuardView
        sessionID={props.input.sessionID}
        state={props.state}
        context={props.context}
        width={Math.max(10, props.input.width - 4)}
        expanded
        family={rows()}
        selectedId={selected()}
        inspectId={inspectId()}
      />
      <text fg={props.context.theme.text.muted}>r refresh / l load more</text>
      <text fg={props.context.theme.text.muted}>
        up/down select {offset() + 1}; Enter open
      </text>
      <text fg={props.context.theme.text.muted}>
        space expand / i inspect selected
      </text>
      <text fg={props.context.theme.text.muted}>
        Guard input = prompt + caches.
      </text>
      <text fg={props.context.theme.text.muted}>
        Native Context uses different totals.
      </text>
    </scrollbox>
  );
}
