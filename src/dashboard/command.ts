import { isAbsolute, resolve } from "node:path";
import type { DashboardConnectionOptions } from "./connection.ts";

export const dashboardHelp = `Usage: context-guard dashboard tui [options]
Open a read-only live terminal dashboard for an existing OpenCode server.

Start here
  1. Keep an OpenCode server running with Context Guard registered.
  2. Close OpenCode's native TUI before opening the standalone dashboard.
  3. In the owning project directory, run: context-guard dashboard tui

Options
  --directory PATH   Owning project directory (local default: current directory)
  --server URL       Connect to an explicit server; requires --directory with
                     an absolute server-side project path. Use HTTPS except
                     on loopback. Credentials in URLs are rejected.
  -h, --help         Show this help

Examples
  context-guard dashboard tui
  context-guard dashboard tui --directory /absolute/project
  context-guard dashboard tui --server https://server.example --directory /server/project

Requirements
  Interactive terminal and Bun >=1.3.0. The OpenTUI renderer is installed
  automatically with CGP. This command never starts a server.

Authentication (explicit servers)
  CONTEXT_GUARD_PASSWORD   Server password
  CONTEXT_GUARD_USERNAME   Server username (default: opencode)

Keys
  1/2/3 overview/detail/history; arrows or j/k move; / search; f filters;
  l location; w history window; r refresh; ? help; q or Ctrl+C quit.`;

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
      "Terminal renderer unavailable; reinstall @cesarus777/opencode-cgp with optional dependencies enabled for its platform renderer, using Bun >=1.3.0",
    );
  }
}
