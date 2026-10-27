# Standalone dashboard shared controller

The second step of the [standalone dashboard plan](../plans/standalone-dashboard.md) is implemented. `DashboardController` supplies the same immutable, scalar-only application state to future terminal and browser frontends. Dashboard CLI commands and frontend rendering are still subsequent milestones.

## Behavior and bounds

- One authenticated SDK client can bind explicit locations through `atLocation()`. Only the selected location has a live `SnapshotClient`; any number of view subscribers share it. Up to four location inventories/snapshot sets are retained.
- Inventory discovers paginated roots and descendants, with defaults of 1,024 sessions, 100 pages and 64 levels. The optional session cap cannot exceed 2,048, matching the live transport. Scans have a 15-second overall deadline and SDK requests retain five-second deadlines. Page/node/depth limits, repeated cursors, invalid hierarchy, foreign locations and API failures produce explicit partial notices. Inventory and public active-session state refresh every 30 seconds and on demand.
- Session titles, arbitrary metadata, permissions, errors and content are excluded at the SDK projection boundary. The server-wide public active-session API is reduced to IDs already in the selected location's inventory. Success/failure comes from native outcome metadata; idle does not establish completion. Failed execution reads preserve labeled stale/unknown status.
- Existing snapshot reconciliation handles epochs, revisions, buffered events, read chunking, two concurrent monitor reads, periodic baselines and retry. A stream gap or read interruption preserves previous values with stale labels and unknown pressure. Measurement and performance age use server time plus monotonic elapsed time. Monitor v1 keeps context available and explicitly labels performance unavailable.
- History is requested only while viewing history for the selected session. Reads are serialized, obsolete selections/windows/locations abort their request signals, and only the latest queued selection is fetched. Up to 16 responses are cached by directory/session/window. Refresh invalidates the location's cache while retaining last successful data with stale labels until replacement. Supported windows are five minutes, one hour, 24 hours and seven days; every read requests at most 500 points/requests. Wrong-session or malformed responses are rejected.
- Agent/model filters apply to retained chart points and request records without additional RPCs. Filtering preserves discontinuities. Summaries use only matched output/duration pairs, retain request partial flags, and expose their source as `matched-request-records`; unmatched durations never acquire zero-valued rates. Retention, gaps, downsampling, partial collection and disabled history have explicit notices. View objects are cloned and recursively frozen.

## Validation

```sh
bun test tests/dashboardconnection.test.ts tests/dashboardinventory.test.ts tests/dashboardcontroller.test.ts tests/dashboardview.test.ts
bun run typecheck
bun test
bun run format:check
bun run build
GUARD_DASHBOARD_HOST=1 bun run test:dashboard-spike
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BINARY=/absolute/path/to/2.0.29/opencode bun run test:dashboard-spike
```

The 24 dashboard tests use injected ports, controlled promises, fetch fixtures and clocks; they require no listening ports or provider access. They cover concurrent children, partial inventory, cancellation, stale/unknown data, v1 fallback, gap/restart recovery, immutable previous views, shared subscriptions, large read chunking/concurrency, matched historical summaries, cache/location bounds, cleanup and privacy rejection.

The full offline suite passed **156 tests across 21 files**; strict type checking, formatting and the build also passed. An initial suite run alongside type checking and the build exceeded the existing native renderer fixture's five-second deadline. Repeating the full suite without those concurrent compilation jobs passed; no renderer timeout or implementation was changed.

The expanded disposable live probe passed on **OpenCode 2.0.29 and 2.1.2**, using `@opencode/client@2.0.29` and Bun 1.1.34, with the native TUI closed. It additionally starts the controller, checks a complete root/child inventory, selects a child, fetches its history and verifies title/metadata/password canaries do not appear in the view model. These host checks use unmeasured sessions and an empty retained history window; populated provider metrics and frontend interaction remain separate smoke gates. Gap/restart checks in this milestone are deterministic transport/controller tests, not a new live server-restart certification.
