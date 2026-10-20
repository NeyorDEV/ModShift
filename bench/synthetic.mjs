// Génère un pack .mrpack synthétique et le faux catalogue Modrinth correspondant.
// Données entièrement inventées (identifiants et hashes factices), déterministes pour une taille
// donnée : deux exécutions produisent exactement les mêmes entrées.
import { strToU8, zipSync } from 'fflate';

const SOURCE = { mc: '1.20.1', loader: 'fabric' };
const TARGET = { mc: '1.21.1', loader: 'fabric' };
const LIBRARIES = 20;
const CATEGORIES = ['utility', 'optimization', 'adventure', 'technology', 'decoration', 'magic'];

const hex = (n, length) => n.toString(16).padStart(length, '0').slice(-length);
const projectId = (n) => `B${hex(n, 7)}`.toUpperCase();

function version(id, project, gameVersion, hashSeed, dependencies = []) {
  return {
    id,
    project_id: project,
    name: `${id} build`,
    version_number: '1.0.0',
    game_versions: [gameVersion],
    loaders: [SOURCE.loader],
    version_type: 'release',
    date_published: '2024-06-01T00:00:00Z',
    dependencies,
    status: 'listed',
    files: [
      {
        hashes: { sha1: hex(hashSeed, 40), sha512: hex(hashSeed, 128) },
        url: `https://cdn.modrinth.com/data/${project}/versions/${id}/${id}.jar`,
        filename: `${id}.jar`,
        primary: true,
        size: 1000,
      },
    ],
  };
}

function project(n, title, categories) {
  return {
    id: projectId(n),
    slug: `bench-${n}`,
    title,
    description: `${title} (synthetic benchmark data)`,
    categories,
    project_type: 'mod',
    client_side: 'optional',
    server_side: 'optional',
    loaders: [SOURCE.loader],
    game_versions: [SOURCE.mc, TARGET.mc],
    downloads: 1000 + ((n * 7919) % 1_000_000),
  };
}

// Répartition des mods (en %) : 65 mis à jour, 10 déjà compatibles, 15 sans version cible
// (recherche d'alternatives), 10 inconnus de Modrinth. 20 % ont une bibliothèque requise.
export function generate(size) {
  const projects = [];
  const versions = [];
  const files = [];

  for (let l = 0; l < LIBRARIES; l++) {
    const n = 1_000_000 + l;
    projects.push(project(n, `Bench Library ${l}`, ['library']));
    versions.push(version(`lib${l}new`, projectId(n), TARGET.mc, 0x2000000 + l));
  }

  for (let i = 0; i < size; i++) {
    const kind = i % 20;
    const id = projectId(i);
    const hashSeed = 0x1000000 + i;
    const category = CATEGORIES[i % CATEGORIES.length];
    const deps =
      i % 5 === 0
        ? [
            {
              version_id: null,
              project_id: projectId(1_000_000 + (i % LIBRARIES)),
              file_name: null,
              dependency_type: 'required',
            },
          ]
        : [];
    const unknown = kind >= 18;
    if (!unknown) {
      projects.push(project(i, `Bench Mod ${i} ${category}`, [category]));
      const current = version(`m${i}old`, id, SOURCE.mc, hashSeed, deps);
      if (kind === 16 || kind === 17) current.game_versions = [SOURCE.mc, TARGET.mc];
      versions.push(current);
      if (kind < 13) versions.push(version(`m${i}new`, id, TARGET.mc, 0x3000000 + i, deps));
    }
    // Les mods 13 à 15 (mod 20) n'ont pas de version cible : alternatives recherchées.
    files.push({
      path: `mods/bench-mod-${i}.jar`,
      hashes: { sha1: hex(hashSeed, 40), sha512: hex(hashSeed, 128) },
      downloads: [`https://cdn.modrinth.com/data/${id}/versions/m${i}old/m${i}old.jar`],
      fileSize: 1000,
    });
  }

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: `Benchmark pack (${size} mods)`,
    summary: 'Synthetic benchmark data: fake hashes and fake IDs, not real Modrinth data.',
    files,
    dependencies: { minecraft: SOURCE.mc, 'fabric-loader': '0.16.5' },
  };
  const mrpack = zipSync({ 'modrinth.index.json': strToU8(JSON.stringify(index)) });
  return {
    catalog: { projects, versions },
    mrpack,
    target: { minecraftVersion: TARGET.mc, loader: TARGET.loader },
  };
}
