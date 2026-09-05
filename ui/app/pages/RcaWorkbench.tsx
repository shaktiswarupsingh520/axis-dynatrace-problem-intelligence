import React, { useMemo, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { useNavigate } from 'react-router-dom';

interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface ProblemFacts { title: string; status: string; severity: string; category: string; start: string; end: string; duration: string; impactLevel: string; affectedUsers: string; affectedEntities: string; }
interface Result { problemId: string; nativeRootCauseEntity: string | null; definitiveRootCause: boolean; analysis: string; generatedAt: string; assistFallback: boolean; problemFacts?: ProblemFacts; occurrenceCount: number; occurrences: Occurrence[]; managementZones?: string[]; recurrenceWindow?: string; evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number }; }

const stringify = (value: unknown): string => { if (value == null) return ''; if (typeof value === 'string') return value; if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value); if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join('; '); return JSON.stringify(value) ?? ''; };
const escCsv = (value: unknown) => `"${stringify(value).replace(/"/g, '""')}"`;
const dt = (value: string) => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : value || '—'; };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const download = (content: string, type: string, filename: string) => { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

function downloadRcaExcel(result: Result) { const headers = ['Problem ID','Native Root Cause','Recurrence Window','Management Zone Scope','Past Occurrences','Correlated Events','Incident Logs','Timeline Snapshots','RCA']; const summary = [result.problemId,result.nativeRootCauseEntity || 'Not proven',result.recurrenceWindow || '30 days',(result.managementZones ?? []).join('; ') || 'Not derived',result.occurrenceCount,result.evidenceSummary.correlatedEvents,result.evidenceSummary.incidentLogs,result.evidenceSummary.timelineSnapshots,result.analysis]; const occurrenceHeaders = ['Problem ID','Title','Status','Severity','Started','Ended','Duration']; const rows = result.occurrences.map((o) => [o.problemId,o.title,o.status,o.severity,o.start,o.end,o.duration].map(escCsv).join(',')); const csv = '\uFEFF' + [headers.map(escCsv).join(','),summary.map(escCsv).join(','),'',occurrenceHeaders.map(escCsv).join(','),...rows].join('\r\n'); download(csv,'application/vnd.ms-excel;charset=utf-8',`axis-rca-${result.problemId}.xls`); }
function sectionText(analysis: string, patterns: string[]): string { const lines = analysis.split(/\r?\n/); const start = lines.findIndex((line) => patterns.some((pattern) => line.toLowerCase().includes(pattern.toLowerCase()))); if (start < 0) return ''; const out: string[] = []; for (let i = start + 1; i < lines.length; i += 1) { if (/^\s*#{1,6}\s+/.test(lines[i]) && i > start + 1) break; out.push(lines[i]); } return out.join('\n').trim(); }
function firstParagraph(analysis: string): string { const executive = sectionText(analysis,['executive summary']); const clean = executive.replace(/^[-*]+\s*/gm,'').trim(); return clean.split(/\n\s*\n/)[0]?.trim() || clean || 'Evidence-backed RCA generated from the retrieved Dynatrace problem data.'; }

function reportHtml(result: Result): string {
  const facts = result.problemFacts ?? { title: 'Dynatrace problem', status: 'Not available', severity: 'Not available', category: 'Not available', start: '', end: '', duration: 'Not available', impactLevel: 'Not available', affectedUsers: 'Not available', affectedEntities: 'Not available' };
  const scope = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  const root = result.nativeRootCauseEntity || 'Not identified';
  const parts = [
    'Axis Bank — Problem Intelligence',
    'Incident Root Cause Analysis',
    'Problem ID: ' + result.problemId,
    'Title: ' + facts.title,
    'Status: ' + facts.status + ' | Severity: ' + facts.severity + ' | Duration: ' + facts.duration,
    'Incident window: ' + (facts.start ? dt(facts.start) : 'Not available') + ' to ' + (facts.end ? dt(facts.end) : '—'),
    'Root-cause entity: ' + root,
    'Past occurrences: ' + result.occurrenceCount,
    'Management zone: ' + scope,
    '',
    'EXECUTIVE SUMMARY',
    firstParagraph(result.analysis),
    '',
    'ROOT CAUSE ASSESSMENT',
    sectionText(result.analysis, ['root cause assessment']) || 'Not available from retrieved evidence.',
    '',
    'TECHNICAL ROOT-CAUSE CHAIN',
    sectionText(result.analysis, ['technical root-cause chain']) || 'Not available from retrieved evidence.',
    '',
    'INCIDENT TIMELINE',
    sectionText(result.analysis, ['incident timeline']) || 'Not available from retrieved evidence.',
    '',
    'PAST OCCURRENCES',
    result.occurrences.slice(0, 30).map((o) => [o.problemId, dt(o.start), o.title, o.status, o.duration].join(' | ')).join('\n') || 'No occurrence records returned.',
    '',
    'IMMEDIATE REMEDIATION PLAN',
    sectionText(result.analysis, ['immediate remediation plan']) || 'Not available from retrieved evidence.',
    '',
    'PERMANENT / PREVENTIVE ACTIONS',
    sectionText(result.analysis, ['permanent / preventive actions']) || 'Not available from retrieved evidence.',
    '',
    'MONITORING & ALERTING RECOMMENDATIONS',
    sectionText(result.analysis, ['monitoring & alerting recommendations']) || 'Not available from retrieved evidence.',
    '',
    'VALIDATION CHECKLIST',
    sectionText(result.analysis, ['validation checklist']) || 'Not available from retrieved evidence.',
    '',
    'RCA CONFIDENCE & EVIDENCE GAPS',
    sectionText(result.analysis, ['rca confidence & evidence gaps']) || 'Not available from retrieved evidence.',
    '',
    'AI ASSESSMENT APPENDIX',
    result.analysis,
  ];
  return parts.join('\n');
}

function printRca(result: Result): void {
  const report = reportHtml(result);
  const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, '_blank', 'width=1100,height=900');
  if (!popup) { URL.revokeObjectURL(url); return; }
  popup.addEventListener('load', () => { popup.print(); }, { once: true });
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function RcaWorkbench() {
  const navigate = useNavigate();
  const analyze = useAppFunction<typeof import('../../../api/analyzeProblemRca.function').default>({ name: 'analyzeProblemRca' });
  const [problemId, setProblemId] = useState('');
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOccurrences, setShowOccurrences] = useState(false);
  const [showRca, setShowRca] = useState(false);
  const result = useMemo(() => data, [data]);

  const run = async () => {
    if (!problemId.trim()) return;
    setBusy(true); setError(''); setData(null);
    try { const response = await analyze.invoke({ problemId: problemId.trim() }); setData(response as Result); }
    catch (e) { setError(e instanceof Error ? e.message : 'RCA analysis failed'); }
    finally { setBusy(false); }
  };

  return <div style={{ padding: 24 }}>
    <Flex alignItems="center" justifyContent="space-between"><div><Heading>RCA Workbench</Heading><Paragraph>Evidence-backed Dynatrace problem analysis with Davis.</Paragraph></div><button type="button" onClick={() => navigate('/')}>Back</button></Flex>
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><input value={problemId} onChange={(e) => setProblemId(e.target.value)} placeholder="Enter problem ID" /><button type="button" onClick={run} disabled={busy}>{busy ? 'Collecting evidence…' : 'Generate RCA'}</button></div>
    {error && <Paragraph>{error}</Paragraph>}
    {result && <div style={{ marginTop: 24 }}>
      <Heading>AI-Generated RCA</Heading>
      <Paragraph>{result.nativeRootCauseEntity ? 'Native root-cause entity: ' + result.nativeRootCauseEntity : 'Native root cause not proven from retrieved evidence.'}</Paragraph>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setShowOccurrences(true)}>{result.occurrenceCount} · View records</button>
        <button type="button" onClick={() => setShowRca((value) => !value)}>{showRca ? 'Hide RCA' : 'Show RCA'}</button>
        <button type="button" onClick={() => printRca(result)}>Print / Save CIO RCA</button>
        <button type="button" onClick={() => downloadRcaExcel(result)}>Export RCA Excel</button>
      </div>
      {showRca && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{result.analysis}</pre>}
      {showOccurrences && <div style={{ marginTop: 16, border: '1px solid #ccc', padding: 16 }}>
        <button type="button" onClick={() => setShowOccurrences(false)}>Close</button>
        <Heading>Past occurrences — {result.occurrenceCount}</Heading>
        <Paragraph>Authoritative count from the retrieved history query. Showing up to {result.occurrences.length} records for detail. Scope: {scopeLabel(result)}.</Paragraph>
        <table><thead><tr><th>Problem ID</th><th>Started</th><th>Title</th><th>Status</th><th>Duration</th></tr></thead><tbody>{result.occurrences.map((o) => <tr key={o.problemId}><td>{o.problemId}</td><td>{dt(o.start)}</td><td>{o.title}</td><td>{o.status}</td><td>{o.duration}</td></tr>)}</tbody></table>
      </div>}
    </div>}
  </div>;
}
function scopeLabel(result: Result): string { return (result.managementZones ?? []).join(', ') || 'All Management Zones'; }
