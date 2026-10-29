# Terminal model analytics validation — 2026-10-29

Scope: aggregate Models list/charts/request details in the standalone terminal dashboard and the read-only location-scoped `context-guard.analytics.v1` service, prepared for version 0.4.0. Publication status is tracked separately through the release workflow and npm staging.

## Behavior

Press **4**, choose a model, then **Enter**. Charts show weighted request TPS, TTFT median/p95, completed requests and reported output across retained root, child and archived sessions. Time buckets and range totals share the CLI's reconciled request facts and completion-time filtering. Pagination, resolution and live inventory do not limit aggregate input. Unknown usage/attribution, independent eligibility and partial coverage remain explicit.

Model and request pages contain at most 50 rows. The service coalesces archive reads, caches normalized facts for 30 seconds and retains at most two 90-second query snapshots. Opaque cursors bind to the query snapshot and selected model/sort. Resizing re-buckets the snapshot; metric/bucket navigation remains local. Failed refreshes retain stale results; location/filter changes cancel obsolete reads. Existing screens remain usable when analytics is unsupported.

## Results

- Formatting, strict TypeScript checks and all **201 offline tests** pass on Bun 1.1.34. The build emits all public entries and consumer declarations.
- Wrapped model rows remain completely reachable in both directions at widths of 1, 20, 35 and 80 columns with a 12-line viewport. End reaches the final eligibility information; tall rows scroll before selection advances.
- Core/server tests cover weighted rates, completion boundaries, eligibility, empty buckets, more than 500 requests and 128 archived sessions, stable pagination while records append, independent totals, long model identities, unknown attribution, cursor binding/expiry, shared/cancelled scans, late completion, bounded caches and scalar payload projection.
- Dashboard and public native-renderer tests cover model selection/sorting, seeded model filters, exact bucket values, agent filters, session-search independence, capability fallback, stale recovery, pagination, cancellation, resize, axis alignment and a single existing monitor subscription.
- Authenticated synthetic-provider PTYs pass on **OpenCode 2.1.2 and 2.0.29** with Bun 1.3.11 for the terminal. The native OpenCode client runs in an independent PTY while the dashboard operates. Checks include model charts/request details, aggregate equality with the offline calculation, local metric/bucket navigation, resize, server restart, privacy and terminal restoration. Quitting the dashboard leaves the native client alive. Native-client content is discarded rather than captured.
- Clean npm tarball checks pass against **both hosts**. The installed server queries **600 archived sessions absent from live inventory**, returning complete aggregate totals and bounded detail pages in observe and enforce modes. A different location cannot access the registered archive. Installed dashboard PTYs, 16 installed adapter regressions, native TUI rendering/shared reactivity, all public exports and TypeScript consumer declarations pass. The standalone renderer installs automatically, and old-Bun server/offline consumers remain usable.
- Cache tests verify one archive scan across model selection, sort, pagination and resolution changes. Actual host reads complete within the configured RPC deadlines. No performance claim for maximum-size archives is inferred from these fixtures.

## Reproduction

```sh
bun run format:check
bun run typecheck
bun test
bun run build

GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run test:dashboard-terminal
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run test:dashboard-terminal

GUARD_PACKAGE_HOST=1 GUARD_PACKAGE_TERMINAL=1 GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run test:package
GUARD_PACKAGE_HOST=1 GUARD_PACKAGE_TERMINAL=1 GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run test:package
```

All listed host/terminal opt-ins were enabled; these live checks passed rather than skipped. Local packaging uses Node 26.11.1/npm 12.2.0; CI's pinned Node/npm toolchain remains a separate check. Tests use isolated configuration, generated authentication and synthetic provider data. Real-provider timing, cross-machine HTTPS, other platforms, maximum-size archive performance, durable/all-time history, custom date-range editing and a native-panel Models view remain outside this validation.
