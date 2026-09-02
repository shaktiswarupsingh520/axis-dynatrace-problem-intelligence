import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import type { Problem, ProblemsResponse } from '../types/problems';

const ts = (v?: number) => v ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(v)) : '-';
const age = (s?: number, e?: number) => {
  if (!s) return '-';
  const m = Math.floor(Math.max(0, (e && e > 0 ? e : Date.now()) - s) / 60000);
  return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

export const Home = () => {
  const [mz, setMz] = useState('ALL');
  const [selected, setSelected] = useState<Problem | null>(null);
  const [voice, setVoice] = useState(false);
  const known = useRef(new Set<string>());
  const initial = useRef(false);

  const { data, isLoading, error, refetch } = useAppFunction<ProblemsResponse>({
    name: 'getProblems',
    data: { from: 'now-24h', to: 'now', pageSize: 100, ...(mz !== 'ALL' ? { managementZoneId: mz } : {}) },
  });
  const problems = useMemo(() => [...(data?.problems ?? [])].sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0)), [data]);
  const zones = useMemo(() => {
    const map = new Map<string, string>();
    problems.forEach(p => (p.managementZones ?? []).forEach(z => z.id && z.name && map.set(z.id, z.name)));
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [problems]);
  const open = problems.filter(p => (p.status ?? '').toUpperCase() === 'OPEN');
  const criticalHigh = open.filter(p => ['CRITICAL', 'HIGH'].includes((p.severityLevel ?? '').toUpperCase()));
  const aging = open.filter(p => p.startTime && Date.now() - p.startTime > 4 * 60 * 60 * 1000);

  useEffect(() => {
    const t = window.setInterval(() => refetch(), 30000);
    return () => window.clearInterval(t);
  }, [refetch]);

  useEffect(() => {
    if (!problems.length) return;
    if (!initial.current) {
      problems.forEach(p => p.problemId && known.current.add(p.problemId));
      initial.current = true;
      return;
    }
    const fresh = problems.find(p => p.problemId && !known.current.has(p.problemId) && (p.status ?? '').toUpperCase() === 'OPEN');
    problems.forEach(p => p.problemId && known.current.add(p.problemId));
    if (fresh) {
      setSelected(fresh);
      if (voice && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Attention. New Dynatrace problem. ${fresh.severityLevel ?? ''}. ${fresh.displayId ?? ''}. ${fresh.title ?? ''}.`));
      }
    }
  }, [problems, voice]);

  const detailQuery = useAppFunction<Problem>({
    name: 'getProblemDetails',
    data: selected?.problemId ? { problemId: selected.problemId } : undefined,
  }, { autoFetch: Boolean(selected?.problemId) });
  const detail = detailQuery.data ?? selected;

  const enableVoice = () => {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance('Dynatrace voice buzz enabled.'));
    setVoice(true);
  };

  return <Flex flexDirection="column" padding={24} gap={20}>
    <style>{`@keyframes piPop{from{opacity:0;transform:translateY(18px) scale(.96)}to{opacity:1;transform:none}}.pi-overlay{position:fixed;inset:0;background:rgba(0,0,0,.48);display:flex;align-items:center;justify-content:center;z-index:9999}.pi-modal{width:min(760px,92vw);max-height:85vh;overflow:auto;background:var(--dt-colors-surface-primary,#fff);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);animation:piPop .28s ease-out}.pi-head{padding:20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between}.pi-body{padding:20px}.pi-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.pi-card{padding:14px;border:1px solid #ddd;border-radius:10px}.pi-table{width:100%;border-collapse:collapse;min-width:1100px}.pi-table th,.pi-table td{padding:10px;border-bottom:1px solid #ddd;text-align:left;white-space:nowrap}.pi-table th{position:sticky;top:0;font-weight:700}.pi-row{cursor:pointer}.pi-row:hover{background:rgba(127,127,127,.08)}.pi-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.pi-kpi{padding:16px;border:1px solid #ddd;border-radius:10px}.pi-value{font-size:26px;font-weight:700}.pi-toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.pi-toolbar button,.pi-toolbar select{padding:8px 12px;border:1px solid #bbb;border-radius:6px;background:inherit}@media(max-width:900px){.pi-kpis,.pi-grid{grid-template-columns:1fr 1fr}}`}</style>
    <div>
      <Heading>Problem Intelligence</Heading><Paragraph>Live Dynatrace problems, aging visibility and new-alert intelligence.</Paragraph>
    </div>
    <div className="pi-toolbar">
      <label htmlFor="mz">Management Zone</label>
      <select id="mz" value={mz} onChange={e => setMz(e.target.value)}><option value="ALL">All Management Zones</option>{zones.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
      <button type="button" onClick={() => refetch()}>↻ Refresh</button>
      <button type="button" onClick={enableVoice}>{voice ? '🔊 Voice Buzz ON' : '🔇 Enable Voice Buzz'}</button>
    </div>
    {error && <Paragraph>Unable to load problems. Check AppEngine function and permissions.</Paragraph>}
    <div className="pi-kpis">
      <div className="pi-kpi">Matched Problems<div className="pi-value">{data?.totalCount ?? 0}</div></div>
      <div className="pi-kpi">Open Problems<div className="pi-value">{open.length}</div></div>
      <div className="pi-kpi">Critical / High<div className="pi-value">{criticalHigh.length}</div></div>
      <div className="pi-kpi">Aging &gt; 4h<div className="pi-value">{aging.length}</div></div>
    </div>
    <div style={{ overflow: 'auto', border: '1px solid #ddd', borderRadius: 10 }}>
      <table className="pi-table"><thead><tr><th>Started</th><th>Problem</th><th>Title</th><th>Severity</th><th>Impact</th><th>Status</th><th>Age</th><th>Management Zones</th></tr></thead>
        <tbody>{isLoading && !problems.length ? <tr><td colSpan={8}>Loading live problems…</td></tr> : problems.length === 0 ? <tr><td colSpan={8}>No problems found.</td></tr> : problems.map(p => <tr key={p.problemId ?? p.displayId} className="pi-row" onClick={() => setSelected(p)}><td>{ts(p.startTime)}</td><td>{p.displayId ?? p.problemId ?? '-'}</td><td>{p.title ?? '-'}</td><td>{p.severityLevel ?? '-'}</td><td>{p.impactLevel ?? '-'}</td><td>{p.status ?? '-'}</td><td>{age(p.startTime, p.endTime)}</td><td>{(p.managementZones ?? []).map(z => z.name).filter(Boolean).join(', ') || '-'}</td></tr>)}</tbody>
      </table>
    </div>
    {selected && detail && <div className="pi-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}><section className="pi-modal" role="dialog" aria-modal="true">
      <div className="pi-head"><div><Heading>{detail.displayId ?? detail.problemId ?? 'Dynatrace Problem'}</Heading><Paragraph>{detail.title ?? 'New Dynatrace problem received'}</Paragraph></div><button type="button" onClick={() => setSelected(null)}>✕</button></div>
      <div className="pi-body"><Paragraph><strong>🚨 Problem alert</strong></Paragraph><div className="pi-grid">
        <div className="pi-card">Severity<strong>{detail.severityLevel ?? '-'}</strong></div><div className="pi-card">Impact<strong>{detail.impactLevel ?? '-'}</strong></div><div className="pi-card">Status<strong>{detail.status ?? '-'}</strong></div><div className="pi-card">Started<strong>{ts(detail.startTime)}</strong></div><div className="pi-card">Age<strong>{age(detail.startTime, detail.endTime)}</strong></div><div className="pi-card">Root Cause<strong>{detail.rootCauseEntity?.name ?? '-'}</strong></div>
      </div><div style={{ marginTop: 18 }}><strong>Alert details / evidence</strong>{detailQuery.isLoading ? <Paragraph>Loading diagnostic evidence…</Paragraph> : <ul>{(detail.evidenceDetails?.details ?? []).slice(0, 10).map((e, i) => <li key={`${e.displayName ?? 'evidence'}-${i}`}>{e.displayName ?? e.evidenceType ?? 'Evidence'}{e.entity?.name ? ` — ${e.entity.name}` : ''}</li>)}{!detail.evidenceDetails?.details?.length && <li>No detailed evidence returned.</li>}</ul>}</div></div>
    </section></div>}
  </Flex>;
};
