import React, { useMemo, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { useNavigate } from 'react-router-dom';

interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface Result {
  problemId: string;
  nativeRootCauseEntity: string | null;
  definitiveRootCause: boolean;
  analysis: string;
  generatedAt: string;
  assistFallback: boolean;
  occurrenceCount: number;
  occurrences: Occurrence[];
  managementZones?: string[];
  recurrenceWindow?: string;
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
const escHtml = (value: unknown) => stringify(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const dt = (value: string) => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : value || '—'; };
const download = (content: string, type: string, filename: string) => { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

function downloadRcaExcel(result: Result) {
  const headers = ['Problem ID', 'Native Root Cause', 'Recurrence Window', 'Management Zone Scope', 'Past Occurrences', 'Correlated Events', 'Incident Logs', 'Timeline Snapshots', 'RCA'];
  const summary = [result.problemId, result.nativeRootCauseEntity || 'Not proven', result.recurrenceWindow || '30 days', (result.managementZones ?? []).join('; ') || 'Not derived', result.occurrenceCount, result.evidenceSummary.correlatedEvents, result.evidenceSummary.incidentLogs, result.evidenceSummary.timelineSnapshots, result.analysis];
  const occurrenceHeaders = ['Problem ID', 'Title', 'Status', 'Severity', 'Started', 'Ended', 'Duration'];
  const rows = result.occurrences.map((o) => [o.problemId, o.title, o.status, o.severity, o.start, o.end, o.duration].map(escCsv).join(','));
  const csv = `\uFEFF${[headers.map(escCsv).join(','), summary.map(escCsv).join(','), '', occurrenceHeaders.map(escCsv).join(','), ...rows].join('\r\n')}`;
  download(csv, 'application/vnd.ms-excel;charset=utf-8', `axis-rca-${result.problemId}.xls`);
}

function printRca(result: Result) {
  const occurrenceRows = result.occurrences.slice(0, 50).map((o) => `<tr><td>${escHtml(o.problemId)}</td><td>${escHtml(dt(o.start))}</td><td>${escHtml(o.status)}</td><td>${escHtml(o.severity)}</td><td>${escHtml(o.duration)}</td></tr>`).join('');
  const windowRef = window.open('', '_blank', 'width=1000,height=900');
  if (!windowRef) throw new Error('Allow pop-ups to print the RCA.');
  const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  windowRef.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Axis RCA ${escHtml(result.problemId)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172334;font-size:10.5px;line-height:1.5}h1{color:#173b70;margin:0;font-size:22px}h2{color:#173b70;font-size:14px;border-bottom:2px solid #d9e5f2;padding-bottom:4px;margin-top:20px}.hero{padding:18px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.card{padding:8px;border:1px solid #dce5ee;border-radius:7px}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700}.analysis{white-space:pre-wrap}.scope{margin-top:10px;padding:8px;border-left:4px solid #4c82b8;background:#edf5fc}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9}.note{margin-top:18px;padding:9px;background:#fff8e8;border-left:4px solid #e4a11b}@media print{.note{break-inside:avoid}table{break-inside:auto}tr{break-inside:avoid}}</style></head><body><div class="hero"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div style="font-size:9px;color:#65758a">Problem ${escHtml(result.problemId)} · Generated ${escHtml(dt(result.generatedAt))}</div><div class="grid"><div class="card"><div class="label">Native root cause</div><div class="value">${escHtml(result.nativeRootCauseEntity || 'Not proven')}</div></div><div class="card"><div class="label">Correlated events</div><div class="value">${result.evidenceSummary.correlatedEvents}</div></div><div class="card"><div class="label">Incident logs</div><div class="value">${result.evidenceSummary.incidentLogs}</div></div><div class="card"><div class="label">Past occurrences</div><div class="value">${result.occurrenceCount}</div></div></div><div class="scope"><b>Recurrence scope:</b> Last 30 days · <b>Management zone:</b> ${escHtml(scope)}</div></div><h2>AI Root Cause Analysis</h2><div class="analysis">${escHtml(result.analysis)}</div><h2>Past Occurrences</h2><table><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Severity</th><th>Duration</th></tr></thead><tbody>${occurrenceRows || '<tr><td colspan="5">No occurrence records returned.</td></tr>'}</tbody></table><div class="note"><b>RCA governance:</b> Facts come from retrieved Dynatrace evidence. Inferences and recommendations are proposals and must be validated before production action.</div><script>window.onload=()=>setTimeout(()=>window.print(),500)</script></body></html>`);
  windowRef.document.close();
}

export const RcaWorkbench = () => {
  const navigate = useNavigate();
  const [problemId, setProblemId] = useState('');
  const [runId, setRunId] = useState('');
  const [showOccurrences, setShowOccurrences] = useState(false);
  const request = useMemo(() => ({ problemId: runId }), [runId]);
  const { data, isLoading, error } = useAppFunction<Result>({ name: 'analyzeProblemRca', data: request }, { autoFetch: Boolean(runId), autoFetchOnUpdate: true });
  const occurrences = useMemo(() => data?.occurrences ?? [], [data]);
  const scope = data?.managementZones?.length ? data.managementZones.join(', ') : 'Management zone could not be derived';
  const run = () => { const id = problemId.trim().toUpperCase(); if (/^P-[A-Z0-9]+$/i.test(id)) setRunId(id); };
  return <Flex flexDirection="column" padding={24} gap={16}>
    <div style={{ border: '1px solid #dbe3ec', borderRadius: 14, background: '#fff', overflow: 'hidden', boxShadow: '0 8px 28px rgba(20,45,75,.07)' }}>
      <div style={{ padding: '22px 24px', background: 'linear-gradient(135deg,#eef7ff,#fff)' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.14em', color: '#1476d4' }}>DYNATRACE DAVIS + ASSIST</div><Heading>AI Root Cause &amp; RCA</Heading><Paragraph>Evidence-backed incident RCA using Davis problem data, correlated events, incident logs and recurrence history.</Paragraph></div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', padding: '15px 24px', background: '#f7f9fb', borderBlock: '1px solid #e2e8ef' }}><label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11, fontWeight: 700 }}>Problem ID<input value={problemId} onChange={(e) => setProblemId(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder="e.g. P-260929324" style={{ height: 38, width: 270, border: '1px solid #cbd6e1', borderRadius: 7, padding: '0 11px' }} /></label><button type="button" onClick={run} disabled={isLoading || !problemId.trim()}>{isLoading ? 'Analysing…' : 'Analyze with Assist'}</button><button type="button" onClick={() => data && printRca(data)} disabled={!data}>Print / Save CIO-ready PDF</button><button type="button" onClick={() => data && downloadRcaExcel(data)} disabled={!data}>Download Excel</button><button type="button" onClick={() => navigate('/')}>Back to Problems</button></div>
      <div style={{ padding: '9px 24px', fontSize: 11, color: '#63758a' }}>{isLoading ? `Collecting Davis evidence for ${runId}…` : data ? `RCA generated ${new Date(data.generatedAt).toLocaleString()}` : 'Ready for a Davis Problem ID.'}</div>
      {data && <div style={{ margin: '0 24px 12px', padding: '10px 12px', border: '1px solid #cfe0ef', borderRadius: 8, background: '#f5f9fd', fontSize: 11 }}><strong>Recurrence scope:</strong> Last 30 days · <strong>Management zone:</strong> {scope}</div>}
      <div style={{ padding: '0 24px 24px' }}>{error && <div style={{ padding: 12, border: '1px solid #e5aaa5', background: '#fff5f4', borderRadius: 8, color: '#9b241b' }}>RCA could not be generated: {error.message}</div>}{data && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(110px,1fr))', gap: 8, margin: '12px 0 18px' }}><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Problem</small><strong style={{ display: 'block', marginTop: 3 }}>{data.problemId}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Native root cause</small><strong style={{ display: 'block', marginTop: 3 }}>{data.nativeRootCauseEntity || 'Not proven'}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Correlated events</small><strong style={{ display: 'block', marginTop: 3 }}>{data.evidenceSummary.correlatedEvents}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Incident logs</small><strong style={{ display: 'block', marginTop: 3 }}>{data.evidenceSummary.incidentLogs}</strong></div><div style={{ padding: 10, border: '1px solid #e0e7ee', borderRadius: 8, background: '#f9fbfd' }}><small>Timeline snapshots</small><strong style={{ display: 'block', marginTop: 3 }}>{data.evidenceSummary.timelineSnapshots}</strong></div><div style={{ padding: 10, border: '1px solid #c9d9e8', borderRadius: 8, background: '#f5f9fd' }}><small>Past occurrences</small><button type="button" onClick={() => setShowOccurrences(true)} style={{ display: 'block', marginTop: 3, padding: 0, border: 0, background: 'transparent', color: '#1268b3', fontWeight: 800, cursor: 'pointer', textDecoration: 'underline' }}>{data.occurrenceCount} · View records</button></div></div><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.6, border: '1px solid #e2e8ef', borderRadius: 10, padding: 18, margin: 0, background: '#fbfcfe' }}>{data.analysis}</pre>{data.assistFallback && <div style={{ marginTop: 10, padding: 9, background: '#fff8e8', borderLeft: '4px solid #d89b20', fontSize: 11 }}>Dynatrace Assist was unavailable for this run. The displayed RCA is generated from retrieved Davis evidence.</div>}</>}</div>
    </div>
    {showOccurrences && data && <div style={{ position: 'fixed', inset: 0, background: 'rgba(7,18,31,.58)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={(e) => { if (e.target === e.currentTarget) setShowOccurrences(false); }}><section style={{ width: 'min(1050px,94vw)', maxHeight: '88vh', overflow: 'auto', background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,.28)' }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}><div><Heading>Past occurrences — {data.occurrenceCount}</Heading><Paragraph>Authoritative scope: last 30 days · same management-zone scope: {scope}. Showing {occurrences.length} records returned for investigation.</Paragraph></div><button type="button" onClick={() => setShowOccurrences(false)}>Close</button></div><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['Problem', 'Title', 'Status', 'Severity', 'Started', 'Ended', 'Duration'].map((h) => <th key={h} style={{ textAlign: 'left', padding: 8, borderBottom: '1px solid #e4e9ef' }}>{h}</th>)}</tr></thead><tbody>{occurrences.map((o, i) => <tr key={`${o.problemId}-${i}`}><td>{o.problemId}</td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.start}</td><td>{o.end || '—'}</td><td>{o.duration}</td></tr>)}</tbody></table></section></div>}
  </Flex>;
};
