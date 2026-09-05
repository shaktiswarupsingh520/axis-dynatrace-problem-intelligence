import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import './RcaWorkbench.css';

type Occurrence = { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string };
type ProblemFacts = { title?: string; status?: string; severity?: string; category?: string; start?: string; end?: string; duration?: string; impactLevel?: string; affectedUsers?: string | number; affectedEntities?: string | number };
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
  problemFacts?: ProblemFacts;
};

type AnalysisSection = { title: string; body: string };

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

const parseAnalysis = (analysis: string): AnalysisSection[] => {
  const lines = analysis.split(/\r?\n/);
  const sections: AnalysisSection[] = [];
  let current: AnalysisSection | null = null;
  lines.forEach((line) => {
    const match = line.match(/^\s*#{1,6}\s+(.+?)\s*$/);
    if (match) {
      if (current) sections.push({ title: current.title, body: current.body.trim() });
      current = { title: match[1].replace(/[*_]/g, '').trim(), body: '' };
    } else if (current) {
      current.body += (current.body ? '\n' : '') + line;
    }
  });
  if (current) sections.push({ title: current.title, body: current.body.trim() });
  return sections.length ? sections.filter((section) => section.body) : [{ title: 'Davis Assist Analysis', body: analysis }];
};

const reportText = (result: Result): string => [
  'AXIS BANK — AI-ASSISTED INCIDENT ROOT CAUSE ANALYSIS',
  'Problem ID: ' + result.problemId,
  'Native root-cause entity: ' + (result.nativeRootCauseEntity || 'Not proven'),
  'Recurrence scope: ' + (result.recurrenceWindow || 'Last 30 days'),
  'Management zone: ' + ((result.managementZones ?? []).join(', ') || 'Not derived'),
  'Past occurrences: ' + result.occurrenceCount,
  '', result.analysis,
].join('\n');

const printRca = (result: Result): void => {
  const popup = window.open('', '_blank', 'width=1100,height=900');
  if (!popup) return;
  popup.document.title = 'Axis CIO RCA ' + result.problemId;
  const pre = popup.document.createElement('pre');
  pre.style.whiteSpace = 'pre-wrap'; pre.style.fontFamily = 'Arial, sans-serif'; pre.style.fontSize = '11px'; pre.style.lineHeight = '1.45'; pre.style.margin = '24px';
  pre.textContent = reportText(result);
  popup.document.body.appendChild(pre);
  window.setTimeout(() => { popup.focus(); popup.print(); }, 300);
};

export function RcaWorkbench(): React.JSX.Element {
  const navigate = useNavigate();
  const [problemId, setProblemId] = useState('');
  const [data, setData] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showOccurrences, setShowOccurrences] = useState(false);

  const sections = useMemo(() => data ? parseAnalysis(data.analysis) : [], [data]);
  const facts = data?.problemFacts;
  const scope = (data?.managementZones ?? []).join(', ') || 'Management zone not derived';

  const analyze = async (): Promise<void> => {
    if (!problemId.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/analyzeProblemRca', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problemId: problemId.trim() }) });
      if (!response.ok) throw new Error('RCA request failed with HTTP ' + response.status);
      setData(await response.json() as Result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'RCA analysis failed');
    } finally { setBusy(false); }
  };

  return <main className="rca-page">
    <div className="rca-shell">
      <header className="rca-topbar">
        <div>
          <div className="rca-eyebrow">Dynatrace Davis + Assist</div>
          <h1 className="rca-title">Root Cause &amp; Incident Intelligence</h1>
          <p className="rca-subtitle">Evidence-backed incident analysis, recurrence intelligence and CIO-ready RCA reporting.</p>
        </div>
        <button className="rca-back" type="button" onClick={() => navigate('/')}>Back to overview</button>
      </header>

      <section className="rca-input-card">
        <label className="rca-field"><span className="rca-label">Dynatrace Problem ID</span><input className="rca-input" value={problemId} onChange={(e) => setProblemId(e.target.value)} placeholder="e.g. P-260933994" onKeyDown={(e) => { if (e.key === 'Enter') void analyze(); }} /></label>
        <button className="rca-primary" type="button" disabled={busy || !problemId.trim()} onClick={() => { void analyze(); }}>{busy ? 'Collecting evidence…' : 'Generate RCA'}</button>
      </section>
      {error && <div className="rca-error">{error}</div>}

      {data && <section className="rca-result">
        <div className="rca-hero">
          <div className="rca-hero-kicker">AI-assisted incident analysis</div>
          <div className="rca-hero-title">{facts?.title || 'Davis Problem ' + data.problemId}</div>
          <div className="rca-hero-meta">{data.problemId} · Generated {dateText(data.generatedAt)}</div>
          <div className="rca-actions">
            <button className="rca-action" type="button" onClick={() => setShowOccurrences(true)}>View {data.occurrenceCount} past occurrences</button>
            <button className="rca-action" type="button" onClick={() => printRca(data)}>Print / Save CIO RCA</button>
            <button className="rca-action" type="button" onClick={() => downloadRcaExcel(data)}>Export RCA Excel</button>
          </div>
        </div>

        <div className="rca-metrics">
          {[
            ['Status', facts?.status || '—'], ['Severity', facts?.severity || '—'], ['Category', facts?.category || '—'],
            ['Duration', facts?.duration || '—'], ['Root-cause entity', data.nativeRootCauseEntity || 'Not proven'], ['Management zone', scope],
          ].map(([label, value]) => <div className="rca-metric" key={label}><div className="rca-metric-label">{label}</div><div className="rca-metric-value" title={value}>{value}</div></div>)}
        </div>

        <div className="rca-grid">
          <section className="rca-panel">
            <div className="rca-panel-head"><span className="rca-panel-title">AI-generated RCA</span><span className="rca-panel-note">Evidence-backed · Davis problem telemetry</span></div>
            <div className="rca-analysis">{sections.map((section, index) => <article className="rca-section" key={section.title + index}><h2 className="rca-section-title">{section.title}</h2><div className="rca-section-body">{section.body}</div></article>)}</div>
          </section>
          <aside className="rca-panel">
            <div className="rca-panel-head"><span className="rca-panel-title">Incident facts</span><span className="rca-panel-note">Retrieved evidence</span></div>
            <div className="rca-facts">
              <div className="rca-fact"><span>Started</span><strong>{facts?.start ? dateText(facts.start) : 'Not available'}</strong></div>
              <div className="rca-fact"><span>Ended</span><strong>{facts?.end ? dateText(facts.end) : 'Not available'}</strong></div>
              <div className="rca-fact"><span>Impact level</span><strong>{facts?.impactLevel || 'Not available'}</strong></div>
              <div className="rca-fact"><span>Affected users</span><strong>{facts?.affectedUsers ?? 'Not available'}</strong></div>
              <div className="rca-fact"><span>Affected entities</span><strong>{facts?.affectedEntities ?? 'Not available'}</strong></div>
              <div className="rca-fact"><span>Recurrence window</span><strong>{data.recurrenceWindow || 'Last 30 days'}</strong></div>
              <div className="rca-fact"><span>Historical records</span><strong>{data.occurrenceCount}</strong></div>
              <div className="rca-fact"><span>Correlated events</span><strong>{data.evidenceSummary.correlatedEvents}</strong></div>
              <div className="rca-fact"><span>Incident logs</span><strong>{data.evidenceSummary.incidentLogs}</strong></div>
              <div className="rca-fact"><span>Timeline snapshots</span><strong>{data.evidenceSummary.timelineSnapshots}</strong></div>
            </div>
          </aside>
        </div>
      </section>}

      {showOccurrences && data && <div className="rca-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowOccurrences(false); }}>
        <section className="rca-modal" role="dialog" aria-modal="true" aria-label="Past occurrences">
          <div className="rca-modal-head"><div><div className="rca-modal-title">Past occurrences · {data.occurrenceCount}</div><div className="rca-panel-note">{data.recurrenceWindow || 'Last 30 days'} · scope: {scope}</div></div><button className="rca-close" type="button" onClick={() => setShowOccurrences(false)}>Close</button></div>
          <div className="rca-modal-info">Showing {data.occurrences.length} retrieved records. The occurrence count is authoritative; the table is a returned sample.</div>
          <div className="rca-table-wrap"><table className="rca-table"><thead><tr>{['Problem ID','Started','Title','Status','Severity','Duration'].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{data.occurrences.map((o) => <tr key={o.problemId}><td><strong>{o.problemId}</strong></td><td>{dateText(o.start)}</td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.duration}</td></tr>)}</tbody></table></div>
        </section>
      </div>}
    </div>
  </main>;
}
