import type { AnalysisResult, ModStatus } from '../core/types.js';
import { MOD_STATUSES } from '../core/types.js';
import { modDisplayName, modNotes, STATUS_ICONS, STATUS_LABELS, versionLabel } from './labels.js';

export interface TableOptions {
  color?: boolean;
  // Largeur maximale de la colonne « notes » (le texte est tronqué au-delà).
  maxNotesWidth?: number;
}

const ANSI = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  green: '\u001b[32m',
  cyan: '\u001b[36m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
};

const STATUS_COLORS: Record<ModStatus, string> = {
  compatible: ANSI.green,
  'update-found': ANSI.cyan,
  'alternative-suggested': ANSI.yellow,
  'not-found': ANSI.red,
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

// Tableau texte simple à colonnes alignées. Les couleurs sont appliquées après le calcul des
// largeurs pour ne pas fausser l'alignement.
function renderGrid(
  headers: string[],
  rows: string[][],
  paint: (text: string, row: number, col: number) => string,
): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[], row: number) =>
    cells
      .map((c, i) => {
        const padded = i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0);
        return row < 0 ? padded : paint(padded, row, i);
      })
      .join('  ')
      .trimEnd();
  return [
    line(headers, -1),
    widths.map((w) => '─'.repeat(w)).join('  '),
    ...rows.map((r, i) => line(r, i)),
  ];
}

export function renderTable(result: AnalysisResult, options: TableOptions = {}): string {
  const color = options.color ?? false;
  const maxNotes = options.maxNotesWidth ?? 70;
  const c = (code: string, text: string) => (color ? `${code}${text}${ANSI.reset}` : text);
  const out: string[] = [];

  const source = [result.pack.minecraftVersion, result.pack.loader].filter(Boolean).join(' ');
  out.push(
    c(ANSI.bold, `ModShift — ${result.pack.name ?? result.pack.source}`) +
      `  ${source || 'unknown source'} → ${result.target.minecraftVersion} ${result.target.loader}`,
    '',
  );

  const rows = result.mods.map((m) => [
    `${STATUS_ICONS[m.status]} ${STATUS_LABELS[m.status]}`,
    modDisplayName(m),
    versionLabel(m.currentVersion),
    versionLabel(m.targetVersion),
    truncate(modNotes(m), maxNotes),
  ]);
  out.push(
    ...renderGrid(['Status', 'Mod', 'Current', 'Target', 'Notes'], rows, (text, row, col) => {
      const mod = result.mods[row];
      if (!mod) return text;
      if (col === 0) return c(STATUS_COLORS[mod.status], text);
      if (col === 4) return c(ANSI.dim, text);
      return text;
    }),
  );

  const { added, missing } = result.dependencies;
  if (added.length > 0) {
    out.push('', c(ANSI.bold, 'Dependencies added:'));
    for (const d of added) {
      out.push(
        `  + ${d.project.title} ${versionLabel(d.version)} (required by ${d.requiredBy.join(', ')})`,
      );
    }
  }
  if (missing.length > 0) {
    out.push('', c(ANSI.bold, 'Missing dependencies:'));
    for (const d of missing) {
      out.push(
        c(ANSI.red, `  ! ${d.title ?? d.projectId}`) +
          ` (required by ${d.requiredBy.join(', ')}): ${d.reason}`,
      );
    }
  }
  if (result.conflicts.length > 0) {
    out.push('', c(ANSI.bold, 'Conflicts:'));
    for (const conflict of result.conflicts) {
      out.push(
        c(ANSI.red, `  ✘ ${conflict.declaredBy} is incompatible with ${conflict.project.title}`),
      );
    }
  }

  out.push(
    '',
    `Summary: ${MOD_STATUSES.map((s) => `${result.summary[s]} ${STATUS_LABELS[s]}`).join(', ')}`,
  );
  if (result.mods.some((m) => m.alternatives.length > 0)) {
    out.push(c(ANSI.yellow, 'Alternatives are suggestions, to verify before use.'));
  }
  if (result.otherFilesCount > 0) {
    out.push(
      `${result.otherFilesCount} non-mod file(s) (resource packs, configs…) were not analysed.`,
    );
  }
  if (result.warnings.length > 0) {
    out.push('', c(ANSI.bold, 'Warnings:'));
    for (const w of result.warnings) out.push(c(ANSI.dim, `  - ${w}`));
  }
  return `${out.join('\n')}\n`;
}
