# 0.4.2 release validation

Date: 2026-11-08. Status: release prepared for commit, tag and staged npm publication. Public publication is verified separately after the registry approval step.

## Scope and documentation

This release restores the primary sidebar context chart by default and capacity bars for visible subagents. It also shares bounded revisioned archive reads between History and Models, adds captured-size streaming and independent cancellation, reuses normalized facts and query variants, bounds Overview formatting to its viewport, and publishes progressive standalone discovery with four branch requests.

The [dashboard performance report](dashboard-performance-2026-11-08.md) and its raw JSON record three sequential before/after process runs per workload on Bun 1.3.11. Warm reads improve; first-ever reads still take seconds and some Models projections exceed the 20 ms timer-delay target. Benchmark-only worker/index prototypes are not runtime dependencies. These limitations remain open and are not advertised as completed first-read optimization.

Documentation audit updated the README's release examples, cache and discovery descriptions; configuration's revision semantics; architecture and compatibility; benchmark reproduction; sidebar description and golden frame; the investigation's historical status; implementation delivery status; release instructions; and changelog. The historical 0.4.1 candidate record now identifies its subsequent publication without rewriting its original validation evidence.

The package version is `0.4.2`. npm confirmed `0.4.1` as `latest` and returned E404 for `0.4.2` before preparation. `bun install --ignore-scripts` found no dependency or binary-lockfile changes.

## Validation

The implementation checks passed before release preparation:

- 250 offline tests across 33 files; strict typecheck, build, formatting and diff checks.
- Clean packed install, all exports, 16 behavioral tests, standalone renderer/preflight, native TUI rendering/reactivity/cleanup and consumer declarations.
- Packed monitor/History and location-isolated analytics over 600 archived sessions on the actual host in observe and enforce modes.
- Built standalone PTYs on OpenCode 2.0.29 and 2.1.2: History/Models, all metrics/windows, fault/retry, restart, native-client survival, scalar privacy canaries and terminal restoration.

The final versioned candidate additionally passed the CI minimum Bun 1.1.34 formatting/type/unit/build checks (250 tests, 0 failures). Clean package verification also passed: 65 allowlisted files, all exports, installed behavioral tests, native TUI rendering/reactivity/cleanup and consumer declarations. The optional installed interactive PTY is reported as skipped unless explicitly enabled; it is separate from the built-checkout PTYs above. Genuine-provider accounting, remote routing, other platforms and long-running memory behavior remain outside this validation.

## Publication

The repository's `v*` tag workflow validates the exact tag/version pair and stages the package through npm OIDC with provenance. Successful staging is not public publication. Maintainer 2FA approval is still required by npm. Release progress, workflow URL and final registry state are reported with the release operation; no credentials or OTPs belong in this record.
