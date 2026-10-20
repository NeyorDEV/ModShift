// Logique de l'action « ModShift Check » (testable sans GitHub ni réseau).

export const COMMENT_MARKER = '<!-- modshift-check -->';
// Limite d'un commentaire GitHub : 65 536 caractères ; on garde une marge.
export const MAX_COMMENT_LENGTH = 60_000;
export const STATUSES = ['compatible', 'update-found', 'alternative-suggested', 'not-found'];

// « not-found,alternative-suggested » → liste validée de statuts.
export function parseFailOn(value) {
  const list = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const status of list) {
    if (!STATUSES.includes(status)) {
      throw new Error(`invalid fail-on status "${status}" (expected: ${STATUSES.join(', ')})`);
    }
  }
  return list;
}

export function parseBoolean(name, value) {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false' || normalized === '') return false;
  throw new Error(`input "${name}" must be true or false (got "${value}")`);
}

// Statuts qui font échouer le job (ceux de fail-on présents au moins une fois).
export function failingStatuses(summary, failOn) {
  return failOn.filter((status) => (summary[status] ?? 0) > 0);
}

// Corps du commentaire : marqueur caché (pour le retrouver), rapport tronqué si besoin.
export function buildComment(report, { runUrl } = {}) {
  const footer = runUrl ? `\n\n---\nFull report: ${runUrl}` : '';
  let body = `${COMMENT_MARKER}\n${report.trim()}`;
  if (body.length + footer.length > MAX_COMMENT_LENGTH) {
    body = `${body.slice(0, MAX_COMMENT_LENGTH - footer.length - 80)}\n\n_…report truncated, see the job summary._`;
  }
  return `${body}${footer}`;
}

// Numéro de la pull request à partir de l'événement GitHub (undefined hors pull_request).
export function pullRequestNumber(event) {
  const number =
    event?.pull_request?.number ?? (event?.issue?.pull_request ? event.issue.number : undefined);
  return Number.isInteger(number) ? number : undefined;
}

// Crée ou met à jour l'unique commentaire de ModShift sur la PR (API REST « issue comments » :
// toute pull request est une issue).
export async function upsertComment({ fetch, apiUrl, repository, number, token, body, userAgent }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': userAgent,
    'Content-Type': 'application/json',
  };
  const base = `${apiUrl}/repos/${repository}/issues`;
  let existing;
  for (let page = 1; page <= 10 && !existing; page++) {
    const response = await fetch(`${base}/${number}/comments?per_page=100&page=${page}`, {
      headers,
    });
    if (!response.ok) throw new Error(`listing comments failed: HTTP ${response.status}`);
    const comments = await response.json();
    existing = comments.find(
      (c) => typeof c.body === 'string' && c.body.startsWith(COMMENT_MARKER),
    );
    if (comments.length < 100) break;
  }
  const response = existing
    ? await fetch(`${base}/comments/${existing.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body }),
      })
    : await fetch(`${base}/${number}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body }),
      });
  if (!response.ok) {
    throw new Error(
      `${existing ? 'updating' : 'creating'} the comment failed: HTTP ${response.status}`,
    );
  }
  return existing ? 'updated' : 'created';
}

// Arguments de `modshift analyze` à partir des entrées de l'action (aucun shell).
export function analyzeArgs(inputs, format, output) {
  const args = ['analyze', '--format', format, '--output', output, '--quiet'];
  if (inputs.mc) args.push('--mc', inputs.mc);
  if (inputs.loader) args.push('--loader', inputs.loader);
  if (inputs.side) args.push('--side', inputs.side);
  if (inputs.config) args.push('--config', inputs.config);
  if (inputs.cacheDir) args.push('--cache-dir', inputs.cacheDir);
  // « -- » : un chemin commençant par « - » reste un chemin, pas une option.
  args.push('--', inputs.pack);
  return args;
}
