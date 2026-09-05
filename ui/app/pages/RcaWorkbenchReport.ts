export interface CioRcaResult {
  problemId: string;
  nativeRootCauseEntity: string | null;
  analysis: string;
  generatedAt: string;
  occurrenceCount: number;
  occurrences: Array<{ problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string }>;
  managementZones?: string[];
  recurrenceWindow?: string;
  evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number };
  problemFacts?: { title?: string; status?: string; severity?: string; category?: string; start?: string; end?: string; duration?: string; impactLevel?: string; affectedUsers?: string | number; affectedEntities?: string | number };
}

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  return '';
};

const section = (analysis: string, names: string[]): string => {
  const lines = analysis.split(/\r?\n/);
  const index = lines.findIndex((line) => names.some((name) => line.toLowerCase().includes(name.toLowerCase())));
  if (index < 0) return '';
  const body: string[] = [];
  for (let i = index + 1; i < lines.length; i += 1) {
    if (/^\s*#{1,6}\s+/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
};

const escapeText = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
const dateText = (value: string): string => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value || '—'; };

export function buildCioRcaHtml(result: CioRcaResult): string {
  const facts = result.problemFacts ?? {};
  const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  const root = result.nativeRootCauseEntity || 'Not proven by available evidence';
  const headings: Array<[string, string[]]> = [
    ['Executive Summary', ['executive summary']],
    ['Root Cause Assessment', ['root cause assessment']],
    ['Technical Root-Cause Chain', ['technical root-cause chain']],
    ['Incident Timeline', ['incident timeline']],
    ['Past Occurrences & Recurrence Pattern', ['past occurrences', 'recurrence pattern']],
    ['Impact Assessment', ['impact assessment']],
    ['Immediate Remediation Plan', ['immediate remediation plan']],
    ['Permanent / Preventive Actions', ['permanent / preventive actions']],
    ['Monitoring & Alerting Recommendations', ['monitoring & alerting recommendations']],
    ['Validation Checklist', ['validation checklist']],
    ['RCA Confidence & Evidence Gaps', ['rca confidence & evidence gaps']],
  ];
  const body = headings.map(([title, names]) => '<section><h2>' + escapeText(title) + '</h2><pre>' + escapeText(section(result.analysis, names)) + '</pre></section>').join('');
  const occurrenceRows = result.occurrences.slice(0, 30).map((occurrence) => '<tr><td>' + escapeText(occurrence.problemId) + '</td><td>' + escapeText(dateText(occurrence.start)) + '</td><td>' + escapeText(occurrence.title) + '</td><td>' + escapeText(occurrence.status) + '</td><td>' + escapeText(occurrence.severity) + '</td><td>' + escapeText(occurrence.duration) + '</td></tr>').join('');
  const metrics = [
    ['Status', text(facts.status) || '—'],
    ['Severity', text(facts.severity) || '—'],
    ['Duration', text(facts.duration) || '—'],
    ['Recurrence', String(result.occurrenceCount)],
  ];
  const metricHtml = metrics.map(([label, value]) => '<div class="m"><div class="l">' + escapeText(label) + '</div><div class="v">' + escapeText(value) + '</div></div>').join('');
  const occurrenceHtml = occurrenceRows || '<tr><td colspan="6">No occurrence records returned.</td></tr>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>Axis CIO RCA ' + escapeText(result.problemId) + '</title></head><body><div class="hero"><div class="brand">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div class="meta">Problem ' + escapeText(result.problemId) + ' · ' + escapeText(text(facts.title) || 'Dynatrace Problem') + ' · Generated ' + escapeText(dateText(result.generatedAt)) + '</div><div class="metrics">' + metricHtml + '</div><div class="scope"><b>Root cause:</b> ' + escapeText(root) + '<br><b>Recurrence:</b> Last 30 days<br><b>Management zone:</b> ' + escapeText(scope) + '</div></div>' + body + '<section><h2>Occurrence Detail</h2><table><thead><tr><th>Problem</th><th>Started</th><th>Title</th><th>Status</th><th>Severity</th><th>Duration</th></tr></thead><tbody>' + occurrenceHtml + '</tbody></table></section><div class="note"><b>Governance:</b> Dynatrace telemetry is observed evidence. AI interpretation and proposed actions require SRE validation.</div></body></html>';
}

export function downloadCioRca(html: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'axis-cio-rca-report.html';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
