import { type CurseForgeClient, curseForgeApiKey } from '../curseforge/client.js';
import { missingKeyWarning, resolveCurseForgeRefs } from '../curseforge/resolve.js';
import type { ModSource } from './types.js';

// CurseForge : résout les références projectID/fileID d'un export CurseForge (nom de fichier,
// SHA-1), que Modrinth reconnaît ensuite. Clé lue uniquement dans CURSEFORGE_API_KEY ; sans clé,
// un avertissement est ajouté et rien n'est envoyé. Aucun fichier n'est téléchargé.
export function curseForgeSource(deps: {
  createClient: (apiKey: string) => CurseForgeClient;
}): ModSource {
  return {
    id: 'curseforge',
    name: 'CurseForge',
    description: 'Resolves CurseForge manifest references (needs CURSEFORGE_API_KEY).',
    async prepare(pack, context) {
      if (!pack.mods.some((m) => m.curseforge)) return;
      const apiKey = curseForgeApiKey(context.env);
      if (!apiKey) {
        const warning = missingKeyWarning(pack);
        if (warning) pack.warnings.push(warning);
        return;
      }
      const count = pack.mods.filter((m) => m.curseforge).length;
      context.log(`Resolving ${count} CurseForge file reference(s)…`);
      const result = await resolveCurseForgeRefs(pack, deps.createClient(apiKey));
      context.debug(`CurseForge: ${result.resolved} resolved, ${result.unresolved} unresolved`);
    },
  };
}
