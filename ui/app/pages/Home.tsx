import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import type { Problem, ProblemsResponse } from '../types/problems';

const formatTimestamp = (timestamp?: number) => {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(timestamp));
};

const formatDuration = (start?: number, end?: number) => {
  if (!start) return '-';
  const durationMs = Math.max(0, (end && end > 0 ? end : Date.now()) - start);
  const minutes = Math.floor(durationMs / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const upper = (value?: string) => (value ?? '').toUpperCase();

// Voice buzz is intentionally short: title only. IDs, RCA and remediation stay on screen.
const getVoiceText = (problem: Problem) => `Attention. New Dynatrace alert. ${problem.title || 'New problem alert'}.`;

const speakProblem = (problem: Problem) => {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(getVoiceText(problem));
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
};

export const Home = () => {
  const [selectedMz, setSelectedMz] = useState('ALL');
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const knownProblemIds = useRef(new Set<string>());
  const initialised = useRef(false);
  const pendingVoiceProblemId = useRef<string | null>(null);

  const requestData = useMemo(() => ({
    from: 'now-24h',
    to: 'now',
    pageSize: 100,
    ...(selectedMz !== 'ALL' ? { managementZoneId: selectedMz } : {}),
  }), [selectedMz]);

  const { data, isLoading, error, refetch } = useAppFunction<ProblemsResponse>({ name: 'getProblems', data: requestData });

  const problems = useMemo(
    () => [...(data?.problems ?? [])].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0)),
    [data],
  );

  const zones = useMemo(() => {
    const map = new Map<string, string>();
    for (const problem of problems) {
      for (const zone of problem.managementZones ?? []) {
        if (zone.id) map.set(zone.id, zone.name ?? zone.id);
      }
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [problems]);

  const openProblems = useMemo(() => problems.filter((problem) => upper(problem.status) === 'OPEN'), [problems]);
  const criticalHigh = useMemo(
    () => openProblems.filter((problem) => ['CRITICAL', 'HIGH'].includes(upper(problem.severityLevel))),
    [openProblems],
  );
  const aging = useMemo(
    () => openProblems.filter((problem) => Boolean(problem.startTime) && Date.now() - (problem.startTime ?? 0) > 4 * 60 * 60 * 1000),
    [openProblems],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refetch();
      setLastRefresh(Date.now());
    }, 30000);
    return () => window.clearInterval(timer);
  }, [refetch]);

  useEffect(() => {
    if (!problems.length) return;
    if (!initialised.current) {
      problems.forEach((problem) => {
        if (problem.problemId) knownProblemIds.current.add(problem.problemId);
      });
      initialised.current = true;
      return;
    }

    const fresh = problems.find(
      (problem) => Boolean(problem.problemId) && !knownProblemIds.current.has(problem.problemId as string) && upper(problem.status) === 'OPEN',
    );
    problems.forEach((problem) => {
      if (problem.problemId) knownProblemIds.current.add(problem.problemId);
    });

    if (fresh?.problemId) {
      pendingVoiceProblemId.current = fresh.problemId;
      setSelectedProblem(fresh);
    }
  }, [problems]);

  const detailQuery = useAppFunction<Problem>(
    { name: 'getProblemDetails', data: selectedProblem?.problemId ? { problemId: selectedProblem.problemId } : undefined },
    { autoFetch: Boolean(selectedProblem?.problemId), autoFetchOnUpdate: Boolean(selectedProblem?.problemId) },
  );
  const detail = detailQuery.data ?? selectedProblem;

  useEffect(() => {
    if (!voiceEnabled || !detail?.problemId) return;
    if (pendingVoiceProblemId.current !== detail.problemId) return;
    speakProblem(detail);
    pendingVoiceProblemId.current = null;
  }, [detail, voiceEnabled]);

  const refresh = useCallback(() => {
    void refetch();
    setLastRefresh(Date.now());
  }, [refetch]);

  const enableVoice = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance('Dynatrace voice buzz enabled. New alert titles will be announced.'));
    setVoiceEnabled(true);
  };

  const disableVoice = () => {
    setVoiceEnabled(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  const analysis = detail?.problemAnalysis;
  const impacts = detail?.impactAnalysis?.impacts ?? [];
  const comments = detail?.recentComments?.comments ?? [];

  return (
    <Flex flexDirection="column" padding={24} gap={20}>
      <style>{`
        .pi-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pi-toolbar button,.pi-toolbar select{padding:8px 12px;border:1px solid #bbb;border-radius:6px;background:inherit}
        .pi-kpis{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px}.pi-kpi{padding:16px;border:1px solid #ddd;border-radius:10px}.pi-value{font-size:26px;font-weight:700;margin-top:4px}
        .pi-table-wrap{overflow:auto;border:1px solid #ddd;border-radius:10px}.pi-table{width:100%;border-collapse:collapse;min-width:1200px}.pi-table th,.pi-table td{padding:11px 12px;border-bottom:1px solid #ddd;text-align:left;white-space:nowrap}.pi-table th{position:sticky;top:0;font-weight:700;background:var(--dt-colors-surface-primary,#fff);z-index:1}.pi-row{cursor:pointer}.pi-row:hover{background:rgba(127,127,127,.08)}
        .pi-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;animation:piFade .18s ease-out}.pi-modal{width:min(900px,94vw);max-height:90vh;overflow:auto;background:var(--dt-colors-surface-primary,#fff);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.35);animation:piPop .3s cubic-bezier(.2,.8,.2,1)}
        .pi-head{padding:20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;gap:20px}.pi-body{padding:20px}.pi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pi-card{padding:14px;border:1px solid #ddd;border-radius:10px}.pi-label{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.05em}.pi-detail{margin-top:6px;font-weight:600;word-break:break-word}
        .pi-close{border:0;background:transparent;font-size:22px;cursor:pointer}.pi-alert{padding:15px;border:1px solid #ddd;border-radius:10px;margin-bottom:16px}.pi-section{margin-top:20px}.pi-section-title{font-weight:700;margin-bottom:8px}.pi-section-box{padding:14px;border:1px solid #ddd;border-radius:10px;line-height:1.55}.pi-section-box ul{margin:8px 0 0 20px}.pi-section-box li{margin:7px 0}.pi-badge{display:inline-block;padding:4px 8px;border-radius:999px;border:1px solid #bbb;font-size:11px;font-weight:700}.pi-error{padding:12px;border:1px solid #d44;border-radius:8px}
        @keyframes piPop{from{opacity:0;transform:translateY(24px) scale(.95)}to{opacity:1;transform:none}}@keyframes piFade{from{opacity:0}to{opacity:1}}@media(max-width:900px){.pi-kpis,.pi-grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.pi-kpis,.pi-grid{grid-template-columns:1fr}}
      `}</style>

      <Flex flexDirection="column" gap={4}>
        <Heading>Axis Problem Intelligence</Heading>
        <Paragraph>Live Dynatrace problems, management-zone filtering, Davis evidence and voice-driven RCA.</Paragraph>
      </Flex>

      <div className="pi-toolbar">
        <label htmlFor="pi-mz">Management Zone</label>
        <select id="pi-mz" value={selectedMz} onChange={(event) => setSelectedMz(event.target.value)}><option value="ALL">All Management Zones</option>{zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button type="button" onClick={refresh} disabled={isLoading}>↻ Refresh</button>
        {!voiceEnabled ? <button type="button" onClick={enableVoice}>🔇 Enable Voice Buzz</button> : <button type="button" onClick={disableVoice}>🔊 Voice Buzz ON</button>}
        <span>Updated {new Date(lastRefresh).toLocaleTimeString()}</span>
      </div>

      {error && <div className="pi-error"><Paragraph>Unable to load Dynatrace problems. {error.message}</Paragraph></div>}

      <div className="pi-kpis"><div className="pi-kpi">Matched Problems<div className="pi-value">{data?.totalCount ?? 0}</div></div><div className="pi-kpi">Open Problems<div className="pi-value">{openProblems.length}</div></div><div className="pi-kpi">Critical / High<div className="pi-value">{criticalHigh.length}</div></div><div className="pi-kpi">Aging &gt; 4h<div className="pi-value">{aging.length}</div></div></div>

      <div className="pi-table-wrap"><table className="pi-table"><thead><tr><th>Started</th><th>Problem</th><th>Title</th><th>Severity</th><th>Impact</th><th>Status</th><th>Age</th><th>Management Zones</th></tr></thead><tbody>
        {isLoading && !problems.length ? <tr><td colSpan={8}>Loading live problems…</td></tr> : problems.length === 0 ? <tr><td colSpan={8}>No problems found for the selected management zone.</td></tr> : problems.map((problem) => <tr key={problem.problemId ?? problem.displayId} className="pi-row" onClick={() => setSelectedProblem(problem)}><td>{formatTimestamp(problem.startTime)}</td><td>{problem.displayId ?? problem.problemId ?? '-'}</td><td>{problem.title ?? '-'}</td><td>{problem.severityLevel ?? '-'}</td><td>{problem.impactLevel ?? '-'}</td><td>{problem.status ?? '-'}</td><td>{formatDuration(problem.startTime, problem.endTime)}</td><td>{(problem.managementZones ?? []).map((zone) => zone.name).filter(Boolean).join(', ') || '-'}</td></tr>)}
      </tbody></table></div>

      {selectedProblem && detail && <div className="pi-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedProblem(null); }}><section className="pi-modal" role="dialog" aria-modal="true" aria-label="Dynatrace problem RCA details">
        <div className="pi-head"><div><Heading>{detail.displayId ?? detail.problemId ?? 'Dynatrace Problem'}</Heading><Paragraph>{detail.title ?? 'New Dynatrace problem received'}</Paragraph></div><button className="pi-close" type="button" onClick={() => setSelectedProblem(null)} aria-label="Close">✕</button></div>
        <div className="pi-body">
          <div className="pi-alert"><strong>🚨 New problem alert</strong><Paragraph>{analysis?.description ?? detail.title ?? 'Loading Davis diagnostic description…'}</Paragraph><span className="pi-badge">Davis evidence analysis</span></div>
          <div className="pi-grid"><div className="pi-card"><div className="pi-label">Severity</div><div className="pi-detail">{detail.severityLevel ?? '-'}</div></div><div className="pi-card"><div className="pi-label">Impact</div><div className="pi-detail">{detail.impactLevel ?? '-'}</div></div><div className="pi-card"><div className="pi-label">Status</div><div className="pi-detail">{detail.status ?? '-'}</div></div><div className="pi-card"><div className="pi-label">Started</div><div className="pi-detail">{formatTimestamp(detail.startTime)}</div></div><div className="pi-card"><div className="pi-label">Age</div><div className="pi-detail">{formatDuration(detail.startTime, detail.endTime)}</div></div><div className="pi-card"><div className="pi-label">Root Cause Entity</div><div className="pi-detail">{analysis?.rootCause ?? detail.rootCauseEntity?.name ?? '-'}</div></div></div>

          <div className="pi-section"><div className="pi-section-title">🧠 RCA / probable root cause</div><div className="pi-section-box"><strong>{analysis?.probableCause ?? 'Davis analysis is loading…'}</strong>{analysis?.confidence && <Paragraph>Analysis confidence: {analysis.confidence}</Paragraph>}</div></div>
          <div className="pi-section"><div className="pi-section-title">📋 Impact assessment</div><div className="pi-section-box">{analysis?.impactSummary ?? `Impact level: ${detail.impactLevel ?? 'not provided'}.`}{impacts.length > 0 && <ul>{impacts.slice(0, 10).map((impact, index) => <li key={`${impact.impactType ?? 'impact'}-${index}`}>{impact.impactType ?? 'Impact'}{impact.impactedEntity?.name ? ` — ${impact.impactedEntity.name}` : ''}{impact.estimatedAffectedUsers ? ` — ${impact.estimatedAffectedUsers} affected users` : ''}{impact.numberOfPotentiallyAffectedServiceCalls ? ` — ${impact.numberOfPotentiallyAffectedServiceCalls} potentially affected service calls` : ''}</li>)}</ul>}</div></div>
          <div className="pi-section"><div className="pi-section-title">🛠 Recommended remediation</div><div className="pi-section-box">{analysis?.remediation ?? 'Review the correlated Dynatrace evidence and root-cause entity before taking action.'}</div></div>
          <div className="pi-section"><div className="pi-section-title">🔎 Davis evidence / alert description</div><div className="pi-section-box">{detailQuery.isLoading ? <Paragraph>Loading diagnostic evidence…</Paragraph> : <ul>{(detail.evidenceDetails?.details ?? []).slice(0, 15).map((evidence, index) => <li key={`${evidence.displayName ?? 'evidence'}-${index}`}><strong>{evidence.displayName ?? evidence.evidenceType ?? 'Evidence'}</strong>{evidence.entity?.name ? ` — ${evidence.entity.name}` : ''}{evidence.rootCauseRelevant ? ' — root-cause relevant' : ''}</li>)}{!detail.evidenceDetails?.details?.length && <li>No detailed evidence was returned for this problem.</li>}</ul>}</div></div>
          {comments.length > 0 && <div className="pi-section"><div className="pi-section-title">💬 Recent problem comments</div><div className="pi-section-box"><ul>{comments.slice(0, 5).map((comment, index) => <li key={`${comment.createdAt ?? index}`}><strong>{comment.author ?? 'Dynatrace user'}:</strong> {comment.content ?? ''}</li>)}</ul></div></div>}
        </div>
      </section></div>}
    </Flex>
  );
};
