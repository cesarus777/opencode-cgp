import { expect, test } from "bun:test";
import { releaseTarget, assertUnpublished } from "../scripts/release.ts";
test("release requires the exact version tag and separates prereleases", () => {
  expect(releaseTarget("0.1.0", "v0.1.0")).toBe("latest");
  expect(releaseTarget("0.2.0-beta.1", "v0.2.0-beta.1")).toBe("next");
  for (const tag of ["main", "v0.1.1", "0.1.0", "v0.1.0-beta.1"])
    expect(() => releaseTarget("0.1.0", tag)).toThrow();
  for (const version of [
    "latest",
    "01.0.0",
    "1.0.0-",
    "1.0.0-beta..1",
    "1.0.0-01",
    "1.0.0+build",
  ])
    expect(() => releaseTarget(version, `v${version}`)).toThrow();
});

test("registry preflight permits only a completed E404 lookup", () => {
  expect(() =>
    assertUnpublished(1, JSON.stringify({ error: { code: "E404" } })),
  ).not.toThrow();
  for (const code of ["E401", "E403", "E429", "E500", "EAI_AGAIN", "ETIMEDOUT"])
    expect(() =>
      assertUnpublished(1, JSON.stringify({ error: { code } })),
    ).toThrow();
  for (const output of [
    "",
    "not json",
    "null",
    "[]",
    '"E404"',
    "{}",
    '{"error":null}',
  ])
    expect(() => assertUnpublished(1, output)).toThrow();
  expect(() => assertUnpublished(0, '"0.2.5"')).toThrow();
  expect(() => assertUnpublished(0, '{"error":{"code":"E404"}}')).toThrow();
  expect(() => assertUnpublished(137, '{"error":{"code":"E404"}}')).toThrow();
});
