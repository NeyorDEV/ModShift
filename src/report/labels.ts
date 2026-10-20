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
