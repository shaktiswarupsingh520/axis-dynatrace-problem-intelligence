import React, { useMemo, useState } from 'react';
import './AlertOptimizationPlan.css';
import { buildAlertOptimizationEmail, downloadAlertOptimizationPdf, type OptimizationReportInput } from './AlertOptimizationReport';

type Zone = { id: string; name: string };
type Pattern = {
  key: string;
  title: string;
  rootCauseEntity: string;
  severity: string;
  impact: string;
  occurrences: number;
  openCount: number;
  avgDurationMinutes: number;
  recurrenceRatePerWeek: number;
  maxDurationMinutes?: number;
  firstSeen?: number;
  lastSeen?: number;
  problemIds?: string[];
};
type Plan = {
  managementZone: string;
  generatedAt: string;
  window: string;
  dataCoverage: { analyzedProblems: number; pageCount: number; dataComplete: boolean; truncated: boolean; maxPages?: number };
  totals: { problems: number; uniquePatterns: number; recurringPatterns: number; openProblems: number; thresholdReviewCandidates: number; immediateActionCandidates: number };
  patterns: Pattern[];
  thresholdCandidates: Pattern[];
  immediateActions: Pattern[];
  assistAnalysis: string;
  assistStatus: string;
  availableManagementZones: Zone[];
  methodology: string[];
};

const mins = (n: number) => n < 60 ? n.toFixed(0) + 'm' : Math.floor(n / 60) + 'h ' + Math.round(n % 60) + 'm';

export const AlertOptimizationPlan = () => {
  const [zone, setZone] = useState('');
  const [lookback, setLookback] = useState<'1d' | '7d' | '30d'>('30d');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [zones, setZones] = useState<Zone[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailStatus, setEmailStatus] = useState('');
  const [selectedThresholdCandidate, setSelectedThresholdCandidate] = useState<Pattern | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? zones.filter(z => z.name.toLowerCase().includes(q)) : zones;
  }, [zones, search]);

  const loadZones = async () => {
    try {
      const r = await fetch('/api/getAlertOptimizationPlan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ managementZoneName: '__LOAD_ZONES_ONLY__' }),
      });
      const body = await r.text();
      if (!r.ok) throw new Error(body || 'Unable to load Management Zones.');
      const data = JSON.parse(body) as Plan;
      setZones(data.availableManagementZones ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load Management Zones.');
    }
  };

  const generate = async () => {
    if (!zone) return;
    setLoading(true);
    setError('');
    setPlan(null);
    try {
      const r = await fetch('/api/getAlertOptimizationPlan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ managementZoneName: zone, lookback }),
      });
      const body = await r.text();
      if (!r.ok) throw new Error(body || 'Alert Optimization Plan generation failed.');
      setPlan(JSON.parse(body) as Plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to generate Alert Optimization Plan.');
    } finally {
      setLoading(false);
    }
  };

  const sendEmail = async () => {
    if (!plan || !emailTo.trim()) return;
    setEmailSending(true);
    setEmailStatus('');
    try {
      const response = await fetch('/api/sendRcaEmail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: emailTo.split(/[;,\s]+/).map(v => v.trim()).filter(Boolean),
          cc: emailCc.split(/[;,\s]+/).map(v => v.trim()).filter(Boolean),
          subject: 'Alert Optimization Plan: ' + plan.managementZone + ' Management Zone',
          message: buildAlertOptimizationEmail(plan as OptimizationReportInput),
        }),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(body || 'Email failed with HTTP ' + response.status);
      const result = JSON.parse(body) as { accepted?: boolean; error?: string };
      if (!result.accepted) throw new Error(result.error || 'The email workflow rejected the request.');
      setEmailStatus('Optimization report accepted by the email workflow.');
      setEmailOpen(false);
    } catch (e) {
      setEmailStatus(e instanceof Error ? e.message : 'Unable to send the optimization report.');
    } finally {
      setEmailSending(false);
    }
  };

  const assist = (value: string) => value.split(/\r?\n/).map((line, i) => (
    <p key={i} className={/^\s*(?:#{1,6}|\d+\.)/.test(line) ? 'aop-heading-line' : ''}>{line || ' '}</p>
  ));

  return (
    <main className="aop-page">
      <div className="aop-shell">
        <header className="aop-header">
          <div>
            <div className="aop-brand">AXIS BANK <span>•</span> DYNATRACE OPERATIONS</div>
            <div className="aop-eyebrow">Alert Optimization</div>
            <h1>Alert Optimization Plan</h1>
            <p>Analyze Dynatrace Davis problems across a selectable 1-day, 7-day or 30-day lookback and turn recurring patterns into evidence-based review actions.</p>
          </div>
          <div className="aop-window">LOOKBACK<strong>{lookback === '1d' ? '1 DAY' : lookback === '7d' ? '7 DAYS' : '30 DAYS'}</strong></div>
        </header>

        <section className="aop-filter">
          <div className="aop-range"><label>LOOKBACK<select value={lookback} onChange={e => { setLookback(e.target.value as '1d' | '7d' | '30d'); setPlan(null); }}><option value="1d">Last 1 day</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label></div>
          <div className="aop-picker">
            <label>MANAGEMENT ZONE</label>
            <button type="button" className="aop-trigger" onClick={() => { setOpen(!open); if (!zones.length) void loadZones(); setSearch(''); }}>
              <span>{zone || 'Select Management Zone'}</span><span>⌄</span>
            </button>
            {open && <div className="aop-menu">
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search management zones…" />
              <div className="aop-options">
                {filtered.map(z => <button key={z.id} type="button" onClick={() => { setZone(z.name); setOpen(false); }}>{z.name}</button>)}
                {!filtered.length && <div className="aop-empty">No matching Management Zone found.</div>}
              </div>
            </div>}
          </div>
          <button type="button" className="aop-generate" disabled={!zone || loading} onClick={() => void generate()}>
            {loading ? 'Analysing ' + (lookback === '1d' ? '1-day' : lookback === '7d' ? '7-day' : '30-day') + ' data…' : 'Generate Optimization Plan'}
          </button>
          <div className="aop-filter-note">Source: Dynatrace Problems API · selected lookback · recommendations: Dynatrace Assist</div>
        </section>

        {error && <div className="aop-error">{error}</div>}

        {loading && <section className="aop-loading"><div className="aop-spinner" /><div><strong>Building alert optimization intelligence</strong><p>Correlating problem patterns and asking Dynatrace Assist for recommendations…</p></div></section>}

        {plan && !loading && <div className="aop-content">
          <section className="aop-kpis">
            <div><span>PROBLEMS</span><strong>{plan.totals.problems.toLocaleString()}</strong><small>{plan.window.toLowerCase()}</small></div>
            <div><span>UNIQUE PATTERNS</span><strong>{plan.totals.uniquePatterns.toLocaleString()}</strong><small>title + root cause + impact</small></div>
            <div><span>RECURRING PATTERNS</span><strong>{plan.totals.recurringPatterns.toLocaleString()}</strong><small>2+ occurrences</small></div>
            <div><span>OPEN NOW</span><strong>{plan.totals.openProblems.toLocaleString()}</strong><small>currently active</small></div>
          </section>

          <section className={plan.dataCoverage.truncated ? 'aop-coverage is-warning' : 'aop-coverage is-complete'}>
            <div className="aop-coverage-icon">{plan.dataCoverage.truncated ? '!' : '✓'}</div>
            <div><strong>{plan.dataCoverage.truncated ? 'Analysis reached the data safety limit' : 'Complete problem dataset analyzed'}</strong><p>{plan.dataCoverage.analyzedProblems.toLocaleString()} problems analyzed across {plan.dataCoverage.pageCount} API page{plan.dataCoverage.pageCount === 1 ? '' : 's'}.{plan.dataCoverage.truncated ? ' Additional problems may exist beyond the safety cap.' : ' No additional Problems API pages were returned.'}</p></div>
          </section>

          <section className="aop-report-actions">
            <div><strong>Report actions</strong><span>Export or distribute the generated optimization plan for the selected window.</span></div>
            <div className="aop-action-buttons">
              <button type="button" onClick={() => downloadAlertOptimizationPdf(plan as OptimizationReportInput)}>↓ Download PDF</button>
              <button type="button" onClick={() => { setEmailStatus(''); setEmailOpen(true); }}>✉ Email Report</button>
            </div>
          </section>
          {emailStatus && <div className="aop-email-status">{emailStatus}</div>}

          {selectedThresholdCandidate && <div className="aop-email-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedThresholdCandidate(null); }}>
            <section className="aop-review-modal" role="dialog" aria-modal="true" aria-label="Threshold sensitivity review">
              <div className="aop-section-head"><div><div className="aop-kicker">THRESHOLD / SENSITIVITY REVIEW</div><h2>Candidate detail</h2></div><button type="button" className="aop-modal-close" onClick={() => setSelectedThresholdCandidate(null)}>×</button></div>
              <div className="aop-review-body">
                <h3>{selectedThresholdCandidate.title}</h3>
                <p className="aop-review-subtitle">{selectedThresholdCandidate.rootCauseEntity}</p>
                <div className="aop-review-grid">
                  <div><span>Occurrences</span><strong>{selectedThresholdCandidate.occurrences}</strong></div>
                  <div><span>Open occurrences</span><strong>{selectedThresholdCandidate.openCount}</strong></div>
                  <div><span>Average duration</span><strong>{mins(selectedThresholdCandidate.avgDurationMinutes)}</strong></div>
                  <div><span>Maximum duration</span><strong>{mins(selectedThresholdCandidate.maxDurationMinutes ?? selectedThresholdCandidate.avgDurationMinutes)}</strong></div>
                  <div><span>Severity</span><strong>{selectedThresholdCandidate.severity}</strong></div>
                  <div><span>Impact</span><strong>{selectedThresholdCandidate.impact}</strong></div>
                  <div><span>Recurrence rate</span><strong>{selectedThresholdCandidate.recurrenceRatePerWeek}/week</strong></div>
                  <div><span>Sample problem IDs</span><strong>{selectedThresholdCandidate.problemIds?.join(', ') || 'Not available'}</strong></div>
                </div>
                <div className="aop-review-callout">
                  <strong>Why this is a review candidate</strong>
                  <p>This pattern occurred at least 5 times, averaged 15 minutes or less, and has no currently open occurrence in the selected lookback. That indicates a possible noise/sensitivity opportunity, but it does <b>not</b> reveal the current Dynatrace threshold.</p>
                </div>
                <div className="aop-review-next">
                  <strong>Validation before changing the alert</strong>
                  <ol>
                    <li>Open the current anomaly-detection / alerting configuration for the affected entity.</li>
                    <li>Compare the configured threshold or sensitivity with the observed recurrence and duration above.</li>
                    <li>Confirm business impact with the application owner before changing, suppressing or routing the alert.</li>
                    <li>Measure alert volume and operational impact after any approved change.</li>
                  </ol>
                </div>
              </div>
            </section>
          </div>}

          {emailOpen && <div className="aop-email-overlay" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEmailOpen(false); }}>
            <section className="aop-email-modal" role="dialog" aria-modal="true" aria-label="Email optimization report">
              <div className="aop-section-head"><div><div className="aop-kicker">DISTRIBUTE REPORT</div><h2>Email optimization report</h2></div><button type="button" className="aop-modal-close" onClick={() => setEmailOpen(false)}>×</button></div>
              <div className="aop-email-body">
                <label>TO<input value={emailTo} onChange={e => setEmailTo(e.target.value)} placeholder="owner@axisbank.com; manager@axisbank.com" /></label>
                <label>CC<input value={emailCc} onChange={e => setEmailCc(e.target.value)} placeholder="Optional" /></label>
                <div className="aop-email-preview"><strong>Subject</strong><p>Dynatrace Alert Optimization | {plan.managementZone} | {plan.window}</p><strong>Content</strong><p>Executive summary, recurring patterns, threshold-review candidates, immediate-action queue and Dynatrace Assist recommendations.</p></div>
                <div className="aop-email-footer"><button type="button" onClick={() => setEmailOpen(false)}>Cancel</button><button type="button" className="aop-send" disabled={!emailTo.trim() || emailSending} onClick={() => void sendEmail()}>{emailSending ? 'Sending…' : 'Send Report'}</button></div>
              </div>
            </section>
          </div>}

          <section className="aop-assist">
            <div className="aop-section-head"><div><div className="aop-kicker">DYNATRACE ASSIST</div><h2>AI-assisted optimization recommendations</h2></div><span className={plan.assistAnalysis ? 'aop-status-good' : 'aop-status-warn'}>{plan.assistStatus}</span></div>
            <div className="aop-assist-body">{plan.assistAnalysis ? assist(plan.assistAnalysis) : <p>Assist recommendations were not returned. Use the evidence tables below.</p>}</div>
          </section>

          <section className="aop-grid">
            <article className="aop-card">
              <div className="aop-section-head"><div><div className="aop-kicker">NOISE / RECURRENCE</div><h2>Repeated alert patterns</h2></div><span>{plan.totals.recurringPatterns} patterns</span></div>
              <div className="aop-table-wrap"><table><thead><tr><th>Pattern</th><th>Root Cause</th><th>Count</th><th>Open</th><th>Avg Duration</th><th>Severity</th></tr></thead><tbody>
                {plan.patterns.filter(p => p.occurrences >= 2).slice(0, 20).map(p => <tr key={p.key}><td><b>{p.title}</b><small>{p.impact}</small></td><td>{p.rootCauseEntity}</td><td><strong>{p.occurrences}</strong><small>{p.recurrenceRatePerWeek}/week</small></td><td>{p.openCount}</td><td>{mins(p.avgDurationMinutes)}</td><td><span className="aop-pill">{p.severity}</span></td></tr>)}
              </tbody></table></div>
            </article>
            <article className="aop-card">
              <div className="aop-section-head"><div><div className="aop-kicker">THRESHOLD / SENSITIVITY</div><h2>Review candidates</h2></div><span>{plan.thresholdCandidates.length} candidates</span></div>
              <div className="aop-card-note">Review candidates only. Exact threshold values are not inferred from problem history.</div>
              <div className="aop-list">{plan.thresholdCandidates.slice(0, 12).map(p => <button type="button" className="aop-list-row aop-review-row" key={p.key} onClick={() => setSelectedThresholdCandidate(p)}><div><b>{p.title}</b><small>{p.rootCauseEntity} · {p.occurrences} occurrences · avg {mins(p.avgDurationMinutes)}</small></div><span>Review</span></button>)}{!plan.thresholdCandidates.length && <div className="aop-empty">No strong threshold-review pattern detected.</div>}</div>
            </article>
          </section>

          <section className="aop-card">
            <div className="aop-section-head"><div><div className="aop-kicker">ACTION QUEUE</div><h2>Immediate attention candidates</h2></div><span>{plan.immediateActions.length} candidates</span></div>
            <div className="aop-table-wrap"><table><thead><tr><th>Priority Pattern</th><th>Reason</th><th>Open</th><th>Occurrences</th><th>Avg Duration</th><th>Root Cause</th></tr></thead><tbody>
              {plan.immediateActions.map(p => <tr key={p.key}><td><b>{p.title}</b><small>{p.severity} · {p.impact}</small></td><td>{p.openCount ? 'Currently open' : p.avgDurationMinutes >= 60 ? 'Long-running pattern' : 'Severe problem category'}</td><td>{p.openCount}</td><td>{p.occurrences}</td><td>{mins(p.avgDurationMinutes)}</td><td>{p.rootCauseEntity}</td></tr>)}
            </tbody></table></div>
          </section>

          <section className="aop-card">
            <div className="aop-section-head"><div><div className="aop-kicker">METHOD & GOVERNANCE</div><h2>How the plan is generated</h2></div></div>
            <div className="aop-method-grid">{plan.methodology.map((m, i) => <div key={i}><strong>{String(i + 1).padStart(2, '0')}</strong><p>{m}</p></div>)}</div>
          </section>
        </div>}
      </div>
    </main>
  );
};
