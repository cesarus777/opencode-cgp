import { test, expect } from "bun:test";
import type { OpenCodeClient, SessionInfo } from "@opencode/client";
import { discoverFamily } from "../src/tui/inventory.ts";
import { session } from "./fixtures/session.ts";

function client(nodes: SessionInfo[], repeat = false) {
  const calls: { parentID?: string | null; cursor?: string }[] = [];
  const port: Pick<OpenCodeClient, "session"> = {
    session: {
      get: async ({ sessionID }) => {
        const s = nodes.find((n) => n.id === sessionID);
        if (!s) throw new Error("missing");
        return s;
      },
      list: async (input) => {
        calls.push({
          ...(input?.parentID === undefined
            ? {}
            : { parentID: input.parentID }),
          ...(input?.cursor ? { cursor: input.cursor } : {}),
        });
        const found = nodes.filter((n) => n.parentID === input?.parentID),
          offset = Number(input?.cursor ?? 0);
        return {
          data: found.slice(offset, offset + 100),
          cursor: {
            next: repeat
              ? "0"
              : found.length > offset + 100
                ? String(offset + 100)
                : null,
          },
        };
      },
    } as OpenCodeClient["session"],
  };
  return { port, calls };
}
test("discovery follows ancestors, every paginated child and grandchildren via public list", async () => {
  const nodes = [
    session("r"),
    ...Array.from({ length: 105 }, (_, i) => session(`c${i}`, "r")),
    session("g", "c0"),
    session("gg", "g"),
  ];
  const { port, calls } = client(nodes),
    result = await discoverFamily(
      port,
      "gg",
      new AbortController().signal,
      () => undefined,
    );
  expect(result.rootId).toBe("r");
  expect(result.sessions.size).toBe(108);
  expect(result.complete).toBe(false); // 100-page work cap is explicit.
  expect(calls.find((c) => c.cursor === "100")?.parentID).toBe("r");
});
test("small nested family is complete; forks do not become children", async () => {
  const fork = {
    ...session("fork"),
    fork: { sessionID: "r", boundary: { type: "message", messageID: "m" } },
  };
  const { port } = client([
    session("r"),
    session("c", "r"),
    session("g", "c"),
    session("gg", "g"),
    session("fork"),
  ]);
  void fork;
  const result = await discoverFamily(
    port,
    "gg",
    new AbortController().signal,
    () => undefined,
  );
  expect(result.complete).toBe(true);
  expect(result.sessions.has("fork")).toBe(false);
  expect(result.sessions.size).toBe(4);
});
test("repeated cursors, missing parent, cycles and node caps report partial inventory", async () => {
  const repeated = client([session("r"), session("c", "r")], true);
  expect(
    (
      await discoverFamily(
        repeated.port,
        "r",
        new AbortController().signal,
        () => undefined,
      )
    ).complete,
  ).toBe(false);
  const orphan = client([session("o", "missing")]);
  expect(
    (
      await discoverFamily(
        orphan.port,
        "o",
        new AbortController().signal,
        () => undefined,
      )
    ).complete,
  ).toBe(false);
  const capped = client([
    session("r"),
    ...Array.from({ length: 20 }, (_, i) => session(String(i), "r")),
  ]);
  const result = await discoverFamily(
    capped.port,
    "r",
    new AbortController().signal,
    () => undefined,
    5,
  );
  expect(result.complete).toBe(false);
  expect(result.sessions.size).toBe(5);
});

test("load more resumes the pending breadth-first work instead of rescanning the first hundred leaves", async () => {
  const { port, calls } = client([
    session("r"),
    ...Array.from({ length: 220 }, (_, i) => session(`child${i}`, "r")),
  ]);
  const signal = new AbortController().signal;
  let result = await discoverFamily(port, "r", signal, () => undefined);
  expect(result.complete).toBe(false);
  const firstCount = calls.length;
  result = await discoverFamily(
    port,
    "r",
    signal,
    () => undefined,
    1024,
    result,
  );
  expect(calls.length - firstCount).toBeLessThanOrEqual(100);
  result = await discoverFamily(
    port,
    "r",
    signal,
    () => undefined,
    1024,
    result,
  );
  expect(result.complete).toBe(true);
  expect(result.sessions.size).toBe(221);
  expect(calls.filter((call) => call.parentID === "r").length).toBe(3);
});

test("a node cap can resume a partially consumed page without losing descendants", async () => {
  const { port } = client([
    session("r"),
    ...Array.from({ length: 20 }, (_, i) => session(`c${i}`, "r")),
  ]);
  const signal = new AbortController().signal;
  const first = await discoverFamily(port, "r", signal, () => undefined, 5);
  const next = await discoverFamily(
    port,
    "r",
    signal,
    () => undefined,
    30,
    first,
  );
  expect(next.complete).toBe(true);
  expect(next.sessions.size).toBe(21);
});
