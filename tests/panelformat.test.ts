import { expect, test } from "bun:test";
import { metric, type GuardRow } from "../src/family.ts";
import {
  compactionLabel,
  panelRowLines,
  panelStatus,
  panelSummary,
  thresholdDistance,
} from "../src/tui/panelformat.ts";
import { cells } from "../src/tui/format.ts";
import { sidebarFamily } from "./fixtures/sidebar.ts";
import type { MonitorHealth } from "../src/snapshot.ts";

function measured(): GuardRow & {
  snapshot: NonNullable<GuardRow["snapshot"]> & {
    measurement: NonNullable<NonNullable<GuardRow["snapshot"]>["measurement"]>;
  };
} {
  const row = sidebarFamily()[0];
  if (!row?.snapshot?.measurement) throw new Error("Missing measured fixture");
  return {
    ...row,
    snapshot: { ...row.snapshot, measurement: row.snapshot.measurement },
  };
}

test("overview distinguishes occupancy, threshold distance and exact comparison boundaries", () => {
  const row = measured();
  const summary = panelSummary(row, 76, 3000).join("\n");
  expect(summary).toContain("112K/500K · 22%");
  expect(summary).toContain("Threshold 160K · 48K tokens below threshold");
  expect(summary).toContain("Provider reported · measured 3s ago");
  expect(summary).not.toContain("until compaction");
  for (const comparison of [">", ">="] as const) {
    const snapshot = {
      ...row.snapshot,
      policy: {
        ...row.snapshot.policy,
        comparison,
        triggerTokens: row.snapshot.measurement.tokens,
      },
    };
    const exact = { ...row, snapshot, ...metric(snapshot, 4000, 300000) };
    expect(thresholdDistance(exact)).toBe(
      comparison === ">" ? "At threshold · requires more" : "Threshold reached",
    );
  }
  const crossed = {
    ...row,
    ...metric(
      {
        ...row.snapshot,
        policy: { ...row.snapshot.policy, triggerTokens: 100000 },
      },
      4000,
      300000,
    ),
  };
  expect(thresholdDistance(crossed)).toBe("12K tokens over threshold");
});

test("stale occupancy is last measured while stale, missing and invalid pressure stays unknown", () => {
  const row = measured();
  const stale = { ...row, ...metric(row.snapshot, 400000, 300000) };
  expect(panelSummary(stale, 76, 399000).join(" ")).toContain(
    "Last measured 112K/500K",
  );
  expect(thresholdDistance(stale)).toBe("pressure unknown");
  expect(panelSummary(stale, 76, 399000).join(" ")).not.toContain("48K below");
  const invalid = {
    ...row,
    ...metric({ ...row.snapshot, model: "new-model" }, 4000, 300000),
  };
  expect(panelSummary(invalid, 76, 3000).join(" ")).not.toContain("112K");
  const { snapshot: _snapshot, ...unmonitored } = row;
  const missing: GuardRow = {
    ...unmonitored,
    ...metric(undefined, 4000, 300000),
  };
  expect(panelSummary(missing, 76, 0).join(" ")).toContain("Usage unknown");
  expect(thresholdDistance(missing)).toBe("pressure unknown");
});

test("overview remains compact, preserves estimates and measures names in terminal cells", () => {
  const row = measured();
  const long = {
    ...row,
    node: { ...row.node, agent: "研究助手👩‍💻".repeat(20) },
    depth: 64,
  };
  for (const width of [16, 20, 35, 71, 72, 76, 120]) {
    for (const lines of [
      panelSummary(long, width, 3000),
      panelRowLines(long, width, true),
    ]) {
      expect(lines.every((line) => cells(line) <= width)).toBe(true);
    }
    expect(panelRowLines(row, width, true).join(" ")).toContain(">*");
  }
  expect(panelRowLines(row, 76, true)).toHaveLength(1);
  expect(panelRowLines(row, 35, true)).toHaveLength(2);
  expect(panelSummary(row, 16, 3000, true)).toHaveLength(2);
  const approximate = {
    ...row,
    snapshot: {
      ...row.snapshot,
      measurement: {
        ...row.snapshot.measurement,
        confidence: "approximate" as const,
      },
    },
  };
  expect(panelSummary(approximate, 76, 3000).join(" ")).toContain("~112K");
  expect(panelRowLines(approximate, 35, true).join(" ")).toContain("~22%");
});

test("compaction and enforcement copy preserves admission and uncertainty distinctions", () => {
  const row = measured();
  const phase = (
    value: NonNullable<GuardRow["snapshot"]>["compaction"]["phase"],
  ) =>
    compactionLabel({
      ...row,
      snapshot: {
        ...row.snapshot,
        compaction: { ...row.snapshot.compaction, phase: value },
      },
    });
  expect(phase("accepted")).toContain("waiting to start");
  expect(phase("awaiting-measurement")).toContain("checking context reduction");
  expect(phase("uncertain")).toContain("automatic retry suppressed");
  expect(phase("idle")).toBeUndefined();
  const health: MonitorHealth = {
    enabled: true,
    mode: "observe",
    enforcement: "observing",
    reasons: [],
    staleMs: 300000,
    maxSessions: 1024,
  };
  expect(panelStatus(health)).toContain("Guard won't request compaction");
  expect(
    panelStatus({
      ...health,
      enforcement: "suspended",
      reasons: ["event-stream-gap"],
    }),
  ).toContain("reload required");
});

test("measurement wording separates source, scope and freshness without claiming current usage", async () => {
  const { mainLines, agentLines } = await import("../src/tui/compactformat.ts");
  const { detailLines } = await import("../src/tui/format.ts");
  const base = measured();
  for (const confidence of ["reported", "approximate"] as const)
    for (const scope of ["completed-request", "prepared-request"] as const) {
      const snapshot = {
        ...base.snapshot,
        measurement: { ...base.snapshot.measurement, confidence, scope },
      };
      const row = { ...base, snapshot, ...metric(snapshot, 4000, 300000) };
      for (const text of [
        mainLines(row, 35, 3000).join(" "),
        panelSummary(row, 76, 3000).join(" "),
      ]) {
        expect(text).toContain(
          confidence === "reported" ? "Provider reported" : "Estimated",
        );
        expect(text).toContain("measured 3s ago");
        expect(text).not.toContain("fresh");
      }
      const detail = detailLines(row, 80, true, 3000).join(" ");
      expect(detail).toContain(
        scope === "completed-request"
          ? "last completed request"
          : "prepared request",
      );
      expect(detail).toContain(`Measurement confidence: ${confidence}`);
      expect(detail).toContain(`Measurement scope: ${scope}`);
      const stale = { ...row, ...metric(snapshot, 400000, 300000) };
      expect(mainLines(stale, 35, 399000).join(" ")).toContain("out of date");
      expect(panelSummary(stale, 76, 399000).join(" ")).toContain(
        "Last measured",
      );
      expect(agentLines(stale, 35).join(" ")).toContain(
        "Measurement out of date",
      );
      expect(thresholdDistance(stale)).toBe("pressure unknown");
      for (const invalidSnapshot of [
        { ...snapshot, model: "changed" },
        { ...snapshot, measurement: { ...snapshot.measurement, at: 5000 } },
      ]) {
        const invalid = {
          ...row,
          snapshot: invalidSnapshot,
          ...metric(invalidSnapshot, 4000, 300000),
        };
        expect(panelSummary(invalid, 76, 0).join(" ")).toContain(
          "Usage unavailable",
        );
        expect(mainLines(invalid, 35, 0).join(" ")).not.toContain(
          "Provider reported",
        );
        expect(detailLines(invalid, 80).join(" ")).toContain(
          "Measurement cannot be used",
        );
        expect(detailLines(invalid, 80).join(" ")).not.toContain("112.0k");
      }
    }
});

test("lifecycle exceptions remain readable at narrow widths and codes remain in Details", async () => {
  const { detailLines } = await import("../src/tui/format.ts");
  const base = measured();
  for (const phase of [
    "idle",
    "requesting",
    "accepted",
    "running",
    "awaiting-measurement",
    "blocked",
    "uncertain",
  ] as const) {
    const row = {
      ...base,
      snapshot: {
        ...base.snapshot,
        compaction: { ...base.snapshot.compaction, phase, armed: false },
      },
    };
    const detail = detailLines(row, 80, true).join(" ");
    expect(detail).toContain(`Compaction phase: ${phase}`);
    expect(detail).toContain("Armed: false (one eligibility condition");
    expect(detail).not.toContain("ready");
    if (phase === "idle")
      expect(detail).toContain("No compaction request in progress");
    for (const width of [16, 20, 35, 76]) {
      const lines = panelRowLines(row, width, true);
      expect(lines.every((line) => cells(line) <= width)).toBe(true);
      if (phase === "accepted")
        expect(lines.join(" ")).toContain("waiting to start");
      if (phase === "uncertain")
        expect(lines.join(" ")).toContain("Completion unconfirmed");
      if (phase === "awaiting-measurement")
        expect(lines.join(" ")).toContain("checking context reduction");
    }
  }
  for (const [blockedReason, explanation] of [
    ["reclaim-unverifiable", "could not be verified"],
    ["insufficient-reclaim", "below the required minimum"],
    ["compaction-failed", "Compaction failed"],
    ["new-reason\u001b[31m", "See diagnostic codes"],
  ] as const) {
    const row = {
      ...base,
      snapshot: {
        ...base.snapshot,
        compaction: {
          ...base.snapshot.compaction,
          blockedReason,
          phase: "blocked" as const,
        },
      },
    };
    const detail = detailLines(row, 80, true).join(" ");
    expect(detail).toContain(explanation ?? "");
    expect(detail).toContain(
      `Blocked reason: ${blockedReason?.replace(/\u001b\[31m/g, "")}`,
    );
    expect(detail).not.toContain("\u001b");
  }
});
