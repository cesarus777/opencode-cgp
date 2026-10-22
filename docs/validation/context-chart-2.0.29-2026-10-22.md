# Context chart continuity — local OpenCode 2.0.29

The built plugin was checked in a disposable local OpenCode 2.0.29 server and its actual compiled TUI. The test uses a deterministic local SSE provider, isolated configuration/data/state directories and synthetic sessions. It does not use genuine provider credentials or change user configuration.

## Reproduction

```sh
bun run build
GUARD_SYNTHETIC_TUI=1 bun scripts/metrics-server-live.ts
```

Python 3, `pyte`, Pillow and fontconfig's `fc-match` are required for the PTY driver and chart previews. The normal offline checks are `bun run typecheck`, `bun test` and `bun run format:check`.

## Scenarios

- The root reaches 89,600 reported input tokens out of 128,000 (70%). A pause retains that level with a muted dashed tail.
- A child actually waits on a native permission request, then receives a one-time reply in the isolated test. The root chart retains its level throughout the wait.
- A child executes a delayed shell tool and continues. Its activity does not reset or replace the root trace.
- A later root request reports 64,000 tokens (50%). The scalar label shows that actual measurement while the sidebar chart holds its previous 70% level in gray.
- Manual native compaction completes. A subsequent reported request uses 12,800 tokens (10%). The graph shows the lower level alongside its earlier history.
- The context panel is resized to 80×40 and back to 180×60. Its plot fits in nine rows with both vertical edges and its baseline visible. Panel formatting now uses the actual scroll viewport width, accounting for the scrollbar.

The offline suite additionally covers missing usage, admission/running/failure without completion, estimated usage after completion, duplicate renders, delayed observations, same-timestamp lower corrections, fixed capacity/threshold boundaries and bounded history and sharing across view remounts. The native renderer fixture checks muted held spans and verifies that the panel's scrollbar does not cause chart lines to wrap.

## Artifacts and limits

The driver saves only scalar chart rectangles under ignored `.artifacts/context-*.txt` and `.png`: pause, permission wait, child activity, lower held usage and compaction in narrow/wide panels and the sidebar. PNGs are previews reconstructed from the PTY character/color cells, not desktop screenshots. Session messages, titles, prompts and tool output are excluded from these captures.

The shared UI state keeps at most 96 local display points per session for the 128 most recently viewed sessions, retaining them across sidebar/panel mounts and session navigation; its horizontal axis is observation order, not proportional elapsed time. It is not persistent session history. Model/capacity changes start a new trace. Enforcement and token/percentage labels continue using original measurements; holding the visual level does not change compaction policy or accounting. Provider omissions and compaction errors remain covered offline rather than certified with a genuine provider. HTML reporting was not changed for this feature.
