// Types de src/ui/public/logic.js (utilisés par les tests).
export declare const STATUS_ORDER: string[];
export declare const STATUS_LABELS: Record<string, string>;
export declare function versionLabel(
  version: { versionNumber: string; versionType: string } | undefined,
): string;
export declare function displayName(mod: { project?: { title: string }; fileName: string }): string;
export declare function notesFor(mod: {
  status: string;
  reason?: string;
  alternatives: { project: { title: string } }[];
}): string;
export declare function sortMods<T>(
  mods: T[],
  key: 'status' | 'name' | 'current' | 'target',
  dir?: 'asc' | 'desc',
): T[];
export declare function filterMods<T>(mods: T[], filters?: { status?: string; text?: string }): T[];
export declare function countByStatus(mods: { status: string }[]): Record<string, number>;
export declare function modrinthUrl(project: { slug: string }): string;
