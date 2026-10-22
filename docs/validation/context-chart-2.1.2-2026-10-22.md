# OpenCode 2.1.2 compatibility and context chart validation

OpenCode was upgraded from 2.0.29 to the stable npm `latest`, 2.1.2, using the existing `~/.local` npm installation. The installed binary reports `opencode v2.1.2`. The plugin's SDK dependencies remain pinned at 2.0.29 so the existing minimum supported host and clean-consumer types stay covered; native host integration is verified separately.

## Reproduction

```sh
bun run build
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
GUARD_PACKAGE_HOST=1 bun run validate
npm pack --dry-run
```

The host test uses disposable project/configuration/data/cache/state directories, an authenticated loopback server and a synthetic SSE provider. It does not use genuine provider credentials, edit user configuration or request downloads of models. Python 3 with `pyte`, Pillow and `fc-match` is needed for the PTY previews.

## Fixture updates for the current public API

The 2.1.2 fixture uses `@opencode/ai/providers/openai-compatible` and the reasoning capability `{ supported: true }`. The earlier 2.0.29 fixture keeps its original provider runtime and boolean capability. The new reasoning shape is defined in the [2.1.2 configuration schema](https://github.com/anomalyco/opencode/blob/v2.1.2/packages/schema/src/config/provider.ts); the native package follows the [public provider guide](https://opencode.ai/v2/docs/providers). The harness waits for the synthetic models in the public catalog before issuing requests, and failure diagnostics contain only scalar identities, metrics and event/error types.

A boolean reasoning capability on 2.1.2 caused the test provider configuration to be unavailable, producing `provider.no-route`. This was fixed in the disposable fixture. No plugin lifecycle assumptions or user model limits were changed to bypass that failure.

## Validation results

Formatting, strict type checking and all 132 offline tests passed. The clean-package check passed with npm 11.21.0, including 16 adapter regressions against the installed tarball, actual 2.1.2 registration/RPC checks in observe and enforce modes, native TUI rendering/reactivity and consumer declaration compilation. The dry-run pack contained 41 allowlisted files. The initial npm 12.2.0 cold install reached the former three-minute command deadline; clean-package commands now allow five minutes, and the retry used the same npm version as CI.

## Checked behavior

- Public monitor v1, performance v2 and history v1 RPCs; live streaming rates/TTFT, reported totals, hierarchy, model changes, idle time and bounded history.
- History restart/retention, scalar privacy canaries, ownership checks and disabled history.
- Actual compiled TUI controls and cleanup, plus pauses, native child permission waits, child tool activity, temporarily lower usage and manual compaction.
- A 70% level held through pauses and a temporarily reported 50%, followed by a confirmed post-compaction measurement at 10%. Both levels remain visible after switching from the panel back to the sidebar.
- Context panels at 80×40 and 180×60, with the actual scroll viewport width keeping chart edges and baseline on screen.
- Automatic child compaction after tools, continuation after completion and successful execution termination.

Scalar PTY chart rectangles are saved to ignored `.artifacts/context-*.txt` and `.png`. PNGs reconstruct terminal character/color cells; they are not desktop screenshots and contain no session messages, titles or tool output. Local chart history is bounded and shared between sidebar/panel views, as described in [configuration](../configuration.md).

Genuine-provider accounting, cross-machine clients, tmux and Neovim remain outside this synthetic-provider validation. This report does not imply that npm staging is public publication; release status must be checked separately.

The 0.2.4 tag passed CI but its release preflight stopped before staging. The 0.2.5 release uses bounded npm-client registry lookups; a local preflight confirmed the unused version, and tests verify that authentication/network failures, malformed responses and interrupted commands cannot permit publication.
