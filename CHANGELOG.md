# Changelog

## 0.4.1 — 2026-11-07

- Keep native performance Charts visible immediately after returning from help. Pause reads and polling during help, retain only the matching plot, and discard it when session, location, or window changes. See the [chart-help continuity plan](docs/plans/native-chart-help-continuity.md) and [0.4.1 release validation](docs/validation/release-0.4.1-2026-11-07.md).

- Distinguish missing history service, timeout, incompatible response, rejected request and temporary failure in native Charts and standalone History. Preserve matching previous results with their successful-load timestamp and original range during refresh/failure; provide accurate keyboard retry without exposing server errors.
- Coalesce native chart retries, discard obsolete responses, pause polling when recording/service compatibility needs attention, and keep refresh visible at narrow widths. Validate UX-10 with 233 offline tests and native/standalone synthetic-provider PTY checks on OpenCode 2.0.29 and 2.1.2; see the [chart recovery delivery record](docs/validation/chart-failure-recovery-2026-11-07.md).

- Use plain-language measurement and compaction labels across the native sidebar/panel and standalone session dashboard. Distinguish provider-reported, estimated, stale, missing and unusable readings, accepted requests, context-reduction checks and unconfirmed completion.
- Lead Details with readable explanations and a performance glossary while retaining exact diagnostic codes and accounting fields. Clarify context-chart legends with “Dim = last known context” and “┄ threshold”; preserve trace geometry and compaction semantics.
- Validate UX-09 with 222 offline tests and native/standalone synthetic-provider PTY checks on OpenCode 2.0.29 and 2.1.2. The sidebar fixture occupies 22 lines at 39 columns and 23 at 35 columns. See the [terminology delivery record](docs/validation/plain-language-terminology-2026-11-07.md).

- Compact the native sidebar to identity-first occupancy, early panel access, expandable history and two-line ordinary descendant rows. Group completed subtrees only when discovery and their measurement/lifecycle states are trustworthy; preserve attention-bearing ancestry and hidden-fold feedback.
- Move sidebar throughput and aggregate diagnostics into panel Details, with route-family statistics independent of selection/folding. The ordinary fixture shrinks from 63 to 22 lines at 39 columns; validate with 220 offline tests and synthetic-provider PTY checks on OpenCode 2.0.29 and 2.1.2. See the [sidebar validation record](docs/validation/sidebar-density-2026-11-06.md).

- Add native-panel keyboard help with preserved selection, scroll position and chart settings. Pause chart polling during help, keep Guard status visible, and reserve contextual help/close controls at narrow widths.
- Report native inventory discovery progress, actionable continuation, failures and node bounds. Add the client plugin option `openShortcut` for keyboard entry from child composers through the existing `context-guard.show` command and display its effective shortcut; it remains unbound by default. See the [native keyboard/help validation](docs/validation/native-keyboard-help-2026-11-06.md).

- Compact the standalone dashboard Overview into aligned columns or narrow cards, with bounded exception lines and full diagnostics in Details. Preserve the selected identity through resizing, updates and small viewports; page by visible session rows.
- Add distinguishing session labels, contextual details/quit hints, and filtered-selection feedback. Validate with 213 offline tests and synthetic-provider PTY checks on OpenCode 2.0.29 and 2.1.2; see the [overview validation record](docs/validation/standalone-overview-density-2026-11-06.md).

- Use consistent threshold and Guard status wording across the native sidebar, panel, and standalone dashboard. Replace “tokens until compaction” with distance below/over threshold, and separate capacity occupancy from “Near threshold” / “Threshold reached.”
- Keep stale occupancy labeled “Last measured” while current pressure stays unknown. Explain last-known Guard health during disconnect and reason-specific reload/storage-repair requirements without treating reconnect as enforcement recovery.
- Preserve critical status and selected identity at narrow sizes; retain monitoring-limit/model-limit warnings and exact diagnostic reason codes in Details. Validate with 209 offline tests and native/standalone OpenCode 2.1.2 PTY smoke tests; see the [status validation record](docs/validation/threshold-status-consistency-2026-11-06.md).

- Open `/context-guard` with a compact selected-session summary and nested family list. Move full diagnostics and the context-history chart into Details (`i`), keeping retained performance Charts on `c`.
- Preserve selected-session identity across views, refreshes, and ordering changes; fall back safely when a selected session disappears. Keep one panel consumer active across all views.
- Add responsive table/card layouts, clickable footer actions, page and boundary navigation, and scrolling in Details. Keep Guard status visible and distinguish stale occupancy, threshold distance, and compaction lifecycle states.
- Validate the native overview with 205 offline tests and an actual OpenCode 2.1.2 synthetic-provider PTY run; see the [validation record](docs/validation/native-panel-overview-2026-11-06.md).

## 0.4.0 — 2026-10-29

- Add a Models screen to the standalone terminal dashboard: aggregate charts and statistics across retained root, child and archived sessions, exact agent filtering, model sorting, time windows, bucket inspection and paginated request details.
- Add the read-only, location-scoped `context-guard.analytics.v1` RPC with bounded scans, short-lived snapshots and pagination independent of aggregate totals. Older servers preserve existing dashboard screens and report Models as unsupported.

- Preserve history graph indentation in the standalone dashboard so axes, gap markers and filled columns stay aligned.
- Keep all model statistics accessible in narrow terminals, scrolling through wrapped rows before advancing model selection.
- Clarify that the dashboard can run in a separate terminal while working in OpenCode; closing the native TUI was a test setup condition.

## 0.3.1 — 2026-10-29

- Install the standalone dashboard's pinned OpenTUI renderer automatically with CGP, including its native platform library. Keep renderer loading lazy so server and offline commands still work on Bun >=1.1.34; the dashboard requires Bun >=1.3.0.
- Clarify CLI launch instructions and add command-specific help with examples.

## 0.3.0 — 2026-10-28

Changes since 0.2.5:

- Add `context-guard dashboard tui` with a root/child session overview, complete snapshot details, retained performance history, search, filters and explicit location selection. Connections recover from interruptions and retain labeled stale values.
- Add `context-guard models /absolute/history-directory` to compare models across retained sessions. JSON/CSV exports include duration-weighted request TPS, TTFT mean/median/p95, eligibility counts, deduplication and coverage. Filter by exact model/agent and completion-time range.
- Export harness-independent `aggregateModels` through the core package entry.
- Correct context chart threshold rendering and stale colors. Held bars preserve the preceding measurement's fractional height. Pauses temporarily mute the latest column; repeated unchanged/held observations reuse it instead of consuming history space.

The standalone terminal command requires Bun >=1.3.0 and the optional `@opentui/core@0.5.17` renderer. Server/core and offline diagnostic/analytics commands retain Bun >=1.1.34 support. OpenCode SDK dependencies remain pinned at 2.0.29; local synthetic-provider validation also covers OpenCode 2.1.2.

Model analytics uses the bounded retained archive (default seven days / 64 MiB), not permanent history. Its Models screen, analytics RPC and durable request ledger remain planned. The browser dashboard remains planned. Genuine-provider timing and cross-machine terminal validation remain unverified.
