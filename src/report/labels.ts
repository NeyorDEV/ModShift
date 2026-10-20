import type {
  Alternative,
  ConflictKind,
  ModAnalysis,
  ModStatus,
  VersionRef,
} from '../core/types.js';

export const STATUS_LABELS: Record<ModStatus, string> = {
  compatible: 'compatible',
  'update-found': 'update found',
  'alternative-suggested': 'alternative suggested',
  'not-found': 'not found',
};

export const STATUS_ICONS: Record<ModStatus, string> = {
  compatible: '✔',
  'update-found': '↑',
  'alternative-suggested': '?',
  'not-found': '✘',
};

export const CONFLICT_LABELS: Record<ConflictKind, string> = {
  incompatible: 'Incompatible mods',
  'pinned-version': 'Pinned dependency version',
  duplicate: 'Duplicate mod',
};

export function modDisplayName(mod: ModAnalysis): string {
  return mod.project?.title ?? mod.fileName;
}

export function versionLabel(version: VersionRef | undefined): string {
  if (!version) return '—';
  return version.versionType === 'release'
    ? version.versionNumber
    : `${version.versionNumber} (${version.versionType})`;
}

export function alternativesLabel(mod: ModAnalysis): string {
  if (mod.alternatives.length === 0) return '';
  // La mention « to verify » est placée en tête pour survivre à une éventuelle troncature.
  return `Suggestions (to verify): ${mod.alternatives.map((a) => a.project.title).join(', ')}`;
}

// Texte de la colonne « notes » : alternatives et/ou raison.
export function modNotes(mod: ModAnalysis): string {
  if (mod.status === 'alternative-suggested') return alternativesLabel(mod);
  return mod.reason ?? '';
}

// Explication d'une alternative : pourquoi elle est proposée et son score de pertinence.
export function alternativeWhy(alt: Alternative): string {
  return `relevance ${alt.score}/100 — ${alt.explanation}`;
}

// Section « couches de compatibilité » commune aux rapports Markdown.
export function compatLayerSection(mods: ModAnalysis[]): string[] {
  const hinted = mods.filter((m) => m.compatLayer);
  if (hinted.length === 0) return [];
  const lines = [
    '',
    '## Compatibility layers (experimental, not guaranteed)',
    '',
    '> These mods have no version for the target, but a version for another loader that a ' +
      'compatibility layer could load. **Experimental, not guaranteed**: ModShift never adds them ' +
      'to the migrated pack. Test them in a copy of your world.',
    '',
  ];
  for (const mod of hinted) {
    const hint = mod.compatLayer;
    if (!hint) continue;
    const requires = hint.requires
      .map((r) => `[${r.title}](https://modrinth.com/mod/${r.slug})`)
      .join(', ');
    lines.push(
      `- **${modDisplayName(mod)}**: ${hint.runs} version ${hint.version.versionNumber} through ${hint.name}. Requires ${requires}.${hint.caveat ? ` ${hint.caveat}` : ''} Source: ${hint.source}.`,
    );
  }
  return lines;
}
