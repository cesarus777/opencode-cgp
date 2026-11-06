import type { InventoryStatus } from "./inventory.ts";
import { cells } from "./format.ts";

export function inventoryMessages(status: InventoryStatus): string[] {
  if (status.scanning)
    return [`Discovering agents · ${status.discovered} found`];
  const lines: string[] = [];
  if (status.failed || status.damaged)
    lines.push("Family discovery incomplete · refresh to rescan");
  if (status.pending && status.discovered >= 2048)
    lines.push("Partial family · 2048-node limit reached");
  else if (status.canLoadMore)
    lines.push(
      status.discovered >= status.limit
        ? `Partial family · ${status.limit}-node limit · load more allows 2048`
        : "Partial family · load more available",
    );
  else if (!status.complete && !lines.length)
    lines.push("Family discovery incomplete · refresh to rescan");
  return lines;
}

export interface PanelAction {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
}

// Essential actions are chosen first; optional actions never wrap out of sight.
export function footerActions(
  essential: readonly PanelAction[],
  optional: readonly PanelAction[],
  width: number,
): PanelAction[] {
  const result: PanelAction[] = [];
  let used = 0;
  for (const action of [...essential, ...optional]) {
    const size = cells(action.label) + (result.length ? 1 : 0);
    if (used + size > width) continue;
    result.push(action);
    used += size;
  }
  return result;
}
