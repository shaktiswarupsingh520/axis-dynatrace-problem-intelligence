import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';

type Occurrence = { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string };
type Result = {
  problemId: string;
  nativeRootCauseEntity: string | null;
  analysis: string;
  generatedAt: string;
  occurrenceCount: number;
  occurrences: Occurrence[];
  managementZones?: string[];
  recurrenceWindow?: string;
  evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number };
};

const asText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value) ?? '';
};

const csvCell = (value: unknown): string => '"' + asText(value).replace(/"/g, '""') + '"';
const dateText = (value: string): string => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : value || '—'; };
const downloadBlob = (content: string, type: string, filename: string): void => { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); };

function downloadRcaExcel(result: Result): void {
  const head = ['Problem ID','Native Root Cause','Recurrence Window','Management Zone Scope','Past Occurrences','Correlated Events','Incident Logs','Timeline Snapshots','RCA'];
  const summary = [result.problemId,result.nativeRootCauseEntity || 'Not proven',result.recurrenceWindow || '30 days',(result.managementZones ?? []).join('; ') || 'Not derived',result.occurrenceCount,result.evidenceSummary.correlatedEvents,result.evidenceSummary.incidentLogs,result.evidenceSummary.timelineSnapshots,result.analysis];
  const occHead = ['Problem ID','Title','Status','Severity','Started','Ended','Duration'];
  const occRows = result.occurrences.map((o) => [o.problemId,o.title,o.status,o.severity,o.start,o.end,o.duration].map(csvCell).join(','));
  const csv = '\uFEFF' + [head.map(csvCell).join(','),summary.map(csvCell).join(','),'',occHead.map(csvCell).join(','),...occRows].join('\r\n');
  downloadBlob(csv, 'application/vnd.ms-excel;charset=utf-8', 'axis-rca-' + result.problemId + '.xls');
}

const extractSection = (analysis: string, names: string[]): string => {
  const lines = analysis.split(/\r?\n/);
  const start = lines.findIndex((line) => names.some((name) => line.toLowerCase().includes(name.toLowerCase())));
  if (start < 0) return '';
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*#{1,6}\s+/.test(lines[i]) && i > start + 1) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
};

const reportText = (result: Result): string => {
  const zones = (result.managementZones ?? []).join(', ') || 'Management zone not derived';
  const root = result.nativeRootCauseEntity || 'Not proven';
  return [
    'AXIS BANK — AI-ASSISTED INCIDENT ROOT CAUSE ANALYSIS',
    'Problem ID: ' + result.problemId,
    'Native root-cause entity: ' + root,
    'Recurrence scope: Last 30 days',
    'Management zone: ' + zones,
    'Past occurrences: ' + result.occurrenceCount,
    '',
    'EXECUTIVE SUMMARY',
    extractSection(result.analysis, ['executive summary']) || result.analysis,
    '',
    'ROOT CAUSE ASSESSMENT',
    extractSection(result.analysis, ['root cause assessment']) || 'Not available from retrieved evidence.',
    '',
    'TECHNICAL ROOT-CAUSE CHAIN',
    extractSection(result.analysis, ['technical root-cause chain']) || 'Not available from retrieved evidence.',
    '',
    'INCIDENT TIMELINE',
    extractSection(result.analysis, ['incident timeline']) || 'Not available from retrieved evidence.',
    '',
    'PAST OCCURRENCES',
    result.occurrences.map((o) => [o.problemId,dateText(o.start),o.title,o.status,o.duration].join(' | ')).join('\n') || 'No occurrence records returned.',
    '',
    'IMMEDIATE REMEDIATION PLAN',
    extractSection(result.analysis, ['immediate remediation plan']) || 'Not available from retrieved evidence.',
    '',
    'PERMANENT / PREVENTIVE ACTIONS',
    extractSection(result.analysis, ['permanent / preventive actions']) || 'Not available from retrieved evidence.',
    '',
    'MONITORING & ALERTING RECOMMENDATIONS',
    extractSection(result.analysis, ['monitoring & alerting recommendations']) || 'Not available from retrieved evidence.',
    '',
    'VALIDATION CHECKLIST',
    extractSection(result.analysis, ['validation checklist']) || 'Not available from retrieved evidence.',
    '',
    'RCA CONFIDENCE & EVIDENCE GAPS',
    extractSection(result.analysis, ['rca confidence & evidence gaps']) || 'Not available from retrieved evidence.',
    '',
    'AI ASSESSMENT APPENDIX',
    result.analysis,
  ].join('\n');
};

const printRca = (result: Result): void => {
  const popup = window.open('', '_blank', 'width=1100,height=900');
  if (!popup) return;
  popup.document.title = 'Axis CIO RCA ' + result.problemId;
  const pre = popup.document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontFamily = 'Arial, sans-serif';
  pre.style.fontSize = '11px';
  pre.style.lineHeight = '1.45';
  pre.style.margin = '24px';
  pre.textContent = reportText(result);
  popup.document.body.appendChild(pre);
  window.setTimeout(() => { popup.focus(); popup.print(); }, 300);
};

export default function RcaWorkbench(): React.JSX.Element {
  const navigate = useNavigate();
  const [problemId, setProblemId] = useState('');
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOccurrences, setShowOccurrences] = useState(false);
  const analyze = async (): Promise<void> => {
    if (!problemId.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/analyzeProblemRca', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problemId: problemId.trim() }) });
      if (!response.ok) throw new Error('RCA request failed with HTTP ' + response.status);
      setData(await response.json() as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'RCA analysis failed'); }
    finally { setBusy(false); }
  };
  const scope = (data?.managementZones ?? []).join(', ') || 'Management zone not derived';
  return <div style={{ padding: 24 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><div><Heading>RCA Workbench</Heading><Paragraph>Evidence-backed Dynatrace problem analysis with Davis.</Paragraph></div><button type="button" onClick={() => navigate('/')}>Back</button></div>
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}><input value={problemId} onChange={(e) => setProblemId(e.target.value)} placeholder="Enter problem ID" /><button type="button" disabled={busy} onClick={() => { void analyze(); }}>{busy ? 'Collecting evidence…' : 'Generate RCA'}</button></div>
    {error && <Paragraph>{error}</Paragraph>}
    {data && <div style={{ marginTop: 24 }}><Paragraph><strong>Recurrence scope:</strong> Last 30 days · <strong>Management zone:</strong> {scope}</Paragraph><Paragraph><strong>Native root cause:</strong> {data.nativeRootCauseEntity || 'Not proven'}</Paragraph><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={() => setShowOccurrences(true)}>{data.occurrenceCount} · View records</button><button type="button" onClick={() => printRca(data)}>Download CIO-ready RCA PDF</button><button type="button" onClick={() => downloadRcaExcel(data)}>Download Excel</button></div><pre style={{ whiteSpace: 'pre-wrap', marginTop: 16 }}>{data.analysis}</pre>{showOccurrences && <div style={{ marginTop: 16, padding: 16, border: '1px solid #ccd6e0' }}><button type="button" onClick={() => setShowOccurrences(false)}>Close</button><Heading>Past occurrences — {data.occurrenceCount}</Heading><Paragraph>Last 30 days · same Management Zone: {scope}. Showing {data.occurrences.length} records.</Paragraph><table><thead><tr>{['Problem ID','Started','Title','Status','Severity','Duration'].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.occurrences.map((o) => <tr key={o.problemId}><td>{o.problemId}</td><td>{dateText(o.start)}</td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.duration}</td></tr>)}</tbody></table></div>}</div>}
  </div>;
}