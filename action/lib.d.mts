// Types de la logique de l'action (utilisés par les tests).
export declare const COMMENT_MARKER: string;
export declare const MAX_COMMENT_LENGTH: number;
export declare const STATUSES: string[];
export declare function parseFailOn(value: string | undefined): string[];
export declare function parseBoolean(name: string, value: string | undefined): boolean;
export declare function failingStatuses(
  summary: Record<string, number>,
  failOn: string[],
): string[];
export declare function buildComment(report: string, options?: { runUrl?: string }): string;
export declare function pullRequestNumber(event: unknown): number | undefined;
export declare function upsertComment(options: {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  apiUrl: string;
  repository: string;
  number: number;
  token: string;
  body: string;
  userAgent: string;
}): Promise<'created' | 'updated'>;
export interface ActionInputs {
  pack: string;
  mc?: string;
  loader?: string;
  side?: string;
  config?: string;
  cacheDir?: string;
}
export declare function analyzeArgs(inputs: ActionInputs, format: string, output: string): string[];
