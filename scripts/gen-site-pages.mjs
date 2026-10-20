#!/usr/bin/env node
// Génère les pages « guide » du site de documentation (docs/) à partir des sections du README
// et de action/README.md, pour qu'il n'y ait qu'une seule source de vérité. Les liens relatifs
// au dépôt sont réécrits pour le site. La CI vérifie que les pages versionnées sont à jour.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';

const REPO = 'https://github.com/NeyorDEV/ModShift/blob/main';

// Section du README (titre exact, niveau 2) → page du site.
const PAGES = [
  { file: 'guide/introduction.md', title: 'Introduction', sections: ['Features'], intro: true },
  { file: 'guide/installation.md', title: 'Installation', sections: ['Installation'] },
  {
    file: 'guide/getting-started.md',
    title: 'Getting started',
    sections: ['Quick start', 'Example output'],
  },
  { file: 'guide/commands.md', title: 'Commands and options', sections: ['Commands', 'Options'] },
  { file: 'guide/interactive.md', title: 'Interactive mode', sections: ['Interactive mode'] },
  { file: 'guide/web-ui.md', title: 'Web interface', sections: ['Web interface'] },
  {
    file: 'guide/configuration.md',
    title: 'Configuration file',
    sections: ['Configuration file'],
  },
  {
    file: 'guide/sources.md',
    title: 'Sources: CurseForge and plugins',
    sections: ['Other sources (plugins)', 'CurseForge packs'],
  },
  { file: 'guide/cache.md', title: 'Cache and offline mode', sections: ['Cache and offline mode'] },
  {
    file: 'guide/changing-loader.md',
    title: 'Changing loader',
    sections: ['Changing loader (e.g. Forge → Fabric)'],
  },
  { file: 'guide/client-server.md', title: 'Client and server', sections: ['Client and server'] },
  { file: 'guide/performance.md', title: 'Performance', sections: ['Performance'] },
  {
    file: 'guide/how-it-works.md',
    title: 'How it works',
    sections: ['How it works'],
  },
  { file: 'guide/api.md', title: 'Programmatic API', sections: ['Programmatic API'] },
  { file: 'faq.md', title: 'FAQ', sections: ['FAQ'] },
  { file: 'limitations.md', title: 'Known limitations', sections: ['Limitations'] },
];

// Ancres du README → pages du site.
const ANCHORS = {
  'cache-and-offline-mode': '/guide/cache',
  'changing-loader-eg-forge--fabric': '/guide/changing-loader',
  'client-and-server': '/guide/client-server',
  commands: '/guide/commands',
  'configuration-file': '/guide/configuration',
  contributing: `${REPO}/CONTRIBUTING.md`,
  'curseforge-packs': '/guide/sources#curseforge-packs',
  'example-output': '/guide/getting-started#example-output',
  faq: '/faq',
  features: '/guide/introduction',
  'github-action': '/guide/github-action',
  'how-it-works': '/guide/how-it-works',
  installation: '/guide/installation',
  'interactive-mode': '/guide/interactive',
  license: `${REPO}/LICENSE`,
  limitations: '/limitations',
  options: '/guide/commands#options',
  'other-sources-plugins': '/guide/sources',
  performance: '/guide/performance',
  'programmatic-api': '/guide/api',
  'quick-start': '/guide/getting-started',
  security: `${REPO}/SECURITY.md`,
  'web-interface': '/guide/web-ui',
};

// Réécrit un lien relatif au dépôt (depuis `from`, chemin dans le dépôt) pour le site ; les
// images restent relatives à la page (`page`, chemin dans docs/) pour être intégrées au build.
function rewrite(target, from, page) {
  if (/^[a-z]+:/i.test(target)) return target;
  const [path, hash] = target.split('#');
  if (!path) return ANCHORS[hash] ?? `#${hash}`;
  const resolved = new URL(path, `file:///${from}`).pathname.slice(1);
  const suffix = hash ? `#${hash}` : '';
  if (resolved.startsWith('docs/images/')) {
    return posix.relative(posix.dirname(`docs/${page}`), resolved);
  }
  if (resolved.startsWith('docs/') && resolved.endsWith('.md')) {
    return `/${resolved.slice('docs/'.length, -'.md'.length)}${suffix}`;
  }
  if (resolved === 'action/README.md') return `/guide/github-action${suffix}`;
  if (resolved === 'bench/README.md') return `/guide/performance${suffix || '#method'}`;
  return `${REPO}/${resolved}${suffix}`;
}

function rewriteLinks(markdown, from, page) {
  return markdown
    .replace(/\]\(([^)\s]+)\)/g, (_, target) => `](${rewrite(target, from, page)})`)
    .replace(
      /(<img [^>]*src=")([^"]+)"/g,
      (_, before, src) => `${before}${rewrite(src, from, page)}"`,
    );
}

// Sections de niveau 2 d'un document Markdown (hors blocs de code).
function sections(markdown) {
  const result = new Map();
  let current;
  let inCode = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    if (!inCode && line.startsWith('## ')) {
      current = line.slice(3).trim();
      result.set(current, []);
      continue;
    }
    if (current) result.get(current).push(line);
  }
  return result;
}

// Un niveau de titre en moins : « ### » devient « ## » dans une page dont le titre est « # ».
const promote = (lines) =>
  lines.map((line) => (/^#{3,6} /.test(line) ? line.slice(1) : line)).join('\n');

const header = (source) =>
  `<!-- Generated from ${source} by scripts/gen-site-pages.mjs: edit the source, then run npm run docs:pages. -->`;

function write(file, content) {
  const path = `docs/${file}`;
  mkdirSync(dirname(path), { recursive: true });
  // « {{ … }} » (ex. expressions GitHub Actions) serait interprété par Vue : page en v-pre.
  const body = content.includes('{{') ? `::: v-pre\n${content.trim()}\n:::` : content.trim();
  writeFileSync(path, `${body}\n`);
}

const readme = readFileSync('README.md', 'utf8');
const bySection = sections(readme);
for (const page of PAGES) {
  const parts = page.sections.map((title) => {
    const lines = bySection.get(title);
    if (!lines) throw new Error(`README.md has no "## ${title}" section`);
    // La première section prend le titre de la page (sauf après l'introduction), les suivantes
    // deviennent des « ## ».
    const first = title === page.sections[0] && !page.intro;
    return first ? promote(lines) : `## ${title}\n${promote(lines)}`;
  });
  let intro = '';
  if (page.intro) {
    // Paragraphe d'introduction du README (après le titre et les badges, avant « Contents »).
    const head = readme.slice(0, readme.indexOf('\n## '));
    intro = head
      .split('\n')
      .filter(
        (line) =>
          !line.startsWith('# ') && !line.includes('img.shields.io') && !line.startsWith('[!['),
      )
      .join('\n');
  }
  write(
    page.file,
    rewriteLinks(
      [header('README.md'), `# ${page.title}`, intro, ...parts].join('\n\n'),
      'README.md',
      page.file,
    ),
  );
}

// Page de l'action GitHub : action/README.md.
const action = readFileSync('action/README.md', 'utf8');
write(
  'guide/github-action.md',
  rewriteLinks(
    `${header('action/README.md')}\n\n${action}`,
    'action/README.md',
    'guide/github-action.md',
  ),
);

// Méthode des benchmarks, ajoutée à la page Performance.
const bench = readFileSync('bench/README.md', 'utf8').replace(/^# Benchmarks\n/, '');
const performance = readFileSync('docs/guide/performance.md', 'utf8');
write(
  'guide/performance.md',
  `${performance}\n## Method\n${rewriteLinks(bench.replace(/^## /gm, '### '), 'bench/README.md', 'guide/performance.md')}`,
);
