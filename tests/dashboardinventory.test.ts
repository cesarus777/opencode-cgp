import { expect, test } from "bun:test";
import { discoverInventory } from "../src/dashboard/inventory.ts";
import type { DashboardPort, DashboardSession } from "../src/dashboard/port.ts";

const node = (sessionId: string, parentId?: string): DashboardSession => ({
  sessionId,
  directory: "/project",
  ...(parentId ? { parentId } : {}),
});
function inventoryPort(
  sessions: readonly DashboardSession[],
  repeated = false,
) {
  const calls: { parent?: string | null; cursor?: string }[] = [];
  const port: Pick<DashboardPort, "location" | "listSessions"> = {
    location: { directory: "/project" },
    async listSessions(input) {
      calls.push({
        ...(input.parentID === undefined ? {} : { parent: input.parentID }),
        ...(input.cursor ? { cursor: input.cursor } : {}),
      });
      const rows = sessions.filter(
        (session) => (session.parentId ?? null) === input.parentID,
      );
      const offset = Number(input.cursor ?? 0);
      return {
        data: rows.slice(offset, offset + 100),
        cursor: {
          next: repeated
            ? "0"
            : rows.length > offset + 100
              ? String(offset + 100)
              : null,
        },
      };
    },
  };
  return { port, calls };
}
test("dashboard inventory paginates roots and discovers concurrent children within the explicit page budget", async () => {
  const { port, calls } = inventoryPort([
    ...Array.from({ length: 101 }, (_, i) => node(`root-${i}`)),
    node("child-a", "root-0"),
    node("child-b", "root-0"),
    node("grandchild", "child-a"),
  ]);
  const result = await discoverInventory(port, new AbortController().signal);
  expect(result.sessions.length).toBe(103);
  expect(
    calls.some((call) => call.parent === null && call.cursor === "100"),
  ).toBe(true);
  expect(result.complete).toBe(false);
  expect(result.notices).toContain("page-limit");
  expect(result.pages).toBe(100);
});
test("dashboard inventory completes a small forest and enforces node, depth and repeated-cursor limits", async () => {
  const { port } = inventoryPort([
    node("root"),
    node("other"),
    node("child", "root"),
    node("nested", "child"),
  ]);
  const result = await discoverInventory(port, new AbortController().signal);
  expect(result.complete).toBe(true);
  expect(result.sessions.length).toBe(4);
  const capped = await discoverInventory(port, new AbortController().signal, {
    maxNodes: 2,
    maxPages: 100,
    maxDepth: 64,
  });
  expect(capped.sessions.length).toBe(2);
  expect(capped.notices).toContain("node-limit");
  const deep = await discoverInventory(port, new AbortController().signal, {
    maxNodes: 1024,
    maxPages: 100,
    maxDepth: 1,
  });
  expect(deep.sessions.some((row) => row.sessionId === "nested")).toBe(false);
  expect(deep.notices).toContain("depth-limit");
  const repeated = await discoverInventory(
    inventoryPort([node("root")], true).port,
    new AbortController().signal,
  );
  expect(repeated.notices).toContain("repeated-cursor");
  expect(repeated.pages).toBeLessThan(10);
});
test("dashboard inventory marks API failures, foreign locations and incorrect parent edges partial", async () => {
  const port: Pick<DashboardPort, "location" | "listSessions"> = {
    location: { directory: "/project" },
    async listSessions(input) {
      if (input.parentID === "root") throw new Error("private-canary");
      return {
        data: [
          node("root"),
          { ...node("foreign"), directory: "/other" },
          node("wrong-parent", "missing"),
        ],
      };
    },
  };
  const result = await discoverInventory(port, new AbortController().signal);
  expect(result.sessions.map((row) => row.sessionId)).toEqual(["root"]);
  expect(result.complete).toBe(false);
  expect(result.notices).toEqual([
    "foreign-location",
    "invalid-hierarchy",
    "inventory-unavailable",
  ]);
  expect(JSON.stringify(result)).not.toContain("private-canary");
});
test("dashboard inventory aborts obsolete scans and rejects unbounded limits", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    discoverInventory(inventoryPort([]).port, abort.signal),
  ).rejects.toThrow();
  await expect(
    discoverInventory(inventoryPort([]).port, new AbortController().signal, {
      maxNodes: 100000,
      maxPages: 100,
      maxDepth: 64,
    }),
  ).rejects.toThrow("Invalid dashboard inventory limits");
});
