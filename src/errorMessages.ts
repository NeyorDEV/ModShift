import { UsageError } from './commands/analyze.js';
import { InputError } from './input/errors.js';
import { InvalidMrpackError } from './migrate/writer.js';
import {
  ModrinthApiError,
  ModrinthNetworkError,
  OfflineCacheMissError,
  RateLimitError,
} from './modrinth/errors.js';

export interface DescribedError {
  message: string;
  // Action concrète proposée à l'utilisateur.
  hint?: string;
}

// Traduit une erreur « attendue » en message clair et actionnable.
// Renvoie `undefined` pour une erreur inattendue (bug), affichée avec sa pile d'appels.
export function describeError(error: unknown): DescribedError | undefined {
  if (error instanceof UsageError) {
    return { message: error.message, hint: 'Run the command with --help to see every option.' };
  }
  if (error instanceof InputError) {
    return {
      message: error.message,
      hint: 'ModShift reads a Modrinth .mrpack, a CurseForge export .zip (with manifest.json) or a folder of .jar files. Check the path and that the file is not corrupted.',
    };
  }
  if (error instanceof RateLimitError) {
    const wait =
      error.resetSeconds !== undefined ? `about ${Math.ceil(error.resetSeconds)} s` : 'a minute';
    return {
      message: error.message,
      hint: `Wait ${wait} and run the command again: responses already received are cached and will not be requested again.`,
    };
  }
  if (error instanceof ModrinthNetworkError) {
    return {
      message: error.message,
      hint: 'Check your internet connection, proxy or firewall (api.modrinth.com must be reachable). To reuse results from a previous run, add --offline.',
    };
  }
  if (error instanceof OfflineCacheMissError) {
    return {
      message: error.message,
      hint: 'Run the same command once without --offline to fill the cache, then retry offline.',
    };
  }
  if (error instanceof ModrinthApiError) {
    return error.status >= 500
      ? {
          message: `Modrinth is having problems (HTTP ${error.status}) for ${error.url}`,
          hint: 'Try again in a few minutes (https://status.modrinth.com).',
        }
      : {
          message: error.message,
          hint: 'This request was rejected by Modrinth. Please open an issue with the command you ran.',
        };
  }
  if (error instanceof InvalidMrpackError) {
    return {
      message: error.message,
      hint: 'This is a ModShift bug: no file was written. Please open an issue with the source pack.',
    };
  }
  return undefined;
}

export function formatError(described: DescribedError): string {
  return `error: ${described.message}\n${described.hint ? `hint: ${described.hint}\n` : ''}`;
}
