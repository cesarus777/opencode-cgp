/** Content stays with the native checkpoint and adapter, never with monitor state. */
export const transcriptLimit = 2_000_000;
export interface TranscriptEntry {
  id: string;
  type: string;
  text?: string;
  work?: string;
  complete?: boolean;
  checkpoint?: {
    originalId: string;
    original: string;
    middle: string;
    latest: string;
  };
  opaque?: boolean;
}
export interface ProtectedContext {
  originalId: string;
  original: string;
  latest: string;
  middle: string;
}
export function selectProtected(
  entries: readonly TranscriptEntry[],
  boundary?: string,
): ProtectedContext {
  const end =
    boundary === undefined
      ? entries.length
      : entries.findIndex((e) => e.id === boundary);
  if (end < 0) throw new Error("history-unavailable");
  const history = entries.slice(0, end);
  if (
    history.reduce((n, e) => n + ((e.work ?? e.text)?.length ?? 0), 0) >
    transcriptLimit
  )
    throw new Error("history-too-large");
  const checkpointIndex = history.findLastIndex(
    (e) => e.checkpoint !== undefined,
  );
  const checkpoint = history[checkpointIndex]?.checkpoint;
  if (history.some((e) => e.opaque)) throw new Error("opaque-checkpoint");
  const first = history.find((e) => e.type === "user");
  const lastCompaction = history.findLastIndex(
    (e) => e.type === "compaction" && e.complete,
  );
  if (
    !checkpoint &&
    lastCompaction >= 0 &&
    (!first || history.indexOf(first) > lastCompaction)
  )
    throw new Error("original-unavailable");
  if (
    checkpoint &&
    first &&
    history.indexOf(first) < checkpointIndex &&
    (first.id !== checkpoint.originalId || first.text !== checkpoint.original)
  )
    throw new Error("integrity-failed");
  const original = checkpoint?.original ?? first?.text;
  const originalId = checkpoint?.originalId ?? first?.id;
  if (original === undefined || !originalId)
    throw new Error("history-unavailable");
  let userIndex = -1,
    answerIndex = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry?.type !== "assistant" || !entry.complete || !entry.text) continue;
    for (let j = i - 1; j >= 0; j--) {
      if (history[j]?.type === "user") {
        userIndex = j;
        answerIndex = i;
        break;
      }
    }
    if (userIndex >= 0) break;
  }
  const user = history[userIndex],
    answer = history[answerIndex];
  const latest =
    user && answer
      ? `User:\n${user.text ?? ""}\n\nAssistant:\n${answer.text ?? ""}`
      : (checkpoint?.latest ?? "");
  // A previous checkpoint's latest exchange becomes intermediate work, once.
  const middle = [
    checkpoint?.middle,
    checkpoint && checkpoint.latest !== latest ? checkpoint.latest : undefined,
    ...history
      .slice(checkpointIndex + 1)
      .filter(
        (e) =>
          e.id !== originalId &&
          e !== user &&
          e !== answer &&
          (e.type !== "compaction" || !e.checkpoint),
      )
      .map((e) =>
        (e.work ?? e.text) ? `${e.type}:\n${e.work ?? e.text}` : "",
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (original.length + latest.length + middle.length > transcriptLimit)
    throw new Error("history-too-large");
  return { originalId, original, latest, middle };
}

/** Versioned length boundaries make delimiter-like user content unambiguous. */
export function constructCheckpoint(
  source: ProtectedContext,
  summary: string,
  nonce: string,
) {
  if (!summary.trim()) throw new Error("empty-summary");
  let delimiter = `<<<Guard:${nonce}>>>`;
  while (
    [source.original, source.latest, summary].some((s) => s.includes(delimiter))
  )
    delimiter += "_";
  const sections = [source.original, summary, source.latest];
  const labels = [
    "Original request — verbatim",
    "Summary of intermediate work",
    "Latest complete exchange — verbatim",
  ];
  let text = "";
  const boundaries = sections.map((section, i) => {
    text += `${delimiter}\n${labels[i]}\n`;
    const start = text.length;
    text += section;
    const end = text.length;
    text += `\n${delimiter}\n`;
    return { start, end };
  });
  if (!text.includes(source.original) || !text.includes(source.latest))
    throw new Error("integrity-failed");
  return { text, boundaries, originalId: source.originalId, version: 1 };
}
