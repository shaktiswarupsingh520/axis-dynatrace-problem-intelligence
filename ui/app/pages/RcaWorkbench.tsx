import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getCurrentUserDetails } from '@dynatrace-sdk/app-environment';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './RcaWorkbench.css';
import { buildCioRcaHtml, downloadCioRca, downloadCioRcaPdf } from './RcaWorkbenchReport';

type Occurrence = { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string };
type ProblemFacts = { title?: string; status?: string; severity?: string; category?: string; start?: string; end?: string; duration?: string; impactLevel?: string; affectedUsers?: string | number; affectedEntities?: string | number };
type Result = { problemId: string; nativeRootCauseEntity: string | null; nativeRootCauseEntityId?: string | null; nativeRootCauseEntityType?: string | null; definitiveRootCause?: boolean; analysis: string; assistAnalysis?: string; generatedAt: string; occurrenceCount: number; occurrences: Occurrence[]; managementZones?: string[]; recurrenceWindow?: string; evidenceSummary: { correlatedEvents: number; incidentLogs: number; historicalOccurrences: number; timelineSnapshots: number }; causalEvents?: Array<{ id: string; name: string; description: string; entityId: string; entityType: string }>; timelineSnapshots?: Array<Record<string, unknown>>; problemFacts?: ProblemFacts };
type JsonObject = Record<string, unknown>;

const asText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ');
  const json = JSON.stringify(value);
  return typeof json === 'string' ? json : '';
};
const durationText = (start?: string, end?: string, provided?: string): string => { const raw = asText(provided).trim(); if (raw && raw !== '-' && raw !== '—' && raw.toLowerCase() !== 'not available') return raw; if (!start || !end) return 'Not available'; const ms = new Date(end).getTime() - new Date(start).getTime(); if (!Number.isFinite(ms) || ms < 0) return 'Not available'; const minutes = Math.floor(ms / 60000); const seconds = Math.floor((ms % 60000) / 1000); if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`; return seconds ? `${minutes}m ${seconds}s` : `${minutes} min`; };
const parseAnalysis = (analysis: string): Array<{ title: string; body: string }> => {
  const lines = analysis.split(/\r?\n/); const sections: Array<{ title: string; body: string }> = []; let current: { title: string; body: string } | null = null;
  for (const line of lines) {
    const match = line.match(/^\s*(?:#{1,6}\s+|\d+\.\s+)(.+?)\s*$/);
    if (match) { if (current && current.body.trim()) sections.push({ title: current.title, body: current.body.trim() }); current = { title: (match[1] ?? '').replace(/[*_]/g, '').trim(), body: '' }; }
    else if (current) current.body += (current.body ? '\n' : '') + line;
  }
  if (current && current.body.trim()) sections.push({ title: current.title, body: current.body.trim() });
  return sections.length ? sections : [{ title: 'Davis Assist Analysis', body: analysis }];
};
const getSection = (sections: Array<{ title: string; body: string }>, name: string): string => sections.find((item) => item.title.toLowerCase().includes(name.toLowerCase()))?.body ?? '';
const confidence = (analysis: string): string => { const match = analysis.match(/confidence(?: level)?\s*[:-]\s*([A-Za-z]+(?:\s*\/\s*[A-Za-z]+)?(?:\s*\(\s*\d+%\s*\))?)/i); return match?.[1] ?? 'Evidence based'; };
const splitRecipients = (value: string): string[] => [...new Set(value.split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean))];
const buildEmailMessage = (result: Result, sections: Array<{ title: string; body: string }>, triggeredByName: string, triggeredByEmail: string): string => {
  const facts = result.problemFacts;
  const executive = sections.find((item) => item.title.toLowerCase().includes('executive summary'))?.body
    || 'Executive summary not available.';
  const rootAssessment = sections.find((item) => item.title.toLowerCase().includes('root cause assessment'))?.body
    || 'Root-cause assessment not available.';
  const impact = sections.find((item) => item.title.toLowerCase().includes('impact assessment'))?.body
    || 'Impact assessment not available.';
  const remediation = sections.find((item) => item.title.toLowerCase().includes('immediate remediation plan'))?.body
    || 'Immediate remediation plan not available.';
  const assist = result.assistAnalysis?.trim() || 'No AI-assisted analysis was returned for this RCA.';
  const rcaUrl = 'https://axis-prod.apps.dynatrace.com/ui/apps/my.axis.problem.intelligence/rca?problemId='
    + encodeURIComponent(result.problemId);
  return [
    '**AXIS BANK | DYNATRACE INCIDENT RCA**',
    '',
    `**Problem:** ${result.problemId}  `,
    `**Alert:** ${facts?.title || 'Dynatrace Problem'}  `,
    `**Status:** ${facts?.status || 'Not available'} | **Severity:** ${facts?.severity || 'Not available'}  `,
    `**Duration:** ${durationText(facts?.start, facts?.end, facts?.duration)}  `,
    `**Management Zone:** ${(result.managementZones ?? []).join(', ') || 'Not derived'}`,
    '',
    '**EXECUTIVE FINDING**',
    executive,
    '',
    '**ROOT CAUSE**',
    result.nativeRootCauseEntity || 'Not identified by Davis',
    rootAssessment,
    '',
    '**IMPACT**',
    impact,
    '',
    '**IMMEDIATE REMEDIATION**',
    remediation,
    '',
    '**RECURRENCE**',
    `${result.occurrenceCount} matching occurrences in the last 30 days.`,
    '',
    '**AI-ASSISTED ANALYSIS**',
    assist,
    '',
    `[Open full RCA and download the CIO-ready PDF](${rcaUrl})`,
    '',
    `Automation by: Shaktiswarup Pahantasingh`,
    `Triggered by: ${triggeredByEmail || 'Unknown user'}`
  ].join('\n');
};
const downloadExcel = (result: Result): void => {
  const cell = (value: unknown): string => '"' + asText(value).replace(/"/g, '""') + '"';
  const rows = [['Problem ID', 'Title', 'Status', 'Severity', 'Duration', 'Root Cause Entity', 'Management Zone', 'Past Occurrences'], [result.problemId, result.problemFacts?.title, result.problemFacts?.status, result.problemFacts?.severity, result.problemFacts?.duration, result.nativeRootCauseEntity ?? 'Not proven', (result.managementZones ?? []).join('; '), result.occurrenceCount], [], ['Problem ID', 'Title', 'Status', 'Severity', 'Duration'], ...result.occurrences.map((o) => [o.problemId, o.title, o.status, o.severity, o.duration])];
  const csv = '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([csv], { type: 'application/vnd.ms-excel;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Axis-RCA-' + result.problemId + '.xls'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function RcaWorkbench(): React.JSX.Element {
  const navigate = useNavigate(); const [searchParams] = useSearchParams(); const [problemId, setProblemId] = useState<string>(searchParams.get('problemId') ?? ''); const [data, setData] = useState<Result | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [showOccurrences, setShowOccurrences] = useState(false); const [activeSection, setActiveSection] = useState('Executive Summary'); const [showEmail, setShowEmail] = useState(false); const [emailTo, setEmailTo] = useState(''); const [emailCc, setEmailCc] = useState(''); const [emailBusy, setEmailBusy] = useState(false); const [emailError, setEmailError] = useState(''); const [emailSuccess, setEmailSuccess] = useState('');
  const currentUser = useMemo(() => { try { return getCurrentUserDetails(); } catch { return { name: 'Unknown user', email: '' }; } }, []);
  const currentUserName = currentUser.name || 'Unknown user';
  const currentUserEmail = currentUser.email || '';
  const sections = useMemo(() => data ? parseAnalysis(data.analysis) : [], [data]); const facts = data?.problemFacts; const scope = (data?.managementZones ?? []).join(', ') || 'Management zone not derived';
  const analyze = useCallback(async (requestedId: string): Promise<void> => {
    const id = asText(requestedId).trim(); if (!id) return;
    if (!/^P-\d+$/.test(id)) { setData(null); setError(`Invalid Dynatrace Problem ID: ${id}. Expected a value such as P-260948426.`); return; }
    setProblemId(id); setBusy(true); setError('');
    try {
      // IMPORTANT: use the already-proven problem-details execution path. The old
      // /api/analyzeProblemRca function duplicated the backend and was the source of
      // the HTTP 540 crash. getProblemDetails already retrieves native Davis evidence
      // and invokes the working Assist path used by the incident popup.
      const response = await fetch('/api/getProblemDetails', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problemId: id }) });
      const responseText = await response.text();
      if (!response.ok) throw new Error(`RCA request failed with HTTP ${String(response.status)}${responseText ? `: ${responseText.slice(0, 400)}` : ''}`);
      const raw: unknown = responseText ? JSON.parse(responseText) : null;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('RCA response was empty or invalid.');
      const source = raw as JsonObject;
      const analysis = asText(source.problemAnalysis && typeof source.problemAnalysis === 'object' ? (source.problemAnalysis as JsonObject).fullRca : '') || `## Executive Summary\n${asText(source.problemAnalysis && typeof source.problemAnalysis === 'object' ? (source.problemAnalysis as JsonObject).probableCause : '') || 'Davis evidence was retrieved successfully, but a full RCA response was not returned.'}\n\n## Root Cause Assessment\n${asText(source.problemAnalysis && typeof source.problemAnalysis === 'object' ? (source.problemAnalysis as JsonObject).probableCause : '') || 'Not proven by available evidence.'}\n\n## Impact Assessment\n${asText(source.problemAnalysis && typeof source.problemAnalysis === 'object' ? (source.problemAnalysis as JsonObject).impactSummary : '') || 'Not available.'}\n\n## Immediate Remediation Plan\n${asText(source.problemAnalysis && typeof source.problemAnalysis === 'object' ? (source.problemAnalysis as JsonObject).remediation : '') || 'Not available.'}\n\n## RCA Confidence & Evidence Gaps\n${asText(source.problemAnalysis && typeof source.problemAnalysis === 'object' ? (source.problemAnalysis as JsonObject).confidence : '') || 'Evidence based'}`;
      const pa = source.problemAnalysis && typeof source.problemAnalysis === 'object' ? source.problemAnalysis as JsonObject : {};
      const eventIds = Array.isArray(pa.eventIds) ? pa.eventIds : [];
      const causalEvents = Array.isArray(pa.causalEvents) ? pa.causalEvents : [];
      const sourceEvidence = source.evidenceSummary && typeof source.evidenceSummary === 'object' ? source.evidenceSummary as JsonObject : {};
      const sourceOccurrences = Array.isArray(source.occurrences) ? source.occurrences : [];
      const sourceZones = Array.isArray(source.managementZones) ? source.managementZones.map(asText).filter(Boolean) : [];
      const normalized: Result = {
        problemId: id,
        nativeRootCauseEntity: asText(source.nativeRootCauseEntity) || (asText(pa.rootCause) && !asText(pa.rootCause).toLowerCase().includes('no definitive') ? asText(pa.rootCause) : null),
        nativeRootCauseEntityId: asText(pa.rootCauseEntityId) || null,
        nativeRootCauseEntityType: asText(pa.rootCauseEntityType) || null,
        definitiveRootCause: Boolean(source.definitiveRootCause) || Boolean(asText(pa.rootCauseEntityId) || (asText(pa.rootCause) && !asText(pa.rootCause).toLowerCase().includes('no definitive'))),
        analysis,
        assistAnalysis: asText(source.assistAnalysis) || asText(pa.assistAnalysis),
        generatedAt: asText(source.generatedAt) || new Date().toISOString(),
        occurrenceCount: Number(source.occurrenceCount) || 0,
        occurrences: sourceOccurrences.map((item) => {
          const row = item && typeof item === 'object' ? item as JsonObject : {};
          return {
            problemId: asText(row.display_id) || asText(row.problemId),
            title: asText(row['event.name']) || asText(row.title),
            status: asText(row['event.status']) || asText(row.status),
            severity: asText(row['event.severity']) || asText(row.severity),
            start: asText(row['event.start']) || asText(row.start),
            end: asText(row['event.end']) || asText(row.end),
            duration: durationText(asText(row['event.start']) || asText(row.start), asText(row['event.end']) || asText(row.end), asText(row.duration)),
          };
        }),
        managementZones: sourceZones,
        recurrenceWindow: asText(source.recurrenceWindow) || '30d',
        evidenceSummary: {
          correlatedEvents: Number(sourceEvidence.correlatedEvents) || causalEvents.length || eventIds.length,
          incidentLogs: Number(sourceEvidence.incidentLogs) || 0,
          historicalOccurrences: Number(sourceEvidence.historicalOccurrences) || Number(source.occurrenceCount) || 0,
          timelineSnapshots: Number(sourceEvidence.timelineSnapshots) || 0,
        },
        causalEvents: causalEvents.map((item) => { const row = item && typeof item === 'object' ? item as JsonObject : {}; return { id: asText(row.id), name: asText(row.name), description: asText(row.description), entityId: asText(row.entityId), entityType: asText(row.entityType) }; }),
        timelineSnapshots: Array.isArray(pa.timelineSnapshots) ? pa.timelineSnapshots.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [],
        problemFacts: {
          title: asText(source.title) || asText(source['event.name']) || 'Dynatrace Problem',
          status: asText(source.status) || asText(source['event.status']) || 'Not available',
          severity: asText(source.severity)
            || asText(source.severityLevel)
            || asText(source['event.severity'])
            || asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).severity : '')
            || 'Not available',
          category: asText(source.category) || asText(source['event.category']) || '',
          start: asText(source.startTime)
            || asText(source['event.start'])
            || asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).start : ''),
          end: asText(source.endTime)
            || asText(source['event.end'])
            || asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).end : ''),
          duration: durationText(asText(source.startTime) || asText(source['event.start']) || asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).start : ''), asText(source.endTime) || asText(source['event.end']) || asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).end : ''), asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).duration : '') || asText(source.duration) || asText(source.resolved_problem_duration)),
          impactLevel: asText(source.impactLevel) || asText(source['dt.davis.impact_level']),
          affectedUsers: asText(pa.affectedUsers) || asText(source.affectedUsers),
          affectedEntities: asText(source.problemFacts && typeof source.problemFacts === 'object' ? (source.problemFacts as JsonObject).affectedEntities : '') || asText(source.affectedEntities),
        }
      };
      setData(normalized); setActiveSection('Executive Summary');
    } catch (cause: unknown) { setData(null); setError(cause instanceof Error ? cause.message : 'RCA analysis failed'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const requested = searchParams.get('problemId') ?? ''; if (requested && requested !== data?.problemId) void analyze(requested); }, [searchParams, data?.problemId, analyze]);
  const emailSubject = data ? `Dynatrace RCA | ${data.problemId} | ${facts?.title || 'Incident'}` : '';
  const openEmail = () => { setEmailError(''); setEmailSuccess(''); setEmailTo(''); setEmailCc(''); setShowEmail(true); };
  const sendEmail = async () => {
    if (!data) return;
    const to = splitRecipients(emailTo); const cc = splitRecipients(emailCc);
    if (!to.length) { setEmailError('Enter at least one To email address.'); return; }
    setEmailBusy(true); setEmailError(''); setEmailSuccess('');
    try {
      const message = buildEmailMessage(data, sections, currentUserName, currentUserEmail);
      const response = await fetch('/api/sendRcaEmail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to, cc, subject: emailSubject, message }) });
      const body = await response.text();
      let parsed: unknown = null;
      try { parsed = body ? JSON.parse(body) : null; } catch { /* keep raw response */ }
      if (!response.ok) throw new Error(body || `Email RCA failed with HTTP ${response.status}`);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as JsonObject).accepted === false) {
        throw new Error(asText((parsed as JsonObject).error) || 'Dynatrace workflow rejected the RCA email request.');
      }
      setEmailSuccess('RCA email accepted by Dynatrace workflow.');
    } catch (cause: unknown) {
      setEmailError(cause instanceof Error ? cause.message : 'Unable to send RCA email.');
    } finally { setEmailBusy(false); }
  };
  const rootCause = data?.nativeRootCauseEntity || 'Not identified by Davis'; const rootCauseState = data?.nativeRootCauseEntity ? 'Davis identified a root-cause entity' : 'Davis did not expose a definitive root-cause entity'; const executive = getSection(sections, 'Executive Summary') || 'Generate an RCA to retrieve the evidence-backed executive summary.'; const rootAssessment = getSection(sections, 'Root Cause Assessment'); const impact = getSection(sections, 'Impact Assessment');
  return <main className="rca-page"><div className="rca-shell">
    <header className="rca-header"><div><div className="rca-brand">AXIS BANK <span>•</span> DYNATRACE OPERATIONS</div><div className="rca-eyebrow">Davis Intelligence Workspace</div><h1>Incident Root Cause Analysis</h1><p>Turn a Dynatrace Problem into an evidence-backed RCA, recurrence view and CIO-ready report.</p></div><div className="rca-header-actions"><button type="button" className="rca-secondary" onClick={() => navigate('/')}>← Problem Intelligence</button>{data && <><button type="button" className="rca-pdf" onClick={() => downloadCioRcaPdf(data)}>↓ Download CIO-ready PDF</button><button type="button" className="rca-email" onClick={openEmail}>✉ Email RCA Report</button></>}</div></header>
    <section className="rca-search"><div><label htmlFor="problem-id">Dynatrace Problem ID</label><input id="problem-id" value={problemId} onChange={(event) => setProblemId(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void analyze(problemId); }} placeholder="P-260931557" /></div><button type="button" className="rca-generate" disabled={busy || !asText(problemId).trim()} onClick={() => { void analyze(problemId); }}>{busy ? 'Analysing Davis evidence…' : 'Generate RCA'}</button><div className="rca-search-hint">Evidence sources: native Davis problem + bounded live telemetry · recurrence: <b>30d</b></div></section>
    {error && <div className="rca-error">{error}</div>}{!data && !busy && !error && <section className="rca-empty"><div className="rca-empty-icon">✦</div><h2>Start with a Dynatrace Problem</h2><p>Enter a Problem ID to retrieve Davis root-cause evidence, incident timeline, recurrence patterns, impact and remediation actions.</p></section>}{busy && <section className="rca-loading"><div className="rca-spinner"/><div><strong>Building incident intelligence</strong><p>Using the proven Incident Intelligence Davis evidence path…</p></div></section>}
    {data && !busy && <><section className="rca-hero"><div className="rca-hero-main"><div className="rca-status">{String(facts?.status ?? 'UNKNOWN').toUpperCase()} <span>•</span> SEVERITY {facts?.severity ?? '—'}</div><h2>{facts?.title || 'Dynatrace Problem ' + data.problemId}</h2><div className="rca-problem-id">{data.problemId}</div><div className="rca-hero-summary">{executive.split('\n').slice(0, 5).join(' ')}</div></div><div className="rca-hero-score"><div className="rca-score-label">RCA CONFIDENCE</div><div className="rca-score-value">{confidence(data.analysis)}</div><div className="rca-score-note">Based on retrieved Davis evidence</div></div></section>
      <section className="rca-kpis"><div className="rca-kpi"><span>ROOT CAUSE</span><strong className={data.nativeRootCauseEntity ? 'positive' : 'neutral'}>{rootCause}</strong><small>{data.nativeRootCauseEntityId ? `Davis identified · ${data.nativeRootCauseEntityId}` : rootCauseState}</small></div><div className="rca-kpi"><span>RECURRENCE</span><strong>{data.occurrenceCount.toLocaleString()}</strong><small>matching occurrences · last 30d</small></div><div className="rca-kpi"><span>MANAGEMENT ZONE</span><strong>{scope}</strong><small>retrieved problem scope</small></div><div className="rca-kpi"><span>EVIDENCE</span><strong>{data.evidenceSummary.correlatedEvents + data.evidenceSummary.incidentLogs + data.evidenceSummary.timelineSnapshots}</strong><small>{data.evidenceSummary.correlatedEvents} events · {data.evidenceSummary.incidentLogs} logs · {data.evidenceSummary.timelineSnapshots} snapshots</small></div></section>
      <section className="rca-insight-grid"><article className="rca-insight rca-insight-primary"><div className="rca-card-kicker">PRIMARY FINDING</div><h3>{rootCauseState}</h3><p>{rootAssessment || executive}</p></article><article className="rca-insight"><div className="rca-card-kicker">IMPACT</div><h3>{facts?.impactLevel || 'Not available'}</h3><p>{impact || 'Impact assessment is contained in the generated RCA.'}</p></article><article className="rca-insight"><div className="rca-card-kicker">DURATION</div><h3>{durationText(facts?.start, facts?.end, facts?.duration)}</h3><p>Observed problem duration derived from the retrieved problem facts.</p></article></section>
      <section className="rca-workspace"><aside className="rca-nav"><div className="rca-nav-title">RCA REPORT</div>{sections.map((item, index) => <button type="button" key={item.title + index} className={activeSection === item.title ? 'active' : ''} onClick={() => setActiveSection(item.title)}><span>{String(index + 1).padStart(2, '0')}</span>{item.title}</button>)}<div className="rca-nav-divider"/><button type="button" className="rca-occurrence-link" onClick={() => setShowOccurrences(true)}>↗ View {data.occurrenceCount.toLocaleString()} past occurrences</button></aside><article className="rca-report-panel"><div className="rca-report-head"><div><div className="rca-card-kicker">EVIDENCE-FIRST RCA</div><h3>{activeSection}</h3></div><div className="rca-report-actions"><button type="button" onClick={() => downloadCioRcaPdf(data)}>PDF</button><button type="button" onClick={() => downloadCioRca(buildCioRcaHtml(data))}>HTML</button><button type="button" onClick={() => downloadExcel(data)}>Excel</button></div></div><div className="rca-report-body">{(getSection(sections, activeSection) || 'Not available from retrieved evidence.').split('\n').map((line, index) => <p key={index}>{line || ' '}</p>)}</div></article></section></>}
      {data && !busy && data.assistAnalysis && <section className="rca-assist-panel"><div className="rca-card-kicker">DYNATRACE ASSIST · NON-AUTHORITATIVE</div><h3>Assist interpretation & proposed actions</h3><p>Assist is used only as a writing/recommendation layer. Root cause, metrics, timestamps, recurrence and impact shown above come from retrieved Dynatrace evidence.</p><div className="rca-assist-body">{data.assistAnalysis.split(/\r?\n/).map((line, index) => <p key={index}>{line || ' '}</p>)}</div></section>}
    {showEmail && data && <div className="rca-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !emailBusy) setShowEmail(false); }}><section className="rca-modal rca-email-modal" role="dialog" aria-modal="true" aria-label="Email RCA report"><header><div><div className="rca-card-kicker">RCA DELIVERY</div><h3>Email RCA Report</h3><p>Send the current RCA and Dynatrace Assist analysis by email.</p></div><button type="button" onClick={() => setShowEmail(false)} disabled={emailBusy}>Close</button></header><div className="rca-email-form"><label>To<input value={emailTo} onChange={(event) => setEmailTo(event.target.value)} placeholder="user@axisbank.com, owner@axisbank.com" disabled={emailBusy} /></label><div className="rca-email-help">Separate multiple recipients with commas or semicolons. Maximum 10 To recipients.</div><label>Cc<input value={emailCc} onChange={(event) => setEmailCc(event.target.value)} placeholder="manager@axisbank.com" disabled={emailBusy} /></label><div className="rca-email-help">Cc is optional. Maximum 10 Cc recipients.</div><label>Subject<input value={emailSubject} readOnly /></label><label>Message<textarea value={buildEmailMessage(data, sections, currentUserName, currentUserEmail)} readOnly rows={12} /></label>{emailError && <div className="rca-email-error">{emailError}</div>}{emailSuccess && <div className="rca-email-success">{emailSuccess}</div>}<div className="rca-email-actions"><button type="button" className="rca-secondary" onClick={() => setShowEmail(false)} disabled={emailBusy}>Cancel</button><button type="button" className="rca-pdf" onClick={() => void sendEmail()} disabled={emailBusy}>{emailBusy ? 'Sending RCA…' : 'Send RCA'}</button></div></div></section></div>}
    {showOccurrences && data && <div className="rca-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowOccurrences(false); }}><section className="rca-modal" role="dialog" aria-modal="true" aria-label="Past occurrences"><header><div><div className="rca-card-kicker">RECURRENCE INTELLIGENCE</div><h3>{data.occurrenceCount.toLocaleString()} Past Occurrences</h3><p>{data.recurrenceWindow || '30d'} · {scope}</p></div><button type="button" onClick={() => setShowOccurrences(false)}>Close</button></header><div className="rca-modal-note">Returned occurrence detail from the proven Incident Intelligence path.</div><div className="rca-table-wrap"><table><thead><tr><th>Problem</th><th>Title</th><th>Status</th><th>Severity</th><th>Duration</th></tr></thead><tbody>{data.occurrences.map((o) => <tr key={o.problemId}><td><b>{o.problemId}</b></td><td>{o.title}</td><td>{o.status}</td><td>{o.severity}</td><td>{o.duration}</td></tr>)}</tbody></table></div></section></div>}
  </div></main>;
}
