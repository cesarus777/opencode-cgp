import { rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin";

// Only generated output is removed. All package imports remain external so the
// V2 host can supply its own SDK, Solid owner graph and OpenTUI renderer.
await rm("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["src/index.ts", "src/core.ts", "src/rpc.ts", "src/tui.tsx"],
  outdir: "dist",
  target: "bun",
  format: "esm",
  packages: "external",
  plugins: [createSolidTransformPlugin()],
});
if (!result.success)
  throw new AggregateError(result.logs, "Runtime build failed");
const declarations = Bun.spawn(
  ["bun", "node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"],
  { stdout: "inherit", stderr: "inherit" },
);
if ((await declarations.exited) !== 0)
  throw new Error("Declaration build failed");
// TypeScript preserves source extensions in declaration imports. Publish only
// references to declaration siblings, never paths requiring the source tree.
async function rewriteDeclarations(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await rewriteDeclarations(path);
    else if (entry.name.endsWith(".d.ts")) {
      const source = await readFile(path, "utf8");
      await writeFile(
        path,
        source.replace(/(["'])(\.{1,2}\/[^"']+)\.tsx?\1/g, "$1$2.js$1"),
      );
    }
  }
}
await rewriteDeclarations("dist/types");
console.log("Built server, core, RPC, Solid TUI and declarations.");
