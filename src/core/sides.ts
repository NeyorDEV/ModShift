// Côté client / serveur d'un mod, d'après les métadonnées Modrinth.
//
// Sources (spécification OpenAPI de Modrinth et code de labrinth) :
// - `environment` d'une version (ex. `client_only`, `server_only_client_optional`) remplace les
//   champs `client_side` / `server_side` des projets, marqués « Deprecated » ;
// - la correspondance entre les deux reprend `convert_v3_environment_to_v2_side_types`
//   (apps/labrinth/src/routes/v2_reroute.rs), utilisée par Modrinth lui-même pour l'API v2.

export const SIDE_SUPPORTS = ['required', 'optional', 'unsupported', 'unknown'] as const;
export type SideSupport = (typeof SIDE_SUPPORTS)[number];

export const TARGET_SIDES = ['client', 'server', 'both'] as const;
// Installation visée : client seul, serveur dédié seul, ou les deux (aucun filtre).
export type TargetSide = (typeof TARGET_SIDES)[number];

export interface ModSide {
  client: SideSupport;
  server: SideSupport;
  // version : champ `environment` de la version retenue ; project : champs (dépréciés) du
  // projet ; none : aucune information.
  source: 'version' | 'project' | 'none';
}

// client : inutile sur un serveur ; server : inutile sur un client ; both : les deux ;
// unknown : information absente ou incohérente (à vérifier).
export type SideCategory = 'client' | 'server' | 'both' | 'unknown';

type Pair = [SideSupport, SideSupport];

// Types de projets dont le côté est fixé par Modrinth quel que soit `environment`.
const BY_PROJECT_TYPE: Record<string, Pair> = {
  plugin: ['unsupported', 'required'],
  datapack: ['optional', 'required'],
  shader: ['required', 'unsupported'],
  resourcepack: ['required', 'unsupported'],
};

const BY_ENVIRONMENT: Record<string, Pair> = {
  client_and_server: ['required', 'required'],
  client_only: ['required', 'unsupported'],
  client_only_server_optional: ['required', 'optional'],
  singleplayer_only: ['required', 'required'],
  server_only: ['unsupported', 'required'],
  server_only_client_optional: ['optional', 'required'],
  dedicated_server_only: ['unsupported', 'required'],
  client_or_server: ['optional', 'optional'],
  client_or_server_prefers_both: ['optional', 'optional'],
};

function support(value: string | undefined): SideSupport {
  return SIDE_SUPPORTS.includes(value as SideSupport) ? (value as SideSupport) : 'unknown';
}

export function sideFromEnvironment(
  environment: string | undefined,
  projectType?: string,
): Pair | undefined {
  const fixed = projectType ? BY_PROJECT_TYPE[projectType] : undefined;
  if (fixed) return fixed;
  return environment ? BY_ENVIRONMENT[environment] : undefined;
}

// Côté d'un mod : `environment` de la version d'abord, champs du projet sinon.
export function sideOf(
  project: { client_side?: string; server_side?: string; project_type?: string } | undefined,
  version: { environment?: string } | undefined,
): ModSide {
  const fromVersion = sideFromEnvironment(version?.environment, project?.project_type);
  if (fromVersion) return { client: fromVersion[0], server: fromVersion[1], source: 'version' };
  const client = support(project?.client_side);
  const server = support(project?.server_side);
  if (client !== 'unknown' || server !== 'unknown') return { client, server, source: 'project' };
  return { client: 'unknown', server: 'unknown', source: 'none' };
}

export function sideCategory(side: ModSide): SideCategory {
  const { client, server } = side;
  if (client === 'unknown' || server === 'unknown') return 'unknown';
  if (client === 'unsupported' && server === 'unsupported') return 'unknown';
  if (server === 'unsupported') return 'client';
  if (client === 'unsupported') return 'server';
  return 'both';
}

// Le mod doit-il être installé pour cette cible ? `unknown` : impossible à dire.
export function neededOn(side: ModSide, target: TargetSide): 'yes' | 'no' | 'unknown' {
  if (target === 'both') return 'yes';
  const value = target === 'server' ? side.server : side.client;
  if (value === 'unknown') return 'unknown';
  return value === 'unsupported' ? 'no' : 'yes';
}

// Valeurs `env` d'un fichier .mrpack (required / optional / unsupported), si le côté est connu.
export function mrpackEnv(
  side: ModSide,
):
  { client: Exclude<SideSupport, 'unknown'>; server: Exclude<SideSupport, 'unknown'> } | undefined {
  if (side.client === 'unknown' || side.server === 'unknown') return undefined;
  return { client: side.client, server: side.server };
}
