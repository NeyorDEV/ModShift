#!/usr/bin/env node
// Génère docs/cli.md à partir de l'aide réelle de la CLI (`npm run build` d'abord).
// La CI vérifie que le fichier versionné est à jour.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import process from 'node:process';

const commands = ['', 'analyze', 'migrate', 'interactive', 'ui', 'cache stats', 'cache clear'];
const run = (args) =>
  execFileSync(process.execPath, ['dist/cli.js', ...args], {
    encoding: 'utf8',
    // Largeur fixe : la sortie ne dépend pas du terminal.
    env: { ...process.env, COLUMNS: '80' },
  });

const version = run(['--version']).trim();
const sections = commands.map((command) => {
  const args = command ? command.split(' ') : [];
  return [
    `## \`modshift${command ? ` ${command}` : ''}\``,
    '',
    '```text',
    run([...args, '--help']).trimEnd(),
    '```',
  ].join('\n');
});

writeFileSync(
  'docs/cli.md',
  [
    '# Command-line reference',
    '',
    `Generated from \`modshift <command> --help\` (ModShift ${version}). Regenerate with`,
    '`npm run build && npm run docs:cli`. Explanations and examples are in the README.',
    '',
    ...sections.flatMap((s) => [s, '']),
  ].join('\n'),
);
