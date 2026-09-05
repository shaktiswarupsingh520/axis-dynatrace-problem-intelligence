import type { } from './RcaWorkbench';

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

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  return '';
};

const escapeText = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char));
const dateText = (value: string): string => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : value || '—'; };

export function buildCioRcaHtml(result: CioRcaResult): string {
  const facts = result.problemFacts ?? {};
  const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  const root = result.nativeRootCauseEntity || 'Not proven by available evidence';
  const sections = [
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
  const body = sections.map(([title, names]) => `<section><h2>${escapeText(title)}</h2><pre>${escapeText(section(result.analysis, names as string[]) || 'Not available from retrieved evidence.')}</pre></section>`).join('');
  const occurrenceRows = result.occurrences.slice(0, 30).map((occurrence) => `<tr><td>${escapeText(occurrence.problemId)}</td><td>${escapeText(dateText(occurrence.start))}</td><td>${escapeText(occurrence.title)}</td><td>${escapeText(occurrence.status)}</td><td>${escapeText(occurrence.severity)}</td><td>${escapeText(occurrence.duration)}</td></tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Axis CIO RCA ${escapeText(result.problemId)}</title><style>body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#172334;font-size:11px}h1{font-size:24px;color:#173b70;margin:0 0 6px}h2{font-size:14px;color:#173b70;border-bottom:2px solid #d9e5f2;padding-bottom:5px;margin-top:22px}p{line-height:1.5}.hero{padding:20px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:14px}.card{padding:9px;border:1px solid #dce5ee;border-radius:7px}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700}.note{margin-top:18px;padding:10px;background:#fff8e8;border-left:4px solid #e4a11b}pre{font-family:Arial,sans-serif;white-space:pre-wrap;font-size:10px;line-height:1.5}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body><div class="hero"><div class="label">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><p><b>Problem:</b> ${escapeText(result.problemId)} · <b>Title:</b> ${escapeText(text(facts.title) || 'Dynatrace Problem')}<br><b>Generated:</b> ${escapeText(dateText(result.generatedAt))}</p><div class="grid"><div class="card"><div class="label">Status</div><div class="value">${escapeText(text(facts.status) || '—')}</div></div><div class="card"><div class="label">Severity</div><div class="value">${escapeText(text(facts.severity) || '—')}</div></div><div class="card"><div class="label">Duration</div><div class="value">${escapeText(text(facts.duration) || '—')}</div></div><div class="card"><div class="label">Recurrence</div><div class="value">${escapeText(String(result.occurrenceCount))}</div></div></div><p><b>Root cause:</b> ${escapeText(root)}<br><b>Recurrence scope:</b> Last 30 days<br><b>Management zone:</b> ${escapeText(scope)}</p></div>${body}<section><h2>Occurrence Detail</h2><table><thead><tr><th>Problem</th><th>Started</th><th>Title</th><th>Status</th><th>Severity</th><th>Duration</th></tr></thead><tbody>${occurrenceRows || '<tr><td colspan="6">No occurrence records returned.</td></tr>'}</tbody></table></section><div class="note"><b>Governance:</b> Dynatrace telemetry is treated as observed evidence. AI text may include inference and proposed actions; those require SRE validation.</div></body></html>`;
}

export function printCioRca(result: CioRcaResult): void {
  const popup = window.open('', '_blank', 'width=1100,height=900');
  if (!popup) throw new Error('Allow pop-ups to generate the CIO-ready RCA.');
  popup.document.open();
  popup.document.write(buildCioRcaHtml(result));
  popup.document.close();
  popup.focus();
  window.setTimeout(() => popup.print(), 600);
}
