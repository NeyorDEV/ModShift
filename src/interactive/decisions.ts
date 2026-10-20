import type { ModShiftConfig } from '../config/config.js';
import type { ModAnalysis, ProjectRef } from '../core/types.js';
import { versionLabel } from '../report/labels.js';

// Logique de décision du mode interactif, séparée de l'affichage pour être testable :
// quelles options proposer pour un mod, et comment une décision modifie modshift.config.json.

export type Decision =
  // Garder ce que propose l'analyse (version actuelle, mise à jour, ou remplacement déjà choisi).
  | { action: 'accept' }
  // Utiliser une alternative (enregistrée comme correspondance manuelle).
  | { action: 'alternative'; project: ProjectRef }
  // Ne plus analyser ce mod.
  | { action: 'ignore' }
  // L'analyser mais le laisser hors des packs migrés.
  | { action: 'exclude' };

export interface DecisionOption {
  label: string;
  value: Decision;
  description?: string;
}

// Clé enregistrée dans la configuration : slug Modrinth du mod d'origine s'il est connu,
// sinon nom de fichier.
export function decisionKey(mod: ModAnalysis): string {
  if (mod.mapping) return mod.mapping.original?.slug ?? mod.fileName;
  return mod.project?.slug ?? mod.fileName;
}

// Mods à revoir en priorité : tout ce qui n'est pas une mise à jour sûre.
export function needsReview(mod: ModAnalysis): boolean {
  return (
    (mod.status !== 'compatible' && mod.status !== 'update-found') ||
    mod.fallback !== undefined ||
    mod.identification === 'mod-id'
  );
}

export function optionsFor(mod: ModAnalysis): DecisionOption[] {
  const options: DecisionOption[] = [];
  if (mod.status === 'compatible' || mod.status === 'update-found') {
    const version = versionLabel(mod.targetVersion);
    const label = mod.mapping
      ? `Keep the replacement ${mod.project?.title ?? ''} ${version}`
      : mod.status === 'compatible'
        ? `Keep ${version} (already compatible)`
        : `Accept the update to ${version}`;
    options.push({
      label,
      value: { action: 'accept' },
      description: mod.fallback ? 'Fallback compatibility, to test.' : undefined,
    });
  }
  for (const alternative of mod.alternatives) {
    options.push({
      label: `Use ${alternative.project.title} instead (suggestion, to verify)`,
      value: { action: 'alternative', project: alternative.project },
      description: `${alternative.reason === 'similar-name' ? 'Similar name' : 'Same category'}, ${alternative.downloads.toLocaleString('en-US')} downloads.`,
    });
  }
  options.push({
    label: 'Exclude it from the migrated pack',
    value: { action: 'exclude' },
    description: 'Still analysed and reported, but left out of migrated packs.',
  });
  options.push({
    label: 'Ignore it',
    value: { action: 'ignore' },
    description: 'Not analysed any more (useful for mods you know are not needed).',
  });
  return options;
}

// Décision déjà enregistrée dans la configuration pour ce mod (pour rejouer / proposer par défaut).
export function savedDecision(config: ModShiftConfig, mod: ModAnalysis): Decision | undefined {
  const key = decisionKey(mod);
  if (config.ignore?.includes(key)) return { action: 'ignore' };
  if (config.exclude?.includes(key)) return { action: 'exclude' };
  if (config.mappings?.[key] && mod.mapping && mod.project) {
    return { action: 'alternative', project: mod.project };
  }
  return undefined;
}

const sameDecision = (a: Decision, b: Decision): boolean =>
  a.action === b.action &&
  (a.action !== 'alternative' || (b.action === 'alternative' && a.project.id === b.project.id));

// Option proposée par défaut : décision déjà enregistrée, sinon accepter si possible,
// sinon exclure (jamais une alternative non choisie explicitement).
export function defaultOption(config: ModShiftConfig, mod: ModAnalysis): Decision {
  const saved = savedDecision(config, mod);
  const options = optionsFor(mod);
  if (saved) {
    const match = options.find((o) => sameDecision(o.value, saved));
    if (match) return match.value;
    if (saved.action === 'alternative' && mod.mapping) return { action: 'accept' };
  }
  return options[0]?.value.action === 'accept' ? { action: 'accept' } : { action: 'exclude' };
}

// Applique une décision à la configuration (copie, sans modifier l'original).
export function applyDecision(
  config: ModShiftConfig,
  mod: ModAnalysis,
  decision: Decision,
): ModShiftConfig {
  const key = decisionKey(mod);
  const ignore = (config.ignore ?? []).filter((k) => k !== key);
  const exclude = (config.exclude ?? []).filter((k) => k !== key);
  const keptMapping = config.mappings?.[key];
  const mappings = Object.fromEntries(
    Object.entries(config.mappings ?? {}).filter(([from]) => from !== key),
  );

  switch (decision.action) {
    case 'accept':
      // Accepter un remplacement existant revient à le garder.
      if (mod.mapping && keptMapping) mappings[key] = keptMapping;
      break;
    case 'alternative':
      mappings[key] = decision.project.slug;
      break;
    case 'ignore':
      ignore.push(key);
      break;
    case 'exclude':
      exclude.push(key);
      break;
  }
  return { ...config, ignore, exclude, mappings };
}

export interface DecisionSummary {
  accepted: number;
  alternatives: number;
  ignored: number;
  excluded: number;
}

export function summarizeDecisions(decisions: Decision[]): DecisionSummary {
  const summary: DecisionSummary = { accepted: 0, alternatives: 0, ignored: 0, excluded: 0 };
  for (const d of decisions) {
    if (d.action === 'accept') summary.accepted++;
    else if (d.action === 'alternative') summary.alternatives++;
    else if (d.action === 'ignore') summary.ignored++;
    else summary.excluded++;
  }
  return summary;
}
