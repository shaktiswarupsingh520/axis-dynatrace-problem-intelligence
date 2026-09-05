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
  const names: Array<[string, string[]]> = [
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
  const body = names.map(([title, keys]) => '<section><h2>' + escapeText(title) + '</h2><pre>' + escapeText(section(result.analysis, keys) || 'Not available from retrieved evidence.') + '</pre></section>').join('');
  const occurrenceRows = result.occurrences.slice(0, 30).map((occurrence) => '<tr><td>' + escapeText(occurrence.problemId) + '</td><td>' + escapeText(dateText(occurrence.start)) + '</td><td>' + escapeText(occurrence.title) + '</td><td>' + escapeText(occurrence.status) + '</td><td>' + escapeText(occurrence.severity) + '</td><td>' + escapeText(occurrence.duration) + '</td></tr>').join('');
  const metrics = [
    ['Status', text(facts.status) || '—'],
    ['Severity', text(facts.severity) || '—'],
    ['Duration', text(facts.duration) || '—'],
    ['Recurrence', String(result.occurrenceCount)],
  ];
  const metricHtml = metrics.map(([label, value]) => '<div style="padding:12px;border:1px solid #d8e1ea;border-radius:7px"><div style="font-size:9px;text-transform:uppercase;color:#6d7f92;font-weight:700">' + escapeText(label) + '</div><div style="margin-top:4px;font-weight:700">' + escapeText(value) + '</div></div>').join('');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Axis CIO RCA ' + escapeText(result.problemId) + '</title></head><body style="font-family:Arial,sans-serif;margin:0;padding:24px;color:#172334;font-size:11px;line-height:1.5"><div style="padding:20px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1 style="font-size:24px;color:#173b70;margin:4px 0">AI-Assisted Incident Root Cause Analysis</h1><p><b>Problem:</b> ' + escapeText(result.problemId) + ' · <b>Title:</b> ' + escapeText(text(facts.title) || 'Dynatrace Problem') + '<br><b>Generated:</b> ' + escapeText(dateText(result.generatedAt)) + '</p><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' + metricHtml + '</div><p><b>Root cause:</b> ' + escapeText(root) + '<br><b>Recurrence scope:</b> Last 30 days<br><b>Management zone:</b> ' + escapeText(scope) + '</p></div>' + body + '<section><h2 style="font-size:14px;color:#173b70;border-bottom:2px solid #d9e5f2;padding-bottom:5px">Occurrence Detail</h2><table style="width:100%;border-collapse:collapse;font-size:8px"><thead><tr><th style="padding:5px;text-align:left;background:#eef4f9">Problem</th><th style="padding:5px;text-align:left;background:#eef4f9">Started</th><th style="padding:5px;text-align:left;background:#eef4f9">Title</th><th style="padding:5px;text-align:left;background:#eef4f9">Status</th><th style="padding:5px;text-align:left;background:#eef4f9">Severity</th><th style="padding:5px;text-align:left;background:#eef4f9">Duration</th></tr></thead><tbody>' + (occurrenceRows || '<tr><td colspan="6">No occurrence records returned.</td></tr>') + '</tbody></table></section><div style="margin-top:18px;padding:10px;background:#fff8e8;border-left:4px solid #e4a11b"><b>Governance:</b> Dynatrace telemetry is treated as observed evidence. AI text may include inference and proposed actions; those require SRE validation.</div></body></html>';
  return html;
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
