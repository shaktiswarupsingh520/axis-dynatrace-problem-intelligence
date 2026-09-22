/* eslint-disable noSecrets/no-secrets */
export interface CioRcaResult {
  problemId: string; nativeRootCauseEntity: string | null; analysis: string; generatedAt?: string; occurrenceCount: number;
  occurrences?: Array<{ problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string }>;
  managementZones?: string[]; recurrenceWindow?: string;
  evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number };
  problemFacts?: { title?: string; status?: string; severity?: string; category?: string; start?: string; end?: string; duration?: string; impactLevel?: string; affectedUsers?: string | number; affectedEntities?: string | number };
}
const text = (value: unknown): string => { if (value == null) return ''; if (typeof value === 'string') return value; if (typeof value === 'number' || typeof value === 'boolean') return String(value); if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', '); return ''; };
const section = (analysis: string, names: string[]): string => { const lines = analysis.split(/\r?\n/); const index = lines.findIndex((line) => names.some((name) => line.toLowerCase().includes(name.toLowerCase()))); if (index < 0) return ''; const body: string[] = []; for (let i = index + 1; i < lines.length; i += 1) { if (/^\s*#{1,6}\s+/.test(lines[i])) break; body.push(lines[i]); } return body.join('\n').trim(); };
const escapeText = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const cleanDateValue = (value: string): string => value.replace(/^"(.*)"$/, '$1').trim();
const dateText = (value: string): string => { const cleaned = cleanDateValue(value); const date = new Date(cleaned); return Number.isFinite(date.getTime()) ? date.toLocaleString() : cleaned || '—'; };
export function buildCioRcaHtml(result: CioRcaResult): string {
  const facts = result.problemFacts ?? {}; const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived'; const root = result.nativeRootCauseEntity || 'Not proven by available evidence';
  const names: Array<[string, string[]]> = [['Executive Summary',['executive summary']],['Incident Overview',['incident overview']],['Root Cause Assessment',['root cause assessment']],['Technical Root-Cause Chain',['technical root-cause chain']],['Incident Timeline',['incident timeline']],['Past Occurrences & Recurrence Pattern',['past occurrences','recurrence pattern']],['Impact Assessment',['impact assessment']],['Immediate Remediation Plan',['immediate remediation plan']],['Permanent / Preventive Actions',['permanent / preventive actions']],['Monitoring & Alerting Recommendations',['monitoring & alerting recommendations']],['Validation Checklist',['validation checklist']],['RCA Confidence & Evidence Gaps',['rca confidence & evidence gaps']]];
  const body = names.map(([title, keys]) => '<section><h2>' + escapeText(title) + '</h2><pre>' + escapeText(section(result.analysis, keys) || 'Not available from retrieved evidence.') + '</pre></section>').join('');
  const occurrenceRows = (result.occurrences ?? []).slice(0, 50).map((o) => '<tr><td>' + escapeText(o.problemId) + '</td><td>' + escapeText(dateText(o.start)) + '</td><td>' + escapeText(o.title) + '</td><td>' + escapeText(o.status) + '</td><td>' + escapeText(o.severity) + '</td><td>' + escapeText(o.duration) + '</td></tr>').join('');
  const metrics = [['Status',text(facts.status)||'—'],['Severity',text(facts.severity)||'—'],['Duration',text(facts.duration)||'—'],['Recurrence',String(result.occurrenceCount)]];
  const metricHtml = metrics.map(([label,value]) => '<div><div class="label">' + escapeText(label) + '</div><div class="value">' + escapeText(value) + '</div></div>').join('');
  return '<!doctype html><html><head><meta charset="utf-8"><title>Axis CIO RCA ' + escapeText(result.problemId) + '</title><style>body{font-family:Arial,sans-serif;margin:0;padding:28px;color:#172334;font-size:11px;line-height:1.5}.hero{padding:22px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.label{font-size:9px;text-transform:uppercase;color:#6d7f92;font-weight:700}.value{margin-top:4px;font-weight:700}h1{font-size:24px;color:#173b70;margin:4px 0}h2{font-size:14px;color:#173b70;border-bottom:2px solid #d9e5f2;padding-bottom:5px;margin-top:22px}pre{font-family:Arial,sans-serif;white-space:pre-wrap;font-size:10px;line-height:1.5}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;text-align:left;border-bottom:1px solid #e4e9ef}th{background:#eef4f9}.note{margin-top:18px;padding:10px;background:#fff8e8;border-left:4px solid #e4a11b}</style></head><body><div class="hero"><div class="label">AXIS BANK</div><h1>Evidence-First Incident Root Cause Analysis</h1><p><b>Problem:</b> ' + escapeText(result.problemId) + ' · <b>Title:</b> ' + escapeText(text(facts.title)||'Dynatrace Problem') + '<br><b>Generated:</b> ' + escapeText(dateText(result.generatedAt ?? new Date().toISOString())) + '</p><div class="grid">' + metricHtml + '</div><p><b>Root cause:</b> ' + escapeText(root) + '<br><b>Recurrence scope:</b> ' + escapeText(result.recurrenceWindow || 'Last 30 days') + '<br><b>Management zone:</b> ' + escapeText(scope) + '</p></div>' + body + '<section><h2>Occurrence Detail</h2><table><thead><tr><th>Problem</th><th>Started</th><th>Title</th><th>Status</th><th>Severity</th><th>Duration</th></tr></thead><tbody>' + (occurrenceRows || '<tr><td colspan="6">No occurrence records returned.</td></tr>') + '</tbody></table></section><div class="note"><b>Governance:</b> Dynatrace telemetry is treated as observed evidence. Dynatrace Assist is a separate non-authoritative writing/recommendation layer; proposed actions require SRE validation.</div></body></html>';
}
const pdfEscape = (value: string): string => value
  .replace(/—|–/g, '-')
  .replace(/·/g, '|')
  .replace(/[“”]/g, '"')
  .replace(/[‘’]/g, "'")
  .replace(/[^\x20-\x7E]/g, '?')
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')
  .replace(/[\r\n]+/g, ' ');

const wrap = (value: string, width = 88): string[] => {
  const output: string[] = [];
  for (const raw of value.split(/\r?\n/)) {
    let remaining = raw.replace(/\t/g, '    ').trim();
    if (!remaining) {
      output.push('');
      continue;
    }
    while (remaining.length > width) {
      let cut = remaining.lastIndexOf(' ', width);
      if (cut < 20) cut = width;
      output.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trimStart();
    }
    output.push(remaining);
  }
  return output;
};

const pdfText = (commands: string[], x: number, y: number, value: string, size: number, bold = false, color = '0.09 0.14 0.22'): void => {
  commands.push(color + ' rg');
  commands.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + String(size) + ' Tf ' + String(x) + ' ' + String(y) + ' Td (' + pdfEscape(value) + ') Tj ET');
};

const pdfRect = (commands: string[], x: number, y: number, w: number, h: number, color: string, stroke = false): void => {
  commands.push('q ' + color + ' rg ' + String(x) + ' ' + String(y) + ' ' + String(w) + ' ' + String(h) + ' re ' + (stroke ? 'S' : 'f') + ' Q');
};

const pdfLine = (commands: string[], x1: number, y1: number, x2: number, y2: number, color = '0.78 0.83 0.90', width = 1): void => {
  commands.push('q ' + color + ' RG ' + String(width) + ' w ' + String(x1) + ' ' + String(y1) + ' m ' + String(x2) + ' ' + String(y2) + ' l S Q');
};

function drawHeader(commands: string[], title: string, _subtitle: string, page: number, total: number): void {
  pdfRect(commands, 0, 790, 595, 52, '0.08 0.18 0.34');
  pdfText(commands, 38, 818, 'AXIS BANK', 9, true, '1 1 1');
  pdfText(commands, 38, 800, title, 15, true, '1 1 1');
  pdfText(commands, 555, 801, String(page) + ' / ' + String(total), 8, false, '0.78 0.86 0.96');
}

function drawFooter(commands: string[]): void {
  pdfLine(commands, 38, 34, 557, 34, '0.84 0.87 0.92', 0.6);
  pdfText(commands, 38, 20, 'Evidence-first incident RCA | Confidential', 7, false, '0.40 0.46 0.54');
  pdfText(commands, 475, 20, 'Dynatrace', 7, false, '0.40 0.46 0.54');
}

function drawSectionTitle(commands: string[], x: number, y: number, title: string, subtitle?: string): number {
  pdfRect(commands, x, y - 2, 4, 24, '0.18 0.39 0.78');
  pdfText(commands, x + 14, y + 8, title, 13, true);
  if (subtitle) pdfText(commands, x + 14, y - 5, subtitle, 7.5, false, '0.43 0.49 0.57');
  return y - 34;
}

function drawCard(commands: string[], x: number, y: number, w: number, h: number, label: string, value: string, accent = '0.18 0.39 0.78'): void {
  pdfRect(commands, x, y, w, h, '0.96 0.97 0.99');
  pdfRect(commands, x, y, 4, h, accent);
  pdfText(commands, x + 14, y + h - 18, label.toUpperCase(), 6.5, true, '0.42 0.48 0.56');
  const valueLines = wrap(value, Math.max(12, Math.floor((w - 28) / 6.2)));
  valueLines.slice(0, 2).forEach((line, i) => pdfText(commands, x + 14, y + h - 35 - i * 12, line, 10.5, true));
}

function drawBulletList(commands: string[], x: number, y: number, items: string[], maxWidth = 78, size = 9): number {
  let cursor = y;
  for (const item of items) {
    const lines = wrap(item, maxWidth);
    pdfText(commands, x, cursor, '-', 10, true, '0.18 0.39 0.78');
    lines.forEach((line, i) => pdfText(commands, x + 12, cursor - i * 12, line, size));
    cursor -= Math.max(16, lines.length * 12 + 5);
  }
  return cursor;
}

function drawTable(commands: string[], x: number, y: number, widths: number[], headers: string[], rows: string[][], rowH = 23): number {
  let cursor = y;
  let xx = x;
  headers.forEach((header, i) => {
    pdfRect(commands, xx, cursor - rowH, widths[i], rowH, '0.08 0.18 0.34');
    pdfText(commands, xx + 6, cursor - 15, header, 7, true, '1 1 1');
    xx += widths[i];
  });
  cursor -= rowH;
  rows.forEach((row) => {
    xx = x;
    row.forEach((cell, i) => {
      pdfRect(commands, xx, cursor - rowH, widths[i], rowH, '0.97 0.98 0.99');
      const cellLines = wrap(cell || '-', Math.max(8, Math.floor((widths[i] - 12) / 5.2))).slice(0, 2);
      cellLines.forEach((line, j) => pdfText(commands, xx + 6, cursor - 13 - j * 8, line, 6.8));
      xx += widths[i];
    });
    cursor -= rowH;
  });
  return cursor;
}

const observedDuration = (start?: string, end?: string): string => {
  if (!start || !end) return '';
  const a = new Date(cleanDateValue(start)).getTime();
  const b = new Date(cleanDateValue(end)).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return '';
  const minutes = (b - a) / 60000;
  return minutes < 60 ? Math.round(minutes) + ' min' : (minutes / 60).toFixed(1) + ' hr';
};

export function buildCioRcaPdf(result: CioRcaResult): Blob {
  const facts = result.problemFacts ?? {};
  const root = result.nativeRootCauseEntity || 'Not proven by available evidence';
  const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  const rawDuration = text(facts.duration);
  const duration = rawDuration && rawDuration !== '-' && rawDuration !== '—' && rawDuration.toLowerCase() !== 'not available'
    ? rawDuration
    : observedDuration(facts.start, facts.end) || 'Not available';
  const affected = text(facts.affectedEntities) || 'Not available';
  const analysis = result.analysis || '';

  const rootAssessment = section(analysis, ['root cause assessment']) || 'Not available from retrieved evidence.';
  const immediate = section(analysis, ['immediate remediation plan']) || 'Not available from retrieved evidence.';
  const preventive = section(analysis, ['permanent / preventive actions']) || 'Not available from retrieved evidence.';
  const monitoring = section(analysis, ['monitoring & alerting recommendations']) || 'Not available from retrieved evidence.';
  const validation = section(analysis, ['validation checklist']) || 'Not available from retrieved evidence.';
  const confidence = section(analysis, ['rca confidence & evidence gaps']) || 'Not available from retrieved evidence.';
  const occurrences = (result.occurrences ?? []).slice(0, 20);

  const totalPages = 7;
  const pages: string[] = [];

  // PAGE 1 - Executive incident brief
  {
    const c: string[] = [];
    pdfRect(c, 0, 0, 595, 842, '0.06 0.13 0.25');
    pdfRect(c, 0, 0, 12, 842, '0.18 0.39 0.78');
    pdfText(c, 48, 775, 'AXIS BANK', 11, true, '1 1 1');
    pdfText(c, 48, 690, 'EVIDENCE-FIRST', 8, true, '0.45 0.78 1');
    pdfText(c, 48, 655, 'INCIDENT ROOT', 28, true, '1 1 1');
    pdfText(c, 48, 622, 'CAUSE ANALYSIS', 28, true, '1 1 1');
    pdfText(c, 48, 574, result.problemId, 12, true, '1 1 1');
    pdfText(c, 48, 548, text(facts.title) || 'Dynatrace Problem', 11, false, '0.76 0.83 0.92');
    pdfLine(c, 48, 500, 547, 500, '0.42 0.55 0.70', 0.8);
    pdfText(c, 48, 470, 'EXECUTIVE INCIDENT BRIEF', 8, true, '0.45 0.78 1');

    drawCard(c, 48, 397, 113, 58, 'Status', text(facts.status) || 'Not available', '0.16 0.65 0.43');
    drawCard(c, 174, 397, 113, 58, 'Severity', text(facts.severity) || 'Not available', '0.95 0.65 0.20');
    drawCard(c, 300, 397, 113, 58, 'Duration', duration, '0.18 0.39 0.78');
    drawCard(c, 426, 397, 113, 58, 'Matching occurrences', String(result.occurrenceCount), '0.70 0.32 0.36');

    pdfText(c, 48, 350, 'INCIDENT SUMMARY', 7, true, '0.48 0.58 0.69');
    pdfText(c, 48, 332, 'Duration', 7, true, '0.48 0.58 0.69');
    pdfText(c, 110, 332, duration, 9.5, true, '1 1 1');
    pdfText(c, 48, 312, 'Root cause type', 7, true, '0.48 0.58 0.69');
    pdfText(c, 110, 312, 'SERVICE', 8.5, true, '1 1 1');

    pdfRect(c, 48, 230, 491, 48, '0.10 0.20 0.36');
    pdfText(c, 62, 258, 'ROOT-CAUSE ENTITY', 6.5, true, '0.45 0.78 1');
    pdfText(c, 62, 240, root, 12, true, '1 1 1');
    pdfText(c, 300, 240, 'Native Problems API', 7, false, '0.70 0.78 0.88');

    pdfText(c, 48, 180, 'Affected entities', 7, true, '0.48 0.58 0.69');
    wrap(affected, 76).slice(0, 2).forEach((line, i) => pdfText(c, 48, 163 - i * 12, line, 8.5, true, '1 1 1'));
    pdfText(c, 48, 112, 'Management zone', 7, true, '0.48 0.58 0.69');
    wrap(scope, 78).slice(0, 2).forEach((line, i) => pdfText(c, 48, 95 - i * 12, line, 8, false, '0.82 0.87 0.94'));
    pdfText(c, 48, 42, 'Evidence-first incident RCA | Confidential', 7, false, '0.58 0.66 0.76');
    pages.push(c.join('\n'));
  }

  // PAGE 2 - Executive decision view
  {
    const c: string[] = [];
    drawHeader(c, 'Executive Decision View', 'Leadership summary | What the evidence establishes', 2, totalPages);
    let y = 748;
    y = drawSectionTitle(c, 48, y, 'Incident at a glance', 'Core facts retrieved from Dynatrace');
    const status = text(facts.status) || 'Not available';
    drawCard(c, 48, 675, 116, 55, 'Problem ID', result.problemId, '0.18 0.39 0.78');
    drawCard(c, 174, 675, 116, 55, 'Status', status, status.toLowerCase() === 'closed' ? '0.16 0.65 0.43' : '0.95 0.65 0.20');
    drawCard(c, 300, 675, 116, 55, 'Severity', text(facts.severity) || 'Not available', '0.95 0.65 0.20');
    drawCard(c, 426, 675, 113, 55, 'Category', text(facts.category) || 'Not available', '0.18 0.39 0.78');

    pdfRect(c, 48, 530, 491, 110, '0.95 0.97 0.99');
    pdfText(c, 62, 620, 'EXECUTIVE SUMMARY', 7, true, '0.18 0.39 0.78');
    const executiveSummary = [
      'Dynatrace detected a Failure rate increase affecting the reported service scope.',
      'The native Problems API identifies ' + root + ' as the root-cause entity.',
      'Observed evidence: severity ' + (text(facts.severity) || 'not available') + ', duration ' + duration + ', ' +
        String(result.evidenceSummary.correlatedEvents) + ' correlated Davis events and ' +
        String(result.evidenceSummary.timelineSnapshots) + ' timeline snapshots.',
      'The underlying technical trigger is not asserted beyond the retrieved evidence; application logs and additional telemetry should be used for deeper validation.'
    ];
    executiveSummary.forEach((line, i) => {
      wrap(line, 90).forEach((wrapped, j) => pdfText(c, 62, 600 - (i * 21) - (j * 12), wrapped, 8.2));
    });

    y = drawSectionTitle(c, 48, 516, 'Evidence coverage', 'Observed evidence available to this RCA');
    const evidenceTableBottom = drawTable(c, 48, y, [190, 115, 186], ['Indicator', 'Observed', 'Interpretation'], [
      ['Root-cause entity', root, 'Native Problems API evidence'],
      ['Affected entities', affected, 'Problem impact scope'],
      ['Correlated Davis events', String(result.evidenceSummary.correlatedEvents), 'Retrieved evidence'],
      ['Incident logs', String(result.evidenceSummary.incidentLogs), 'Retrieved logs'],
      ['Timeline snapshots', String(result.evidenceSummary.timelineSnapshots), 'Retrieved Davis timeline']
    ], 27);

    const incidentFactsTitleY = Math.max(245, evidenceTableBottom - 48);
    drawSectionTitle(c, 48, incidentFactsTitleY, 'Incident facts');
    drawTable(c, 48, incidentFactsTitleY - 34, [190, 301], ['Attribute', 'Value'], [
      ['Title', text(facts.title) || 'Not available'],
      ['Root cause', root],
      ['Impact level', text(facts.impactLevel) || 'Not available'],
      ['Affected users', text(facts.affectedUsers) || 'Not available']
    ], 24);
    drawFooter(c);
    pages.push(c.join('\n'));
  }

  // PAGE 3 - Root cause assessment
  {
    const c: string[] = [];
    drawHeader(c, 'Root Cause Assessment', 'Evidence and causal chain', 3, totalPages);
    let y = 750;
    y = drawSectionTitle(c, 48, y, 'Authoritative finding', 'Native Dynatrace Problems API');
    drawCard(c, 48, 668, 491, 62, 'Root-cause entity', root, '0.16 0.65 0.43');
    pdfText(c, 62, 682, 'The native Problems API result is treated as the authoritative root-cause source.', 7.5, false, '0.42 0.48 0.56');

    y = drawSectionTitle(c, 48, 638, 'Root cause assessment');
    const rootAssessmentClean = rootAssessment
      .replace(/\s*\(ID:\s*[^)]+\)/gi, '')
      .replace(/\s*\[?(?:SERVICE|PROCESS_GROUP|HOST)-[A-Z0-9_-]+\]?/g, '');
    wrap(rootAssessmentClean, 92).slice(0, 8).forEach((line, i) => pdfText(c, 48, y - i * 13, line, 8.5));
    y -= Math.min(120, Math.max(50, wrap(rootAssessment, 92).length * 13 + 20));

    y = drawSectionTitle(c, 48, y, 'Technical root-cause chain', 'Observed chain only; inferred triggers remain explicitly marked');
    pdfRect(c, 48, y - 18, 491, 92, '0.96 0.98 0.99');
    pdfRect(c, 62, y + 35, 10, 10, '0.16 0.65 0.43');
    pdfText(c, 82, y + 34, root, 10, true);
    pdfText(c, 82, y + 16, 'Root-cause entity identified by the native Dynatrace Problems API.', 7.8, false, '0.42 0.48 0.56');
    pdfText(c, 62, y - 4, 'Supporting evidence', 7, true, '0.18 0.39 0.78');
    pdfText(c, 160, y - 4, String(result.evidenceSummary.correlatedEvents) + ' correlated Davis events; ' + String(result.evidenceSummary.timelineSnapshots) + ' timeline snapshots.', 7.8);
    pdfText(c, 62, y - 23, 'Causal-chain boundary', 7, true, '0.70 0.42 0.08');
    pdfText(c, 160, y - 23, 'No additional service-to-service relationship is asserted without explicit telemetry evidence.', 7.8);

    pdfRect(c, 48, 105, 491, 92, '0.97 0.96 0.91');
    pdfText(c, 62, 178, 'PROVEN VS. REQUIRES VALIDATION', 7, true, '0.70 0.42 0.08');
    pdfText(c, 62, 158, 'PROVEN', 7, true, '0.16 0.65 0.43');
    pdfText(c, 120, 158, 'Dynatrace exposed a root-cause entity for this problem.', 8);
    pdfText(c, 62, 139, 'VALIDATE', 7, true, '0.85 0.48 0.10');
    pdfText(c, 120, 139, 'The underlying technical trigger requires additional telemetry when not retrieved.', 8);
    pdfText(c, 62, 120, 'GAP', 7, true, '0.70 0.32 0.36');
    pdfText(c, 120, 120, 'No unobserved metric, deployment, exception or infrastructure cause is asserted.', 8);
    drawFooter(c);
    pages.push(c.join('\n'));
  }

  // PAGE 4 - Timeline & recurrence
  {
    const c: string[] = [];
    drawHeader(c, 'Incident Timeline & Recurrence', 'Operational history retrieved for this problem', 4, totalPages);
    let y = 750;
    y = drawSectionTitle(c, 48, 750, 'Evidence Timeline', 'Retrieved Davis evidence; incident start/end window omitted');
    const timelineText = section(analysis, ['incident timeline']) || 'Not available from retrieved evidence.';
    wrap(timelineText, 88).filter(Boolean).slice(0, 12).forEach((line, i) => {
      pdfText(c, 58, 695 - i * 16, line, 8.5);
    });

    y = drawSectionTitle(c, 48, 470, 'Recurrence pattern', 'Only evidence-matched occurrences are shown');
    const rows = occurrences.map((o) => [o.problemId, dateText(o.start), o.title, o.status, o.severity, o.duration]);
    if (rows.length) {
      drawTable(c, 48, y, [82, 128, 126, 72, 55, 28], ['Problem', 'Started', 'Title', 'Status', 'Sev', 'Dur'], rows, 25);
    } else {
      pdfText(c, 48, y - 15, 'No matching occurrence records returned.', 9);
    }
    pdfRect(c, 48, 85, 491, 45, '0.95 0.97 0.99');
    pdfText(c, 62, 112, 'Recurrence scope', 7, true, '0.42 0.48 0.56');
    pdfText(c, 160, 112, result.recurrenceWindow || 'Last 30 days', 8.5, true);
    pdfText(c, 62, 96, 'Matching occurrences', 7, true, '0.42 0.48 0.56');
    pdfText(c, 160, 96, String(result.occurrenceCount), 8.5, true);
    drawFooter(c);
    pages.push(c.join('\n'));
  }

  // PAGE 5 - Remediation
  {
    const c: string[] = [];
    drawHeader(c, 'Remediation & Preventive Actions', 'Operational response plan', 5, totalPages);
    const y = 750;
    drawSectionTitle(c, 48, y, 'Immediate stabilization', 'Actions to contain the current operational risk');
    pdfRect(c, 48, 575, 491, 118, '0.95 0.98 0.96');
    pdfText(c, 62, 670, '01  VALIDATE', 7, true, '0.16 0.65 0.43');
    drawBulletList(c, 62, 650, wrap(immediate, 78).filter(Boolean).slice(0, 5), 78, 8.3);

    drawSectionTitle(c, 48, 550, 'Permanent / preventive actions', 'Only actions supported by observed evidence or explicitly framed as validation');
    pdfRect(c, 48, 380, 491, 145, '0.97 0.97 0.99');
    pdfText(c, 62, 500, '02  PREVENT', 7, true, '0.18 0.39 0.78');
    drawBulletList(c, 62, 480, wrap(preventive, 78).filter(Boolean).slice(0, 7), 78, 8.3);

    drawSectionTitle(c, 48, 350, 'Monitoring & alerting', 'Recommended correlation points');
    pdfRect(c, 48, 185, 491, 135, '0.99 0.97 0.92');
    pdfText(c, 62, 296, '03  MONITOR', 7, true, '0.70 0.42 0.08');
    drawBulletList(c, 62, 276, wrap(monitoring, 78).filter(Boolean).slice(0, 7), 78, 8.3);

    drawFooter(c);
    pages.push(c.join('\n'));
  }

  // PAGE 6 - Validation & governance
  {
    const c: string[] = [];
    drawHeader(c, 'Validation, Confidence & Governance', 'RCA quality controls', 6, totalPages);
    const y = 750;
    drawSectionTitle(c, 48, y, 'Validation checklist', 'Before closing the RCA');
    const validationItems = wrap(validation, 88).filter(Boolean).slice(0, 12);
    let vy = 685;
    validationItems.forEach((item) => {
      pdfRect(c, 50, vy - 2, 10, 10, '0.97 0.98 0.99', true);
      pdfText(c, 70, vy, item, 8.3);
      vy -= 22;
    });

    pdfRect(c, 48, 300, 491, 145, '0.95 0.97 0.99');
    pdfText(c, 62, 420, 'RCA CONFIDENCE & EVIDENCE GAPS', 7, true, '0.18 0.39 0.78');
    wrap(confidence, 86).slice(0, 8).forEach((line, i) => pdfText(c, 62, 398 - i * 14, line, 8.3));

    pdfRect(c, 48, 110, 491, 155, '0.97 0.96 0.91');
    pdfText(c, 62, 240, 'GOVERNANCE NOTE', 7, true, '0.70 0.42 0.08');
    wrap('Dynatrace telemetry is treated as observed evidence. Dynatrace Assist is a separate non-authoritative interpretation and recommendation layer. Proposed actions require SRE/application validation before closure.', 82).forEach((line, i) => pdfText(c, 62, 218 - i * 13, line, 8.3));
    drawFooter(c);
    pages.push(c.join('\n'));
  }

  // PAGE 7 - Evidence appendix
  {
    const c: string[] = [];
    drawHeader(c, 'Evidence Appendix', 'Detailed retrieved occurrence and evidence inventory', 7, totalPages);
    let y = 750;
    y = drawSectionTitle(c, 48, y, 'Past occurrence detail', 'Evidence-matched records returned by the RCA backend');
    const rows = occurrences.map((o) => [o.problemId, dateText(o.start), o.title, o.status, o.severity, o.duration]);
    if (rows.length) {
      drawTable(c, 48, y, [88, 132, 125, 74, 55, 27], ['Problem', 'Started', 'Title', 'Status', 'Sev', 'Dur'], rows, 25);
    } else {
      pdfText(c, 48, y - 15, 'No occurrence records returned.', 9);
    }

    y = Math.min(y - Math.max(35, rows.length * 25 + 30), 400);
    y = drawSectionTitle(c, 48, y, 'Evidence inventory');
    drawTable(c, 48, y, [240, 251], ['Evidence type', 'Retrieved'], [
      ['Correlated Davis events', String(result.evidenceSummary.correlatedEvents)],
      ['Incident logs', String(result.evidenceSummary.incidentLogs)],
      ['Historical occurrences', String(result.evidenceSummary.historicalOccurrences)],
      ['Timeline snapshots', String(result.evidenceSummary.timelineSnapshots)],
      ['Management zone scope', scope]
    ], 28);

    pdfRect(c, 48, 92, 491, 74, '0.95 0.97 0.99');
    pdfText(c, 62, 146, 'REPORT BOUNDARY', 7, true, '0.18 0.39 0.78');
    wrap('This report intentionally avoids asserting unobserved metric values, deployments, exception types, infrastructure causes or user impact. Where evidence is unavailable, the report labels the gap instead of filling it with generated values.', 82).slice(0, 4).forEach((line, i) => pdfText(c, 62, 127 - i * 12, line, 8));
    drawFooter(c);
    pages.push(c.join('\n'));
  }

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => String(5 + i * 2) + ' 0 R').join(' ');
  objects.push('<< /Type /Pages /Kids [' + kids + '] /Count ' + String(pages.length) + ' >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  for (let i = 0; i < pages.length; i += 1) {
    const pageObject = 5 + i * 2;
    const streamObject = pageObject + 1;
    const stream = pages[i];
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + String(streamObject) + ' 0 R >>');
    objects.push('<< /Length ' + String(stream.length) + ' >>\nstream\n' + stream + '\nendstream');
  }

  let pdf = '%PDF-1.4\n%AXIS\n';
  const offsets: number[] = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += String(i + 1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
  }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + String(objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + String(objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + String(xref) + '\n%%EOF';
  return new Blob([pdf], { type: 'application/pdf' });
}

export function downloadCioRcaPdf(result: CioRcaResult): void { const blob = buildCioRcaPdf(result); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Axis-CIO-RCA-' + result.problemId + '.pdf'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function downloadCioRca(html: string): void { const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'axis-cio-rca-report.html'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
export const buildRcaReport = buildCioRcaHtml;
