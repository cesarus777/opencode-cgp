import type { ExecutionStatus } from "../family.ts";
import type { HistoryChartRead, HistoryChartResult } from "../historycharts.ts";
import type { SnapshotTransport } from "../tui/transport.ts";

/** The inventory boundary deliberately excludes titles, metadata, and content. */
export interface DashboardSession {
  readonly sessionId: string;
  readonly directory: string;
  readonly parentId?: string;
  readonly agent?: string;
  readonly model?: string;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
  readonly terminalAt?: number;
}
export interface SessionPageInput {
  readonly parentID?: string | null;
  readonly cursor?: string;
  readonly limit?: number;
}
export interface DashboardPort {
  readonly location: { readonly directory: string };
  /** Rebind the same authenticated client, never create another server/client. */
  atLocation(directory: string): DashboardPort;
  listSessions(
    input: SessionPageInput,
    signal: AbortSignal,
  ): Promise<{
    readonly data: readonly DashboardSession[];
    readonly cursor?: { readonly next?: string | null };
  }>;
  activeSessions(
    ids: readonly string[],
    signal: AbortSignal,
  ): Promise<readonly string[]>;
  monitor(signal: AbortSignal): Promise<{
    readonly version: 1 | 2;
    readonly transport: SnapshotTransport;
  }>;
  history(
    input: HistoryChartRead,
    signal: AbortSignal,
  ): Promise<HistoryChartResult>;
}
export interface InventoryNode extends DashboardSession {
  readonly status: ExecutionStatus;
  readonly inventoryStale: boolean;
}
