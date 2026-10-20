import type { AnalysisResult } from '../core/types.js';
import { MOD_STATUSES } from '../core/types.js';
import {
  CONFLICT_LABELS,
  modDisplayName,
  modNotes,
  STATUS_ICONS,
  STATUS_LABELS,
  versionLabel,
  alternativeWhy,
  compatLayerSection,
  externalSection,
  sideSection,
} from './labels.js';

// Échappe les caractères qui casseraient un tableau Markdown.
function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') || ' ';
}

function table(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

function sourceLabel(result: AnalysisResult): string {
  const { minecraftVersion, loader } = result.pack;
  return [minecraftVersion ?? 'unknown version', loader ?? 'unknown loader'].join(' ');
}

export function renderMarkdown(result: AnalysisResult): string {
  const lines: string[] = [];
  const target = `${result.target.minecraftVersion} ${result.target.loader}`;
  lines.push(`# ModShift report${result.pack.name ? `: ${result.pack.name}` : ''}`, '');
  lines.push(`- **Source:** ${sourceLabel(result)} (${result.pack.source})`);
  lines.push(`- **Target:** ${target}`);
  lines.push(`- **Mods analysed:** ${result.mods.length}`);
  if (result.otherFilesCount > 0) {
    lines.push(`- **Other files (not analysed):** ${result.otherFilesCount}`);
  }
  lines.push('', '## Summary', '');
  lines.push(
    ...table(
      ['Status', 'Count'],
      MOD_STATUSES.map((s) => [
        `${STATUS_ICONS[s]} ${STATUS_LABELS[s]}`,
        String(result.summary[s]),
      ]),
    ),
  );

  lines.push('', '## Mods', '');
  lines.push(
    ...table(
      ['Status', 'Mod', 'File', 'Current', 'Target', 'Notes'],
      result.mods.map((m) => [
        `${STATUS_ICONS[m.status]} ${STATUS_LABELS[m.status]}`,
        m.project ? `[${m.project.title}](https://modrinth.com/mod/${m.project.slug})` : m.fileName,
        m.fileName,
        versionLabel(m.currentVersion),
        versionLabel(m.targetVersion),
        modNotes(m),
      ]),
    ),
  );

  const withAlternatives = result.mods.filter((m) => m.alternatives.length > 0);
  if (withAlternatives.length > 0) {
    lines.push('', '## Suggested alternatives', '');
    lines.push('> These are **suggestions, to verify**: they are not equivalent replacements.', '');
    for (const mod of withAlternatives) {
      lines.push(`### ${modDisplayName(mod)}`, '');
      for (const alt of mod.alternatives) {
        lines.push(
          `- [${alt.project.title}](https://modrinth.com/mod/${alt.project.slug}) — ${alternativeWhy(alt)}`,
        );
      }
      lines.push('');
    }
    lines.pop();
  }

  lines.push(...compatLayerSection(result.mods));
  lines.push(...externalSection(result.mods));

  const { added, missing } = result.dependencies;
  if (added.length > 0 || missing.length > 0) {
    lines.push('', '## Dependencies', '');
    if (added.length > 0) {
      lines.push('Added (required by mods of the migrated pack):', '');
      lines.push(
        ...table(
          ['Dependency', 'Version', 'Required by'],
          added.map((d) => [
            d.project.title,
            `${versionLabel(d.version)}${d.fallback ? ` (${d.fallback.loader} version: fallback compatibility, to test)` : ''}`,
            d.requiredBy.join(', '),
          ]),
        ),
      );
    }
    if (missing.length > 0) {
      if (added.length > 0) lines.push('');
      lines.push('Missing (no compatible version):', '');
      lines.push(
        ...table(
          ['Dependency', 'Required by', 'Reason'],
          missing.map((d) => [d.title ?? d.projectId, d.requiredBy.join(', '), d.reason]),
        ),
      );
    }
  }

  if (result.conflicts.length > 0) {
    lines.push('', '## Conflicts', '');
    for (const c of result.conflicts) {
      lines.push(`- **${CONFLICT_LABELS[c.kind]}:** ${c.explanation}`);
    }
  }

  if (result.ignored.length > 0) {
    lines.push('', '## Ignored (modshift.config.json)', '');
    for (const mod of result.ignored) {
      lines.push(
        `- ${mod.project?.title ?? mod.fileName} (\`${mod.fileName}\`), rule \`${mod.rule}\``,
      );
    }
  }

  lines.push(...sideSection(result));

  if (result.warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const w of result.warnings) lines.push(`- ${w}`);
  }

  return `${lines.join('\n')}\n`;
}
