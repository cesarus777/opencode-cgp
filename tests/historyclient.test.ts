import { expect, test } from "bun:test";
import {
  checkedHistory,
  historyFailure,
  HistoryFailure,
  historyStatusLines,
} from "../src/historyclient.ts";
import { retainedHistory } from "./fixtures/history.ts";

test("history classifies structured errors without inferring capability from HTTP status or message text", () => {
  for (const [code, reason] of [
    ["rpc.unavailable", "unsupported"],
    ["rpc.method_not_found", "unsupported"],
    ["rpc.invalid_output", "incompatible"],
    ["rpc.invalid_input", "rejected"],
    ["rpc.internal", "unavailable"],
    ["other", "unavailable"],
  ] as const) {
    const failure = historyFailure({ type: code, message: "private-canary" });
    expect(failure.reason).toBe(reason);
    expect(String(failure)).not.toContain("private-canary");
    expect(
      historyStatusLines({
        status: "unavailable",
        reason: failure.reason,
      }).join(" "),
    ).not.toContain("private-canary");
  }
  for (const error of [
    new Error("rpc.unavailable private-canary"),
    { status: 404 },
    { status: 503 },
    null,
  ])
    expect(historyFailure(error).reason).toBe("unavailable");
  const timeout = new DOMException("private-canary", "TimeoutError");
  expect(historyFailure(timeout).reason).toBe("timeout");
  expect(historyFailure(new Error(), AbortSignal.abort(timeout)).reason).toBe(
    "timeout",
  );
  expect(historyFailure(new HistoryFailure("incompatible")).reason).toBe(
    "incompatible",
  );
});

test("history validates schema and every session before retaining results", () => {
  const good = retainedHistory();
  expect(checkedHistory(good, "s")).toBe(good);
  expect(() => checkedHistory(good, "foreign")).toThrow("History incompatible");
  expect(() => checkedHistory({ ...good, data: {} }, "s")).toThrow(
    "History incompatible",
  );
  expect(() =>
    checkedHistory(
      {
        ...good,
        data: {
          ...good.data,
          series: [
            ...good.data.series,
            ...retainedHistory("foreign").data.series,
          ],
        },
      },
      "s",
    ),
  ).toThrow("History incompatible");
});

test("history status explains loading, disabled recording, failure and previous results accurately", () => {
  expect(historyStatusLines({ status: "loading" }).join(" ")).toBe(
    "Loading retained history…",
  );
  expect(
    historyStatusLines({ status: "unavailable", stale: true }).join(" "),
  ).not.toContain("previous results");
  const retained = historyStatusLines({
    status: "unavailable",
    reason: "timeout",
    stale: true,
    loadedAt: 1000,
  }).join(" ");
  expect(retained).toContain("timed out. Press r");
  expect(retained).toContain(
    "Showing previous results · last loaded 1970-01-01T00:00:01.000Z",
  );
  expect(
    historyStatusLines({ status: "loading", stale: true, loadedAt: 1000 }).join(
      " ",
    ),
  ).toContain("Updating history");
  expect(historyStatusLines({ status: "disabled" }).join(" ")).toContain(
    "configuration changes",
  );
  expect(
    historyStatusLines({ status: "ready", loadedAt: 1000, stale: false }),
  ).toEqual([]);
});
