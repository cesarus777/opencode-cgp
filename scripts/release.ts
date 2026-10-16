import { appendFile } from "node:fs/promises";
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
if (import.meta.main) {
  const tag = releaseTarget(
    manifest.version,
    process.env.GITHUB_REF_NAME ?? "",
  );
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${manifest.version}`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (response.status !== 404) {
    if (response.ok)
      throw new Error(
        `${manifest.name}@${manifest.version} already exists; refusing duplicate publication`,
      );
    throw new Error(
      `Registry check failed (${response.status}); refusing publication`,
    );
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required");
  await appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
}
