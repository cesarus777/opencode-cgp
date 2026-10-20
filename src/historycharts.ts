import type { ChartData } from "./charts.ts";
import type { readPerformanceHistory } from "./history.ts";
export interface HistoryChartRead {
  schemaVersion: 1;
  sessionId: string;
  from: number;
  to: number;
  maxPoints: number;
}
export interface HistoryChartResult {
  schemaVersion: 1;
  generatedAt: number;
  enabled: boolean;
  truncated: boolean;
  metadata: Awaited<ReturnType<typeof readPerformanceHistory>>["metadata"];
  data: ChartData;
}
