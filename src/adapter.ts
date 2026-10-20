import { PerformanceTracker, outputTokens } from "./performance.ts";
import { serveHistory, type HistoryRpcPort } from "./historyserver.ts";
import { PerformanceHistory } from "./history.ts";
import { SnapshotStore } from "./snapshot.ts";
import { serveSnapshots, type SnapshotRpcPort } from "./snapshotserver.ts";
import type { Plugin } from "@opencode/plugin";
import type { OpenCodeEvent } from "@opencode/client";
import type { Registration } from "@opencode/plugin/promise/registration";
import type { SessionContext } from "@opencode/plugin/promise/session";
import { parseConfig } from "./config.ts";
import { ContextMonitor, promptTokens } from "./monitor.ts";
import { CompactionScheduler } from "./scheduler.ts";
import { estimate } from "./estimate.ts";
import { decodeRecovery, encodeRecovery } from "./recovery.ts";
import { JsonlTelemetrySink, defaultPath } from "./telemetry.ts";
import type { Identity, ModelLimits, TelemetrySink } from "./types.ts";
export interface Host {
  rpc?: SnapshotRpcPort;
  historyRpc?: HistoryRpcPort;
  app: { version: string };
  options: unknown;
  location: { directory: string };
  session: Pick<Plugin.Context["session"], "get" | "compact" | "hook">;
  model: Pick<Plugin.Context["model"], "list">;
  event: Plugin.Context["event"];
  storage: Pick<Plugin.Context["storage"], "get" | "set">;
}
export async function setup(ctx: Host, injectedSink?: TelemetrySink) {
  const config = parseConfig(ctx.options);
  const disk = new JsonlTelemetrySink(
    config.telemetry.path ?? defaultPath(ctx.location.directory),
    config.telemetry,
  );
  const diagnostics = injectedSink ?? disk;
  const performance = new PerformanceTracker(
    config.safety.maxSessions,
    config.metrics.rollingWindowMs,
  );
  const store = new SnapshotStore(
    config,
    () => monitor?.sessions ?? new Map(),
    Date.now,
    crypto.randomUUID(),
    config.metrics.enabled ? (id) => performance.snapshot(id) : undefined,
  );
  let monitor: ContextMonitor | undefined;
  const sink: TelemetrySink = {
    emit(event) {
      try {
        if (event.session) store.mark(event.session.sessionId);
        if (
          [
            "event-stream-gap",
            "persistence-unavailable",
            "capacity-exceeded",
            "model-metadata-unavailable",
          ].includes(event.type)
        ) {
          if (event.type === "event-stream-gap")
            store.degrade("event-stream-gap");
          if (event.type === "persistence-unavailable")
            store.degrade("persistence-unavailable");
          if (event.type === "capacity-exceeded")
            store.degrade("capacity-exceeded");
          if (event.type === "model-metadata-unavailable")
            store.degrade("model-metadata-unavailable");
        }
      } catch {
        /* Projection must never interrupt monitoring. */
      }
      diagnostics.emit(event);
    },
  };
  const stopV1 = await serveSnapshots(ctx.rpc, store).catch(() => {
    diagnostics.emit({
      time: Date.now(),
      type: "snapshot-service-unavailable",
    });
    return () => {};
  });
  const stopV2 = await serveSnapshots(ctx.rpc, store, true).catch(() => {
    diagnostics.emit({
      time: Date.now(),
      type: "performance-service-unavailable",
    });
    return () => {};
  });
  const stopHistory = await serveHistory(
    ctx.historyRpc,
    config.history.path ?? `${defaultPath(ctx.location.directory)}.metrics`,
    config.enabled && config.metrics.enabled && config.history.enabled,
    Date.now,
    async (sessionId, signal) => {
      const info = await ctx.session.get({ sessionID: sessionId }, { signal });
      return info.location.directory === ctx.location.directory;
    },
  ).catch(() => {
    diagnostics.emit({ time: Date.now(), type: "history-service-unavailable" });
    return () => {};
  });
  const stopSnapshots = async () => {
    await stopHistory();
    await stopV2();
    await stopV1();
  };
  if (!config.enabled) {
    sink.emit({ time: Date.now(), type: "disabled" });
    return async () => {
      await stopSnapshots();
      await disk.flush();
    };
  }
  const history = new PerformanceHistory(
    config.history.path ?? `${defaultPath(ctx.location.directory)}.metrics`,
    {
      ...config.history,
      enabled: config.history.enabled && config.metrics.enabled,
    },
    Date.now,
    (type) => diagnostics.emit({ time: Date.now(), type }),
  );
  await history.initialize();
  if (config.metrics.enabled) {
    performance.restore(
      await ctx.storage.get("performance.v1").catch(() => undefined),
    );
  }
  const performanceResidents = new Set<string>();
  const recordPerformance = (
    id: string,
    type: "sample" | "request" | "lifecycle" | "gap" | "terminal",
    event?: string,
  ) => {
    if (!config.metrics.enabled) return;
    const state = monitor?.sessions.get(id),
      snapshot = performance.snapshot(id);
    if (!state || !snapshot) return;
    history.emit({
      schema: 1,
      recordId: crypto.randomUUID(),
      time: Date.now(),
      type,
      sessionId: id,
      ...(state.parentId ? { parentId: state.parentId } : {}),
      ...(state.agent ? { agent: state.agent } : {}),
      ...(state.model ? { model: state.model } : {}),
      ...(event ? { event } : {}),
      performance: snapshot,
    });
  };
  const persistPerformance = async () => {
    if (!config.metrics.enabled) return;
    await ctx.storage
      .set(
        "performance.v1",
        performance.checkpoint().map((row) => ({ ...row })),
      )
      .catch(() => {
        diagnostics.emit({
          time: Date.now(),
          type: "performance-persistence-unavailable",
        });
      });
  };
  const controller = new AbortController();
  let stopped = false,
    persistenceHealthy = true;
  let work = Promise.resolve();
  const serialized = (task: () => Promise<void>) => {
    const next = work.then(task);
    work = next.catch(() => {});
    return next;
  };
  const requests = new Map<string, { id: string; model: string }>();
  const saved = await ctx.storage.get("safety").catch(() => {
    persistenceHealthy = false;
    return undefined;
  });
  const decoded = decodeRecovery(saved, config.safety.maxSessions);
  if (
    saved !== undefined &&
    (!Array.isArray(saved) || saved.length !== decoded.length)
  ) {
    // Never forget an unresolved request because storage is malformed or a capacity was reduced.
    persistenceHealthy = false;
  }
  const recoveries = new Map(decoded.map((s) => [s.sessionId, s]));
  let persistChain = Promise.resolve();
  const persist = () => {
    if (!persistenceHealthy) return persistChain;
    const rows = [...(monitor?.sessions.values() ?? [])]
      .filter(
        (s) =>
          s.compaction.lastAttempt !== undefined ||
          s.compaction.phase !== "idle",
      )
      .map((s) => ({
        sessionId: s.sessionId,
        sequence: s.sequence,
        compaction: { ...s.compaction },
      }));
    const missing = [...recoveries]
      .filter(([id]) => !monitor?.sessions.has(id))
      .map(([, recovery]) => recovery);
    // Only validated scalar safety fields enter the JSON storage contract.
    const data = encodeRecovery(
      [...rows, ...missing].slice(0, config.safety.maxSessions),
    );
    persistChain = persistChain
      .then(() => ctx.storage.set("safety", data))
      .catch(() => {
        persistenceHealthy = false;
        sink.emit({ time: Date.now(), type: "persistence-unavailable" });
      });
    return persistChain;
  };
  const scheduler = new CompactionScheduler(
    config,
    {
      compact: async (sessionId, id) => {
        if (!persistenceHealthy)
          throw new Error("Safety persistence unavailable");
        await persist(); // Durable local intent before admitting the runtime control.
        if (
          !monitor?.sessions.has(sessionId) ||
          monitor?.sessions.get(sessionId)?.compaction.phase !== "requesting"
        )
          throw new Error("Session no longer requesting");
        if (!persistenceHealthy || stopped)
          throw new Error("Safety persistence unavailable");
        await ctx.session.compact(
          { sessionID: sessionId, id, delivery: "steer" },
          { signal: controller.signal },
        );
      },
    },
    sink,
  );
  monitor = new ContextMonitor(config, scheduler, sink);
  const activeMonitor = monitor;
  let models = new Map<string, ModelLimits>(),
    modelAt = 0,
    modelRetryAt = 0,
    modelRetryMs = 1000;
  async function refreshModels(retryMissing = false) {
    const now = Date.now();
    if (now - modelAt < 60000 && (!retryMissing || now < modelRetryAt)) return;
    modelAt = now;
    modelRetryAt = now + modelRetryMs;
    modelRetryMs = Math.min(60000, modelRetryMs * 2);
    try {
      models = new Map(
        (
          await ctx.model.list(undefined, { signal: controller.signal })
        ).data.map((m) => [`${m.providerID}/${m.id}`, { ...m.limit }]),
      );
      let missing = false;
      for (const s of activeMonitor.sessions.values()) {
        const limits = s.model ? models.get(s.model) : undefined;
        if (limits) s.limits = { ...limits };
        else {
          delete s.limits;
          missing ||= s.model !== undefined;
        }
        store.mark(s.sessionId);
      }
      if (!missing) modelRetryMs = 1000;
      store.recover("model-metadata-unavailable");
    } catch {
      models.clear();
      for (const s of activeMonitor.sessions.values()) {
        delete s.limits;
        store.mark(s.sessionId);
      }
      sink.emit({ time: Date.now(), type: "model-metadata-unavailable" });
    }
  }
  async function discover(sessionId: string) {
    const info = await ctx.session.get(
      { sessionID: sessionId },
      { signal: controller.signal },
    );
    if (info.location.directory !== ctx.location.directory) return;
    const identity: Identity = {
      sessionId,
      ...(info.parentID ? { parentId: info.parentID } : {}),
      ...(info.agent ? { agent: info.agent } : {}),
      ...(info.model
        ? { model: `${info.model.providerID}/${info.model.id}` }
        : {}),
    };
    if (
      !activeMonitor.sessions.has(sessionId) &&
      !recoveries.has(sessionId) &&
      activeMonitor.sessions.size + recoveries.size >= config.safety.maxSessions
    ) {
      sink.emit({ time: Date.now(), type: "capacity-exceeded" });
      return;
    }
    const s = activeMonitor.touch(
      identity,
      identity.model ? models.get(identity.model) : undefined,
    );
    if (s) {
      if (!identity.model || !models.has(identity.model)) delete s.limits;
      const recovery = recoveries.get(sessionId);
      if (recovery) {
        s.compaction = recovery.compaction;
        s.sequence = recovery.sequence ?? -1;
        recoveries.delete(sessionId);
      }
      if (config.metrics.enabled) {
        if (
          !performance.snapshot(sessionId) &&
          [...performance.ids()].length >= config.safety.maxSessions
        ) {
          const dormant = [...performance.ids()].find(
            (id) => !performanceResidents.has(id),
          );
          if (dormant) performance.remove(dormant);
        }
        performance.observe(
          sessionId,
          info.time.created,
          outputTokens(info.tokens),
        );
        performanceResidents.add(sessionId);
      }
      s.usage.cumulative = info.tokens;
      s.usage.cumulativeScope = "session";
      store.mark(s.sessionId);
    }
    return s;
  }
  // Coalesce hook snapshots per session. No asynchronous control request is awaited by a hook.
  const pending = new Map<
    string,
    { identity: Identity; at: number; estimate?: number }
  >();
  let draining = false;
  async function drainHooks() {
    if (stopped) return;
    try {
      // A catalog read can precede provider initialization. Repair missing limits
      // with bounded backoff; never evaluate policy merely because metadata arrives.
      await refreshModels(
        [...activeMonitor.sessions.values()].some(
          (s) => s.model !== undefined && !models.has(s.model),
        ),
      );
      for (const [id, h] of pending) {
        pending.delete(id);
        try {
          const s = activeMonitor.sessions.get(id) ?? (await discover(id));
          if (!s) continue;
          if (
            h.at <=
            Math.max(s.lastExecutionEnd ?? 0, s.compaction.lastCompleted ?? 0)
          )
            continue;
          activeMonitor.touch(
            h.identity,
            h.identity.model ? models.get(h.identity.model) : undefined,
          );
          s.active = true;
          if (
            (!s.usage.current ||
              Date.now() - s.usage.current.at > config.safety.staleMs) &&
            h.estimate !== undefined &&
            s.model
          )
            activeMonitor.measure(s, {
              tokens: h.estimate,
              at: h.at,
              model: s.model,
              confidence: "approximate",
              provenance: "serialized-estimate",
              scope: "prepared-request",
            });
          else activeMonitor.evaluate(s);
        } catch {
          sink.emit({ time: Date.now(), type: "session-observation-failed" });
        }
      }
    } finally {
      draining = false;
    }
  }
  const hook = (event: SessionContext) => {
    if (stopped) return;
    const id = event.sessionID,
      model = `${event.model.providerID}/${event.model.id}`,
      current = activeMonitor.sessions.get(id)?.usage.current;
    if (!pending.has(id) && pending.size >= config.safety.maxSessions) {
      sink.emit({ time: Date.now(), type: "hook-capacity-exceeded" });
      return;
    }
    const fallback =
      !current ||
      current.model !== model ||
      Date.now() - current.at > config.safety.staleMs;
    const tokens = fallback
      ? estimate([event.system, event.messages, event.tools])
      : undefined;
    pending.set(id, {
      identity: { sessionId: id, agent: event.agent, model },
      at: Date.now(),
      ...(tokens === undefined ? {} : { estimate: tokens }),
    });
  };
  const registrations: Registration[] = [];
  try {
    registrations.push(await ctx.session.hook("context", hook));
    // No mutations or custom summary: the hook only marks an ongoing summary.
    registrations.push(
      await ctx.session.hook("compaction", (e) => {
        const s = activeMonitor.sessions.get(e.sessionID);
        if (s) {
          s.compaction.phase = "running";
          s.compaction.armed = false;
          store.mark(s.sessionId);
        }
      }),
    );
  } catch (error) {
    for (const r of registrations) await r.dispose();
    await history.flush();
    await stopSnapshots();
    throw error;
  }
  const relevant = new Set([
    "session.usage.updated",
    "session.created",
    "session.step.started",
    "session.step.streamed",
    "session.step.ended",
    "session.step.failed",
    "session.compaction.started",
    "session.compaction.ended",
    "session.compaction.failed",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "session.deleted",
    "session.model.selected",
    "session.agent.selected",
    "session.tool.called",
  ]);
  async function handle(event: OpenCodeEvent) {
    if (event.location && event.location.directory !== ctx.location.directory)
      return;
    if (
      event.type === "session.text.delta" ||
      event.type === "session.reasoning.delta"
    ) {
      if (config.metrics.enabled)
        performance.delta(
          event.data.sessionID,
          event.data.assistantMessageID,
          event.id,
          event.created,
          event.data.delta.length,
        );
      return;
    }
    if (!relevant.has(event.type) || !("sessionID" in event.data)) return;
    const id = event.data.sessionID;
    if (event.location && event.location.directory !== ctx.location.directory)
      return;
    if (event.type === "session.deleted") {
      recordPerformance(id, "terminal", "session.deleted");
      performance.remove(id);
      performanceResidents.delete(id);
      await persistPerformance();
      store.remove(id);
      requests.delete(id);
      activeMonitor.remove(id);
      recoveries.delete(id);
      await persist();
      return;
    }
    await refreshModels();
    // O(1) session metadata/totals lookup, never a full transcript scan.
    const s = await discover(id);
    if (!s) return;
    if (
      "durable" in event &&
      event.durable &&
      !activeMonitor.accept(s, event.durable.seq)
    )
      return;
    const perfAccepted =
      config.metrics.enabled &&
      (!("durable" in event) ||
        !event.durable ||
        performance.accept(id, event.durable.seq));
    switch (event.type) {
      case "session.step.started":
        if (perfAccepted)
          performance.start(
            id,
            event.data.assistantMessageID,
            event.data.agent,
            `${event.data.model.providerID}/${event.data.model.id}`,
            event.data.started,
          );
        activeMonitor.touch(
          {
            sessionId: id,
            agent: event.data.agent,
            model: `${event.data.model.providerID}/${event.data.model.id}`,
          },
          models.get(`${event.data.model.providerID}/${event.data.model.id}`),
        );
        requests.set(id, {
          id: event.data.assistantMessageID,
          model: `${event.data.model.providerID}/${event.data.model.id}`,
        });
        s.usage.modelRequests++;
        s.active = true;
        break;
      case "session.step.streamed":
        if (perfAccepted)
          performance.streamed(
            id,
            event.data.assistantMessageID,
            event.created,
          );
        break;
      case "session.step.ended":
      case "session.step.failed": {
        if (perfAccepted)
          performance.settle(
            id,
            event.data.assistantMessageID,
            event.data.tokens ? outputTokens(event.data.tokens) : undefined,
          );
        const tokens = event.data.tokens && promptTokens(event.data.tokens);
        const request = requests.get(id);
        if (
          tokens !== undefined &&
          request?.id === event.data.assistantMessageID &&
          request.model === s.model
        )
          activeMonitor.measure(s, {
            tokens,
            at: event.created,
            requestId: event.data.assistantMessageID,
            model: request.model,
            confidence: "reported",
            provenance: "provider-normalized",
            scope: "completed-request",
          });
        else {
          delete s.usage.current;
          sink.emit({
            time: Date.now(),
            type: "provider-usage-unavailable",
            session: s,
          });
        }
        break;
      }
      case "session.compaction.started":
        scheduler.lifecycle(s, "started", event.created);
        break;
      case "session.compaction.ended":
        scheduler.lifecycle(s, "ended", event.created);
        break;
      case "session.compaction.failed":
        scheduler.lifecycle(s, "failed", event.created);
        break;
      case "session.execution.started":
        s.active = true;
        break;
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        s.active = false;
        // Terminal execution without settlement means request timing is incomplete.
        if (performance.snapshot(id)?.tokenSource === "estimated")
          performance.gap(id);
        s.lastExecutionEnd = event.created;
        break;
      case "session.tool.called":
        s.usage.toolCalls++;
        break;
    }
    sink.emit({ time: Date.now(), type: "session-state", session: s });
    if (perfAccepted) {
      recordPerformance(
        id,
        event.type === "session.step.ended" ||
          event.type === "session.step.failed"
          ? "request"
          : event.type.startsWith("session.execution.") &&
              event.type !== "session.execution.started"
            ? "terminal"
            : "lifecycle",
        event.type,
      );
      await persistPerformance();
    }
    await persist();
  }
  let lastPerformanceSample = 0,
    lastHistorySample = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    if (
      config.metrics.enabled &&
      now - lastPerformanceSample >= config.metrics.sampleIntervalMs
    ) {
      lastPerformanceSample = now;
      for (const id of performanceResidents) {
        store.mark(id);
        const snapshot = performance.snapshot(id);
        if (
          now - lastHistorySample >= 1000 &&
          snapshot &&
          (snapshot.status === "waiting" || snapshot.status === "streaming")
        )
          recordPerformance(id, "sample");
      }
      if (now - lastHistorySample >= 1000) lastHistorySample = now;
    }
    store.flush();
    if (draining || stopped) return;
    draining = true;
    void serialized(async () => {
      await drainHooks();
      activeMonitor.cleanup();
      if (
        activeMonitor.sessions.size + recoveries.size <
        config.safety.maxSessions
      )
        store.recover("capacity-exceeded");
      for (const id of performanceResidents)
        if (!activeMonitor.sessions.has(id)) {
          performance.remove(id);
          performanceResidents.delete(id);
        }
      for (const id of requests.keys())
        if (!activeMonitor.sessions.has(id)) requests.delete(id);
    }).catch(() => {
      draining = false;
    });
  }, 100);
  timer.unref();
  // Stream reconnection cannot replay missed lifecycle evidence. Freeze enforcement on a gap.
  const events = (async () => {
    while (!stopped) {
      try {
        for await (const event of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          if (stopped) break;
          await serialized(() => handle(event));
        }
      } catch {
        /* Stream errors and normal unexpected EOF both invalidate observation continuity. */
      }
      if (!stopped) {
        performance.gap();
        for (const id of performanceResidents) {
          store.mark(id);
          recordPerformance(id, "gap", "event-stream-gap");
        }
        await persistPerformance();
        sink.emit({
          time: Date.now(),
          type: "event-stream-gap",
          detail:
            "Enforcement suspended until reload; measurements may be incomplete",
        });
        scheduler.stop();
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(t);
            controller.signal.removeEventListener("abort", finish);
            resolve();
          };
          const t = setTimeout(finish, 1000);
          controller.signal.addEventListener("abort", finish, { once: true });
        });
      }
    }
  })();
  if (!persistenceHealthy)
    sink.emit({
      time: Date.now(),
      type: "persistence-unavailable",
      detail: "Enforcement disabled; safety state could not be read",
    });
  if (!injectedSink)
    console.error(
      `context-guard: ${config.mode}; diagnostics ${disk.path}; metrics ${history.path}`,
    );
  sink.emit({
    time: Date.now(),
    type: "ready",
    detail: `SDK 2.0.29; runtime ${ctx.app.version}; ${config.mode}; active-subagent=step-boundary; next-request-barrier=false; journal=${disk.path}; metrics=${history.path}`,
  });
  return async () => {
    stopped = true;
    scheduler.stop();
    controller.abort();
    clearInterval(timer);
    pending.clear();
    const disposed = await Promise.allSettled(
      registrations.map((r) => r.dispose()),
    );
    if (disposed.some((r) => r.status === "rejected"))
      sink.emit({ time: Date.now(), type: "registration-cleanup-failed" });
    await events;
    await work;
    await scheduler.flush();
    await persist();
    await persistPerformance();
    await history.flush();
    await stopSnapshots();
    await disk.flush();
  };
}
