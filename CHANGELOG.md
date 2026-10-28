# Changelog

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
