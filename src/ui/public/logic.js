// Logique pure de l'interface (tri, filtres, libellés), sans DOM : testée par Vitest.

export const STATUS_ORDER = ['compatible', 'update-found', 'alternative-suggested', 'not-found'];

export const STATUS_LABELS = {
  compatible: 'Compatible',
  'update-found': 'Update found',
  'alternative-suggested': 'Alternative suggested',
  'not-found': 'Not found',
};

/** @param {{ versionNumber: string, versionType: string } | undefined} version */
export function versionLabel(version) {
  if (!version) return '—';
  return version.versionType === 'release'
    ? version.versionNumber
    : `${version.versionNumber} (${version.versionType})`;
}

/** @param {{ project?: { title: string }, fileName: string }} mod */
export function displayName(mod) {
  return mod.project?.title ?? mod.fileName;
}

/** @param {{ status: string, reason?: string, alternatives: { project: { title: string } }[] }} mod */
export function notesFor(mod) {
  if (mod.status === 'alternative-suggested' && mod.alternatives.length > 0) {
    return `Suggestions (to verify): ${mod.alternatives.map((a) => a.project.title).join(', ')}`;
  }
  return mod.reason ?? '';
}

const sortValue = {
  status: (mod) => STATUS_ORDER.indexOf(mod.status),
  name: (mod) => displayName(mod).toLowerCase(),
  current: (mod) => versionLabel(mod.currentVersion).toLowerCase(),
  target: (mod) => versionLabel(mod.targetVersion).toLowerCase(),
};

/**
 * Trie une copie de la liste (tri stable ; égalités départagées par le nom).
 * @param {any[]} mods
 * @param {'status' | 'name' | 'current' | 'target'} key
 * @param {'asc' | 'desc'} dir
 */
export function sortMods(mods, key, dir = 'asc') {
  const value = sortValue[key] ?? sortValue.name;
  const factor = dir === 'desc' ? -1 : 1;
  return [...mods].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const primary = va < vb ? -1 : va > vb ? 1 : 0;
    return primary * factor || displayName(a).localeCompare(displayName(b));
  });
}

/**
 * Filtre par statut et par texte (nom, fichier, slug, raison).
 * @param {any[]} mods
 * @param {{ status?: string, text?: string }} filters
 */
export function filterMods(mods, { status = '', text = '' } = {}) {
  const needle = text.trim().toLowerCase();
  return mods.filter((mod) => {
    if (status && mod.status !== status) return false;
    if (!needle) return true;
    return [displayName(mod), mod.fileName, mod.project?.slug ?? '', mod.reason ?? '']
      .join(' ')
      .toLowerCase()
      .includes(needle);
  });
}

/** @param {{ status: string }[]} mods */
export function countByStatus(mods) {
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0]));
  for (const mod of mods) counts[mod.status] = (counts[mod.status] ?? 0) + 1;
  return counts;
}

// Lien Modrinth d'un projet (slug uniquement composé de caractères sûrs).
/** @param {{ slug: string }} project */
export function modrinthUrl(project) {
  return /^[A-Za-z0-9._-]+$/.test(project.slug)
    ? `https://modrinth.com/project/${project.slug}`
    : 'https://modrinth.com/';
}
