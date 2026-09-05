import React, { useMemo, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { useNavigate } from 'react-router-dom';

interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface ProblemFacts { title: string; status: string; severity: string; category: string; start: string; end: string; duration: string; impactLevel: string; affectedUsers: string; affectedEntities: string; }
interface Result {
  problemId: string; nativeRootCauseEntity: string | null; definitiveRootCause: boolean; analysis: string; generatedAt: string;
  assistFallback: boolean; problemFacts?: ProblemFacts; occurrenceCount: number; occurrences: Occurrence[];
  managementZones?: string[]; recurrenceWindow?: string;
  evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number };
}

const stringify = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};
const escCsv = (value: unknown) => `"${stringify(value).replace(/"/g, '""')}"`;
const dt = (value: string) => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : value || '—'; };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const download = (content: string, type: string, filename: string) => { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

function downloadRcaExcel(result: Result) {
  const headers = ['Problem ID', 'Native Root Cause', 'Recurrence Window', 'Management Zone Scope', 'Past Occurrences', 'Correlated Events', 'Incident Logs', 'Timeline Snapshots', 'RCA'];
  const summary = [result.problemId, result.nativeRootCauseEntity || 'Not proven', result.recurrenceWindow || '30 days', (result.managementZones ?? []).join('; ') || 'Not derived', result.occurrenceCount, result.evidenceSummary.correlatedEvents, result.evidenceSummary.incidentLogs, result.evidenceSummary.timelineSnapshots, result.analysis];
  const occurrenceHeaders = ['Problem ID', 'Title', 'Status', 'Severity', 'Started', 'Ended', 'Duration'];
  const rows = result.occurrences.map((o) => [o.problemId, o.title, o.status, o.severity, o.start, o.end, o.duration].map(escCsv).join(','));
  const csv = `\uFEFF${[headers.map(escCsv).join(','), summary.map(escCsv).join(','), '', occurrenceHeaders.map(escCsv).join(','), ...rows].join('\r\n')}`;
  download(csv, 'application/vnd.ms-excel;charset=utf-8', `axis-rca-${result.problemId}.xls`);
}

function sectionText(analysis: string, patterns: string[]): string {
  const lines = analysis.split(/\r?\n/);
  const wanted = lines.findIndex((line) => patterns.some((pattern) => line.toLowerCase().includes(pattern.toLowerCase())));
  if (wanted < 0) return '';
  const out: string[] = [];
  for (let i = wanted + 1; i < lines.length; i += 1) {
    if (/^\s*#{1,6}\s+/.test(lines[i]) && i > wanted + 1) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}
function firstParagraph(analysis: string): string {
  const executive = sectionText(analysis, ['executive summary']);
  const clean = executive.replace(/^[-*]+\s*/gm, '').trim();
  return clean.split(/\n\s*\n/)[0]?.trim() || clean || 'Evidence-backed RCA generated from the retrieved Dynatrace problem data.';
}

const REPORT_STYLE = [
  '@page{size:A4 portrait;margin:0}',
  '*{box-sizing:border-box}',
  ['html,body{margin:0;padding:0;background:', '#fff', ';color:#172334;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.45}'].join(''),
  '.page{width:210mm;min-height:297mm;position:relative;page-break-after:always;background:#fff;padding:23mm 16mm 18mm}',
  '.page:last-child{page-break-after:auto}',
  '.page>header{position:absolute;left:16mm;right:16mm;top:9mm;display:flex;justify-content:space-between;font-size:8px;font-weight:800;color:#17345d;border-bottom:1px solid #dbe3ec;padding-bottom:5px}',
  '.page>header span{font-weight:500;color:#718096}',
  '.page>header b{margin-left:12px;color:#17345d}',
  '.page>main{min-height:255mm}',
  '.page>footer{position:absolute;left:16mm;right:16mm;bottom:8mm;border-top:1px solid #dbe3ec;padding-top:4px;font-size:7.5px;color:#718096;display:flex;justify-content:space-between}',
  '.cover-page{width:210mm;height:297mm;page-break-after:always;background:#14284a}',
  '.cover{height:297mm;background:#14284a;color:#fff;padding:22mm 17mm 15mm;position:relative;overflow:hidden}',
  '.cover:before{content:"";position:absolute;left:0;top:0;bottom:0;width:5mm;background:#2f62d0}',
  '.cover-brand{font-size:13px;font-weight:800;line-height:1.2}',
  '.cover-brand small{font-size:8px;font-weight:500;letter-spacing:.04em}',
  '.cover-kicker{margin-top:42mm;color:#72a9ff;font-weight:800;letter-spacing:.18em;font-size:9px}',
  '.cover h1{font-size:28px;line-height:1.02;letter-spacing:.02em;margin:4mm 0 7mm}',
  '.cover-id{font-size:13px;font-weight:800}',
  '.cover-subtitle{font-size:10px;color:#91a1b8;margin-top:3mm}',
  '.cover-rule{height:1px;background:#9aa9bf;margin:27mm 0 7mm}',
  '.brief-label{font-size:8px;font-weight:800;letter-spacing:.08em;color:#72a9ff}',
  '.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm;margin:6mm 0}',
  '.metric{background:#f4f7fb;color:#172334;border-radius:5px;padding:4mm;min-height:18mm}',
  '.metric span{display:block;font-size:7px;color:#718096;font-weight:800;letter-spacing:.06em}',
  '.metric strong{display:block;margin-top:2mm;font-size:11px;overflow-wrap:anywhere}',
  '.cover .metric:first-child{background:#f26a6a;color:#fff}',
  '.cover .metric:first-child span{color:#fff}',
  '.cover-window{display:grid;grid-template-columns:34mm 1fr;gap:3mm 5mm;margin-top:9mm;font-size:8.5px}',
  '.cover-window b{color:#91a1b8;font-size:7px;text-transform:uppercase}',
  '.cover-window span{font-weight:700}',
  '.cover-foot{position:absolute;left:17mm;right:17mm;bottom:14mm;color:#91a1b8;font-size:7.5px}',
  '.cover-foot span{float:right}',
  '.section-title{display:flex;align-items:center;gap:3mm;margin-bottom:2mm}',
  '.section-title span{width:2mm;height:7mm;border-radius:1mm;background:#2f62d0}',
  '.section-title h2{margin:0;font-size:13px;color:#172f53}',
  '.eyebrow{font-size:8px;color:#718096;margin:2mm 0}',
  '.page-heading{font-size:20px;color:#172f53;margin:1mm 0 7mm}',
  '.small-label{font-size:7px;color:#64748b;font-weight:800;letter-spacing:.06em}',
  '.info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:5mm}',
  '.info-grid>div{border:1px solid #dbe3ec;border-radius:4px;padding:3.5mm;background:#f7f9fc;min-height:15mm}',
  '.info-grid b{display:block;margin-top:2mm;font-size:10px}',
  '.blue{color:#2861c7}',
  '.finding{border:1px solid #dbe3ec;background:#f7f9fc;border-radius:5px;padding:5mm;margin-bottom:5mm}',
  '.finding p{margin:2mm 0 0;font-size:9.5px}',
  '.two-col{display:grid;grid-template-columns:1fr 1fr;gap:5mm}',
  '.report-block{margin:5mm 0;break-inside:avoid}',
  '.report-block h3,.chain h3{font-size:11px;color:#17345d;border-bottom:1px solid #d9e3ef;padding-bottom:2mm;margin:0 0 3mm}',
  '.prose{white-space:pre-wrap;font-size:9px;color:#27384d}',
  '.report-block table{width:100%;border-collapse:collapse;font-size:8px}',
  '.report-block td{padding:2mm;border-bottom:1px solid #e4e9ef;vertical-align:top}',
  '.report-block td.key{width:36%;font-weight:700;color:#4b5e73}',
  '.chain{background:#f7f9fc;border:1px solid #dbe3ec;border-radius:5px;padding:4mm;margin-top:6mm}',
  '.chain pre{font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap;margin:0;font-size:9px;line-height:1.65;color:#263d5c}',
  '.legend{display:grid;grid-template-columns:45mm 1fr;gap:2mm 4mm;margin-top:6mm;padding:4mm;background:#fbfcfe;border:1px solid #e0e6ed;border-radius:5px;font-size:8px}',
  '.legend b{color:#17345d}',
  '.timeline-cards .cards{margin-top:2mm}',
  '.occurrences th{background:#17345d;color:#fff;text-align:left;padding:2mm;font-size:7px}',
  '.occurrences td{padding:2mm;border-bottom:1px solid #dfe5ec}',
  '.occurrences tr:nth-child(even){background:#f7f9fc}',
  '.governance{margin-top:6mm;padding:4mm;background:#fff8e7;border-left:3px solid #d49b25;font-size:8px;color:#4b3b1a;break-inside:avoid}',
  '.confidence{margin-top:8mm;padding:6mm;border:1px solid #cbd8e6;border-radius:5px;background:#f7f9fc}',
  '.confidence-label{font-size:7px;color:#2f62d0;font-weight:800;letter-spacing:.08em}',
  '.confidence h3{margin:2mm 0;font-size:12px;color:#17345d}',
  '.confidence p{margin:0;font-size:9px;white-space:pre-wrap}',
  '.appendix-title{border-bottom:2px solid #17345d;padding-bottom:5mm;margin-bottom:5mm}',
  '.appendix-title h1{font-size:22px;color:#17345d;margin:1mm 0}',
  '.appendix-meta{font-size:8px;color:#718096}',
  '.appendix-analysis{font-family:Arial,Helvetica,sans-serif;white-space:pre-wrap;font-size:8.5px;line-height:1.48;color:#26384c}',
  'table{page-break-inside:auto}',
  'tr{page-break-inside:avoid;page-break-after:auto}',
  '@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}',
].join('');

const makeCover = (result: Result, facts: ProblemFacts, root: string, cards: (items: Array<[string, string]>) => string) => {
  const severity = 'Level ' + facts.severity;
  return '<article class="cover-page"><div class="cover"><div class="cover-brand">AXIS' + ' BANK<br><small>ApMoSys ' + 'TECHNOLOGIES</small></div><div class="cover-kicker">AI-ASSISTED</div><h1>INCIDENT ' + 'ROOT<br>CAUSE ANALYSIS</h1><div class="cover-id">' + escapeHtml(result.problemId) + '</div><div class="cover-subtitle">' + escapeHtml(facts.title) + '</div><div class="cover-rule"></div><div class="brief-label">EXECUTIVE ' + 'INCIDENT BRIEF</div>' + cards([['STATUS', facts.status], ['SEVERITY', severity], ['DURATION', facts.duration], ['RECURRENCE', String(result.occurrenceCount)]]) + '<div class="cover-window"><b>Incident window</b><span>' + escapeHtml(facts.start ? dt(facts.start) : 'Not available') + ' &nbsp; to &nbsp; ' + escapeHtml(facts.end ? dt(facts.end) : '—') + '</span><b>Root-cause entity</b><span>' + escapeHtml(root) + '</span></div><div class="cover-foot">Prepared by Axis Problem Intelligence<br>Generated ' + escapeHtml(dt(result.generatedAt)) + '<span>CONFIDENTIAL</span></div></div></article>';
};
const makePage = (number: number, label: string, content: string) => '<article class="page"><header><div>AXIS ' + 'BANK <span>| ApMoSys TECHNOLOGIES</span></div><div>' + escapeHtml(label) + ' <b>' + number + ' / 7</b></div></header><main>' + content + '</main><footer>Axis Davis Problem Intelligence <span>| AI-assisted incident RCA | Confidential</span></footer></article>';
const makeBlock = (title: string, value: string) => '<section class="report-block"><h3>' + escapeHtml(title) + '</h3><div class="prose">' + escapeHtml(value || 'Not available from retrieved evidence.') + '</div></section>';

function reportHtml(result: Result): string {
  const facts = result.problemFacts ?? { title: 'Dynatrace problem', status: 'Not available', severity: 'Not available', category: 'Not available', start: '', end: '', duration: 'Not available', impactLevel: 'Not available', affectedUsers: 'Not available', affectedEntities: 'Not available' };
  const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  const root = result.nativeRootCauseEntity || 'Not identified';
  const executive = firstParagraph(result.analysis);
  const rootAssessment = sectionText(result.analysis, ['root cause assessment']);
  const chain = sectionText(result.analysis, ['technical root-cause chain']);
  const timeline = sectionText(result.analysis, ['incident timeline']);
  const impact = sectionText(result.analysis, ['impact assessment']);
  const immediate = sectionText(result.analysis, ['immediate remediation plan']);
  const preventive = sectionText(result.analysis, ['permanent / preventive actions']);
  const monitoring = sectionText(result.analysis, ['monitoring & alerting recommendations']);
  const validation = sectionText(result.analysis, ['validation checklist']);
  const confidence = sectionText(result.analysis, ['rca confidence & evidence gaps']);
  const cards = (items: Array<[string, string]>) => '<div class="cards">' + items.map(([label, value]) => '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('') + '</div>';
  const p2 = '<div class="section-title"><span></span><h2>Incident at a glance</h2></div><div class="eyebrow">Leadership summary</div><h1 class="page-heading">Executive Decision View</h1><div class="info-grid"><div><div class="small-label">PROBLEM ID</div><b class="blue">' + escapeHtml(result.problemId) + '</b></div><div><div class="small-label">STATUS</div><b>' + escapeHtml(facts.status) + '</b></div><div><div class="small-label">SEVERITY</div><b>' + escapeHtml('Level ' + facts.severity) + '</b></div><div><div class="small-label">CATEGORY</div><b>' + escapeHtml(facts.category) + '</b></div></div><div class="finding"><div class="small-label">PRIMARY FINDING</div><p>' + escapeHtml(executive) + '</p></div><div class="two-col"><div>' + makeBlock('Impact & recurrence', impact || ('Past occurrences: ' + result.occurrenceCount + '\nRecurrence scope: ' + (result.recurrenceWindow || '30 days') + '\nManagement zone: ' + scope + '\nImpact level: ' + facts.impactLevel + '\nAffected users: ' + facts.affectedUsers)) + '</div><div><section class="report-block"><h3>Incident facts</h3><table>' + [['Incident', facts.title], ['Root-cause entity', root], ['Started', facts.start ? dt(facts.start) : 'Not available'], ['Ended', facts.end ? dt(facts.end) : '—'], ['Affected users', facts.affectedUsers], ['Impact level', facts.impactLevel]].map(([k, v]) => '<tr><td class="key">' + escapeHtml(k) + '</td><td>' + escapeHtml(v) + '</td></tr>').join('') + '</table></section></div></div>';
  const p3 = '<div class="section-title"><span></span><h2>Incident at a glance</h2></div><div class="eyebrow">Evidence and causal chain</div><h1 class="page-heading">Root Cause Assessment</h1>' + makeBlock('Evidence-backed interpretation', rootAssessment || ('Native Dynatrace root-cause entity: ' + root + '. The retrieved evidence supports the incident signal; any underlying trigger not explicitly identified by Davis remains unproven.')) + '<div class="chain"><h3>Technical root-cause chain</h3><pre>' + escapeHtml(chain || '[Evidence retrieved]\n        ↓\n[Observed problem signal]\n        ↓\n[Service impact]\n        ↓\n[Root cause: not proven unless identified by Davis]') + '</pre></div><div class="legend"><b>Proven / high confidence</b><span>Retrieved directly from Dynatrace evidence.</span><b>Inference / validation required</b><span>AI interpretation that requires SRE validation.</span><b>Evidence gap</b><span>Telemetry not present in the retrieved evidence.</span></div>';
  const timelineFallback = 'Davis problem opened at ' + (facts.start ? dt(facts.start) : 'the supplied start time') + ' and is ' + (facts.end ? 'closed' : 'ongoing / without an end timestamp in the retrieved data') + '.';
  const occRows = result.occurrences.slice(0, 30).map((o) => '<tr><td>' + escapeHtml(o.problemId) + '</td><td>' + escapeHtml(dt(o.start)) + '</td><td>' + escapeHtml(o.title) + '</td><td>' + escapeHtml(o.status) + '</td><td>' + escapeHtml(o.duration) + '</td></tr>').join('');
  const p4 = '<div class="section-title"><span></span><h2>Incident at a glance</h2></div><div class="eyebrow">Operational history</div><h1 class="page-heading">Incident Timeline & Recurrence</h1>' + cards([['DETECTION / START', facts.start ? dt(facts.start) : 'Not available'], ['RECOVERY / END', facts.end ? dt(facts.end) : '—'], ['DURATION', facts.duration], ['RECURRENCE', String(result.occurrenceCount)]]) + makeBlock('Incident timeline', timeline || timelineFallback) + '<section class="report-block"><h3>Recurrence pattern</h3><p><b>' + result.occurrenceCount + '</b> matching occurrence(s) found in the last 30 days within ' + escapeHtml(scope) + '.</p><table class="occurrences"><thead><tr><th>Problem ID</th><th>Started</th><th>Title</th><th>Status</th><th>Duration</th></tr></thead><tbody>' + (occRows || '<tr><td colspan="5">No occurrence records returned.</td></tr>') + '</tbody></table></section>';
  const p5 = '<div class="section-title"><span></span><h2>Incident at a glance</h2></div><div class="eyebrow">Operational response plan</div><h1 class="page-heading">Remediation & Preventive Actions</h1>' + makeBlock('Immediate stabilization', immediate) + makeBlock('Permanent / preventive controls', preventive) + makeBlock('Monitoring recommendations', monitoring) + '<div class="governance">Recommendations are proposals only. Validate ownership, feasibility and production impact with the responsible SRE/application teams before implementation.</div>';
  const p6 = '<div class="section-title"><span></span><h2>Incident at a glance</h2></div><div class="eyebrow">RCA quality controls</div><h1 class="page-heading">Validation, Confidence & Governance</h1>' + makeBlock('Validation checklist', validation || 'Confirm root cause; validate dependency chain; correlate infrastructure metrics; test remediation; monitor recovery; validate alerting; document findings; communicate closure.') + '<section class="confidence"><div class="confidence-label">CONFIDENCE STATEMENT</div><h3>Evidence strength</h3><p>' + escapeHtml(confidence || 'Confidence should reflect the strength of the supplied Dynatrace evidence. Any unproven trigger must remain explicitly identified as an evidence gap.') + '</p></section><div class="governance"><b>Governance note</b><br>Observed Dynatrace evidence is distinguished from AI-generated interpretation. Recommendations require validation and ownership before being treated as completed remediation.</div>';
  const p7 = '<div class="appendix-title"><div class="eyebrow">Detailed AI-generated RCA</div><h1>AI Assessment Appendix</h1><div class="appendix-meta">' + escapeHtml(result.problemId) + ' &nbsp;|&nbsp; ' + escapeHtml(facts.title) + ' &nbsp;|&nbsp; Generated ' + escapeHtml(dt(result.generatedAt)) + '</div></div><div class="appendix-analysis">' + escapeHtml(result.analysis) + '</div>';
  return '<!doctype html><html><head><meta charset="utf-8"><title>Axis CIO RCA ' + escapeHtml(result.problemId) + '</title><style>' + REPORT_STYLE + '</style></head><body>' + makeCover(result, facts, root, cards) + makePage(2, 'Leadership summary', p2) + makePage(3, 'Evidence and causal chain', p3) + makePage(4, 'Operational history', p4) + makePage(5, 'Operational response plan', p5) + makePage(6, 'RCA quality controls', p6) + makePage(7, 'Detailed AI-generated RCA', p7) + '</body></html>';
}

function printRca(result: Result): void {
  const html = reportHtml(result);
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const windowRef = window.open(url, '_blank', 'width=1100,height=900');
  if (!windowRef) {
    URL.revokeObjectURL(url);
    throw new Error('Allow pop-ups for the CIO-ready RCA report.');
  }
  const print = () => { try { windowRef.focus(); windowRef.print(); } catch (error) { void error; } };
  windowRef.addEventListener('load', () => windowRef.setTimeout(print, 700), { once: true });
  window.setTimeout(print, 1800);
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export const RcaWorkbench = () => {
  const navigate = useNavigate();
  const [problemId, setProblemId] = useState('');
  const [runId, setRunId] = useState('');
  const [showOccurrences, setShowOccurrences] = useState(false);
  const [printError, setPrintError] = useState('');
  const request = useMemo(() => ({ problemId: runId }), [runId]);
  const { data, isLoading, error } = useAppFunction<Result>({ name: 'analyzeProblemRca', data: request }, { autoFetch: Boolean(runId), autoFetchOnUpdate: true });
  const occurrences = useMemo(() => data?.occurrences ?? [], [data]);
  const scope = data?.managementZones?.length ? data.managementZones.join(', ') : 'Management zone could not be derived';
  const run = () => { const id = problemId.trim().toUpperCase(); if (/^P-[A-Z0-9]+$/i.test(id)) { setPrintError(''); setRunId(id); } };
  const handlePrint = () => { if (!data) return; setPrintError(''); try { printRca(data); } catch (e) { setPrintError(e instanceof Error ? e.message : 'CIO-ready report could not be opened.'); } };
  return <Flex flexDirection="column" padding={24} gap={16}>
    <div style={{ border: '1px solid #dbe3ec', borderRadius: 14, background: '#fff', overflow: 'hidden', boxShadow: '0 8px 28px rgba(20,45,75,.07)' }}>
      <div style={{ padding: '22px 24px', background: 'linear-gradient(135deg,#eef7ff,#fff)' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', color: '#1476d4' }}>DYNATRACE DAVIS + ASSIST</div><Heading>AI Root Cause &amp; RCA</Heading><Paragraph>Evidence-backed incident RCA using Davis problem data, correlated events and recurrence history.</Paragraph></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', padding: '15px 24px', background: '#f7f9fb', borderBlock: '1px solid #e2e8ef' }}><label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, fontWeight: 700 }}>Problem ID<input value={problemId} onChange={(e) => setProblemId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder="e.g. P-260929324" style={{ height: 38, width: 270, border: '1px solid #cbd6e1', borderRadius: 7, padding: '0 11px' }} /></label><button type="button" onClick={run} disabled={isLoading || !problemId.trim()}>{isLoading ? 'Analysing…' : 'Analyze with Assist'}</button><button type="button" onClick={handlePrint} disabled={!data || isLoading}>Download CIO-ready RCA PDF</button><button type="button" onClick={() => data && downloadRcaExcel(data)} disabled={!data}>Download Excel</button><button type="button" onClick={() => navigate('/')}>Back to Problems</button></div>
      {printError && <div style={{ margin: '10px 24px 0', padding: 10, border: '1px solid #e5aaa5', borderRadius: 8, background: '#fff5f4', color: '#9b241b', fontSize: 11 }}>{printError}</div>}
      <div style={{ padding: '9px 24px', fontSize: 11, color: '#63758a' }}>{isLoading ? `Collecting Davis evidence for ${runId}…` : data ? `RCA generated ${new Date(data.generatedAt).toLocaleString()} · PDF opens in a print-ready window; choose Save as PDF.` : 'Ready for a Davis Problem ID.'}</div>
      {data && <div style={{ margin: '0 24px 12px', padding: '10px 12px', border: '1px solid #cfe0ef', borderRadius: 8, background: '#f5f9fd', fontSize: 11 }}><strong>Recurrence scope:</strong> Last 30 days · <strong>Management zone:</strong> {scope}</div>}
      <div style={{ padding: '0 24px 24px' }}>{error && <div style={{ padding: 12, border: '1px solid #e5aaa5', background: '#fff5f4', borderRadius: 8, color: '#9b241b' }}>RCA could not be generated: {error.message}</div>}{data && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(110px,1fr))', gap: 8, margin: '12px 0 18px' }}><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Problem</small><strong style={{ display: 'block', marginTop: 3 }}>{data.problemId}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Native root cause</small><strong style={{ display: 'block', marginTop: 3 }}>{data.nativeRootCauseEntity || 'Not proven'}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Correlated events</small><strong style={{ display: 'block', marginTop: 3 }}>{data.evidenceSummary.correlatedEvents}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Incident logs</small><strong style={{ display: 'block', marginTop: 3 }}>{data.evidenceSummary.incidentLogs}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Timeline snapshots</small><strong style={{ display: 'block', marginTop: 3 }}>{data.evidenceSummary.timelineSnapshots}</strong></div><div style={{ padding: 10, border: '1px solid #c9d9e8', borderRadius: 8, background: '#f5f9fd' }}><small>Past occurrences</small><button type="button" onClick={() => setShowOccurrences(true)} style={{ display: 'block', marginTop: 3, padding: 0, border: 0, background: 'transparent', color: '#1268b3', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>{data.occurrenceCount} · View records</button></div></div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, border: '1px solid #e2e8ef', borderRadius: 10, padding: 18, margin: 0, background: '#fbfcfe' }}>{data.analysis}</pre>{data.assistFallback && <div style={{ marginTop: 10, padding: 9, background: '#fff8e8', borderLeft: '4px solid #d89b20', fontSize: 11 }}>Dynatrace Assist was unavailable for this run. The displayed RCA is generated from retrieved Davis evidence.</div>}</>}</div>
    </div>
    {showOccurrences && data && <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,18,31,.58)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) setShowOccurrences(false); }}><section style={{ width: 'min(1050px,94vw)', maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,.28)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div><Heading>Past occurrences — {data.occurrenceCount}</Heading><Paragraph>Authoritative scope: last 30 days · same management-zone scope: {scope}. Showing {occurrences.length} records returned for investigation.</Paragraph></div><button type="button" onClick={() => setShowOccurrences(false)}>Close</button></div><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['Problem', 'Title', 'Status', 'Severity', 'Started', 'Ended', 'Duration'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e4e9ef' }}>{h}</th>)}</tr></thead><tbody>{occurrences.map((o, i) => <tr key={`${o.problemId}-${i}`}><td>{o.problemId}</td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.start}</td><td>{o.end || '—'}</td><td>{o.duration}</td></tr>)}</tbody></table></section></div>}
  </Flex>;
};