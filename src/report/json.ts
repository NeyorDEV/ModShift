import type { AnalysisResult } from '../core/types.js';
import { MODSHIFT_VERSION } from '../version.js';

// Version du schéma du rapport JSON (à incrémenter en cas de changement incompatible).
export const REPORT_SCHEMA_VERSION = 1;

export function renderJson(result: AnalysisResult): string {
  return `${JSON.stringify(
    {
      schemaVersion: REPORT_SCHEMA_VERSION,
      generator: `modshift ${MODSHIFT_VERSION}`,
      ...result,
    },
    null,
    2,
  )}\n`;
}
