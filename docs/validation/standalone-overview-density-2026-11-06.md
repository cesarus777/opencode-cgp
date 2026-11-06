# Standalone overview density and visibility validation

Date: 2026-11-06. Implements UX-04/UX-05 from the [UX review](../plans/tui-ux-review.md), following the [implementation plan](../plans/standalone-overview-density.md).

## Delivered behavior

Standalone Overview now renders bounded rows rather than wrapping its diagnostic sentence. At 72 cells or wider it uses aligned identity, state, context occupancy and threshold columns; narrower terminals use two-line cards. An optional exception line summarizes compaction, failure, usage or inventory/live freshness, with `+N` for further diagnostics. Full IDs, models, performance, freshness breakdowns, lifecycle codes and snapshot fields remain in Details. Interrupted execution and the plain-language compaction explanation are also available there.

Identity space is reserved before hierarchy indentation. Below 100 cells, a list-position `#N` distinguishes repeated names without consuming model space; at wider widths, unique sanitized ID suffixes are used, with position fallback for suffix collisions. Position labels can change with list order; selection continues to follow the controller's full session ID.

The row viewport uses actual header, heading, notice and footer heights. Short viewports reduce cards to identity plus metrics, or identity alone, so selected-row reveal cannot show only a diagnostic tail. Notices are bounded with an overflow hint and remain fully available in Details. Critical shared status remains outside the row viewport. Page movement counts fully visible session rows, with at least one-session progress; arrows still select the adjacent session immediately.

Enter/2 opens full Details; Escape returns to the same selection. The Overview footer retains details and quit actions at usable narrow widths. Filtering preserves the controller's existing selected session; if hidden, Overview indicates that arrows select a visible result. Empty results and removed sessions rebase/clamp the viewport without changing controller fallback policy.

## Offline measurements

Measured using the existing three-session `terminalFixture()`, which has blocked/uncertain compaction exceptions:

| Geometry | Before: row content lines | After: row content lines   | Result                                                                                       |
| -------- | ------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| 80×24    | 12                        | 6, plus one column heading | All three identities and exception lines visible.                                            |
| 40×20    | 25                        | 9                          | All three identities and exception lines visible.                                            |
| 20×12    | 55                        | 9 before viewport slicing  | Selected marker and distinguishing position remain visible; navigation reveals each session. |

Ordinary rows without exceptions use one line wide or two lines narrow. Exception rows use at most two or three lines respectively. At 20×12, the fixture's live header and footer leave seven content lines, so the whole family need not fit at once. One- and two-line viewport tests verify identity-first reduction. Dimensions below usable status/identity/footer geometry use a bounded fallback and do not promise simultaneous access to every status explanation.

## Validation results

- Full offline suite: **213 passes, 0 failures**, across 29 files. The terminal file includes eleven tests, with formatter, shell and public native-renderer coverage.
- Strict typecheck, repository formatting, build and `git diff --check` pass.
- Synthetic-provider PTY validation **passes on both OpenCode 2.0.29 and 2.1.2**, using the built CLI and Bun 1.3.11 terminal runtime. Both checks include narrow/wide overview navigation, full-ID child inspection, history and Models, a concurrent native OpenCode client, disconnect/restart, scalar privacy, and quit/Ctrl+C/SIGTERM restoration. Neither host check was skipped.
- The initial sandboxed host attempt could not bind a loopback server; live checks ran with the required local network access. The first 2.0.29 UI attempt exposed a missing help label at 24 columns; the footer was corrected, and both final host checks passed.

Tests cover selected identity through Details/return and resize, repeated/Unicode identities and deep indentation, threshold boundaries and invalid/stale/estimated usage, lifecycle explanations, exception/notice overflow, reordering, paging through 33 sessions, filters, removal, empty results and location changes. Native OpenTUI rendering checks the selected row and narrow footer, alongside existing cleanup/error behavior. Fixture counters verify that local redraw/navigation adds no history reads or monitor subscriptions.

The PTY fixture now checks 80×24, 40×20 and 20×12 selection visibility before its existing full-ID session inspection, history/Models navigation, concurrent native client, disconnect/restart, scalar privacy and terminal restoration checks. It reads performance/token diagnostics in Details rather than requiring them in Overview.

## Reproduction and limits

```sh
bun test tests/dashboardterminal.test.ts tests/dashboardview.test.ts tests/dashboardmodels.test.ts tests/statusformat.test.ts
bun run typecheck
bun test
bun run format:check
bun run build
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/absolute/path/to/bun-1.3.11 GUARD_DASHBOARD_BINARY=/absolute/path/to/opencode-2.0.29 bun run test:dashboard-terminal
GUARD_DASHBOARD_HOST=1 GUARD_DASHBOARD_BUN=/absolute/path/to/bun-1.3.11 GUARD_DASHBOARD_BINARY=/absolute/path/to/opencode-2.1.2 bun run test:dashboard-terminal
```

Runtime and host binaries are the same locally installed paths recorded in the [original terminal validation](dashboard-terminal-2026-10-28.md). Host checks need loopback/PTY access and Python `pyte`. No new dependencies, transport contracts, policy/lifecycle behavior, version bump or publication are included. Package installation checks are outside this presentation increment; the build is used for actual-host validation. Synthetic local checks do not establish real-provider, remote HTTPS, other-platform, or terminal-multiplexer behavior.
