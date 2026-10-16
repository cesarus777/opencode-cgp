import { expect, test } from "bun:test";
import { releaseTarget } from "../scripts/release.ts";
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
