import type {
  RpcHandlers,
  RpcRegistration,
} from "@opencode/plugin/promise/rpc";
export interface SnapshotRpcPort {
  register(
    definition: typeof monitorRpc,
    handlers: RpcHandlers<typeof monitorRpc>,
  ): Promise<RpcRegistration<typeof monitorRpc>>;
}
import { monitorRpc, isRead, isBatch, isResult } from "./rpc.ts";
import type { SnapshotStore, SnapshotBatch } from "./snapshot.ts";
export async function serveSnapshots(
  rpc: SnapshotRpcPort | undefined,
  store: SnapshotStore,
) {
  if (!rpc) return () => {};
  const registration = await rpc.register(monitorRpc, {
    read: async (input) => {
      if (!isRead(input)) throw new Error("Invalid snapshot request");
      const result = store.read(input);
      if (!isResult(result)) throw new Error("Invalid snapshot projection");
      return result;
    },
  });
  const queue: SnapshotBatch[] = [];
  const capacity = Math.ceil(store.health().maxSessions / 128) + 2;
  let busy = false,
    stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let pending = Promise.resolve();
  function send() {
    if (busy || stopped || !queue.length) return;
    const batch = queue[0];
    if (!batch) return;
    busy = true;
    pending = registration.events
      .emit("changed", { ...batch })
      .then(
        () => {
          if (queue[0] === batch) queue.shift();
        },
        () => {
          // Keep the latest pending state; reads repair gaps after bounded overflow.
          if (!stopped) scheduleRetry();
        },
      )
      .finally(() => {
        busy = false;
        if (!retry && !stopped) send();
      });
  }
  const unlisten = store.listen((batch) => {
    if (!isBatch(batch)) return;
    queue.push(batch);
    if (queue.length > capacity) queue.shift();
    if (!retry) send();
  });
  // Clear the timer before retrying, so a successful retry drains the queue.
  const retrySend = () => {
    retry = undefined;
    send();
  };
  // send schedules retries through this wrapper rather than a second publication path.
  function scheduleRetry() {
    retry = setTimeout(retrySend, 100);
  }
  return async () => {
    stopped = true;
    unlisten();
    clearTimeout(retry);
    queue.length = 0;
    await pending;
    await registration.dispose();
  };
}
