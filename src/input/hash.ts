import { createHash } from 'node:crypto';
import type { FileHashes } from '../types.js';

// Calcule les empreintes SHA-1 et SHA-512 utilisées par Modrinth pour identifier un fichier.
export function computeHashes(data: Uint8Array): Required<FileHashes> {
  return {
    sha1: createHash('sha1').update(data).digest('hex'),
    sha512: createHash('sha512').update(data).digest('hex'),
  };
}
