// Interface web de `modshift ui`. Toutes les données venant de l'API (noms de mods, raisons…)
// sont insérées avec textContent, jamais innerHTML.
import {
  countByStatus,
  displayName,
  filterMods,
  modrinthUrl,
  notesFor,
  sortMods,
  STATUS_LABELS,
  STATUS_ORDER,
  versionLabel,
} from './logic.js';

const $ = (selector) => document.querySelector(selector);

// Jeton de session : passé dans l'URL par `modshift ui`, puis retiré de la barre d'adresse.
const params = new URLSearchParams(window.location.search);
if (params.get('token')) {
  sessionStorage.setItem('modshift-token', params.get('token'));
  window.history.replaceState(null, '', window.location.pathname);
}
const token = sessionStorage.getItem('modshift-token') ?? '';

const state = {
  file: null,
  sessionId: null,
  analysis: null,
  sort: { key: 'status', dir: 'asc' },
  filters: { status: '', text: '' },
};

// --- Thème -----------------------------------------------------------------
const themeKey = 'modshift-theme';
function applyTheme(theme) {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
applyTheme(localStorage.getItem(themeKey));
$('#theme-toggle').addEventListener('click', () => {
  const current =
    document.documentElement.dataset.theme ??
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(themeKey, next);
  applyTheme(next);
});

// --- API -------------------------------------------------------------------
async function api(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init.headers ?? {}), 'X-ModShift-Token': token },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body.hint ? `${body.error} — ${body.hint}` : body.error;
    } catch {
      // corps non JSON
    }
    throw new Error(message);
  }
  return response;
}

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// Téléchargement via fetch (le jeton est un en-tête, un simple lien ne suffit pas).
async function download(path, fileName) {
  const response = await api(path);
  const url = URL.createObjectURL(await response.blob());
  const link = el('a', { href: url, download: fileName });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Étape 1 : pack et cible -------------------------------------------------
async function loadInfo() {
  try {
    const info = await (await api('/api/info')).json();
    $('#version').textContent = info.version;
    const select = $('#loader');
    const groups = {
      'mod-loader': 'Mod loaders',
      'server-plugin': 'Server plugins',
      'proxy-plugin': 'Proxy plugins',
    };
    for (const [kind, label] of Object.entries(groups)) {
      const group = el('optgroup', { label });
      for (const loader of info.loaders.filter((l) => l.kind === kind)) {
        group.append(
          el(
            'option',
            { value: loader.id },
            loader.name + (loader.mrpack ? '' : ' (analysis only)'),
          ),
        );
      }
      select.append(group);
    }
    select.value = 'neoforge';
  } catch (error) {
    setStatus($('#status'), `Cannot reach the ModShift server: ${error.message}`, true);
  }
}

function chooseFile(file) {
  if (!file) return;
  state.file = file;
  $('#dropzone-text').textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MiB)`;
  $('#analyze').disabled = false;
}

const dropzone = $('#dropzone');
$('#file-input').addEventListener('change', (event) => chooseFile(event.target.files[0]));
for (const type of ['dragenter', 'dragover']) {
  dropzone.addEventListener(type, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
}
for (const type of ['dragleave', 'drop']) {
  dropzone.addEventListener(type, () => dropzone.classList.remove('dragover'));
}
dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  chooseFile(event.dataTransfer.files[0]);
});

$('#target-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.file) return;
  const query = new URLSearchParams({
    mc: $('#mc').value.trim(),
    loader: $('#loader').value,
    maxAlternatives: $('#max-alternatives').value || '3',
    name: state.file.name,
  });
  $('#analyze').disabled = true;
  setStatus($('#status'), 'Analysing… (the first run of a large pack can take a minute)');
  try {
    const result = await (
      await api(`/api/analyze?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: state.file,
      })
    ).json();
    state.sessionId = result.sessionId;
    state.analysis = result.analysis;
    setStatus($('#status'), '');
    renderResults();
    renderMigrate(result.canMigrate);
  } catch (error) {
    setStatus($('#status'), error.message, true);
  } finally {
    $('#analyze').disabled = false;
  }
});

// --- Étape 2 : résultats ---------------------------------------------------
function badge(status) {
  return el('span', { className: `badge ${status}` }, STATUS_LABELS[status] ?? status);
}

function renderSummary() {
  const counts = countByStatus(state.analysis.mods);
  const container = $('#summary');
  container.replaceChildren(
    ...STATUS_ORDER.map((status) =>
      el(
        'button',
        {
          type: 'button',
          className: 'chip',
          'aria-pressed': String(state.filters.status === status),
          onclick: () => {
            state.filters.status = state.filters.status === status ? '' : status;
            $('#status-filter').value = state.filters.status;
            renderTable();
            renderSummary();
          },
        },
        badge(status),
        ` ${counts[status]}`,
      ),
    ),
  );
}

function renderTable() {
  const mods = sortMods(
    filterMods(state.analysis.mods, state.filters),
    state.sort.key,
    state.sort.dir,
  );
  const body = $('#mods-table tbody');
  body.replaceChildren(
    ...mods.map((mod) =>
      el(
        'tr',
        {
          tabindex: '0',
          onclick: () => showDetail(mod),
          onkeydown: (e) => e.key === 'Enter' && showDetail(mod),
        },
        el(
          'td',
          {},
          badge(mod.status),
          mod.fallback
            ? el(
                'span',
                { className: 'badge warn', title: 'Fallback compatibility, to test' },
                'fallback',
              )
            : null,
        ),
        el('td', {}, displayName(mod)),
        el('td', {}, versionLabel(mod.currentVersion)),
        el('td', {}, versionLabel(mod.targetVersion)),
        el('td', { className: 'notes' }, notesFor(mod)),
      ),
    ),
  );
  $('#empty').hidden = mods.length > 0;
  for (const button of document.querySelectorAll('th button')) {
    if (button.dataset.sort === state.sort.key) button.dataset.dir = state.sort.dir;
    else delete button.dataset.dir;
  }
}

function renderExtras() {
  const { dependencies, conflicts, ignored, warnings } = state.analysis;
  const sections = [];
  const list = (title, items) =>
    items.length > 0
      ? [el('h3', {}, title), el('ul', {}, ...items.map((text) => el('li', {}, text)))]
      : [];
  sections.push(
    ...list(
      'Dependencies added',
      dependencies.added.map(
        (d) =>
          `${d.project.title} ${versionLabel(d.version)} (required by ${d.requiredBy.join(', ')})${d.fallback ? ' — fallback compatibility, to test' : ''}`,
      ),
    ),
    ...list(
      'Missing dependencies',
      dependencies.missing.map(
        (d) => `${d.title ?? d.projectId} (required by ${d.requiredBy.join(', ')}): ${d.reason}`,
      ),
    ),
    ...list(
      'Conflicts',
      conflicts.map((c) => c.explanation),
    ),
    ...list(
      'Ignored (modshift.config.json)',
      ignored.map((m) => `${m.project?.title ?? m.fileName} (rule ${m.rule})`),
    ),
    ...list('Warnings', warnings),
  );
  $('#extras').replaceChildren(el('div', { className: 'extras' }, ...sections));
}

function renderResults() {
  const { pack, target, mods } = state.analysis;
  $('#results').hidden = false;
  const source = [pack.minecraftVersion, pack.loader].filter(Boolean).join(' ') || 'unknown source';
  $('#results-title').textContent =
    `${pack.name ?? state.file.name}: ${source} → ${target.minecraftVersion} ${target.loader} · ${mods.length} mod(s)`;
  renderSummary();
  renderTable();
  renderExtras();
}

for (const button of document.querySelectorAll('th button')) {
  button.addEventListener('click', () => {
    const key = button.dataset.sort;
    state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc' };
    renderTable();
  });
}
$('#search').addEventListener('input', (event) => {
  state.filters.text = event.target.value;
  renderTable();
});
$('#status-filter').addEventListener('change', (event) => {
  state.filters.status = event.target.value;
  renderTable();
  renderSummary();
});
$('#download-analysis').addEventListener('click', (event) => {
  event.preventDefault();
  download(`/api/sessions/${state.sessionId}/download/analysis`, 'modshift-analysis.json').catch(
    (error) => setStatus($('#status'), error.message, true),
  );
});

function showDetail(mod) {
  const rows = [
    ['Status', STATUS_LABELS[mod.status]],
    ['File', mod.fileName],
    [
      'Identification',
      mod.identification === 'mod-id' ? 'by mod id only (unverified)' : mod.identification,
    ],
    ['Current version', versionLabel(mod.currentVersion)],
    ['Target version', versionLabel(mod.targetVersion)],
  ];
  if (mod.targetVersion) rows.push(['Target loaders', mod.targetVersion.loaders.join(', ')]);
  if (mod.fallback)
    rows.push(['Fallback', `${mod.fallback.loader} version: fallback compatibility, to test`]);
  if (mod.loaderChange)
    rows.push([
      'Loader',
      `same project, ${mod.loaderChange.from} → ${mod.loaderChange.to} version`,
    ]);
  if (mod.compatLayer)
    rows.push([
      'Compatibility layer',
      `${mod.compatLayer.runs} version ${mod.compatLayer.version.versionNumber} through ${mod.compatLayer.name}: experimental, not guaranteed, not added to the pack. Requires ${mod.compatLayer.requires.map((r) => r.title).join(', ')}.`,
    ]);
  if (mod.reason) rows.push(['Why', mod.reason]);
  const body = [el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))];
  if (mod.project) {
    body.push(
      el(
        'p',
        {},
        el(
          'a',
          { href: modrinthUrl(mod.project), target: '_blank', rel: 'noopener noreferrer' },
          'Open on Modrinth ↗',
        ),
      ),
    );
  }
  if (mod.alternatives.length > 0) {
    body.push(
      el('h4', {}, 'Alternatives (suggestions, to verify)'),
      el(
        'ul',
        {},
        ...mod.alternatives.map((a) =>
          el(
            'li',
            {},
            el(
              'a',
              { href: modrinthUrl(a.project), target: '_blank', rel: 'noopener noreferrer' },
              a.project.title,
            ),
            ` — relevance ${a.score}/100 — ${a.explanation}`,
          ),
        ),
      ),
    );
  }
  const requiredBy = state.analysis.dependencies.added.filter((d) =>
    d.requiredBy.includes(displayName(mod)),
  );
  if (requiredBy.length > 0) {
    body.push(
      el('h4', {}, 'Adds dependencies'),
      el('ul', {}, ...requiredBy.map((d) => el('li', {}, d.project.title))),
    );
  }
  $('#detail-title').textContent = displayName(mod);
  $('#detail-body').replaceChildren(...body);
  $('#detail').showModal();
}

// --- Étape 3 : pack migré ----------------------------------------------------
function renderMigrate(canMigrate) {
  $('#migrate').hidden = false;
  $('#downloads').hidden = true;
  $('#migrate-form').hidden = !canMigrate;
  $('#migrate-unsupported').hidden = canMigrate;
  $('#migrate-unsupported').textContent = canMigrate
    ? ''
    : 'This target is a plugin platform: the .mrpack format cannot describe it, so only the analysis is available.';
  const { pack, target } = state.analysis;
  if (pack.loader === target.loader && pack.minecraftVersion === target.minecraftVersion) {
    $('#loader-version').placeholder = 'same as the source pack';
  }
}

$('#migrate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#build').disabled = true;
  setStatus($('#migrate-status'), 'Building the pack…');
  try {
    const result = await (
      await api('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.sessionId,
          loaderVersion: $('#loader-version').value,
          includeAlternatives: $('#include-alternatives').checked,
        }),
      })
    ).json();
    $('#downloads').hidden = false;
    setStatus(
      $('#migrate-status'),
      `${result.included.length} mod(s) included, ${result.excluded.length} excluded (see the report).`,
    );
    $('#download-mrpack').onclick = (e) => {
      e.preventDefault();
      download(result.downloads.mrpack, 'migrated.mrpack').catch((error) =>
        setStatus($('#migrate-status'), error.message, true),
      );
    };
    $('#download-report').onclick = (e) => {
      e.preventDefault();
      download(result.downloads.report, 'MIGRATION_REPORT.md').catch((error) =>
        setStatus($('#migrate-status'), error.message, true),
      );
    };
  } catch (error) {
    setStatus($('#migrate-status'), error.message, true);
  } finally {
    $('#build').disabled = false;
  }
});

loadInfo();
