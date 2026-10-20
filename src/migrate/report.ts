import type { AnalysisResult } from '../core/types.js';
import {
  alternativesLabel,
  alternativeWhy,
  compatLayerSection,
  externalSection,
  CONFLICT_LABELS,
  versionLabel,
} from '../report/labels.js';
import type { MigrationPlan, PlannedMod } from './plan.js';

export const MIGRATION_REPORT_FILE = 'MIGRATION_REPORT.md';

const SOURCE_LABELS: Record<PlannedMod['source'], string> = {
  kept: 'kept (already compatible)',
  updated: 'updated',
  dependency: 'added dependency',
  alternative: 'alternative — suggestion, to verify',
};

function cell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ') || ' ';
}

function loaderLine(plan: MigrationPlan): string {
  const { loader } = plan.target;
  if (!plan.loaderVersion) return `${loader} (version unknown)`;
  const from =
    plan.loaderVersionSource === 'option'
      ? '--loader-version'
      : plan.loaderVersionSource === 'config'
        ? 'modshift.config.json'
        : 'source pack';
  return `${loader} ${plan.loaderVersion} (from ${from})`;
}

function modOrigin(mod: PlannedMod): string {
  if (mod.source === 'dependency') return `required by ${mod.requiredBy?.join(', ') ?? '?'}`;
  if (mod.source === 'kept') return 'same version as the source pack';
  const unverified = mod.unverified ? ' (identified by mod id only, unverified)' : '';
  return mod.replaces ? `replaces ${mod.replaces}${unverified}` : '';
}

// Rapport Markdown écrit à côté du .mrpack généré (MIGRATION_REPORT.md).
export function renderMigrationReport(
  plan: MigrationPlan,
  analysis: AnalysisResult,
  outputName: string,
): string {
  const lines: string[] = [];
  const source = [analysis.pack.minecraftVersion, analysis.pack.loader].filter(Boolean).join(' ');
  lines.push(`# Migration report${analysis.pack.name ? `: ${analysis.pack.name}` : ''}`, '');
  lines.push(`- **Source:** ${source || 'unknown'} (${analysis.pack.source})`);
  lines.push(`- **Target:** Minecraft ${plan.target.minecraftVersion}, ${loaderLine(plan)}`);
  lines.push(`- **Generated pack:** \`${outputName}\``);
  lines.push(
    `- **Mods:** ${plan.mods.length} included, ${plan.excluded.length} excluded from ${analysis.mods.length} analysed`,
  );

  const alternatives = plan.mods.filter((m) => m.source === 'alternative');
  if (alternatives.length > 0) {
    lines.push(
      '',
      `> **${alternatives.length} alternative(s) were included automatically** (` +
        '`--include-alternatives`). They are **suggestions, to verify**: they are not equivalent ' +
        'to the mods they replace, and worlds or configs may not carry over.',
    );
  }

  lines.push('', '## Included mods', '');
  if (plan.mods.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| Mod | Version | Status | Origin |', '| --- | --- | --- | --- |');
    for (const mod of plan.mods) {
      lines.push(
        `| ${cell(mod.title)} | ${cell(versionLabel(mod.version))} | ${SOURCE_LABELS[mod.source]}${mod.fallbackLoader ? `, ${mod.fallbackLoader} version: fallback compatibility, to test` : ''}${mod.loaderChange ? `, same project, ${mod.loaderChange.to} version (was ${mod.loaderChange.from})` : ''} | ${cell(modOrigin(mod))} |`,
      );
    }
  }

  lines.push('', '## Excluded mods', '');
  if (plan.excluded.length === 0) {
    lines.push('_None: every mod has a version for the target._');
  } else {
    lines.push(
      'These mods have no compatible version and are **not** in the generated pack.',
      '',
      '| Mod | File | Reason | Suggested alternatives (to verify) |',
      '| --- | --- | --- | --- |',
    );
    for (const mod of plan.excluded) {
      const adopted = mod.adoptedAlternative
        ? ` **Included: ${mod.adoptedAlternative.project.title}.**`
        : '';
      lines.push(
        `| ${cell(mod.project?.title ?? mod.fileName)} | ${cell(mod.fileName)} | ${cell(mod.reason ?? '')} | ${cell(
          mod.alternatives.length > 0
            ? mod.alternatives
                .map((a) => `[${a.project.title}](https://modrinth.com/mod/${a.project.slug})`)
                .join(', ') + adopted
            : '—',
        )} |`,
      );
    }
  }

  const explained = plan.excluded.filter((m) => m.alternatives.length > 0);
  if (explained.length > 0) {
    lines.push('', '## Why these alternatives', '');
    lines.push(
      'Ranked by relevance: shared categories, similar name, keywords from the description and ' +
        'popularity. ModShift does not convert mod code: an alternative is a different mod, to verify.',
    );
    for (const mod of explained) {
      lines.push('', `**${mod.project?.title ?? mod.fileName}**`, '');
      for (const alt of mod.alternatives) {
        lines.push(`- ${alt.project.title}: ${alternativeWhy(alt)}`);
      }
    }
  }

  lines.push(...compatLayerSection(plan.excluded));
  lines.push(...externalSection(plan.excluded));

  const { missing } = analysis.dependencies;
  if (missing.length > 0) {
    lines.push('', '## Missing dependencies', '');
    lines.push(
      'Required by included mods but not available for the target: those mods may not load.',
    );
    lines.push('');
    for (const dep of missing) {
      lines.push(
        `- **${dep.title ?? dep.projectId}** (required by ${dep.requiredBy.join(', ')}): ${dep.reason}`,
      );
    }
  }

  if (analysis.conflicts.length > 0) {
    lines.push('', '## Conflicts', '');
    lines.push(
      'ModShift reports these problems but does not resolve them automatically: review them before playing.',
      '',
    );
    for (const conflict of analysis.conflicts) {
      lines.push(`- **${CONFLICT_LABELS[conflict.kind]}:** ${conflict.explanation}`);
    }
  }

  if (plan.keptFiles.length > 0 || plan.droppedFiles.length > 0) {
    lines.push('', '## Other files', '');
    for (const file of plan.keptFiles) {
      lines.push(`- \`${file.path}\`: kept unchanged (not checked for the target)`);
    }
    for (const file of plan.droppedFiles) {
      lines.push(`- \`${file.path}\`: **not kept**, ${file.reason}`);
    }
  }

  if (analysis.ignored.length > 0) {
    lines.push('', '## Ignored mods', '');
    lines.push('Left out on purpose by the `ignore` list of `modshift.config.json`:', '');
    for (const mod of analysis.ignored) {
      lines.push(
        `- ${mod.project?.title ?? mod.fileName} (\`${mod.fileName}\`), rule \`${mod.rule}\``,
      );
    }
  }

  const warnings = [...analysis.warnings, ...plan.warnings];
  if (warnings.length > 0) {
    lines.push('', '## Warnings', '');
    for (const w of warnings) lines.push(`- ${w}`);
  }
  return `${lines.join('\n')}\n`;
}

const SOURCE_ICONS: Record<PlannedMod['source'], string> = {
  kept: '=',
  updated: '↑',
  dependency: '+',
  alternative: '~',
};

// Résumé console du plan (utilisé par --dry-run et après écriture).
export function renderPlanText(
  plan: MigrationPlan,
  analysis: AnalysisResult,
  header: string,
  overrideCount: number,
): string {
  const out: string[] = [header, ''];
  out.push(`Target: Minecraft ${plan.target.minecraftVersion}, ${loaderLine(plan)}`);
  out.push(
    `Pack: ${plan.mods.length} mod(s), ${plan.keptFiles.length} other file(s), ${overrideCount} override file(s)`,
  );
  out.push('', 'Included:');
  if (plan.mods.length === 0) out.push('  (none)');
  for (const mod of plan.mods) {
    const current = analysis.mods.find((m) => m.fileName === mod.replaces)?.currentVersion;
    const versions =
      mod.source === 'updated' && current
        ? `${versionLabel(current)} → ${versionLabel(mod.version)}`
        : versionLabel(mod.version);
    const extra =
      mod.source === 'dependency'
        ? ` (dependency of ${mod.requiredBy?.join(', ') ?? '?'})`
        : mod.source === 'alternative'
          ? ` (alternative to ${mod.replaces ?? '?'}: suggestion, to verify)`
          : '';
    const fallback = mod.fallbackLoader
      ? ` [${mod.fallbackLoader} version: fallback compatibility, to test]`
      : '';
    const switched = mod.loaderChange
      ? ` [same project, ${mod.loaderChange.from} → ${mod.loaderChange.to}]`
      : '';
    out.push(
      `  ${SOURCE_ICONS[mod.source]} ${mod.title} ${versions}${extra}${fallback}${switched}`,
    );
  }
  out.push('', 'Excluded:');
  if (plan.excluded.length === 0) out.push('  (none)');
  for (const mod of plan.excluded) {
    const alts = alternativesLabel(mod);
    out.push(
      `  - ${mod.project?.title ?? mod.fileName}: ${mod.reason ?? 'no compatible version'}${alts ? ` ${alts}` : ''}`,
    );
  }
  for (const mod of analysis.ignored) {
    out.push(`  · ignored ${mod.project?.title ?? mod.fileName} (rule ${mod.rule})`);
  }
  for (const dep of analysis.dependencies.missing) {
    out.push(
      `  ! missing dependency ${dep.title ?? dep.projectId} (required by ${dep.requiredBy.join(', ')})`,
    );
  }
  for (const conflict of analysis.conflicts) {
    out.push(`  ✘ ${CONFLICT_LABELS[conflict.kind]}: ${conflict.explanation}`);
  }
  return `${out.join('\n')}\n`;
}
