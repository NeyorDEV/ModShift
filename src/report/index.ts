import type { AnalysisResult } from '../core/types.js';
import { renderJson } from './json.js';
import { renderMarkdown } from './markdown.js';
import { renderTable, type TableOptions } from './table.js';

export const REPORT_FORMATS = ['table', 'json', 'markdown'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export function renderReport(
  result: AnalysisResult,
  format: ReportFormat,
  tableOptions: TableOptions = {},
): string {
  switch (format) {
    case 'json':
      return renderJson(result);
    case 'markdown':
      return renderMarkdown(result);
    case 'table':
      return renderTable(result, tableOptions);
  }
}

export { renderJson, renderMarkdown, renderTable };
