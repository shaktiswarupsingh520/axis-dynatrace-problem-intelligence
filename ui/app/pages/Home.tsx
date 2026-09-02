import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import type { Problem, ProblemsResponse } from '../types/problems';

const formatTimestamp = (timestamp?: number) => {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(timestamp));
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

const speakProblem = (problem: Problem) => {
  if (!('speechSynthesis' in window)) return;
  const severity = problem.severityLevel ?? problem.impactLevel ?? 'unknown severity';
  const id = problem.displayId ?? problem.problemId ?? 'unknown problem';
  const title = problem.title ?? 'New Dynatrace problem received';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(
    new SpeechSynthesisUtterance(`Attention. New Dynatrace problem. ${severity}. ${id}. ${title}.`),
  );
};

export const Home = () => {
  const [selectedMz, setSelectedMz] = useState('ALL');
  const [selectedProblem, setSelectedProblem] = useState<Problem | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const knownProblemIds = useRef(new Set<string>());
  const initialised = useRef(false);

  const requestData = useMemo(
    () => ({
      from: 'now-24h',
      to: 'now',
      pageSize: 100,
      ...(selectedMz !== 'ALL' ? { managementZoneId: selectedMz } : {}),
    }),
    [selectedMz],
  );

  const { data, isLoading, error, refetch } = useAppFunction<ProblemsResponse>({
    name: 'getProblems',
    data: requestData,
  });

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

  const openProblems = useMemo(
    () => problems.filter((problem) => upper(problem.status) === 'OPEN'),
    [problems],
  );

  const criticalHigh = useMemo(
    () =>
      openProblems.filter((problem) => {
        const severity = upper(problem.severityLevel);
        return severity === 'CRITICAL' || severity === 'HIGH';
      }),
    [openProblems],
  );

  const aging = useMemo(
    () =>
      openProblems.filter(
        (problem) => Boolean(problem.startTime) && Date.now() - (problem.startTime ?? 0) > 4 * 60 * 60 * 1000,
      ),
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

    const freshProblems = problems.filter(
      (problem) =>
        Boolean(problem.problemId) &&
        !knownProblemIds.current.has(problem.problemId as string) &&
        upper(problem.status) === 'OPEN',
    );

    problems.forEach((problem) => {
      if (problem.problemId) knownProblemIds.current.add(problem.problemId);
    });

    if (freshProblems.length > 0) {
      const fresh = freshProblems[0];
      setSelectedProblem(fresh);
      if (voiceEnabled) speakProblem(fresh);
    }
  }, [problems, voiceEnabled]);

  const detailQuery = useAppFunction<Problem>(
    {
      name: 'getProblemDetails',
      data: selectedProblem?.problemId ? { problemId: selectedProblem.problemId } : undefined,
    },
    {
      autoFetch: Boolean(selectedProblem?.problemId),
      autoFetchOnUpdate: Boolean(selectedProblem?.problemId),
    },
  );

  const detail = detailQuery.data ?? selectedProblem;

  const refresh = useCallback(() => {
    void refetch();
    setLastRefresh(Date.now());
  }, [refetch]);

  const enableVoice = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance('Dynatrace voice buzz enabled.'));
    setVoiceEnabled(true);
  };

  const disableVoice = () => {
    setVoiceEnabled(false);
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  };

  return (
    <Flex flexDirection="column" padding={24} gap={20}>
      <style>{`
        .pi-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
        .pi-toolbar button,.pi-toolbar select{padding:8px 12px;border:1px solid #bbb;border-radius:6px;background:inherit}
        .pi-kpis{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px}
        .pi-kpi{padding:16px;border:1px solid #ddd;border-radius:10px}
        .pi-value{font-size:26px;font-weight:700;margin-top:4px}
        .pi-table-wrap{overflow:auto;border:1px solid #ddd;border-radius:10px}
        .pi-table{width:100%;border-collapse:collapse;min-width:1200px}
        .pi-table th,.pi-table td{padding:11px 12px;border-bottom:1px solid #ddd;text-align:left;white-space:nowrap}
        .pi-table th{position:sticky;top:0;font-weight:700;background:var(--dt-colors-surface-primary,#fff);z-index:1}
        .pi-row{cursor:pointer}.pi-row:hover{background:rgba(127,127,127,.08)}
        .pi-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;animation:piFade .18s ease-out}
        .pi-modal{width:min(820px,92vw);max-height:86vh;overflow:auto;background:var(--dt-colors-surface-primary,#fff);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.35);animation:piPop .28s cubic-bezier(.2,.8,.2,1)}
        .pi-head{padding:20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;gap:20px}
        .pi-body{padding:20px}.pi-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .pi-card{padding:14px;border:1px solid #ddd;border-radius:10px}.pi-label{font-size:12px;opacity:.7;text-transform:uppercase}.pi-detail{margin-top:5px;font-weight:600;word-break:break-word}
        .pi-close{border:0;background:transparent;font-size:22px;cursor:pointer}.pi-alert{padding:14px;border:1px solid #ddd;border-radius:10px;margin-bottom:16px}
        .pi-error{padding:12px;border:1px solid #d44;border-radius:8px}.pi-evidence{margin-top:18px}.pi-evidence li{margin:7px 0}
        @keyframes piPop{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}@keyframes piFade{from{opacity:0}to{opacity:1}}
        @media(max-width:900px){.pi-kpis,.pi-grid{grid-template-columns:1fr 1fr}}@media(max-width:600px){.pi-kpis,.pi-grid{grid-template-columns:1fr}}
      `}</style>

      <Flex flexDirection="column" gap={4}>
        <Heading>Axis Problem Intelligence</Heading>
        <Paragraph>Live Dynatrace problems, management-zone filtering and new-problem voice buzz.</Paragraph>
      </Flex>

      <div className="pi-toolbar">
        <label htmlFor="pi-mz">Management Zone</label>
        <select id="pi-mz" value={selectedMz} onChange={(event) => setSelectedMz(event.target.value)}>
          <option value="ALL">All Management Zones</option>
          {zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <button type="button" onClick={refresh} disabled={isLoading}>↻ Refresh</button>
        {!voiceEnabled ? (
          <button type="button" onClick={enableVoice}>🔇 Enable Voice Buzz</button>
        ) : (
          <button type="button" onClick={disableVoice}>🔊 Voice Buzz ON</button>
        )}
        <span>Updated {new Date(lastRefresh).toLocaleTimeString()}</span>
      </div>

      {error && <div className="pi-error"><Paragraph>Unable to load Dynatrace problems. {error.message}</Paragraph></div>}

      <div className="pi-kpis">
        <div className="pi-kpi">Matched Problems<div className="pi-value">{data?.totalCount ?? 0}</div></div>
        <div className="pi-kpi">Open Problems<div className="pi-value">{openProblems.length}</div></div>
        <div className="pi-kpi">Critical / High<div className="pi-value">{criticalHigh.length}</div></div>
        <div className="pi-kpi">Aging &gt; 4h<div className="pi-value">{aging.length}</div></div>
      </div>

      <div className="pi-table-wrap">
        <table className="pi-table">
          <thead><tr><th>Started</th><th>Problem</th><th>Title</th><th>Severity</th><th>Impact</th><th>Status</th><th>Age</th><th>Management Zones</th></tr></thead>
          <tbody>
            {isLoading && !problems.length ? (
              <tr><td colSpan={8}>Loading live problems…</td></tr>
            ) : problems.length === 0 ? (
              <tr><td colSpan={8}>No problems found for the selected management zone.</td></tr>
            ) : (
              problems.map((problem) => (
                <tr key={problem.problemId ?? problem.displayId} className="pi-row" onClick={() => setSelectedProblem(problem)}>
                  <td>{formatTimestamp(problem.startTime)}</td>
                  <td>{problem.displayId ?? problem.problemId ?? '-'}</td>
                  <td>{problem.title ?? '-'}</td>
                  <td>{problem.severityLevel ?? '-'}</td>
                  <td>{problem.impactLevel ?? '-'}</td>
                  <td>{problem.status ?? '-'}</td>
                  <td>{formatDuration(problem.startTime, problem.endTime)}</td>
                  <td>{(problem.managementZones ?? []).map((zone) => zone.name).filter(Boolean).join(', ') || '-'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedProblem && detail && (
        <div className="pi-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSelectedProblem(null); }}>
          <section className="pi-modal" role="dialog" aria-modal="true" aria-label="Dynatrace problem details">
            <div className="pi-head">
              <div><Heading>{detail.displayId ?? detail.problemId ?? 'Dynatrace Problem'}</Heading><Paragraph>{detail.title ?? 'New Dynatrace problem received'}</Paragraph></div>
              <button className="pi-close" type="button" onClick={() => setSelectedProblem(null)} aria-label="Close">✕</button>
            </div>
            <div className="pi-body">
              <div className="pi-alert"><strong>🚨 Problem alert details</strong><div>{detail.title ?? 'No problem description available.'}</div></div>
              <div className="pi-grid">
                <div className="pi-card"><div className="pi-label">Severity</div><div className="pi-detail">{detail.severityLevel ?? '-'}</div></div>
                <div className="pi-card"><div className="pi-label">Impact</div><div className="pi-detail">{detail.impactLevel ?? '-'}</div></div>
                <div className="pi-card"><div className="pi-label">Status</div><div className="pi-detail">{detail.status ?? '-'}</div></div>
                <div className="pi-card"><div className="pi-label">Started</div><div className="pi-detail">{formatTimestamp(detail.startTime)}</div></div>
                <div className="pi-card"><div className="pi-label">Age</div><div className="pi-detail">{formatDuration(detail.startTime, detail.endTime)}</div></div>
                <div className="pi-card"><div className="pi-label">Root Cause</div><div className="pi-detail">{detail.rootCauseEntity?.name ?? '-'}</div></div>
              </div>
              <div className="pi-evidence">
                <strong>Evidence / description</strong>
                {detailQuery.isLoading ? <Paragraph>Loading diagnostic details…</Paragraph> : (
                  <ul>
                    {(detail.evidenceDetails?.details ?? []).slice(0, 12).map((evidence, index) => (
                      <li key={`${evidence.displayName ?? 'evidence'}-${index}`}>
                        {evidence.displayName ?? evidence.evidenceType ?? 'Evidence'}{evidence.entity?.name ? ` — ${evidence.entity.name}` : ''}
                      </li>
                    ))}
                    {!detail.evidenceDetails?.details?.length && <li>No detailed evidence was returned for this problem.</li>}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </div>
      )}
    </Flex>
  );
};
