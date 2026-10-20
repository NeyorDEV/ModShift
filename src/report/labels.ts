import type {
  Alternative,
  ConflictKind,
  ModAnalysis,
  ModStatus,
  VersionRef,
  AnalysisResult,
} from '../core/types.js';
import { type ModSide, neededOn, sideCategory, type SideCategory } from '../core/sides.js';

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

const SIDE_LABELS = {
  client: 'client-only',
  server: 'server-only',
  both: 'client and server',
  unknown: 'side unknown',
} as const;

// Libellé du côté d'un mod (client-only, server-only…).
export function sideLabel(side: ModSide | undefined): string {
  return SIDE_LABELS[side ? sideCategory(side) : 'unknown'];
}

export interface SideGroups {
  client: string[];
  server: string[];
  unknown: string[];
  // Mods inutiles pour l'installation visée (--side).
  notNeeded: string[];
}

// Regroupe les mods retenus (et les dépendances ajoutées) selon leur côté.
export function sideGroups(result: AnalysisResult): SideGroups {
  const groups: SideGroups = { client: [], server: [], unknown: [], notNeeded: [] };
  const entries = [
    ...result.mods.flatMap((m) =>
      m.project && m.targetVersion ? [{ title: m.project.title, side: m.side }] : [],
    ),
    ...result.dependencies.added.map((d) => ({ title: d.project.title, side: d.side })),
  ];
  for (const { title, side } of entries) {
    const category: SideCategory = side ? sideCategory(side) : 'unknown';
    if (category !== 'both') groups[category].push(title);
    if (side && result.side !== 'both' && neededOn(side, result.side) === 'no') {
      groups.notNeeded.push(title);
    }
  }
  return groups;
}

// Section Markdown « client / serveur » ; vide si tous les mods vont des deux côtés.
export function sideSection(result: AnalysisResult): string[] {
  const groups = sideGroups(result);
  if (groups.client.length + groups.server.length + groups.unknown.length === 0) return [];
  const lines = ['', '## Client and server', ''];
  lines.push(
    `Target installation: **${result.side}** (\`--side\`). Sides come from Modrinth metadata ` +
      "(the version's `environment`, else the project's `client_side` / `server_side`).",
    '',
  );
  if (groups.client.length > 0) lines.push(`- **Client-only:** ${groups.client.join(', ')}`);
  if (groups.server.length > 0) lines.push(`- **Server-only:** ${groups.server.join(', ')}`);
  if (groups.unknown.length > 0) {
    lines.push(`- **Side unknown or ambiguous (check them):** ${groups.unknown.join(', ')}`);
  }
  if (groups.notNeeded.length > 0) {
    lines.push(
      '',
      `Not needed for \`--side ${result.side}\`, left out of migrated packs: ${groups.notNeeded.join(', ')}.`,
    );
  }
  return lines;
}

// Section « autres sources » : fichiers proposés hors Modrinth, jamais ajoutés au pack.
export function externalSection(mods: ModAnalysis[]): string[] {
  const found = mods.filter((m) => m.external && m.external.length > 0);
  if (found.length === 0) return [];
  const lines = [
    '',
    '## Other sources (to verify)',
    '',
    '> Files found outside Modrinth for mods without a compatible version. **External source, to ' +
      'verify**: matched by file name only, never added to the migrated pack. Check the release ' +
      'page before downloading.',
    '',
  ];
  for (const mod of found) {
    for (const c of mod.external ?? []) {
      lines.push(
        `- **${modDisplayName(mod)}**: [${c.fileName.replace(/[[\]]/g, '')}](${c.url.replace(/[()\s]/g, encodeURIComponent)}) (${c.version}${c.pageUrl ? `, [release page](${c.pageUrl})` : ''}) — ${c.reason}`,
      );
    }
  }
  return lines;
}
