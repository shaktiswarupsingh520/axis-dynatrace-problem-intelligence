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
    impactedServices?: Array<{ serviceName: string; occurrences: number }>;
  }>;
  thresholdCandidates: Array<{
    title: string;
    rootCauseEntity: string;
    occurrences: number;
    avgDurationMinutes: number;
    impactedServices?: Array<{ serviceName: string; occurrences: number }>;
  }>;
  immediateActions: Array<{
    title: string;
    rootCauseEntity: string;
    occurrences: number;
    openCount: number;
    avgDurationMinutes: number;
    severity: string;
    impact: string;
    impactedServices?: Array<{ serviceName: string; occurrences: number }>;
  }>;
  assistAnalysis: string;
  assistStatus: string;
};

type Row = string[];
type Column = { title: string; width: number; right?: boolean };

const C = {
  navy: [23, 63, 103],
  blue: [22, 131, 197],
  ink: [32, 55, 74],
  muted: [101, 122, 141],
  border: [211, 223, 232],
  light: [246, 249, 251],
  white: [255, 255, 255],
};

const esc = (v: string) => v
  .replace(/[^\x20-\x7E]/g, ' ')
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')
  .replace(/\r?\n/g, ' ');

const clip = (v: string, n: number) => {
  const s = (v || '').replace(/\s+/g, ' ').trim();
  return s.length <= n ? s : s.slice(0, Math.max(1, n - 3)) + '...';
};

const wrap = (v: string, n: number) => {
  const words = (v || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const out: string[] = [];
  let line = '';
  for (const word of words) {
    if (!line) line = word;
    else if ((line + ' ' + word).length <= n) line += ' ' + word;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.length ? out : [''];
};

const mins = (n: number) => n < 60 ? n.toFixed(0) + 'm' : Math.floor(n / 60) + 'h ' + Math.round(n % 60) + 'm';

const serviceText = (services?: Array<{ serviceName: string; occurrences: number }>, limit = 3) =>
  (services || []).slice(0, limit).map(s => clip(s.serviceName, 27) + ' (' + s.occurrences + ')').join(', ') || 'No service entity identified';

const serviceTotals = (report: OptimizationReportInput) => {
  const map = new Map<string, { occurrences: number; patterns: number }>();
  for (const p of report.patterns) {
    for (const s of p.impactedServices || []) {
      const item = map.get(s.serviceName) || { occurrences: 0, patterns: 0 };
      item.occurrences += s.occurrences;
      item.patterns += 1;
      map.set(s.serviceName, item);
    }
  }
  const rows = Array.from(map.entries())
    .map(([serviceName, v]) => ({ serviceName, ...v }))
    .sort((a, b) => b.occurrences - a.occurrences || b.patterns - a.patterns);
  const total = rows.reduce((sum, r) => sum + r.occurrences, 0);
  return rows.slice(0, 10).map(r => ({ ...r, share: total ? r.occurrences * 100 / total : 0 }));
};

const buildPdf = (report: OptimizationReportInput): Blob => {
  const W = 595, H = 842, M = 36, CW = W - M * 2, BOTTOM = 48, TOP = 755;
  const pages: string[][] = [];
  let page: string[] = [];
  let y = TOP;
  let pageNo = 1;

  const add = (s: string) => page.push(s);
  const fill = (rgb: number[]) => add((rgb[0] / 255) + ' ' + (rgb[1] / 255) + ' ' + (rgb[2] / 255) + ' rg');
  const stroke = (rgb: number[]) => add((rgb[0] / 255) + ' ' + (rgb[1] / 255) + ' ' + (rgb[2] / 255) + ' RG');
  const box = (x: number, yy: number, w: number, h: number, rgb: number[]) => { fill(rgb); add(x + ' ' + yy + ' ' + w + ' ' + h + ' re f'); };
  const rule = (x1: number, y1: number, x2: number, y2: number) => { stroke(C.border); add(x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S'); };
  const txt = (v: string, x: number, yy: number, size = 8, bold = false, rgb = C.ink) => {
    fill(rgb);
    add('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x + ' ' + yy + ' Td (' + esc(v) + ') Tj ET');
  };
  const footer = () => {
    rule(M, 31, W - M, 31);
    txt('Axis Bank - Dynatrace Operations | Alert Optimization Plan', M, 18, 7, false, C.muted);
    txt('Page ' + pageNo, W - M - 35, 18, 7, false, C.muted);
  };
  const header = () => {
    if (pageNo === 1) return;
    box(0, 810, W, 32, C.navy);
    txt('AXIS BANK  |  DYNATRACE OPERATIONS', M, 821, 8, true, C.white);
    txt(clip(report.managementZone, 30) + ' | ' + report.window, W - M - 175, 821, 7, false, C.white);
  };
  const next = () => {
    footer();
    if (page.length) pages.push(page);
    page = [];
    pageNo += 1;
    y = TOP;
    header();
  };
  const ensure = (h: number) => { if (y - h < BOTTOM) next(); };
  const section = (no: string, title: string) => {
    ensure(36);
    box(M, y - 21, CW, 23, C.light);
    box(M, y - 21, 4, 23, C.blue);
    txt(no, M + 11, y - 7, 7, true, C.blue);
    txt(title, M + 32, y - 17, 11, true, C.navy);
    y -= 33;
  };
  const para = (v: string, size = 8.5, leading = 12) => {
    const lines = wrap(v, 105);
    ensure(lines.length * leading + 7);
    for (const line of lines) { txt(line, M, y, size); y -= leading; }
    y -= 5;
  };
  const table = (cols: Column[], rows: Row[], maxRows = 15) => {
    const data = rows.slice(0, maxRows);
    const width = cols.reduce((s, c) => s + c.width, 0);
    const headerH = 23;
    const drawHeader = () => {
      ensure(headerH + 5);
      box(M, y - headerH + 4, width, headerH, C.navy);
      let x = M;
      for (const c of cols) { txt(c.title.toUpperCase(), x + 5, y - 11, 6.4, true, C.white); x += c.width; }
      y -= headerH;
    };
    drawHeader();
    data.forEach((row, ri) => {
      const wrapped = row.map((v, i) => wrap(v, Math.max(8, Math.floor(cols[i].width / 4.3))).slice(0, 3));
      const lineCount = Math.max(1, ...wrapped.map(x => x.length));
      const rowH = Math.max(24, 10 + lineCount * 9);
      if (y - rowH < BOTTOM) { next(); drawHeader(); }
      if (ri % 2) box(M, y - rowH + 4, width, rowH, C.light);
      let x = M;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, li) => {
          const tx = cols[i].right ? x + cols[i].width - 5 - line.length * 3.6 : x + 5;
          txt(line, tx, y - 11 - li * 9, 7.1, i === 0, C.ink);
        });
        x += cols[i].width;
      });
      rule(M, y - rowH + 4, M + width, y - rowH + 4);
      y -= rowH;
    });
    y -= 7;
  };

  box(0, 780, W, 62, C.navy);
  txt('AXIS BANK', M, 814, 10, true, C.white);
  txt('DYNATRACE OPERATIONS', M, 801, 8, true, [176, 220, 242]);
  txt('ALERT OPTIMIZATION PLAN', M, 724, 24, true, C.navy);
  txt(clip(report.managementZone + ' Management Zone', 76), M, 698, 13, true, C.ink);
  txt(report.window + ' | Generated ' + new Date(report.generatedAt).toLocaleString('en-IN'), M, 680, 8.5, false, C.muted);
  box(W - M - 112, 684, 112, 42, C.light);
  txt('LOOKBACK', W - M - 100, 710, 7, true, C.blue);
  txt(report.window.toUpperCase(), W - M - 100, 694, 10, true, C.navy);
  y = 650;

  section('01', 'Executive Summary');
  para('This plan analyzes ' + report.totals.problems.toLocaleString() + ' Dynatrace Problems across ' + report.totals.uniquePatterns.toLocaleString() + ' unique patterns. It highlights recurring alert behavior, repeatedly impacted services, threshold or sensitivity review candidates and immediate-action candidates. Threshold recommendations are review signals only; this report does not change production configuration.');

  section('02', 'Optimization KPIs');
  const kpis = [
    ['Problems analyzed', report.totals.problems.toLocaleString()],
    ['Unique patterns', report.totals.uniquePatterns.toLocaleString()],
    ['Recurring patterns', report.totals.recurringPatterns.toLocaleString()],
    ['Open problems', report.totals.openProblems.toLocaleString()],
    ['Threshold reviews', report.totals.thresholdReviewCandidates.toLocaleString()],
    ['Immediate actions', report.totals.immediateActionCandidates.toLocaleString()],
  ];
  const cardW = (CW - 20) / 3;
  kpis.forEach((k, i) => {
    const x = M + (i % 3) * (cardW + 10);
    const yy = y - Math.floor(i / 3) * 60 - 49;
    box(x, yy, cardW, 49, C.light);
    txt(k[0].toUpperCase(), x + 9, yy + 33, 6.4, true, C.muted);
    txt(k[1], x + 9, yy + 13, 17, true, C.navy);
  });
  y -= 128;

  section('03', 'Top Alert-Generating Services');
  const services = serviceTotals(report);
  table(
    [
      { title: 'Service', width: 300 },
      { title: 'Alerts', width: 82, right: true },
      { title: 'Patterns', width: 65, right: true },
      { title: 'Share', width: 76, right: true },
    ],
    services.length ? services.map(s => [s.serviceName, String(s.occurrences), String(s.patterns), s.share.toFixed(1) + '%']) : [['No service entity identified', '0', '0', '0%']],
    10,
  );

  section('04', 'Repeated / Noisy Alert Patterns');
  const recurring = report.patterns.filter(p => p.occurrences >= 2).slice(0, 15);
  table(
    [
      { title: 'Pattern', width: 150 },
      { title: 'Root cause', width: 105 },
      { title: 'Impacted services', width: 150 },
      { title: 'Occ.', width: 40, right: true },
      { title: 'Open', width: 38, right: true },
      { title: 'Avg', width: 40, right: true },
    ],
    recurring.length ? recurring.map(p => [clip(p.title, 43), clip(p.rootCauseEntity, 27), serviceText(p.impactedServices, 4), String(p.occurrences), String(p.openCount), mins(p.avgDurationMinutes)]) : [['No recurring patterns detected', '-', '-', '0', '0', '-']],
    15,
  );

  section('05', 'Threshold / Sensitivity Review');
  para('Review candidates only. Historical Problem data does not expose the exact configured anomaly-detection threshold. Validate the current configuration and business impact with the application/service owner before changing threshold or sensitivity.');
  table(
    [
      { title: 'Candidate pattern', width: 165 },
      { title: 'Impacted services', width: 155 },
      { title: 'Occ.', width: 40, right: true },
      { title: 'Avg', width: 45, right: true },
      { title: 'Root cause', width: 118 },
    ],
    report.thresholdCandidates.length ? report.thresholdCandidates.slice(0, 15).map(p => [clip(p.title, 47), serviceText(p.impactedServices, 4), String(p.occurrences), mins(p.avgDurationMinutes), clip(p.rootCauseEntity, 30)]) : [['No threshold-review candidates', '-', '0', '-', '-']],
    15,
  );

  section('06', 'Immediate Action Queue');
  table(
    [
      { title: 'Priority pattern', width: 145 },
      { title: 'Reason', width: 105 },
      { title: 'Impacted services', width: 145 },
      { title: 'Open', width: 38, right: true },
      { title: 'Occ.', width: 42, right: true },
      { title: 'Avg', width: 48, right: true },
    ],
    report.immediateActions.length ? report.immediateActions.slice(0, 15).map(p => [
      clip(p.title, 42),
      p.openCount ? 'Currently open' : p.avgDurationMinutes >= 60 ? 'Long-running' : 'Severe category',
      serviceText(p.impactedServices, 4),
      String(p.openCount),
      String(p.occurrences),
      mins(p.avgDurationMinutes),
    ]) : [['No immediate-action candidates', '-', '-', '0', '0', '-']],
    15,
  );

  section('07', 'Dynatrace Assist Recommendations');
  para(report.assistAnalysis || report.assistStatus || 'Assist recommendations were not returned. Use the evidence tables above.');

  section('08', 'Governance & Validation');
  para('1. Validate the pattern with the application and service owner.  2. Open the current Dynatrace anomaly-detection and alerting configuration.  3. Compare configured sensitivity with observed recurrence, duration and business impact.  4. Approve any change through the normal operational process.  5. Measure alert volume and service impact after the change.');
  para('Service occurrence counts represent the number of Problems in which a Dynatrace SERVICE entity appeared for the corresponding pattern. They are operational correlation signals, not proof of causality.', 8, 11);

  footer();
  if (page.length) pages.push(page);

  const objects: string[] = [];
  const addObject = (s: string) => objects.push(s);
  addObject('<< /Type /Catalog /Pages 2 0 R >>');
  addObject('<< /Type /Pages /Kids [KIDS] /Count COUNT >>');
  const f1 = objects.length + 1;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = objects.length + 1;
  addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const refs: number[] = [];
  pages.forEach(commands => {
    const stream = commands.join('\n');
    const cr = objects.length + 1;
    addObject('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    const pr = objects.length + 1;
    addObject('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + cr + ' 0 R >>');
    refs.push(pr);
  });
  objects[1] = objects[1].replace('KIDS', refs.map(r => r + ' 0 R').join(' ')).replace('COUNT', String(refs.length));
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += (i + 1) + ' 0 obj\n' + body + '\nendobj\n'; });
  const xref = pdf.length;
  pdf += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  pdf += 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
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

const emailClip = (v: string, n: number) => clip(v.replace(/\s+/g, ' '), n);

export const buildAlertOptimizationEmail = (report: OptimizationReportInput): string => {
  const services = serviceTotals(report).slice(0, 8);
  const recurring = report.patterns.filter(p => p.occurrences >= 2).slice(0, 10);
  const threshold = report.thresholdCandidates.slice(0, 10);
  const actions = report.immediateActions.slice(0, 10);
  const divider = (ch = '-', n = 82) => ch.repeat(n);

  const asciiTable = (headers: string[], rows: string[][]) => {
    const widths = headers.map((h, i) => Math.min(34, Math.max(h.length, ...rows.map(r => (r[i] || '').length))));
    const fit = (v: string, w: number) => v.length > w ? v.slice(0, Math.max(1, w - 3)) + '...' : v.padEnd(w);
    const line = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const out = [line, '| ' + headers.map((h, i) => fit(h, widths[i])).join(' | ') + ' |', line];
    rows.forEach(r => out.push('| ' + r.map((v, i) => fit(v, widths[i])).join(' | ') + ' |'));
    out.push(line);
    return out.join('\n');
  };

  const serviceRows = services.map(s => [emailClip(s.serviceName, 34), String(s.occurrences), String(s.patterns), s.share.toFixed(1) + '%']);
  const recurringRows = recurring.map(p => [
    emailClip(p.title, 20),
    emailClip(p.rootCauseEntity, 15),
    String(p.occurrences),
    String(p.openCount),
    mins(p.avgDurationMinutes),
    emailClip(serviceText(p.impactedServices, 2), 20),
  ]);
  const thresholdRows = threshold.map(p => [
    emailClip(p.title, 24),
    String(p.occurrences),
    mins(p.avgDurationMinutes),
    emailClip(serviceText(p.impactedServices, 2), 24),
  ]);
  const actionRows = actions.map(p => [
    emailClip(p.title, 23),
    p.openCount ? 'OPEN' : 'REVIEW',
    String(p.occurrences),
    mins(p.avgDurationMinutes),
    emailClip(serviceText(p.impactedServices, 2), 24),
  ]);

  return [
    'ALERT OPTIMIZATION PLAN | ' + report.managementZone.toUpperCase() + ' MANAGEMENT ZONE',
    report.window + ' | Generated ' + new Date(report.generatedAt).toLocaleString('en-IN'),
    divider('='),
    '',
    'EXECUTIVE SUMMARY',
    'Problems analyzed : ' + report.totals.problems.toLocaleString(),
    'Unique patterns   : ' + report.totals.uniquePatterns.toLocaleString(),
    'Recurring patterns: ' + report.totals.recurringPatterns.toLocaleString(),
    'Open problems     : ' + report.totals.openProblems.toLocaleString(),
    'Threshold reviews : ' + report.totals.thresholdReviewCandidates.toLocaleString(),
    'Immediate actions : ' + report.totals.immediateActionCandidates.toLocaleString(),
    '',
    'TOP ALERT-GENERATING SERVICES',
    asciiTable(['Service', 'Alerts', 'Patterns', 'Share'], serviceRows.length ? serviceRows : [['No service entity identified', '0', '0', '0%']]),
    '',
    'REPEATED / NOISY ALERT PATTERNS',
    asciiTable(['Pattern', 'Root cause', 'Occ.', 'Open', 'Avg', 'Services'], recurringRows.length ? recurringRows : [['None detected', '', '0', '0', '-', '-']]),
    '',
    'THRESHOLD / SENSITIVITY REVIEW',
    'Review candidates only. Current configured threshold values are not inferred from historical Problem data.',
    asciiTable(['Candidate pattern', 'Occ.', 'Avg', 'Impacted services'], thresholdRows.length ? thresholdRows : [['None detected', '0', '-', '-']]),
    '',
    'IMMEDIATE ACTION QUEUE',
    asciiTable(['Pattern', 'Status', 'Occ.', 'Avg', 'Impacted services'], actionRows.length ? actionRows : [['None detected', '-', '0', '-', '-']]),
    '',
    'DYNATRACE ASSIST RECOMMENDATIONS',
    emailClip(report.assistAnalysis || report.assistStatus || 'Assist recommendations were not returned.', 3000),
    '',
    'GOVERNANCE',
    'Validate proposed threshold, sensitivity, suppression or routing changes with the application/service owner before production change. Measure alert volume and service impact after approval.',
    '',
    divider(),
    'Axis Bank - Dynatrace Operations | Alert Optimization Plan',
  ].join('\n');
};