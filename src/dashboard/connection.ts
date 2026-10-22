import { OpenCode, type SessionListInput } from "@opencode/client";
import { Service, type Endpoint } from "@opencode/client/service";
import { isAbsolute } from "node:path";
import {
  monitorRpc,
  performanceRpc,
  historyRpc,
  isResult,
  isPerformanceResult,
  isHistoryRead,
  isHistoryResult,
} from "../rpc.ts";
import type { HistoryChartRead } from "../historycharts.ts";
import type { SnapshotTransport } from "../tui/transport.ts";

export interface DashboardConnectionOptions {
  readonly directory: string;
  readonly server?: string;
  /** Explicit remote authentication, held only in this process. */
  readonly password?: string;
  readonly username?: string;
  /** Isolated registration file for the connection spike. */
  readonly serviceFile?: string;
}

function serverUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
      throw new Error();
    return url.href;
  } catch {
    // Never echo an invalid URL: it may contain credentials.
    throw new Error(
      "Use an HTTPS server URL or loopback HTTP URL without credentials, query or fragment",
    );
  }
}

/** One SDK client; no server lifecycle calls or session mutations are exposed. */
export async function connectDashboard(
  options: DashboardConnectionOptions,
  discovery: Pick<typeof Service, "discover" | "headers"> & {
    readonly fetch?: typeof globalThis.fetch;
  } = Service,
) {
  if (!isAbsolute(options.directory))
    throw new Error(
      "Dashboard directory must be an absolute path on the server",
    );
  if (
    !options.server &&
    (options.password !== undefined || options.username !== undefined)
  )
    throw new Error("Explicit credentials require an explicit server URL");
  let endpoint: Endpoint;
  if (options.server !== undefined) {
    endpoint = {
      url: serverUrl(options.server),
      ...(options.password === undefined
        ? {}
        : {
            auth: {
              type: "basic" as const,
              username: options.username ?? "opencode",
              password: options.password,
            },
          }),
    };
  } else {
    let found;
    try {
      found = await discovery.discover(
        options.serviceFile === undefined ? {} : { file: options.serviceFile },
      );
    } catch {
      throw new Error("Local OpenCode service discovery failed");
    }
    if (!found)
      throw new Error(
        "No compatible local OpenCode service found; start OpenCode or supply --server",
      );
    endpoint = {
      url: serverUrl(found.url),
      ...(found.auth ? { auth: found.auth } : {}),
    };
  }
  const headers = discovery.headers(endpoint);
  const request = discovery.fetch ?? globalThis.fetch;
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    ...(headers ? { headers } : {}),
    // Refuse redirects so authentication cannot be forwarded to another endpoint.
    fetch: Object.assign(
      (input: URL | RequestInfo, init?: RequestInit) =>
        request(input, { ...init, redirect: "error" }),
      { preconnect: request.preconnect },
    ),
  });
  const location = Object.freeze({ directory: options.directory });
  const deadline = (signal: AbortSignal) =>
    AbortSignal.any([signal, AbortSignal.timeout(5000)]);
  return {
    location,
    async info(signal: AbortSignal) {
      try {
        return await client.server.info({ signal: deadline(signal) });
      } catch {
        throw new Error("Dashboard server connection failed");
      }
    },
    async listSessions(
      input: Pick<SessionListInput, "parentID" | "cursor" | "limit">,
      signal: AbortSignal,
    ) {
      if (
        input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      )
        throw new Error("Session page limit must be between 1 and 100");
      try {
        return await client.session.list(
          {
            ...input,
            directory: location.directory,
            order: "desc",
            limit: input.limit ?? 100,
          },
          { signal: deadline(signal) },
        );
      } catch {
        throw new Error("Dashboard session inventory unavailable");
      }
    },
    async monitor(signal: AbortSignal): Promise<{
      readonly version: 1 | 2;
      readonly transport: SnapshotTransport;
    }> {
      let source:
        | ReturnType<typeof client.rpc<typeof monitorRpc>>
        | ReturnType<typeof client.rpc<typeof performanceRpc>> =
        client.rpc(performanceRpc);
      let version: 1 | 2 = 2;
      try {
        const result = await source.read(
          { schemaVersion: 1, sessionIds: [] },
          { location, signal: deadline(signal) },
        );
        if (!isPerformanceResult(result)) throw new Error();
      } catch {
        if (signal.aborted)
          throw new Error("Dashboard monitor probe cancelled");
        source = client.rpc(monitorRpc);
        version = 1;
        try {
          const result = await source.read(
            { schemaVersion: 1, sessionIds: [] },
            { location, signal: deadline(signal) },
          );
          if (!isResult(result)) throw new Error();
        } catch {
          throw new Error(
            "Context Guard monitor unavailable or incompatible in this location",
          );
        }
      }
      const rpc = source;
      const checkLocation = (directory: string) => {
        if (directory !== location.directory)
          throw new Error("Dashboard location mismatch");
      };
      return {
        version,
        transport: {
          async read(directory, ids, requestSignal) {
            checkLocation(directory);
            try {
              return await rpc.read(
                { schemaVersion: 1, sessionIds: [...ids] },
                { location, signal: deadline(requestSignal) },
              );
            } catch {
              throw new Error("Dashboard monitor read failed");
            }
          },
          async *subscribe(directory, requestSignal) {
            checkLocation(directory);
            try {
              for await (const event of rpc.events.subscribe("changed", {
                signal: requestSignal,
              })) {
                if (event.location?.directory === location.directory)
                  yield event.data;
              }
            } catch {
              if (!requestSignal.aborted)
                throw new Error("Dashboard monitor stream interrupted");
            }
          },
        },
      };
    },
    async history(input: HistoryChartRead, signal: AbortSignal) {
      if (!isHistoryRead(input))
        throw new Error(
          "History requires one session, at most seven days and 1–500 points",
        );
      try {
        const result = await client
          .rpc(historyRpc)
          .read(input, { location, signal: deadline(signal) });
        if (!isHistoryResult(result)) throw new Error();
        return result;
      } catch {
        throw new Error(
          "Context Guard history unavailable or incompatible in this location",
        );
      }
    },
  };
}

export type DashboardConnection = Awaited<ReturnType<typeof connectDashboard>>;
