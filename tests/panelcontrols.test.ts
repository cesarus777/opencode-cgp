import { expect, test } from "bun:test";
import { inventoryStatus, type Inventory } from "../src/tui/inventory.ts";
import { inventoryMessages, footerActions } from "../src/tui/panelcontrols.ts";
import { cells } from "../src/tui/format.ts";
import { session } from "./fixtures/session.ts";

function inventory(
  count: number,
  pending: boolean,
  damaged = false,
): Inventory {
  return {
    sessions: new Map(
      Array.from({ length: count }, (_, i) => [String(i), session(String(i))]),
    ),
    complete: !pending && !damaged,
    rootId: "0",
    pages: 100,
    pending: pending ? [{ id: "0", depth: 0, cursors: [] }] : [],
    scanned: new Set(),
    damaged,
  };
}

test("inventory feedback distinguishes scanning, resumable work, hard bounds, and incomplete discovery", () => {
  const initial = inventoryStatus(undefined, 1024, true, false);
  expect(initial.canLoadMore).toBe(false);
  expect(inventoryMessages(initial)).toEqual(["Discovering agents · 0 found"]);
  const capped = inventoryStatus(inventory(1024, true), 1024, false, false);
  expect(capped.canLoadMore).toBe(true);
  expect(inventoryMessages(capped).join(" ")).toContain(
    "load more allows 2048",
  );
  const maximum = inventoryStatus(inventory(2048, true), 2048, false, false);
  expect(maximum.canLoadMore).toBe(false);
  expect(inventoryMessages(maximum)).toEqual([
    "Partial family · 2048-node limit reached",
  ]);
  const damaged = inventoryStatus(inventory(2, true, true), 2048, false, false);
  expect(damaged.canLoadMore).toBe(true);
  expect(inventoryMessages(damaged)).toHaveLength(2);
  const complete = inventoryStatus(inventory(2, false), 1024, false, false);
  expect(complete.complete).toBe(true);
  expect(complete.canLoadMore).toBe(false);
  expect(inventoryMessages(complete)).toEqual([]);
  const failed = inventoryStatus(inventory(2, false), 1024, false, true);
  expect(failed.complete).toBe(false);
  expect(inventoryMessages(failed).join(" ")).toContain("refresh to rescan");
});

test("footer reserves essential controls and fits complete cell-aware action targets", () => {
  const action = (id: string, label: string) => ({ id, label, run() {} });
  const essentials = [action("help", "? help"), action("close", "q close")];
  const optional = [
    action("details", "i details"),
    action("charts", "c charts"),
    action("branch", "研究 👩‍💻"),
  ];
  for (const width of [16, 20, 35, 80]) {
    const actions = footerActions(essentials, optional, width);
    expect(actions.slice(0, 2)).toEqual(essentials);
    expect(cells(actions.map((a) => a.label).join(" "))).toBeLessThanOrEqual(
      width,
    );
  }
  expect(footerActions(essentials, optional, 16)).toEqual(essentials);
});
