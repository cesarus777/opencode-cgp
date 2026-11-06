import { createEffect, createMemo, onCleanup } from "solid-js";
import type { Plugin } from "@opencode/plugin/tui";
import type { GuardState } from "./state.ts";
import { CompactSidebar } from "./compact.tsx";

export function GuardView(props: {
  sessionID: string;
  state: GuardState;
  context: Plugin.Context;
  width: number;
}) {
  const consumer = props.state.acquire(props.sessionID);
  createEffect(() => consumer.update(props.sessionID));
  onCleanup(() => consumer.release());
  const rows = createMemo(() => props.state.rows([], true));
  return (
    <CompactSidebar
      sessionID={props.sessionID}
      state={props.state}
      context={props.context}
      rows={rows()}
      width={props.width}
    />
  );
}
