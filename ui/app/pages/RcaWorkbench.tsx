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
  evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number };
}

const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const download = (content: BlobPart, type: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function downloadRcaExcel(result: Result) {
  const rows = result.occurrences.map(o => `<tr><td>${esc(o.problemId)}</td><td>${esc(o.title)}</td><td>${esc(o.status)}</td><td>${esc(o.severity)}</td><td>${esc(o.start)}</td><td>${esc(o.end)}</td><td>${esc(o.duration)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="UTF-8"><style>body{font-family:Arial;font-size:10pt}h1{color:#173b70}table{border-collapse:collapse;width:100%}th{background:#183b63;color:#fff;border:1px solid #b8c2cc;padding:7px}td{border:1px solid #d7dde4;padding:6px;vertical-align:top}tr:nth-child(even){background:#f4f7fa}.analysis{white-space:pre-wrap}</style></head><body><h1>Axis Bank — AI-Assisted Incident RCA</h1><p><b>Problem:</b> ${esc(result.problemId)}<br><b>Native root cause:</b> ${esc(result.nativeRootCauseEntity || 'Not proven by available evidence')}<br><b>Past occurrences:</b> ${result.occurrenceCount}</p><h2>RCA</h2><div class="analysis">${esc(result.analysis)}</div><h2>Past Occurrences</h2><table><thead><tr><th>Problem ID</th><th>Title</th><th>Status</th><th>Severity</th><th>Started</th><th>Ended</th><th>Duration</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No occurrence rows returned.</td></tr>'}</tbody></table></body></html>`;
  download(`\uFEFF${html}`, 'application/vnd.ms-excel;charset=utf-8', `axis-rca-${result.problemId}-${new Date().toISOString().slice(0,10)}.xls`);
}

function downloadRcaPdf(result: Result) {
  const w = window.open('', '_blank', 'width=1100,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><title>Axis RCA ${esc(result.problemId)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172334;font-size:10.5px;line-height:1.5}h1{color:#173b70;font-size:22px}h2{color:#173b70;border-bottom:2px solid #d9e5f2;padding-bottom:4px;margin-top:20px}.hero{padding:18px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.card{padding:8px;border:1px solid #dce5ee;border-radius:7px}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700}.analysis{white-space:pre-wrap}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9}</style></head><body><div class="hero"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div>Problem ${esc(result.problemId)} · Generated ${esc(new Date(result.generatedAt).toLocaleString())}</div><div class="grid"><div class="card"><div class="label">Native root cause</div><div class="value">${esc(result.nativeRootCauseEntity || 'Not proven')}</div></div><div class="card"><div class="label">Past occurrences</div><div class="value">${result.occurrenceCount}</div></div><div class="card"><div class="label">Correlated events</div><div class="value">${result.evidenceSummary.correlatedEvents}</div></div><div class="card"><div class="label">Incident logs</div><div class="value">${result.evidenceSummary.incidentLogs}</div></div></div></div><h2>Root Cause Analysis</h2><div class="analysis">${esc(result.analysis)}</div><h2>Past Occurrences</h2><table><thead><tr><th>Problem</th><th>Title</th><th>Status</th><th>Severity</th><th>Start</th><th>Duration</th></tr></thead><tbody>${result.occurrences.slice(0,50).map(o=>`<tr><td>${esc(o.problemId)}</td><td>${esc(o.title)}</td><td>${esc(o.status)}</td><td>${esc(o.severity)}</td><td>${esc(o.start)}</td><td>${esc(o.duration)}</td></tr>`).join('') || '<tr><td colspan="6">No occurrence rows returned.</td></tr>'}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`);
  w.document.close();
}

export const RcaWorkbench = () => {
  const nav = useNavigate();
  const [problemId, setProblemId] = useState('');
  const [runId, setRunId] = useState('');
  const [showOccurrences, setShowOccurrences] = useState(false);
  const { data, isLoading, error } = useAppFunction<Result>({ name: 'analyzeProblemRca', data: { problemId: runId } }, { autoFetch: Boolean(runId), autoFetchOnUpdate: true });
  const run = () => { const id = problemId.trim().toUpperCase(); if (/^P-[A-Z0-9]+$/i.test(id)) setRunId(id); };
  const occurrenceRows = useMemo(() => data?.occurrences ?? [], [data]);
  return <Flex flexDirection="column" padding={24} gap={16}>
    <style>{`.rca-page{border:1px solid #dbe3ec;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(20,45,75,.08);overflow:hidden}.rca-hero{padding:22px 24px;background:linear-gradient(135deg,#eef7ff,#fff)}.rca-hero h2{margin:5px 0;font-size:25px}.rca-controls{display:flex;gap:10px;align-items:end;flex-wrap:wrap;padding:15px 24px;border-block:1px solid #e2e8ef;background:#f7f9fb}.rca-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700}.rca-controls input{height:38px;width:270px;border:1px solid #cbd6e1;border-radius:7px;padding:0 11px}.rca-btn{height:38px;border-radius:7px;padding:0 15px;font-weight:800;cursor:pointer}.rca-primary{background:#174a7e;color:#fff;border:0}.rca-secondary{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.rca-btn:disabled{opacity:.45;cursor:not-allowed}.rca-status{padding:9px 24px;font-size:11px;color:#63758a}.rca-body{padding:0 24px 24px}.rca-summary{display:grid;grid-template-columns:repeat(6,minmax(110px,1fr));gap:8px;margin:12px 0 18px}.rca-card{padding:10px 12px;border:1px solid #e0e7ee;border-radius:8px;background:#f9fbfd}.rca-card span{display:block;font-size:9px;color:#718197;text-transform:uppercase}.rca-card strong{display:block;margin-top:4px;font-size:13px;word-break:break-word}.rca-analysis{white-space:pre-wrap;font-size:12px;line-height:1.6;color:#24364a;border:1px solid #e2e8ef;border-radius:10px;padding:18px}.rca-notice{margin-top:10px;padding:9px 12px;background:#fff8e8;border-left:4px solid #d89b20;font-size:11px}.rca-error{padding:12px;border:1px solid #e5aaa5;background:#fff5f4;border-radius:8px;color:#9b241b}.rca-occ{color:#174a7e;text-decoration:underline;text-decoration-style:dotted;cursor:pointer;background:transparent;border:0;font-weight:800;padding:0}.rca-modal{position:fixed;inset:0;background:rgba(7,18,31,.58);z-index:10000;display:flex;align-items:center;justify-content:center}.rca-modal-card{width:min(1050px,94vw);max-height:88vh;background:#fff;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.28);overflow:auto;padding:20px}.rca-table{width:100%;border-collapse:collapse;font-size:11px}.rca-table th,.rca-table td{padding:8px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}.rca-table th{background:#edf3f8;position:sticky;top:0}.rca-close{float:right;border:0;background:#eef3f8;border-radius:7px;width:34px;height:34px;font-size:20px;cursor:pointer}@media(max-width:900px){.rca-summary{grid-template-columns:repeat(3,1fr)}}`}</style>
    <div className="rca-page">
      <div className="rca-hero"><div style={{fontSize:10,fontWeight:800,letterSpacing:'.14em',color:'#1476d4'}}>DYNATRACE DAVIS + ASSIST</div><h2>AI Root Cause &amp; RCA</h2><Paragraph>Enter a Davis Problem ID. The app retrieves problem details, causal events, timeline snapshots, incident logs and recurrence history before asking Dynatrace Assist to produce the RCA.</Paragraph></div>
      <div className="rca-controls"><label>Problem ID<input value={problemId} onChange={e=>setProblemId(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')run();}} placeholder="e.g. P-260929324" /></label><button className="rca-btn rca-primary" type="button" onClick={run} disabled={isLoading || !problemId.trim()}>{isLoading?'Analysing Davis evidence…':'Analyze with Assist'}</button><button className="rca-btn rca-secondary" type="button" onClick={()=>data&&downloadRcaPdf(data)} disabled={!data}>Download CIO-ready RCA PDF</button><button className="rca-btn rca-secondary" type="button" onClick={()=>data&&downloadRcaExcel(data)} disabled={!data}>Download Excel</button><button className="rca-btn rca-secondary" type="button" onClick={()=>nav('/')}>Back to Problems</button></div>
      <div className="rca-status">{isLoading ? `Collecting evidence for ${runId}…` : data ? `RCA generated ${new Date(data.generatedAt).toLocaleString()}` : 'Ready for a Davis Problem ID.'}</div>
      <div className="rca-body">
        {error&&<div className="rca-error">RCA could not be generated: {error.message}</div>}
        {data&&<>
          <div className="rca-summary"><div className="rca-card"><span>Problem</span><strong>{data.problemId}</strong></div><div className="rca-card"><span>Native root cause</span><strong>{data.nativeRootCauseEntity||'Not proven'}</strong></div><div className="rca-card"><span>Correlated events</span><strong>{data.evidenceSummary.correlatedEvents}</strong></div><div className="rca-card"><span>Incident logs</span><strong>{data.evidenceSummary.incidentLogs}</strong></div><div className="rca-card"><span>Timeline snapshots</span><strong>{data.evidenceSummary.timelineSnapshots}</strong></div><div className="rca-card"><span>Past occurrences</span><button className="rca-occ" type="button" onClick={()=>setShowOccurrences(true)}>{data.occurrenceCount}</button></div></div>
          <div className="rca-analysis">{data.analysis}</div>
          {data.assistFallback&&<div className="rca-notice">Dynatrace Assist was unavailable for this run. The displayed RCA is generated directly from the retrieved Davis evidence and does not assert an unverified root cause.</div>}
        </>}
      </div>
    </div>
    {showOccurrences&&data&&<div className="rca-modal" role="presentation" onClick={e=>{if(e.target===e.currentTarget)setShowOccurrences(false);}}><section className="rca-modal-card" role="dialog" aria-modal="true"><button className="rca-close" type="button" onClick={()=>setShowOccurrences(false)}>×</button><Heading>Past occurrences — {data.occurrenceCount}</Heading><Paragraph>Matching Davis problems for the same event name. Showing the latest {occurrenceRows.length} records returned for investigation.</Paragraph><table className="rca-table"><thead><tr><th>Problem</th><th>Title</th><th>Status</th><th>Severity</th><th>Started</th><th>Ended</th><th>Duration</th></tr></thead><tbody>{occurrenceRows.length?occurrenceRows.map((o,i)=><tr key={`${o.problemId}-${i}`}><td>{o.problemId}</td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.start}</td><td>{o.end||'—'}</td><td>{o.duration}</td></tr>):<tr><td colSpan={7}>No occurrence records returned.</td></tr>}</tbody></table></section></div>}
  </Flex>;
};
