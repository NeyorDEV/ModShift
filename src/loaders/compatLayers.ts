// Couches de compatibilité : mods tiers qui chargent des mods d'un autre loader.
//
// Uniquement d'après la documentation officielle de chaque projet (README et fichiers de build
// de leurs dépôts, consultés via raw.githubusercontent.com) :
// - Sinytra Connector (branche `dev`) : mods Fabric sur NeoForge, 1.21.1 « primary supported
//   version » ; branche `1.20.1` : mods Fabric sur MinecraftForge, version « long-term-support »
//   (correctifs critiques uniquement, plus de correctifs de compatibilité). Requiert Connector et
//   Forgified Fabric API, qui *remplace* Fabric API (incompatible avec elle).
// - Kilt (branche `version/1.20.1`) : mods Forge sur Fabric, 1.20.1, « Very experimental »,
//   « highly unstable, may break worlds » ; dépend de Fabric API et Fabric Language Kotlin.
//   La version NeoForge 1.21.1 est annoncée « in progress » : non retenue.
//
// Ces couches ne sont JAMAIS ajoutées automatiquement au pack migré : ModShift les signale
// seulement, marquées « experimental, not guaranteed ».

import type { LoaderId } from './registry.js';

export const COMPAT_LAYER_NOTE = 'experimental, not guaranteed';

export interface CompatLayerRequirement {
  // Slug Modrinth du projet à installer.
  slug: string;
  title: string;
}

export interface CompatLayer {
  id: string;
  name: string;
  // Loader des mods chargés par la couche…
  runs: LoaderId;
  // … sur ce loader cible…
  on: LoaderId;
  // … pour ces versions de Minecraft.
  minecraftVersions: string[];
  // Projets Modrinth à installer pour utiliser la couche.
  requires: CompatLayerRequirement[];
  // Projets remplacés par un prérequis de la couche (aucune suggestion pour eux).
  replaces?: string[];
  // Avertissement propre à la couche, repris de sa documentation.
  caveat?: string;
  // Source officielle de ces règles.
  source: string;
}

const CONNECTOR_REQUIRES: CompatLayerRequirement[] = [
  { slug: 'connector', title: 'Sinytra Connector' },
  { slug: 'forgified-fabric-api', title: 'Forgified Fabric API (replaces Fabric API)' },
];

export const COMPAT_LAYERS: readonly CompatLayer[] = [
  {
    id: 'sinytra-connector',
    name: 'Sinytra Connector',
    runs: 'fabric',
    on: 'neoforge',
    minecraftVersions: ['1.21.1'],
    requires: CONNECTOR_REQUIRES,
    replaces: ['fabric-api'],
    source:
      'Sinytra/Connector README (dev branch): Fabric mods on NeoForge, 1.21.1 primary version',
  },
  {
    id: 'sinytra-connector-1.20.1',
    name: 'Sinytra Connector (1.20.1 LTS)',
    runs: 'fabric',
    on: 'forge',
    minecraftVersions: ['1.20.1'],
    requires: CONNECTOR_REQUIRES,
    replaces: ['fabric-api'],
    caveat: 'Long-term-support version: critical bugfixes only, no new compatibility fixes.',
    source: 'Sinytra/Connector README (1.20.1 branch): Fabric mods on MinecraftForge 1.20.1',
  },
  {
    id: 'kilt',
    name: 'Kilt',
    runs: 'forge',
    on: 'fabric',
    minecraftVersions: ['1.20.1'],
    requires: [
      { slug: 'kilt', title: 'Kilt' },
      { slug: 'fabric-api', title: 'Fabric API' },
      { slug: 'fabric-language-kotlin', title: 'Fabric Language Kotlin' },
    ],
    caveat: 'Described by its authors as very experimental and highly unstable; may break worlds.',
    source: 'KiltMC/Kilt README and fabric.mod.json (version/1.20.1 branch): Forge mods on Fabric',
  },
];

// Couches permettant de charger, sur la cible, des mods d'un autre loader.
export function compatLayersFor(target: {
  loader: string;
  minecraftVersion: string;
}): CompatLayer[] {
  return COMPAT_LAYERS.filter(
    (layer) =>
      layer.on === target.loader && layer.minecraftVersions.includes(target.minecraftVersion),
  );
}
