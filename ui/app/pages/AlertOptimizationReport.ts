export type OptimizationReportInput = {
  managementZone: string;
  window: string;
  generatedAt: string;
  totals: {
    problems: number;
    uniquePatterns: number;
    recurringPatterns: number;
    openProblems: number;
    thresholdReviewCandidates: number;
    immediateActionCandidates: number;
  };
  patterns: Array<{
    title: string;
    rootCauseEntity: string;
    occurrences: number;
    openCount: number;
    avgDurationMinutes: number;
    severity: string;
    impact: string;
  }>;
  thresholdCandidates: Array<{
    title: string;
    rootCauseEntity: string;
    occurrences: number;
    avgDurationMinutes: number;
  }>;
  immediateActions: Array<{
    title: string;
    rootCauseEntity: string;
    occurrences: number;
    openCount: number;
    avgDurationMinutes: number;
    severity: string;
    impact: string;
  }>;
  assistAnalysis: string;
  assistStatus: string;
};

const esc = (value: string): string =>
  value.replace(/[^\\x20-\\x7E]/g, ' ').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ');

const wrap = (value: string, max = 92): string[] => {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + (line ? ' ' : '') + word).length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line += (line ? ' ' : '') + word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
};

const addText = (content: string[], value: string, x: number, y: number, size: number, bold = false) => {
  content.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x + ' ' + y + ' Td (' + esc(value) + ') Tj ET');
};

const buildPdf = (report: OptimizationReportInput): Blob => {
  const pageWidth = 595;
  const pageHeight = 842;
  const left = 42;
  const top = 790;
  const bottom = 48;
  const pages: string[][] = [];
  let current: string[] = [];
  let y = top;

  const nextPage = () => {
    if (current.length) pages.push(current);
    current = [];
    y = top;
  };

  const ensure = (height: number) => {
    if (y - height < bottom) nextPage();
  };

  const heading = (value: string) => {
    ensure(36);
    addText(current, value, left, y, 15, true);
    y -= 22;
  };

  const paragraph = (value: string, size = 9.5, leading = 13) => {
    for (const line of wrap(value)) {
      ensure(leading + 2);
      addText(current, line, left, y, size);
      y -= leading;
    }
    y -= 4;
  };

  addText(current, 'AXIS BANK - DYNATRACE OPERATIONS', left, y, 9, true);
  y -= 22;
  addText(current, 'Alert Optimization Plan', left, y, 22, true);
  y -= 28;
  addText(current, report.managementZone + ' - ' + report.window, left, y, 11);
  y -= 20;
  addText(current, 'Generated: ' + new Date(report.generatedAt).toLocaleString('en-IN'), left, y, 9);
  y -= 30;

  heading('Executive Summary');
  paragraph('The selected Management Zone contains ' + report.totals.problems.toLocaleString() + ' analyzed problems, ' + report.totals.uniquePatterns.toLocaleString() + ' unique patterns and ' + report.totals.recurringPatterns.toLocaleString() + ' recurring patterns in the selected window. ' + report.totals.openProblems.toLocaleString() + ' problems are currently open. Threshold and sensitivity candidates are review signals, not automatic production changes.');

  heading('Optimization KPIs');
  [
    'Problems: ' + report.totals.problems,
    'Unique patterns: ' + report.totals.uniquePatterns,
    'Recurring patterns: ' + report.totals.recurringPatterns,
    'Open now: ' + report.totals.openProblems,
    'Threshold review candidates: ' + report.totals.thresholdReviewCandidates,
    'Immediate action candidates: ' + report.totals.immediateActionCandidates,
  ].forEach(item => paragraph(item, 9, 12));

  heading('Repeated / Noisy Alert Patterns');
  const recurring = report.patterns.filter(p => p.occurrences >= 2).slice(0, 15);
  if (!recurring.length) paragraph('No recurring patterns were detected.');
  recurring.forEach((p, i) => paragraph((i + 1) + '. ' + p.title + ' | Root cause: ' + p.rootCauseEntity + ' | Occurrences: ' + p.occurrences + ' | Open: ' + p.openCount + ' | Avg duration: ' + p.avgDurationMinutes.toFixed(1) + 'm | Severity: ' + p.severity + ' | Impact: ' + p.impact, 8.5, 11));

  heading('Threshold / Sensitivity Review');
  if (!report.thresholdCandidates.length) paragraph('No strong threshold-review pattern was detected.');
  report.thresholdCandidates.slice(0, 15).forEach((p, i) => paragraph((i + 1) + '. ' + p.title + ' | ' + p.occurrences + ' occurrences | Avg duration: ' + p.avgDurationMinutes.toFixed(1) + 'm | Root cause: ' + p.rootCauseEntity + '. Review the current anomaly-detection configuration before changing threshold or sensitivity.', 8.5, 11));

  heading('Immediate Action Queue');
  if (!report.immediateActions.length) paragraph('No immediate-action candidates were detected.');
  report.immediateActions.slice(0, 15).forEach((p, i) => paragraph((i + 1) + '. ' + p.title + ' | ' + (p.openCount ? 'Currently open' : 'Review candidate') + ' | Occurrences: ' + p.occurrences + ' | Avg duration: ' + p.avgDurationMinutes.toFixed(1) + 'm | Severity: ' + p.severity + ' | Root cause: ' + p.rootCauseEntity, 8.5, 11));

  heading('Dynatrace Assist Recommendations');
  paragraph(report.assistAnalysis || report.assistStatus || 'Assist recommendations were not returned.', 8.5, 11);

  heading('Governance & Validation');
  paragraph('Validate recurring patterns with application and service owners before changing thresholds, sensitivity, alert routing or suppression. Compare alert volume and operational impact before and after each approved change. Historical problem data does not expose exact current anomaly-detection threshold values, so this report does not invent them.');

  nextPage();

  const objects: string[] = [];
  const addObject = (body: string) => objects.push(body);

  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('<< /Type /Pages /Kids [PAGE_KIDS] /Count PAGE_COUNT >>');
  const font1 = objects.length + 1;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2 = objects.length + 1;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  const pageRefs: number[] = [];
  pages.forEach(commands => {
    const stream = commands.join('\n');
    const contentRef = objects.length + 1;
    addObject('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    const pageRef = objects.length + 1;
    addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + pageWidth + ' ' + pageHeight + '] /Resources << /Font << /F1 ' + font1 + ' 0 R /F2 ' + font2 + ' 0 R >> >> /Contents ' + contentRef + ' 0 R >>');
    pageRefs.push(pageRef);
  });

  objects[1] = objects[1].replace('PAGE_KIDS', pageRefs.map(ref => ref + ' 0 R').join(' ')).replace('PAGE_COUNT', String(pageRefs.length));

  let pdf = '%PDF-1.4\n';
  const xref: number[] = [0];
  objects.forEach((body, index) => {
    xref.push(pdf.length);
    pdf += (index + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xrefStart = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < xref.length; i += 1) pdf += String(xref[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefStart + '\n%%EOF';

  return new Blob([pdf], { type: 'application/pdf' });
};

export const downloadAlertOptimizationPdf = (report: OptimizationReportInput) => {
  const blob = buildPdf(report);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'alert-optimization-' + report.managementZone.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-' + report.window.replace(/\s+/g, '-').toLowerCase() + '.pdf';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const buildAlertOptimizationEmail = (report: OptimizationReportInput): string => {
  const recurring = report.patterns.filter(p => p.occurrences >= 2).slice(0, 10)
    .map((p, i) => (i + 1) + '. ' + p.title + ' - ' + p.occurrences + ' occurrences, avg ' + p.avgDurationMinutes.toFixed(1) + 'm, root cause: ' + p.rootCauseEntity).join('\n');
  const threshold = report.thresholdCandidates.slice(0, 10)
    .map((p, i) => (i + 1) + '. ' + p.title + ' - ' + p.occurrences + ' occurrences, avg ' + p.avgDurationMinutes.toFixed(1) + 'm').join('\n');
  const actions = report.immediateActions.slice(0, 10)
    .map((p, i) => (i + 1) + '. ' + p.title + ' - ' + (p.openCount ? 'open now' : 'review') + ', severity ' + p.severity + ', root cause: ' + p.rootCauseEntity).join('\n');

  return 'AXIS BANK - DYNATRACE OPERATIONS\nALERT OPTIMIZATION PLAN\nManagement Zone: ' + report.managementZone + '\nLookback: ' + report.window + '\nGenerated: ' + new Date(report.generatedAt).toLocaleString('en-IN') + '\n\nSUMMARY\nProblems: ' + report.totals.problems + '\nUnique patterns: ' + report.totals.uniquePatterns + '\nRecurring patterns: ' + report.totals.recurringPatterns + '\nOpen now: ' + report.totals.openProblems + '\nThreshold review candidates: ' + report.totals.thresholdReviewCandidates + '\nImmediate action candidates: ' + report.totals.immediateActionCandidates + '\n\nREPEATED / NOISY PATTERNS\n' + (recurring || 'None detected.') + '\n\nTHRESHOLD / SENSITIVITY REVIEW\n' + (threshold || 'None detected.') + '\n\nIMMEDIATE ACTION QUEUE\n' + (actions || 'None detected.') + '\n\nDYNATRACE ASSIST\n' + (report.assistAnalysis || report.assistStatus) + '\n\nNote: recommendations are review proposals and require owner validation before production changes.';
};
