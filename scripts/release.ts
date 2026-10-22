import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import manifest from "../package.json";

export function releaseTarget(version: string, tag: string): "latest" | "next" {
  const parsed =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    );
  if (!parsed || parsed[4]?.split(".").some((part) => /^0\d+$/.test(part)))
    throw new Error(
      "Release requires a semantic version without build metadata",
    );
  if (tag !== `v${version}`)
    throw new Error(`Tag must be v${version}, got ${tag}`);
  return version.includes("-") ? "next" : "latest";
}
/** Only a completed npm lookup reporting E404 permits a new publication. */
export function assertUnpublished(exitCode: number, output: string): void {
  if (exitCode === 0)
    throw new Error("Version already exists; refusing publication");
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch {
    throw new Error("Invalid registry response; refusing publication");
  }
  if (
    exitCode === 1 &&
    value !== null &&
    typeof value === "object" &&
    "error" in value
  ) {
    const error = value.error;
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "E404"
    )
      return;
  }
  throw new Error("Registry lookup failed; refusing publication");
}

if (import.meta.main) {
  const tag = releaseTarget(
    manifest.version,
    process.env.GITHUB_REF_NAME ?? "",
  );
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  const temporary = await mkdtemp(join(tmpdir(), "guard-release-"));
  try {
    // Use the same registry client as publication, with bounded network retries.
    // Files avoid subprocess pipe loss with Bun 1.1.34 and newer Node versions.
    const output = join(temporary, "registry.json");
    const child = Bun.spawn(
      [
        "npm",
        "view",
        `${manifest.name}@${manifest.version}`,
        "version",
        "--json",
        "--registry=https://registry.npmjs.org",
        "--fetch-retries=2",
        "--fetch-timeout=30000",
      ],
      {
        env: { ...process.env, NODE_AUTH_TOKEN: "" },
        stdout: Bun.file(output),
        stderr: Bun.file(join(temporary, "registry.stderr")),
      },
    );
    const timer = setTimeout(() => child.kill("SIGKILL"), 180000);
    try {
      assertUnpublished(await child.exited, await readFile(output, "utf8"));
    } finally {
      clearTimeout(timer);
    }
    await appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
