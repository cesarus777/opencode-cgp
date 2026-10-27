# Standalone Context Guard dashboard

## Goal and scope

Build one read-only dashboard application with two frontends: a local browser page and a full-screen terminal app. Working name: **Context Guard Dashboard** (Grafana-inspired layout, without a Grafana dependency). It connects to an OpenCode V2 server with this plugin installed and shows current context, compaction, performance, and retained-history metrics for root and child sessions. Launch it independently of OpenCode's native TUI, desktop, or web client.

Initial commands:

```sh
context-guard dashboard web [--server URL] [--directory PATH] [--port PORT]
context-guard dashboard tui [--server URL] [--directory PATH]
```

`--directory` selects the owning OpenCode location. A location picker can list discovered locations, but every RPC read must use an explicit location. The web command serves a loopback-only page and prints its URL; the TUI command owns the alternate screen and restores the terminal on exit. Both commands are read-only. They do not alter policy, trigger compaction, or change OpenCode sessions.

## Existing contracts to reuse

| Source                                                                       | Dashboard use                                                                                                                 |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `context-guard.monitor.v2` read and `changed` events                         | Live per-session context, policy, compaction, health, and performance. Fall back to v1 with performance shown as unavailable. |
| `context-guard.history.v1` read                                              | Bounded historical performance series and request markers for the selected session.                                           |
| Public OpenCode session APIs                                                 | Discover root/child hierarchy and execution state without reading transcripts.                                                |
| `SnapshotClient`, `discoverFamily`, `buildChartData`, and formatting helpers | Reuse sequence/epoch reconciliation, bounded discovery, chart semantics, and labels where the interfaces fit.                 |

No new server RPC is required for the first release. The current history RPC is **one session at a time**, **at most seven days**, and **at most 500 points/requests** per response; the dashboard must show these bounds and partial/gap indicators. The live RPC does not enumerate all sessions by itself, so inventory must come from OpenCode's public session APIs. “All current metrics” means all fields currently exposed by these contracts, not provider metrics the plugin does not collect.

## Shared data layer

1. Add a dashboard controller that owns one authenticated OpenCode SDK client, one inventory per location, one `SnapshotClient` per selected location, and a bounded history cache. Keep its state independent of browser and terminal rendering.
2. For the local background service, use `Service.discover()` and `Service.headers()`; do not silently start a server. Accept `--server` and an explicit credential source for a remote server. Never put credentials in a browser URL, browser storage, logs, or dashboard events.
3. Discover roots and their descendants with pagination and existing node/page/depth limits. Mark partial inventory when a limit or API failure prevents completeness. Refresh inventory periodically and on demand. Scope every RPC read to the owning location and filter RPC events by event location.
4. Subscribe to `monitor.v2` events, read a baseline in chunks, and reuse epoch, revision, sequence-gap, timeout, reconnect, and periodic reconciliation behavior. Probe v2 then v1. Preserve last known values during interruptions but mark them stale; never represent missing data as zero.
5. Fetch history only for the selected session and time window. Cancel obsolete requests on session/window changes, cap concurrent reads, and cache by location/session/window until refresh. Reuse chart gap and downsampling logic.
6. Expose a narrow immutable view model to both frontends: connection/health, inventory, selected session, context/policy/compaction, performance, history, provenance, and completeness notices.

## Screens and interaction

The overview shows connection and enforcement health, monitored/active session counts, and a searchable root/child tree. Rows show agent/model, current prompt tokens and capacity, occupancy, trigger/headroom, pressure, compaction phase, live TPS, and measurement age. Unknown, stale, estimated, blocked, uncertain, and partial values have distinct text labels as well as color.

The selected-session detail shows the complete snapshot contract: usage source/scope, input capacity and output reserve, configured threshold and effective trigger, peak, cumulative input/output/reasoning/cache totals, compaction count/arming/timestamps/reason, and all `PerformanceSnapshot` fields (status, live and average TPS, TTFT, latest request, output totals, timing, completed requests, token source, partial flag). Display request/session IDs as identifiers, with truncation only in narrow layouts.

History offers the existing six views: live TPS, average model TPS, average session TPS, TTFT, completed-request TPS, and cumulative output. Provide 5 minute, 1 hour, 24 hour, and 7 day windows; session/agent/model filters; exact sample/request details; and notices for gaps, retention, downsampling, and disabled history. Summaries must use matched request data and preserve its provenance.

Both frontends use the same navigation model: choose location, choose session, switch overview/detail/history, change window, search/filter, refresh, and open help. The terminal frontend adds keyboard shortcuts and resize-aware plots; the browser frontend adds responsive SVG plots, hover/focus details, and accessible labels. Avoid relying on color alone.

## Browser delivery and terminal runtime

The CLI process serves bundled HTML/CSS/JavaScript and a **read-only local bridge** over `127.0.0.1` by default. The bridge holds OpenCode credentials and fans out sanitized view-model updates to browser clients; browsers do not call privileged OpenCode APIs directly. Bind to a random port unless specified. Protect bridge requests with a per-launch unguessable HttpOnly, SameSite cookie set on the initial page response, plus strict Host/Origin checks; keep that token out of URLs and JavaScript. Use no permissive CORS, a restrictive content security policy, and no external assets. Show the URL in the terminal; optionally open it with a platform browser command. An explicit future option may permit remote dashboard access only after a separate authentication design.

The terminal frontend runs as a standalone Bun application using a dedicated terminal renderer, rather than importing the host-only `@opencode/plugin/tui` entry. Start with a responsive text/table layout and reuse the existing six-row chart renderer where feasible. Handle terminal resize, shutdown signals, and alternate-screen cleanup. Keep terminal renderer dependencies separate from the server plugin entry and package exports.

## Delivery sequence

1. **Connection spike:** prove service discovery/authentication, explicit remote URL, location-scoped monitor read/event subscription, history read, and session pagination against OpenCode 2.0.29 and 2.1.2. Record any SDK incompatibility before committing to transport code.
2. **Shared controller:** implement bounded inventory, live reconciliation, v1/v2 negotiation, history fetching, immutable view model, and deterministic unit tests for gaps/restarts/locations/unknown data.
3. **Terminal MVP:** overview, details, history, keyboard navigation, resize/cleanup, and a live smoke test with the synthetic provider. Verify behavior while OpenCode's own TUI is closed.
4. **Browser MVP:** bundled local page, bridge, responsive overview/details/charts, accessibility, local authentication boundaries, and a live browser smoke test. Verify multiple tabs and reconnects do not multiply upstream subscriptions.
5. **Packaging and docs:** add CLI subcommands/build assets, package smoke coverage, README usage, screenshots, supported-host notes, and a validation record. Run formatting, typecheck, offline tests, package test, and both frontend live checks.

Acceptance: either command starts from the published package; both frontends show the same current metrics and statuses for a root and concurrent children; a server restart/event gap recovers without false zeros or duplicate requests; unknown/partial/estimated data stays labeled; history respects its server bounds; no prompt, response, tool output, or credential reaches logs or the browser payload.

## Open decisions

- Confirm the standalone terminal renderer and exact package size impact during the connection/runtime spike.
- Decide whether a remote-server credential is supplied through an environment variable, protected file, or OS credential store before implementing remote access. Keep it out of command arguments and URLs.
- A cross-location overview would require bounded location discovery and per-location transport. Ship an explicit location selector first; aggregate later if there is a demonstrated need.

## Implementation progress

2026-10-22: the connection spike is implemented in `src/dashboard/connection.ts` with a disposable `test:dashboard-spike` harness and deterministic offline tests. Both OpenCode 2.0.29 and 2.1.2 passed discovery/authentication, paginated inventory, location-scoped monitor reads/events and history with the native TUI closed. See the [validation record](../validation/dashboard-connection-2026-10-22.md), including SDK routing details and the standalone renderer's Bun runtime constraint. Remote CLI credentials will come from environment variables. Shared controller and frontend implementation are next; dashboard CLI commands are not yet available.

2026-10-22: the shared controller is implemented in `src/dashboard/controller.ts`, with bounded whole-location inventory, one selected-location live transport, cancellable serialized history reads, bounded caches, shared navigation/filter state and an immutable scalar view model. The expanded live probe passes on both host versions; 24 deterministic dashboard tests cover gaps, restarts, locations, unknown/stale data, bounds and privacy. See the [controller validation record](../validation/dashboard-controller-2026-10-22.md). The terminal MVP is the next delivery step; CLI commands and frontends are not yet available.
