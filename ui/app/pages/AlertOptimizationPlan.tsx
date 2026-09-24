import React, { useMemo, useState } from 'react';
import './AlertOptimizationPlan.css';

type Zone={id:string;name:string};
type Pattern={key:string;title:string;rootCauseEntity:string;severity:string;impact:string;occurrences:number;openCount:number;avgDurationMinutes:number;recurrenceRatePerWeek:number};
type Plan={managementZone:string;generatedAt:string;window:string;totals:{problems:number;uniquePatterns:number;recurringPatterns:number;openProblems:number;thresholdReviewCandidates:number;immediateActionCandidates:number};patterns:Pattern[];thresholdCandidates:Pattern[];immediateActions:Pattern[];assistAnalysis:string;assistStatus:string;availableManagementZones:Zone[];methodology:string[]};

const mins=(n:number)=>n<60?`${{n.toFixed(0)}m`:`${{Math.floor(n/60)}h ${{Math.round(n%60)}m`;

export const AlertOptimizationPlan=()=>{
 const [zone,setZone]=useState(''),[search,setSearch]=useState(''),[open,setOpen]=useState(false),[zones,setZones]=useState<Zone[]>([]),[plan,setPlan]=useState<Plan|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const filtered=useMemo(()=>{const q=search.trim().toLowerCase();return q?zones.filter(z=>z.name.toLowerCase().includes(q)):zones},[zones,search]);

 const loadZones=async()=>{
  try{
   const r=await fetch('/api/getAlertOptimizationPlan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({managementZoneName:'__LOAD_ZONES_ONLY__'})});
   const body=await r.text();if(!r.ok)throw new Error(body||'Unable to load Management Zones.');
   const data=JSON.parse(body) as Plan;setZones(data.availableManagementZones??[]);
  }catch(e){setError(e instanceof Error?e.message:'Unable to load Management Zones.');}
 };

 const generate=async()=>{
  if(!zone)return;setLoading(true);setError('');setPlan(null);
  try{
   const r=await fetch('/api/getAlertOptimizationPlan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({managementZoneName:zone})});
   const body=await r.text();if(!r.ok)throw new Error(body||`Alert Optimization Plan failed with HTTP ${{r.status}`);
   setPlan(JSON.parse(body) as Plan);
  }catch(e){setError(e instanceof Error?e.message:'Unable to generate Alert Optimization Plan.');}
  finally{setLoading(false);}
 };

 const assist=(value:string)=>value.split(/\r?\n/).map((line,i)=><p key={i} className={/^\s*(?:#{1,6}|\d+\.)/.test(line)?'aop-heading-line':''}>{line||' '}</p>);

 return <main className="aop-page"><div className="aop-shell">
  <header className="aop-header"><div><div className="aop-brand">AXIS BANK <span>•</span> DYNATRACE OPERATIONS</div><div className="aop-eyebrow">Alert Optimization</div><h1>Alert Optimization Plan</h1><p>Analyze the last 30 days of Davis problems for recurring noise, threshold-review candidates, immediate actions and optimization opportunities.</p></div><div className="aop-window">LOOKBACK<strong>30 DAYS</strong></div></header>

  <section className="aop-filter"><div className="aop-picker"><label>MANAGEMENT ZONE</label><button type="button" className="aop-trigger" onClick={()=>{setOpen(!open);if(!zones.length)void loadZones();setSearch('')}}><span>{zone||'Select Management Zone'}</span><span>⌄</span></button>{open&&<div className="aop-menu"><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search management zones…" /><div className="aop-options">{filtered.map(z=><button key={z.id} type="button" onClick={()=>{setZone(z.name);setOpen(false)}}>{z.name}</button>)}{!filtered.length&&<div className="aop-empty">No matching Management Zone found.</div>}</div></div>}</div><button type="button" className="aop-generate" disabled={!zone||loading} onClick={()=>void generate()}>{loading?'Analysing 30-day data…':'Generate Optimization Plan'}</button><div className="aop-filter-note">Source: Dynatrace Problems API · 30-day history · recommendations: Dynatrace Assist</div></section>

  {error&&<div className="aop-error">{error}</div>}
  {loading&&<section className="aop-loading"><div className="aop-spinner"/><div><strong>Building alert optimization intelligence</strong><p>Correlating recurring patterns and asking Dynatrace Assist for recommendations…</p></div></section>}

  {plan&&!loading&&<div className="aop-content">
   <section className="aop-kpis">
    <div><span>PROBLEMS</span><strong>{plan.totals.problems.toLocaleString()}</strong><small>last 30 days</small></div>
    <div><span>UNIQUE PATTERNS</span><strong>{plan.totals.uniquePatterns.toLocaleString()}</strong><small>title + root cause + impact</small></div>
    <div><span>RECURRING PATTERNS</span><strong>{plan.totals.recurringPatterns.toLocaleString()}</strong><small>2+ occurrences</small></div>
    <div><span>OPEN NOW</span><strong>{plan.totals.openProblems.toLocaleString()}</strong><small>currently active</small></div>
   </section>

   <section className="aop-assist"><div className="aop-section-head"><div><div className="aop-kicker">DYNATRACE ASSIST</div><h2>AI-assisted optimization recommendations</h2></div><span className={plan.assistAnalysis?'aop-status-good':'aop-status-warn'}>{plan.assistStatus}</span></div><div className="aop-assist-body">{plan.assistAnalysis?assist(plan.assistAnalysis):<p>Assist recommendations were not returned. Use the evidence tables below.</p>}</div></section>

   <section className="aop-grid">
    <article className="aop-card"><div className="aop-section-head"><div><div className="aop-kicker">NOISE / RECURRENCE</div><h2>Repeated alert patterns</h2></div><span>{plan.totals.recurringPatterns} patterns</span></div><div className="aop-table-wrap"><table><thead><tr><th>Pattern</th><th>Root Cause</th><th>Count</th><th>Open</th><th>Avg Duration</th><th>Severity</th></tr></thead><tbody>{plan.patterns.filter(p=>p.occurrences>=2).slice(0,20).map(p=><tr key={p.key}><td><b>{p.title}</b><small>{p.impact}</small></td><td>{p.rootCauseEntity}</td><td><strong>{p.occurrences}</strong><small>{p.recurrenceRatePerWeek}/week</small></td><td>{p.openCount}</td><td>{mins(p.avgDurationMinutes)}</td><td><span className="aop-pill">{p.severity}</span></td></tr>)}</tbody></table></div></article>

    <article className="aop-card"><div className="aop-section-head"><div><div className="aop-kicker">THRESHOLD / SENSITIVITY</div><h2>Review candidates</h2></div><span>{plan.thresholdCandidates.length} candidates</span></div><div className="aop-card-note">Review candidates only. Exact threshold values are not inferred from problem history.</div><div className="aop-list">{plan.thresholdCandidates.slice(0,12).map(p=><div className="aop-list-row" key={p.key}><div><b>{p.title}</b><small>{p.rootCauseEntity} · {p.occurrences} occurrences · avg {mins(p.avgDurationMinutes)}</small></div><span>Review</span></div>)}{!plan.thresholdCandidates.length&&<div className="aop-empty">No strong threshold-review pattern detected.</div>}</div></article>
   </section>

   <section className="aop-card"><div className="aop-section-head"><div><div className="aop-kicker">ACTION QUEUE</div><h2>Immediate attention candidates</h2></div><span>{plan.immediateActions.length} candidates</span></div><div className="aop-table-wrap"><table><thead><tr><th>Priority Pattern</th><th>Reason</th><th>Open</th><th>Occurrences</th><th>Avg Duration</th><th>Root Cause</th></tr></thead><tbody>{plan.immediateActions.map(p=><tr key={p.key}><td><b>{p.title}</b><small>{p.severity} · {p.impact}</small></td><td>{p.openCount?'Currently open':p.avgDurationMinutes>=60?'Long-running pattern':'Severe problem category'}</td><td>{p.openCount}</td><td>{p.occurrences}</td><td>{mins(p.avgDurationMinutes)}</td><td>{p.rootCauseEntity}</td></tr>)}</tbody></table></div></section>

   <section className="aop-card"><div className="aop-section-head"><div><div className="aop-kicker">METHOD & GOVERNANCE</div><h2>How the plan is generated</h2></div></div><div className="aop-method-grid">{plan.methodology.map((m,i)=><div key={i}><strong>{String(i+1).padStart(2,'0')}</strong><p>{m}</p></div>)}</div></section>
  </div>}
 </div></main>;
};
