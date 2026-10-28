export const mainHelp = `Context Guard — context monitoring for OpenCode V2

Start here
  In your project, run: opencode
  Inside OpenCode, enter: /context-guard
  The plugin loads with OpenCode; observe mode is the default.

Usage: context-guard <command> [options]
       context-guard <journal.jsonl> [--history | --json]

Commands
  dashboard tui   Open the standalone live terminal dashboard
  models          Compare models across retained history
  metrics         Export retained performance records as JSON or CSV
  charts          Generate an interactive HTML report
  <journal.jsonl> Inspect diagnostic session records

Examples
  context-guard dashboard tui
  context-guard models /absolute/history-directory
  context-guard charts /absolute/history-directory --output report.html
  context-guard /absolute/events.jsonl --history

Help
  context-guard <command> --help   Show options and examples
  context-guard help journal      Explain diagnostic inspection
  -h, --help                     Show help

Requires Bun >=1.1.34; the standalone dashboard requires Bun >=1.3.0.
From a source checkout, replace context-guard with bun run inspect.`;

const filterOptions = `  --agent NAME       Filter by exact agent name
  --model PROVIDER/MODEL
                     Filter by exact model ID
  --from ISO-or-ms    Start time: ISO timestamp or Unix milliseconds
  --to ISO-or-ms      End time: ISO timestamp or Unix milliseconds`;

const historyOptions = `  --session ID       Filter by session
${filterOptions}`;

const historyPath = `Use the owning location's history.path directory, not its diagnostic JSONL
file. By default it is a location-hashed directory under
$XDG_STATE_HOME/opencode-context-guard (or ~/.local/state/opencode-context-guard).
A custom telemetry.path does not change the history directory.`;

export const commandHelp: Readonly<Record<string, string>> = {
  models: `Usage: context-guard models <history-directory> [options]
Compare model throughput and time to first token across retained sessions.
The history directory must be an absolute path. Output defaults to JSON.

Options
${filterOptions}
  --csv              Export CSV; coverage metadata goes to stderr
  --json             Export JSON (default); cannot combine with --csv
  -h, --help         Show this help

Example
  context-guard models /absolute/history-directory --agent build --csv

${historyPath}`,
  metrics: `Usage: context-guard metrics <history-directory> [options]
Read retained performance records. Output defaults to JSON.

Options
${historyOptions}
  --csv              Export CSV; coverage metadata goes to stderr
  --chart FILE.html  Generate an HTML report instead (see charts --help)
  -h, --help         Show this help

Example
  context-guard metrics /absolute/history-directory --csv > metrics.csv

${historyPath}`,
  charts: `Usage: context-guard charts <history-directory> [options]
Generate a self-contained interactive HTML report, then open it in a browser.

Options
${historyOptions}
  --output FILE.html Write the report (default: context-guard-charts.html)
  --max-points N     Points per series: 16–5000 (default: 1000)
  --max-sessions N   Session instances: 1–1024 (default: 128)
  --force            Overwrite an existing report
  -h, --help         Show this help

Example
  context-guard charts /absolute/history-directory --output report.html

${historyPath}`,
  journal: `Usage: context-guard <journal.jsonl> [options]
Inspect the diagnostic journal reported in OpenCode's Context Guard startup log.
By default, print the latest retained record for each session, one JSON per line.

Options
  --json             Print latest session records as a JSON array
  --history          Print all retained journal records as a JSON array
  -h, --help         Show this help

Example
  context-guard /absolute/path/from/startup.jsonl --history

This reads a diagnostic file, not a performance history directory.`,
};
