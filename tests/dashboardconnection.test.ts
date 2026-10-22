import { expect, test } from "bun:test";
import { Service } from "@opencode/client/service";
import { connectDashboard } from "../src/dashboard/connection.ts";
import { SnapshotStore } from "../src/snapshot.ts";
import { parseConfig } from "../src/config.ts";
import { buildChartData } from "../src/charts.ts";
import type { HistoryChartResult } from "../src/historycharts.ts";

const signal = () => AbortSignal.timeout(3000);
const snapshot = () =>
  new SnapshotStore(parseConfig({ enabled: false }), () => new Map()).read({
    schemaVersion: 1,
    sessionIds: [],
  });
function network(handler: (request: Request) => Response | Promise<Response>) {
  return {
    ...Service,
    fetch: Object.assign(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        return handler(new Request(input, init));
      },
      { preconnect: fetch.preconnect },
    ),
  };
}

test("dashboard discovers an existing service without starting one and keeps credentials private", async () => {
  let discovered = false;
  const connection = await connectDashboard(
    { directory: "/project" },
    {
      discover: async () => {
        discovered = true;
        return {
          url: "http://127.0.0.1:1234",
          auth: {
            type: "basic",
            username: "opencode",
            password: "private-canary",
          },
        };
      },
      headers: Service.headers,
    },
  );
  expect(discovered).toBe(true);
  expect(JSON.stringify(connection)).toBe(
    '{"location":{"directory":"/project"}}',
  );
  await expect(
    connectDashboard(
      { directory: "/project" },
      { discover: async () => undefined, headers: Service.headers },
    ),
  ).rejects.toThrow("No compatible local");
});

test("dashboard rejects credential URLs, insecure remote URLs and implicit locations without echoing secrets", async () => {
  for (const server of [
    "http://user:private-canary@localhost",
    "https://example.com/?password=private-canary",
    "http://example.com",
    "file:///tmp/private-canary",
  ])
    await expect(
      connectDashboard({ directory: "/project", server }),
    ).rejects.toThrow("without credentials");
  await expect(connectDashboard({ directory: "relative" })).rejects.toThrow(
    "absolute path",
  );
  await expect(
    connectDashboard({ directory: "/project", password: "private-canary" }),
  ).rejects.toThrow("Explicit credentials require");
});

test("dashboard scopes SDK reads, negotiates v1 and filters changed events by location", async () => {
  const calls: {
    path: string;
    body: Record<string, unknown> | undefined;
    search: URLSearchParams;
  }[] = [];
  const value = snapshot();
  const runtime = network(async (request) => {
    expect(request.headers.get("authorization")).toBe(
      `Basic ${btoa("opencode:private-canary")}`,
    );
    const url = new URL(request.url);
    const body: Record<string, unknown> | undefined =
      request.method === "POST" ? await request.json() : undefined;
    calls.push({ path: url.pathname, body, search: url.searchParams });
    if (url.pathname === "/api/session")
      return Response.json({ data: [], cursor: { next: "second" } });
    if (url.pathname.startsWith("/api/rpc/")) {
      if (url.pathname.includes("context-guard.monitor.v2"))
        return new Response(null, { status: 404 });
      return Response.json({ output: value });
    }
    if (url.pathname === "/api/event") {
      const event = (directory: string, sequence: number) =>
        `data: ${JSON.stringify({ type: "rpc.context-guard.monitor.v1.changed", location: { directory }, data: { ...value, sequence } })}\n\n`;
      return new Response(event("/other", 7) + event("/project", 8), {
        headers: { "content-type": "text/event-stream" },
      });
    }
    return new Response(null, { status: 404 });
  });
  const connection = await connectDashboard(
    {
      directory: "/project",
      server: "http://127.0.0.1:1234",
      password: "private-canary",
    },
    runtime,
  );
  expect(
    (await connection.listSessions({ parentID: null, limit: 1 }, signal()))
      .cursor?.next,
  ).toBe("second");
  expect(
    (
      await connection.listSessions(
        { parentID: "root", cursor: "second" },
        signal(),
      )
    ).data,
  ).toEqual([]);
  expect(calls[0]?.search.get("directory")).toBe("/project");
  expect(calls[1]?.search.get("cursor")).toBe("second");
  const monitor = await connection.monitor(signal());
  expect(monitor.version).toBe(1);
  expect(await monitor.transport.read("/project", [], signal())).toEqual(value);
  for (const call of calls.filter((call) => call.body))
    expect(call.search.get("location[directory]")).toBe("/project");
  const events: unknown[] = [];
  for await (const event of monitor.transport.subscribe("/project", signal()))
    events.push(event);
  expect(events).toEqual([{ ...value, sequence: 8 }]);
  await expect(monitor.transport.read("/other", [], signal())).rejects.toThrow(
    "location mismatch",
  );
  const count = calls.length;
  await expect(
    connection.history(
      {
        schemaVersion: 1,
        sessionId: "s",
        from: 0,
        to: 8 * 86400000,
        maxPoints: 500,
      },
      signal(),
    ),
  ).rejects.toThrow("at most seven days");
  expect(calls.length).toBe(count);
});

test("dashboard requires redirect rejection and sanitizes server failures", async () => {
  const runtime = network(() => {
    throw new Error("private-canary");
  });
  const connection = await connectDashboard(
    {
      directory: "/project",
      server: "http://127.0.0.1:1234",
      password: "private-canary",
    },
    runtime,
  );
  await expect(connection.info(signal())).rejects.toThrow(
    "Dashboard server connection failed",
  );
});

test("dashboard prefers v2 and validates bounded location-scoped history without fabricating samples", async () => {
  const paths: string[] = [];
  const history: HistoryChartResult = {
    schemaVersion: 1,
    generatedAt: 1000,
    enabled: false,
    truncated: false,
    metadata: {
      schema: 1,
      retainedBytes: 0,
      skippedBytes: 0,
      malformedRecords: 0,
      completeness: "bounded-retention",
    },
    data: buildChartData([]),
  };
  const runtime = network(async (request) => {
    const url = new URL(request.url);
    paths.push(url.pathname);
    expect(url.searchParams.get("location[directory]")).toBe("/project");
    if (url.pathname.includes("history.v1")) {
      expect(await request.json()).toEqual({
        input: {
          schemaVersion: 1,
          sessionId: "s",
          from: 0,
          to: 604800000,
          maxPoints: 500,
        },
      });
      return Response.json({ output: history });
    }
    return Response.json({ output: snapshot() });
  });
  const connection = await connectDashboard(
    { directory: "/project", server: "https://example.test" },
    runtime,
  );
  expect((await connection.monitor(signal())).version).toBe(2);
  const input = {
    schemaVersion: 1 as const,
    sessionId: "s",
    from: 0,
    to: 604800000,
    maxPoints: 500,
  };
  expect(await connection.history(input, signal())).toEqual(history);
  expect(paths).toEqual([
    "/api/rpc/context-guard.monitor.v2/read",
    "/api/rpc/context-guard.history.v1/read",
  ]);
  await expect(
    connection.history({ ...input, maxPoints: 501 }, signal()),
  ).rejects.toThrow("1–500 points");
  expect(paths.length).toBe(2);
});
