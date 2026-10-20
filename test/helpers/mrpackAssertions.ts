import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { strFromU8, unzipSync } from 'fflate';
import { expect } from 'vitest';
import { type MrpackIndex, validateMrpackArchive } from '../../src/migrate/mrpackSpec.js';
import type { Catalog } from './fakeModrinth.js';

const schema = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../schemas/modrinth.index.schema.json', import.meta.url)),
    'utf8',
  ),
) as object;
const validateSchema = new Ajv({ allErrors: true, strict: true }).compile(schema);

export interface GeneratedPack {
  index: MrpackIndex;
  entries: Record<string, Uint8Array>;
}

// Vérifie un .mrpack généré : règles du format (code), schéma JSON (ajv), et cohérence de
// chaque fichier de mod avec le fichier Modrinth correspondant (hashes, taille, URL).
export function assertValidGeneratedPack(archive: Uint8Array, catalog: Catalog): GeneratedPack {
  expect(validateMrpackArchive(archive)).toEqual([]);
  const entries = unzipSync(archive);
  const index = JSON.parse(
    strFromU8(entries['modrinth.index.json'] ?? new Uint8Array()),
  ) as MrpackIndex;

  const schemaOk = validateSchema(index);
  expect(validateSchema.errors ?? []).toEqual([]);
  expect(schemaOk).toBe(true);

  const catalogFiles = catalog.versions.flatMap((v) => v.files);
  for (const file of index.files.filter((f) => f.path.startsWith('mods/'))) {
    const match = catalogFiles.find((f) => f.hashes.sha1 === file.hashes.sha1);
    expect(match, `no Modrinth file for ${file.path}`).toBeDefined();
    expect(file).toMatchObject({
      path: `mods/${match?.filename}`,
      hashes: { sha1: match?.hashes.sha1, sha512: match?.hashes.sha512 },
      downloads: [match?.url],
      fileSize: match?.size,
    });
  }
  return { index, entries };
}
