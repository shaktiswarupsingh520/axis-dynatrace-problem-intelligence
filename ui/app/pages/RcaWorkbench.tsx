import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './RcaWorkbench.css';
import { buildRcaReport, downloadRcaReport } from './RcaWorkbenchReport';

type Occurrence = { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string };
type ProblemFacts = { title?: string; status?: string; severity?: string; category?: string; start?: string; end?: string; duration?: string; impactLevel?: string; affectedUsers?: string | number; affectedEntities?: string | number };
type Result = { problemId: string; nativeRootCauseEntity: string | null; analysis: string; generatedAt: string; occurrenceCount: number; occurrences: Occurrence[]; managementZones?: string[]; recurrenceWindow?: string; evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number }; problemFacts?: ProblemFacts };
type InputEvent = React.ChangeEvent<HTMLInputElement>;

const asText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value) ?? '';
};
const csvCell = (value: unknown): string => '"' + asText(value).replace(/"/g, '""') + '"';
const dateText = (value: string): string => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString() : value || '—'; };
const downloadBlob = (content: string, type: string, filename: string): void => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); };

function downloadRcaExcel(result: Result): void {
  const head = ['Problem ID','Native Root Cause','Recurrence Window','Management Zone Scope','Past Occurrences','Correlated Events','Incident Logs','Timeline Snapshots','RCA'];
  const summary = [result.problemId,result.nativeRootCauseEntity || 'Not proven',result.recurrenceWindow || 'Last 30 days',(result.managementZones ?? []).join('; ') || 'Not derived',result.occurrenceCount,result.evidenceSummary.correlatedEvents,result.evidenceSummary.incidentLogs,result.evidenceSummary.timelineSnapshots,result.analysis];
  const occurrenceHead = ['Problem ID','Title','Status','Severity','Started','Ended','Duration'];
  const occurrenceRows = result.occurrences.map((o) => [o.problemId,o.title,o.status,o.severity,o.start,o.end,o.duration].map(csvCell).join(','));
  const csv = '\uFEFF' + [head.map(csvCell).join(','),summary.map(csvCell).join(','),'',occurrenceHead.map(csvCell).join(','),...occurrenceRows].join('\r\n');
  downloadBlob(csv, 'application/vnd.ms-excel;charset=utf-8', 'axis-rca-' + result.problemId + '.xls');
}

const parseAnalysis = (analysis: string): Array<{ title: string; body: string }> => {
  const lines = analysis.split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;
  lines.forEach((line) => {
    const match = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (match) {
      if (current && current.body.trim()) sections.push({ title: current.title, body: current.body.trim() });
      const title = match[1] ?? '';
      current = { title: title.replace(/[*_]/g, ''), body: '' };
    } else if (current) current.body += (current.body ? '\n' : '') + line;
  });
  if (current && current.body.trim()) sections.push({ title: current.title, body: current.body.trim() });
  return sections.length ? sections : [{ title: 'Davis Assist Analysis', body: analysis }];
};

export function RcaWorkbench(): React.JSX.Element {
  const navigate = useNavigate();
  const [problemId, setProblemId] = useState<string>('');
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [showOccurrences, setShowOccurrences] = useState<boolean>(false);
  const sections = useMemo(() => data ? parseAnalysis(data.analysis) : [], [data]);
  const facts = data?.problemFacts;
  const scope = (data?.managementZones ?? []).join(', ') || 'Management zone not derived';

  const handleInputChange = (event: InputEvent): void => setProblemId(event.target.value);
  const analyze = async (): Promise<void> => {
    const id = problemId;
    if (id.length === 0) return;
    const normalizedId = id.replace(/^\s+|\s+$/g, '');
    if (normalizedId.length === 0) return;
    setBusy(true); setError('');
    try {
      const request = await fetch('/api/analyzeProblemRca', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problemId: normalizedId }) });
      if (!request.ok) throw new Error('RCA request failed with HTTP ' + String(request.status));
      const response: unknown = await request.json();
      if (!response || typeof response !== 'object') throw new Error('RCA response was empty or invalid.');
      setData(response as Result);
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : 'RCA analysis failed'); }
    finally { setBusy(false); }
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => { if (event.key === 'Enter') void analyze(); };
  const handleReport = (): void => { if (data) downloadRcaReport(buildRcaReport(data)); };
  const hasProblemId = problemId.length > 0;

  return <main className="rca-page"><div className="rca-shell">
    <header className="rca-topbar"><div><div className="rca-eyebrow">Dynatrace Davis + Assist</div><h1 className="rca-title">Root Cause &amp; Incident Intelligence</h1><p className="rca-subtitle">Evidence-backed incident analysis, recurrence intelligence and CIO-ready RCA reporting.</p></div><button className="rca-back" type="button" onClick={() => navigate('/')}>Back to overview</button></header>
    <section className="rca-input-card"><label className="rca-field"><span className="rca-label">Dynatrace Problem ID</span><input className="rca-input" value={problemId} onChange={handleInputChange} placeholder="e.g. P-260933994" onKeyDown={handleKeyDown} /></label><button className="rca-primary" type="button" disabled={busy || !hasProblemId} onClick={() => { void analyze(); }}>{busy ? 'Collecting evidence…' : 'Generate RCA'}</button></section>
    {error && <div className="rca-error">{error}</div>}
    {data && <section className="rca-result"><div className="rca-hero"><div className="rca-hero-kicker">AI-assisted incident analysis</div><div className="rca-hero-title">{facts?.title || 'Davis Problem ' + data.problemId}</div><div className="rca-hero-meta">{data.problemId} · Generated {dateText(data.generatedAt)}</div><div className="rca-actions"><button className="rca-action" type="button" onClick={() => setShowOccurrences(true)}>View {data.occurrenceCount} past occurrences</button><button className="rca-action" type="button" onClick={handleReport}>Download CIO-ready RCA</button><button className="rca-action" type="button" onClick={() => downloadRcaExcel(data)}>Export RCA Excel</button></div></div>
      <div className="rca-metrics">{[['Status',facts?.status || '—'],['Severity',facts?.severity || '—'],['Category',facts?.category || '—'],['Duration',facts?.duration || '—'],['Root-cause entity',data.nativeRootCauseEntity || 'Not proven'],['Management zone',scope]].map(([label,value]) => <div className="rca-metric" key={label}><div className="rca-metric-label">{label}</div><div className="rca-metric-value" title={value}>{value}</div></div>)}</div>
      <div className="rca-grid"><section className="rca-panel"><div className="rca-panel-head"><span className="rca-panel-title">AI-generated RCA</span><span className="rca-panel-note">Evidence-backed · Davis problem telemetry</span></div><div className="rca-analysis">{sections.map((section,index)=><article className="rca-section" key={section.title + index}><h2 className="rca-section-title">{section.title}</h2><div className="rca-section-body">{section.body}</div></article>)}</div></section><aside className="rca-panel"><div className="rca-panel-head"><span className="rca-panel-title">Incident facts</span><span className="rca-panel-note">Retrieved evidence</span></div><div className="rca-facts"><div className="rca-fact"><span>Started</span><strong>{facts?.start ? dateText(facts.start) : 'Not available'}</strong></div><div className="rca-fact"><span>Ended</span><strong>{facts?.end ? dateText(facts.end) : 'Not available'}</strong></div><div className="rca-fact"><span>Impact level</span><strong>{facts?.impactLevel || 'Not available'}</strong></div><div className="rca-fact"><span>Affected users</span><strong>{facts?.affectedUsers ?? 'Not available'}</strong></div><div className="rca-fact"><span>Affected entities</span><strong>{facts?.affectedEntities ?? 'Not available'}</strong></div><div className="rca-fact"><span>Recurrence window</span><strong>{data.recurrenceWindow || 'Last 30 days'}</strong></div><div className="rca-fact"><span>Historical records</span><strong>{data.occurrenceCount}</strong></div><div className="rca-fact"><span>Correlated events</span><strong>{data.evidenceSummary.correlatedEvents}</strong></div><div className="rca-fact"><span>Incident logs</span><strong>{data.evidenceSummary.incidentLogs}</strong></div><div className="rca-fact"><span>Timeline snapshots</span><strong>{data.evidenceSummary.timelineSnapshots}</strong></div></div></aside></div>
    </section>}
    {showOccurrences && data && <div className="rca-modal-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setShowOccurrences(false)}}><section className="rca-modal" role="dialog" aria-modal="true" aria-label="Past occurrences"><div className="rca-modal-head"><div><div className="rca-modal-title">Past occurrences · {data.occurrenceCount}</div><div className="rca-panel-note">{data.recurrenceWindow || 'Last 30 days'} · scope: {scope}</div></div><button className="rca-close" type="button" onClick={()=>setShowOccurrences(false)}>Close</button></div><div className="rca-modal-info">Showing {data.occurrences.length} retrieved records. The occurrence count is authoritative; the table is a returned sample.</div><div className="rca-table-wrap"><table className="rca-table"><thead><tr>{['Problem ID','Started','Title','Status','Severity','Duration'].map((h)=><th key={h}>{h}</th>)}</tr></thead><tbody>{data.occurrences.map((o)=><tr key={o.problemId}><td><strong>{o.problemId}</strong></td><td>{dateText(o.start)}</td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.duration}</td></tr>)}</tbody></table></div></section></div>}
  </div></main>;
}
