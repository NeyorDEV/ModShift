import { MRPACK_KEY_TO_LOADER } from '../loaders/registry.js';
import type { Loader } from '../types.js';

// Clés de `dependencies` dans modrinth.index.json → loader (définies dans le registre).
export const MRPACK_LOADER_KEYS: Record<string, Loader> = MRPACK_KEY_TO_LOADER;

// Convertit un identifiant CurseForge (« forge-47.2.0 », « neoforge-21.1.1 »…) en loader + version.
export function parseCurseForgeLoaderId(
  id: string,
): { loader: Loader; version: string } | undefined {
  const match = /^(neoforge|forge|fabric|quilt)-(.+)$/i.exec(id.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { loader: match[1].toLowerCase() as Loader, version: match[2] };
}
