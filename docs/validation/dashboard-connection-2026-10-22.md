# Standalone dashboard connection spike

The first delivery step in [the dashboard plan](../plans/standalone-dashboard.md) passed against local OpenCode **2.0.29** and **2.1.2**, using the repository's pinned `@opencode/client@2.0.29` and Bun 1.1.34. The native TUI was closed throughout both probes. No provider calls were made.

## Implementation and reproduction

`src/dashboard/connection.ts` owns one authenticated SDK client and exposes only server information, paginated session inventory, monitor transport and bounded history reads. It does not start a server or expose session mutations. Every instance requires an absolute owning directory. Credentials remain in process closures; connection serialization contains only the location. Errors omit SDK responses, credentials and URLs. Explicit URLs reject embedded credentials, query strings, fragments and non-loopback plain HTTP; SDK requests reject redirects.

```sh
bun run build
GUARD_DASHBOARD_HOST=1 bun run test:dashboard-spike
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BINARY=/absolute/path/to/2.0.29/opencode bun run test:dashboard-spike
```

The fixture starts an authenticated loopback host with isolated project/configuration/data/cache/state directories and the built plugin in observe mode. It creates disposable roots and a child, writes a private service registration pointing to this host, exercises `Service.discover()` and `Service.headers()`, then stops the host and removes its temporary files. It never replaces the user's registered service. Without `GUARD_DASHBOARD_HOST=1`, the script prints an explicit skip.

Both versions passed explicit URL authentication, local service discovery/authentication, root cursor pagination, child discovery, location-scoped v2 monitor reads, location-filtered changed events, enabled history reads and bounded-retention metadata. Unmeasured sessions retained absent measurements. Returned scalar contracts contained no authentication password.

## SDK findings

No transport incompatibility was found between these two host versions. The public session list API accepts `directory` as a query filter; it does **not** accept the RPC-style `location` option. Monitor/history RPC reads carry `location: { directory }`. RPC event subscriptions are server-wide and require client-side event location filtering. These distinctions are covered by deterministic fetch fixtures using the actual SDK request encoder/decoder.

Offline tests also cover absent local service, credential privacy, invalid locations/URLs, redirect rejection configuration, sanitized transport failures, v2 preference, v1 fallback, foreign-location events, explicit empty history and seven-day/500-point bounds. They need no network or listening ports. The live history check reads an empty retained window; streaming rates, populated history, reconnection and restart recovery remain controller/frontend validation work.

## Runtime and packaging decisions

Remote CLI authentication will use `CONTEXT_GUARD_PASSWORD` with optional `CONTEXT_GUARD_USERNAME` (default `opencode`). The connection accepts credentials in memory; the CLI environment mapping will be added with the dashboard commands. Passwords will not be command arguments. HTTPS is required outside loopback.

The terminal renderer candidate is the public `@opentui/core@0.5.17` API, loaded only by the standalone terminal entry, without the host's `@opencode/plugin/tui` or Solid registration. It is already an optional peer of this package, so this spike adds **zero dependencies** and no renderer to server imports. The installed Linux x64 directories measure 13,728,413 bytes for core and 6,343,910 bytes for its native platform package (directory sizes, excluding transitive dependencies; not npm download sizes). Exact standalone package/install impact remains a terminal packaging gate.

Core declares Bun `>=1.3.0`, while this package declares `>=1.1.34`. A standalone terminal launch must explicitly enforce a supported renderer runtime, or select a renderer compatible with the existing minimum. The spike does not certify the standalone terminal runtime merely because existing host renderer tests pass. Browser/TUI commands, the controller, bridge authentication and frontend smoke checks are subsequent delivery steps.
