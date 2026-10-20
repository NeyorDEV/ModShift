#!/usr/bin/env node
// Point d'entrée de l'action « ModShift Check » (appelé par action.yml après le build).
// Les entrées arrivent par variables d'environnement (jamais interpolées dans un shell).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import {
  analyzeArgs,
  buildComment,
  failingStatuses,
  parseBoolean,
  parseFailOn,
  pullRequestNumber,
  upsertComment,
} from './lib.mjs';

const env = process.env;
const cli = join(env.MODSHIFT_ROOT ?? join(import.meta.dirname, '..'), 'dist', 'cli.js');
const temp = env.RUNNER_TEMP ?? '/tmp';

function fail(message) {
  process.stdout.write(`::error title=ModShift Check::${message}\n`);
  process.exit(1);
}

function setOutput(name, value) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

let failOn;
let comment;
try {
  failOn = parseFailOn(env.MODSHIFT_FAIL_ON);
  comment = parseBoolean('comment', env.MODSHIFT_COMMENT);
} catch (error) {
  fail(error.message);
}
if (!env.MODSHIFT_PACK) fail('input "pack" is required');

const inputs = {
  pack: env.MODSHIFT_PACK,
  mc: env.MODSHIFT_MC,
  loader: env.MODSHIFT_LOADER,
  side: env.MODSHIFT_SIDE,
  config: env.MODSHIFT_CONFIG,
  cacheDir: join(temp, 'modshift-cache'),
};
const jsonPath = join(temp, 'modshift-report.json');
const reportPath = join(temp, 'modshift-report.md');

// Deux passes : JSON (compteurs) puis Markdown, servi par le cache de la première.
for (const [format, output] of [
  ['json', jsonPath],
  ['markdown', reportPath],
]) {
  try {
    execFileSync(process.execPath, [cli, ...analyzeArgs(inputs, format, output)], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env,
    });
  } catch {
    fail('modshift analyze failed (see the log above)');
  }
}

const result = JSON.parse(readFileSync(jsonPath, 'utf8'));
const report = readFileSync(reportPath, 'utf8');
const summary = result.summary ?? {};
setOutput('report', reportPath);
setOutput('json', jsonPath);
for (const [status, count] of Object.entries(summary)) setOutput(status, String(count));
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${report}\n`);

if (comment) {
  const event = env.GITHUB_EVENT_PATH
    ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
  const number = pullRequestNumber(event);
  if (!number) {
    process.stdout.write(
      'Not a pull request: no comment posted (the report is in the job summary).\n',
    );
  } else if (!env.MODSHIFT_TOKEN) {
    process.stdout.write('::warning title=ModShift Check::no token: no comment posted.\n');
  } else {
    const runUrl =
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : undefined;
    try {
      const action = await upsertComment({
        fetch,
        apiUrl: env.GITHUB_API_URL ?? 'https://api.github.com',
        repository: env.GITHUB_REPOSITORY,
        number,
        token: env.MODSHIFT_TOKEN,
        body: buildComment(report, { runUrl }),
        userAgent: 'NeyorDEV/ModShift-action (https://github.com/NeyorDEV/ModShift)',
      });
      process.stdout.write(`Pull request comment ${action}.\n`);
    } catch (error) {
      // Ex. PR depuis un fork : le jeton n'a pas le droit d'écrire. Le rapport reste dans le résumé.
      process.stdout.write(
        `::warning title=ModShift Check::could not comment on the pull request (${error.message}); needs "pull-requests: write".\n`,
      );
    }
  }
}

const failing = failingStatuses(summary, failOn);
if (failing.length > 0) {
  fail(`mods with status ${failing.map((s) => `${s} (${summary[s]})`).join(', ')}`);
}
