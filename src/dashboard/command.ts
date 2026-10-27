import { isAbsolute, resolve } from "node:path";
import type { DashboardConnectionOptions } from "./connection.ts";

export const dashboardHelp = `Usage: context-guard dashboard tui [--server URL] [--directory PATH]
Read-only standalone terminal dashboard; never starts an OpenCode server.
Requires an interactive terminal, Bun >=1.3.0 and @opentui/core@0.5.17.
Install the renderer beside this package: npm install @opentui/core@0.5.17
Local discovery defaults to the current directory.
An explicit server requires --directory with an owning absolute server path.
Remote authentication: CONTEXT_GUARD_PASSWORD and optional CONTEXT_GUARD_USERNAME
(default opencode). Credentials must never be supplied in the URL.
Keys: 1 overview, 2 detail, 3 history, arrows/j/k move, / search, f filters,
l location, w history window, r refresh, ? help, Escape back, q/Ctrl+C quit.`;

export function parseDashboardArgs(
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
): DashboardConnectionOptions | "help" {
  if (args[0] !== "tui") {
    if (args.length === 1 && args[0] === "--help") return "help";
    throw new Error("Use context-guard dashboard tui; only tui is supported");
  }
  let server: string | undefined, directory: string | undefined;
  const seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--help" && args.length === 2) return "help";
    if (flag !== "--server" && flag !== "--directory")
      throw new Error("Unknown dashboard option; use dashboard tui --help");
    if (seen.has(flag)) throw new Error("Duplicate dashboard option");
    seen.add(flag);
    const value = args[++i];
    if (!value || value.startsWith("--"))
      throw new Error(`Missing value for ${flag}`);
    if (flag === "--server") server = value;
    else directory = value;
  }
  if (server !== undefined && (!directory || !isAbsolute(directory)))
    throw new Error(
      "Explicit servers require --directory with an absolute server path",
    );
  return {
    directory:
      server === undefined
        ? resolve(cwd, directory ?? ".")
        : (directory ?? cwd),
    ...(server === undefined
      ? {}
      : {
          server,
          ...(env.CONTEXT_GUARD_PASSWORD === undefined
            ? {}
            : {
                password: env.CONTEXT_GUARD_PASSWORD,
                username: env.CONTEXT_GUARD_USERNAME ?? "opencode",
              }),
        }),
  };
}

export function checkTerminalRuntime(version: string, interactive: boolean) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  if (
    major < 1 ||
    (major === 1 && minor < 3) ||
    !Number.isFinite(major + minor)
  )
    throw new Error(
      "dashboard tui requires Bun >=1.3.0; other commands support Bun >=1.1.34",
    );
  if (!interactive)
    throw new Error(
      "dashboard tui requires an interactive input and output terminal; run it directly in a terminal",
    );
}

export async function loadTerminalRenderer() {
  try {
    return await import("@opentui/core");
  } catch {
    throw new Error(
      "Terminal renderer unavailable; install @opentui/core@0.5.17 beside @cesarus777/opencode-cgp using Bun >=1.3.0",
    );
  }
}
