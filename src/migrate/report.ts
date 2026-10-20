import type { AnalysisResult } from '../core/types.js';
import { alternativesLabel, versionLabel } from '../report/labels.js';
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
  const from = plan.loaderVersionSource === 'option' ? '--loader-version' : 'source pack';
  return `${loader} ${plan.loaderVersion} (from ${from})`;
}

function modOrigin(mod: PlannedMod): string {
  if (mod.source === 'dependency') return `required by ${mod.requiredBy?.join(', ') ?? '?'}`;
  if (mod.source === 'kept') return 'same version as the source pack';
  return mod.replaces ? `replaces ${mod.replaces}` : '';
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
        `| ${cell(mod.title)} | ${cell(versionLabel(mod.version))} | ${SOURCE_LABELS[mod.source]} | ${cell(modOrigin(mod))} |`,
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
    for (const conflict of analysis.conflicts) {
      lines.push(
        `- **${conflict.declaredBy}** declares **${conflict.project.title}** as incompatible`,
      );
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
    out.push(`  ${SOURCE_ICONS[mod.source]} ${mod.title} ${versions}${extra}`);
  }
  out.push('', 'Excluded:');
  if (plan.excluded.length === 0) out.push('  (none)');
  for (const mod of plan.excluded) {
    const alts = alternativesLabel(mod);
    out.push(
      `  - ${mod.project?.title ?? mod.fileName}: ${mod.reason ?? 'no compatible version'}${alts ? ` ${alts}` : ''}`,
    );
  }
  for (const dep of analysis.dependencies.missing) {
    out.push(
      `  ! missing dependency ${dep.title ?? dep.projectId} (required by ${dep.requiredBy.join(', ')})`,
    );
  }
  for (const conflict of analysis.conflicts) {
    out.push(`  ✘ conflict: ${conflict.declaredBy} is incompatible with ${conflict.project.title}`);
  }
  return `${out.join('\n')}\n`;
}
