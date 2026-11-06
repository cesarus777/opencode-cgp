import { expect, test } from "bun:test";
import { metric } from "../src/family.ts";
import type { MonitorHealth } from "../src/snapshot.ts";
import type { Connection } from "../src/tui/transport.ts";
import {
  connectionLabel,
  connectionNotice,
  guardStatusLines,
  monitorStatusLines,
  pressureLabel,
  thresholdDistance,
} from "../src/tui/statusformat.ts";
import { sidebarFamily } from "./fixtures/sidebar.ts";

const health: MonitorHealth = {
  enabled: true,
  mode: "enforce",
  enforcement: "available",
  reasons: [],
  staleMs: 300000,
  maxSessions: 1024,
};

test("threshold labels follow the existing near and equality boundaries independently of occupancy", () => {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing fixture");
  for (const comparison of [">", ">="] as const) {
    for (const [tokens, label] of [
      [899, "Below threshold"],
      [900, "Near threshold"],
      [1000, comparison === ">" ? "Near threshold" : "Threshold reached"],
      [1001, "Threshold reached"],
    ] as const) {
      const snapshot = {
        ...row.snapshot,
        capacityTokens: 10000,
        policy: { ...row.snapshot.policy, triggerTokens: 1000, comparison },
        measurement: { ...row.snapshot.measurement, tokens },
      };
      const next = { ...row, snapshot, ...metric(snapshot, 4000, 300000) };
      expect(pressureLabel(next)).toBe(label);
      expect(next.utilizationPercent).toBeCloseTo(tokens / 100);
      expect(thresholdDistance(next)).toBe(
        tokens < 1000
          ? `${1000 - tokens} tokens below threshold`
          : tokens > 1000
            ? "1 token over threshold"
            : comparison === ">"
              ? "At threshold · requires more"
              : "Threshold reached",
      );
      const stale = { ...next, ...metric(snapshot, 400000, 300000) };
      expect(stale.utilizationPercent).toBe(next.utilizationPercent);
      expect(thresholdDistance(stale)).toBe("pressure unknown");
      expect(pressureLabel(stale)).toBe("Threshold pressure unknown");
    }
  }
  expect(thresholdDistance(undefined)).toBe("pressure unknown");
  expect(pressureLabel(undefined)).toBe("Threshold pressure unknown");
});

test("Guard status distinguishes mode, admission availability and reason-specific suspension remedies", () => {
  expect(
    guardStatusLines({
      ...health,
      mode: "observe",
      enforcement: "observing",
    }).join(" "),
  ).toContain("Guard won't request compaction");
  expect(guardStatusLines(health).join(" ")).toBe(
    "Guard automatic requests enabled",
  );
  expect(guardStatusLines({ ...health, enforcement: "disabled" })).toEqual([
    "Guard disabled",
  ]);
  expect(guardStatusLines(undefined)).toEqual(["Guard status unknown"]);
  expect(
    monitorStatusLines(
      "live",
      {
        ...health,
        reasons: ["capacity-exceeded", "model-metadata-unavailable"],
      },
      true,
    ).join(" "),
  ).toContain("some sessions unavailable");
  expect(
    monitorStatusLines(
      "live",
      { ...health, reasons: ["model-metadata-unavailable"] },
      true,
    ).join(" "),
  ).toContain("Some model limits unavailable");
  for (const compact of [false, true]) {
    const suspended = (reasons: string[]) =>
      guardStatusLines(
        { ...health, enforcement: "suspended", reasons },
        compact,
      )
        .join(" ")
        .toLowerCase();
    expect(suspended(["event-stream-gap"])).toContain("reload required");
    const storage = suspended(["persistence-unavailable"]);
    expect(storage).toContain("storage");
    expect(storage).toContain("repair");
    expect(storage).toContain("reload");
    const both = suspended(["event-stream-gap", "persistence-unavailable"]);
    expect(both).toContain("storage");
    expect(both).toContain("repair");
    expect(both).toContain("reload");
    expect(suspended(["future-reason"])).toContain("see details");
    expect(suspended(["future-reason"])).not.toContain("reload");
  }
});

test("connection loss describes retained data and last-known Guard health without claiming server suspension", () => {
  const labels: Record<Connection, string> = {
    loading: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    unavailable: "Connection unavailable",
    incompatible: "Monitoring unsupported",
  };
  for (const connection of [
    "loading",
    "live",
    "reconnecting",
    "unavailable",
    "incompatible",
  ] as const) {
    expect(connectionLabel(connection)).toBe(labels[connection]);
    for (const retained of [false, true]) {
      const lines = monitorStatusLines(connection, health, retained).join(" ");
      expect(lines).not.toContain("suspended");
      expect(lines).not.toContain("reload");
      if (connection === "live") {
        expect(connectionNotice(connection, retained)).toBeUndefined();
        expect(lines).not.toContain("Last known");
      } else {
        expect(lines).toContain("Last known Guard:");
        expect(lines).toContain(
          retained
            ? "Showing last received measurements"
            : "No measurements available",
        );
      }
    }
  }
  const suspended = {
    ...health,
    enforcement: "suspended" as const,
    reasons: ["event-stream-gap"],
  };
  for (const connection of ["reconnecting", "live"] as const) {
    expect(monitorStatusLines(connection, suspended, true).join(" ")).toContain(
      "reload required",
    );
  }
});
