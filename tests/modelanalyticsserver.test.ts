import { expect, test } from "bun:test";
import {
  createAnalyticsService,
  serveModelAnalytics,
} from "../src/modelanalyticsserver.ts";
import {
  analyticsRpc,
  isAnalyticsRead,
  isAnalyticsResult,
} from "../src/rpc.ts";
import type { AnalyticsRead } from "../src/modelseries.ts";
import {
  analyticsFixture,
  analyticsMetadata,
  analyticsRequest,
} from "./fixtures/analytics.ts";

const input: AnalyticsRead = {
  schemaVersion: 1,
  from: 700000,
  to: 1000000,
  buckets: 120,
};
const signal = () => AbortSignal.timeout(5000);

test("analytics reads archived models without live inventory and keeps totals before detail pagination", async () => {
  const fixture = analyticsFixture(
    Array.from({ length: 1200 }, (_, i) => analyticsRequest(`r-${i}`)),
  );
  try {
    const first = await fixture.service.read(input, signal());
    expect(isAnalyticsResult(first)).toBe(true);
    expect(first.selected).toMatchObject({
      model: "provider/alpha",
      completedRequests: 1200,
      sessions: 1200,
      outputTokens: 120000,
      averageTps: 100,
    });
    expect(first.requests).toHaveLength(50);
    fixture.records.push(analyticsRequest("appended"));
    const ids = new Set(first.requests.map((r) => r.requestId));
    let cursor = first.nextRequestsCursor;
    while (cursor) {
      const page = await fixture.service.read(
        {
          ...input,
          snapshotId: first.snapshotId,
          model: "provider/alpha",
          requestCursor: cursor,
        },
        signal(),
      );
      expect(page.selected).toEqual(first.selected);
      for (const request of page.requests) {
        expect(ids.has(request.requestId)).toBe(false);
        ids.add(request.requestId);
      }
      cursor = page.nextRequestsCursor;
    }
    expect(ids.size).toBe(1200);
    expect(ids.has("appended")).toBe(false);
    expect(fixture.scans()).toBe(1);
  } finally {
    fixture.service.dispose();
  }
});

test("analytics model paging, sort and bucket resolution reuse the same snapshot", async () => {
  const fixture = analyticsFixture(
    Array.from({ length: 70 }, (_, i) =>
      analyticsRequest(`r-${i}`, `provider/${i.toString().padStart(2, "0")}`),
    ),
  );
  try {
    const first = await fixture.service.read(input, signal());
    expect(first.totalModels).toBe(70);
    expect(first.models).toHaveLength(50);
    if (!first.nextModelsCursor) throw new Error("Missing model page cursor");
    const second = await fixture.service.read(
      {
        ...input,
        snapshotId: first.snapshotId,
        modelCursor: first.nextModelsCursor,
      },
      signal(),
    );
    expect(second.models).toHaveLength(20);
    expect(
      new Set([...first.models, ...second.models].map((m) => m.model)).size,
    ).toBe(70);
    const resize = await fixture.service.read(
      {
        ...input,
        snapshotId: first.snapshotId,
        buckets: 16,
        model: "provider/69",
      },
      signal(),
    );
    expect(resize.buckets).toHaveLength(16);
    expect(resize.selected?.completedRequests).toBe(1);
    expect(fixture.scans()).toBe(1);
  } finally {
    fixture.service.dispose();
  }
});

test("analytics rejects paths, foreign/expired snapshots and cursors bound to a different query/model/sort", async () => {
  const fixture = analyticsFixture(
    Array.from({ length: 60 }, (_, i) => analyticsRequest(`r-${i}`)),
  );
  try {
    const first = await fixture.service.read(input, signal());
    expect(isAnalyticsRead({ ...input, path: "/foreign" })).toBe(false);
    expect(isAnalyticsRead({ ...input, to: input.from })).toBe(false);
    expect(isAnalyticsRead({ ...input, to: input.from + 604800001 })).toBe(
      false,
    );
    expect(isAnalyticsRead({ ...input, buckets: 241 })).toBe(false);
    expect(isAnalyticsRead({ ...input, requestCursor: "forged" })).toBe(false);
    await expect(
      fixture.service.read(
        { ...input, snapshotId: first.snapshotId, agent: "foreign" },
        signal(),
      ),
    ).rejects.toThrow("expired");
    if (!first.nextRequestsCursor)
      throw new Error("Missing request page cursor");
    await expect(
      fixture.service.read(
        {
          ...input,
          snapshotId: first.snapshotId,
          model: "provider/beta",
          requestCursor: first.nextRequestsCursor,
        },
        signal(),
      ),
    ).rejects.toThrow("cursor");
    const other = createAnalyticsService("/other", "/other", false);
    await expect(
      other.read({ ...input, snapshotId: first.snapshotId }, signal()),
    ).rejects.toThrow("expired");
    other.dispose();
    fixture.setNow(1100000);
    await expect(
      fixture.service.read(
        { ...input, snapshotId: first.snapshotId },
        signal(),
      ),
    ).rejects.toThrow("expired");
    fixture.service.dispose();
    await expect(fixture.service.read(input, signal())).rejects.toThrow(
      "stopped",
    );
  } finally {
    fixture.service.dispose();
  }
});

test("analytics cache expires for fresh queries and agent filters apply before aggregates", async () => {
  const fixture = analyticsFixture([
    analyticsRequest("a"),
    analyticsRequest("b", "provider/alpha", 1000, 999, 990000, "review"),
  ]);
  try {
    const first = await fixture.service.read(
      { ...input, agent: "build" },
      signal(),
    );
    expect(first.selected?.outputTokens).toBe(100);
    fixture.records.push(analyticsRequest("c"));
    fixture.setNow(1031000);
    const next = await fixture.service.read(
      { ...input, agent: "build" },
      signal(),
    );
    expect(next.selected?.outputTokens).toBe(200);
    expect(fixture.scans()).toBe(2);
  } finally {
    fixture.service.dispose();
  }
});

test("analytics disabled status avoids disk and registration follows public RPC lifecycle", async () => {
  let disposed = false;
  const stop = await serveModelAnalytics(
    {
      register: async (definition, handlers) => {
        expect(definition).toBe(analyticsRpc);
        const result = await handlers.read(input, {
          signal: signal(),
          error: () => {
            throw new Error("unused");
          },
        });
        expect(isAnalyticsResult(result)).toBe(true);
        if (isAnalyticsResult(result)) {
          expect(result.enabled).toBe(false);
          expect(result.models).toHaveLength(0);
        }
        return {
          dispose: async () => {
            disposed = true;
          },
        };
      },
    },
    "/does-not-exist",
    "/project",
    false,
  );
  await stop();
  expect(disposed).toBe(true);
});

test("analytics coalesces scans and cancelling one caller does not cancel another", async () => {
  let scans = 0,
    finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const service = createAnalyticsService("/archive", "/project", true, {
    read: async (_path, filter) => {
      scans++;
      await gate;
      filter?.signal?.throwIfAborted();
      return { metadata: analyticsMetadata, records: [analyticsRequest("a")] };
    },
  });
  const cancel = new AbortController();
  try {
    const abandoned = service.read(input, cancel.signal);
    const retained = service.read(input, signal());
    cancel.abort();
    await expect(abandoned).rejects.toThrow("cancelled");
    finish();
    expect((await retained).selected?.completedRequests).toBe(1);
    expect(scans).toBe(1);
  } finally {
    finish();
    service.dispose();
  }
});

test("analytics projects approved scalars and labels gaps, missing usage and malformed archive coverage", async () => {
  const record = analyticsRequest("a");
  if (!record.performance) throw new Error("Missing fixture");
  record.performance = {
    ...record.performance,
    tokenSource: "unavailable",
    ttftMs: -1,
  };
  const service = createAnalyticsService("/archive", "/project", true, {
    read: async () => ({
      metadata: {
        ...analyticsMetadata,
        skippedBytes: 100,
        malformedRecords: 2,
      },
      records: [
        record,
        {
          schema: 1,
          recordId: "gap",
          type: "gap",
          time: 990000,
          sessionId: "__history__",
          event: "gap",
        },
      ],
    }),
  });
  try {
    const result = await service.read(input, signal());
    expect(result.coverage.partial).toBe(true);
    expect(result.selected?.averageTps).toBeUndefined();
    expect(result.requests[0]?.ttftMs).toBeUndefined();
    expect(result.gaps).toEqual([990000]);
    expect(isAnalyticsResult({ ...result, prompt: "private-canary" })).toBe(
      false,
    );
    expect(
      isAnalyticsResult({
        ...result,
        selected: { ...result.selected, output: "private-canary" },
      }),
    ).toBe(false);
  } finally {
    service.dispose();
  }
});

test("analytics immediately replaces a fully cancelled scan and late completion cannot replace its cache", async () => {
  const finishes: (() => void)[] = [];
  let scans = 0;
  const service = createAnalyticsService("/archive", "/project", true, {
    read: async (_path, filter) => {
      const index = scans++;
      await new Promise<void>((resolve) => finishes.push(resolve));
      filter?.signal?.throwIfAborted();
      return {
        metadata: analyticsMetadata,
        records: [analyticsRequest(`scan-${index}`)],
      };
    },
  });
  const cancel = new AbortController();
  try {
    const first = service.read(input, cancel.signal);
    await Bun.sleep(1);
    cancel.abort();
    await expect(first).rejects.toThrow("cancelled");
    const second = service.read(input, signal());
    await Bun.sleep(1);
    expect(scans).toBe(2);
    finishes[1]?.();
    expect((await second).requests[0]?.requestId).toBe("scan-1");
    finishes[0]?.();
    await Bun.sleep(1);
    expect((await service.read(input, signal())).requests[0]?.requestId).toBe(
      "scan-1",
    );
  } finally {
    for (const finish of finishes) finish();
    service.dispose();
  }
});

test("analytics cursors stay bounded for full-length model identities", async () => {
  const model = `provider/${"x".repeat(503)}`;
  const fixture = analyticsFixture(
    Array.from({ length: 60 }, (_, i) => analyticsRequest(`r-${i}`, model)),
  );
  try {
    const first = await fixture.service.read({ ...input, model }, signal());
    if (!first.nextRequestsCursor) throw new Error("Missing cursor");
    expect(first.nextRequestsCursor.length).toBeLessThanOrEqual(512);
    const next = await fixture.service.read(
      {
        ...input,
        model,
        snapshotId: first.snapshotId,
        requestCursor: first.nextRequestsCursor,
      },
      signal(),
    );
    expect(next.requests).toHaveLength(10);
  } finally {
    fixture.service.dispose();
  }
});

test("analytics keeps unknown model attribution separate and selectable", async () => {
  const record = analyticsRequest("unknown");
  if (!record.performance) throw new Error("Missing fixture");
  const { requestModel: _requestModel, ...performance } = record.performance;
  const { model: _model, ...unknown } = record;
  const fixture = analyticsFixture([
    { ...unknown, performance },
    analyticsRequest("known"),
  ]);
  try {
    const result = await fixture.service.read(
      { ...input, unknownModel: true },
      signal(),
    );
    expect(isAnalyticsResult(result)).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.selected?.model).toBeUndefined();
    expect(result.selected?.completedRequests).toBe(1);
    expect(result.requests[0]?.requestId).toBe("unknown");
    expect(result.coverage.partial).toBe(true);
  } finally {
    fixture.service.dispose();
  }
});
