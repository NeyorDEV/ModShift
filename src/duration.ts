// Durées lisibles (« 90s », « 30m », « 12h », « 7d », « 0 ») pour les options de la CLI.

const UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

// Convertit une durée en millisecondes ; `undefined` si le format est invalide.
export function parseDuration(value: string): number | undefined {
  const match = /^\s*(\d+(?:\.\d+)?)\s*([smhd]?)\s*$/i.exec(value);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? '').toLowerCase();
  // Sans unité, seul « 0 » est accepté (ambigu sinon).
  if (unit === '') return amount === 0 ? 0 : undefined;
  return Math.round(amount * (UNITS[unit] ?? 0));
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}
