# Release 0.3.0 validation — 2026-10-28

Scope: standalone terminal dashboard, retained-request model analytics and paused context chart fixes since v0.2.5. Browser delivery, a Models dashboard screen and a durable analytics ledger remain outside this release.

## Results

- Formatting, strict typecheck and all 173 offline tests pass on Bun 1.1.34.
- The release package builds and installs in an isolated consumer. Server/core/RPC imports and model analytics work without renderer peers; installed adapter regressions, compiled native TUI rendering/reactivity/disposal and consumer declaration checks pass.
- Packaged OpenCode server registration/RPC checks pass in observe and enforce modes with `GUARD_PACKAGE_HOST=1`.
- The clean-installed standalone terminal passes authenticated synthetic-provider PTY checks on OpenCode 2.1.2: populated root/concurrent children, all metrics/windows, navigation, resizing, restart recovery, privacy and terminal restoration.
- The built standalone terminal passes the same synthetic-provider checks on OpenCode 2.0.29. Terminal checks use Bun 1.3.11 and `@opentui/core@0.5.17`.
- Registry lookup confirmed `latest` at 0.2.5 and 0.3.0 unused before release preparation. A successful staging workflow still requires npm approval before public publication.

## Commands

```sh
bun install --offline
GUARD_PACKAGE_HOST=1 GUARD_PACKAGE_TERMINAL=1 GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run validate
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BINARY=/tmp/guard-terminal-host-2029/node_modules/@opencode/cli-linux-x64/bin/opencode GUARD_DASHBOARD_BUN=/tmp/guard-terminal-runtime/node_modules/@oven/bun-linux-x64/bin/bun bun run test:dashboard-terminal
npm pack --dry-run --json --ignore-scripts
```

Host binary details and terminal runtime setup are recorded in the [terminal validation report](dashboard-terminal-2026-10-28.md). The release checks use Node 26.11.1/npm 12.2.0 locally; GitHub release CI separately pins Node 22.14.0/npm 11.21.0. These results do not certify real-provider timing, cross-machine clients, other platforms or permanent history. npm credentials and generated provider content are excluded from committed artifacts.
