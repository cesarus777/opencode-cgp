export function tokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "?";
  const magnitude = Math.abs(value);
  if (magnitude >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
  return String(value);
}
