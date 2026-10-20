import { buildChartData } from "./charts.ts";
import { readPerformanceHistory } from "./history.ts";
import { historyRpc, isHistoryRead, isHistoryResult } from "./rpc.ts";
import type { HistoryChartResult } from "./historycharts.ts";
import type {
  RpcHandlers,
  RpcRegistration,
} from "@opencode/plugin/promise/rpc";
export interface HistoryRpcPort {
  register(
    definition: typeof historyRpc,
    handlers: RpcHandlers<typeof historyRpc>,
  ): Promise<Pick<RpcRegistration<typeof historyRpc>, "dispose">>;
}

/** Read-only archive service. Clients can select an ID/time range, never a filesystem path. */
export async function serveHistory(
  rpc: HistoryRpcPort | undefined,
  path: string,
  enabled: boolean,
  now = Date.now,
  authorize: (
    sessionId: string,
    signal: AbortSignal,
  ) => Promise<boolean> = async () => true,
) {
  if (!rpc) return () => {};
  let reading = false,
    stopped = false;
  const registration = await rpc.register(historyRpc, {
    read: async (input, context) => {
      if (!isHistoryRead(input))
        throw new Error("Invalid history request (maximum window: seven days)");
      if (reading || stopped)
        throw new Error("History service busy or stopped; retry later");
      reading = true;
      try {
        const allowed =
          !enabled || (await authorize(input.sessionId, context.signal));
        if (!allowed) throw new Error("Session is outside this location");
        const result = enabled
          ? await readPerformanceHistory(path, {
              sessionId: input.sessionId,
              from: input.from,
              to: input.to,
            })
          : {
              metadata: {
                schema: 1,
                retainedBytes: 0,
                skippedBytes: 0,
                malformedRecords: 0,
                completeness: "bounded-retention",
              },
              records: [],
            };
        if (context.signal.aborted || stopped)
          throw new Error("History read cancelled");
        const data = buildChartData(result.records, {
          sessionId: input.sessionId,
          maxPoints: input.maxPoints,
          maxSessions: 1,
        });
        const truncated =
          data.gaps.length > 128 ||
          data.series.some(
            (s) =>
              s.requests.length > input.maxPoints ||
              s.originalPoints > s.points.length,
          ) ||
          result.metadata.skippedBytes > 0;
        data.gaps = data.gaps.slice(-128);
        for (const s of data.series)
          s.requests = s.requests.slice(-input.maxPoints);
        const response: HistoryChartResult = {
          schemaVersion: 1,
          generatedAt: now(),
          enabled,
          truncated,
          metadata: { ...result.metadata, completeness: "bounded-retention" },
          data,
        };
        if (!isHistoryResult(response))
          throw new Error("History response exceeds the supported bounds");
        return response;
      } finally {
        reading = false;
      }
    },
  });
  return async () => {
    stopped = true;
    await registration.dispose();
  };
}
