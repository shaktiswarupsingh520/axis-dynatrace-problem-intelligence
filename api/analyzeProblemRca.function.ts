import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; snapshots: Row[]; }

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('; ');
  if (typeof v === 'object') return JSON.stringify(v) ?? '';
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return '';
};
const q = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function dql(query: string, max = 200): Promise<Row[]> {
  const r = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = r.result;
  const token = r.requestToken;
  for (let i = 0; !result && token && i < 30; i += 1) {
    const p = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    result = p.result;
    if (!result) await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!result) throw new Error('DQL did not complete.');
  return (result.records ?? []).filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));
}

async function loadEvidence(id: string): Promise<Evidence> {
  const pid = q(id);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${pid}"\n| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);
  const p = rows[0];
  const ids = Array.isArray(p.affected_entity_ids) ? p.affected_entity_ids.map(text).filter(Boolean) : [text(p.affected_entity_ids)].filter(Boolean);
  const entityList = [...new Set(ids)].slice(0, 80).map(x => `"${q(x)}"`).join(', ');
  const eventIds = Array.isArray(p['dt.davis.event_ids']) ? p['dt.davis.event_ids'].map(text).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 80).map(x => `"${q(x)}"`).join(', ');
  const start = text(p['event.start']);
  const end = text(p['event.end']) || new Date().toISOString();
  const events = eventList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| sort event.start asc\n| limit 100`, 100).catch(() => []) : Promise.resolve([] as Row[]);
  const logs = entityList && start ? dql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| sort timestamp asc\n| limit 100`, 100).catch(() => []) : Promise.resolve([] as Row[]);
  const history = dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(text(p['event.name']))}"\n| sort event.start desc\n| limit 40`, 40).catch(() => []);
  const snapshots = text(p['event.id']) ? dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(text(p['event.id']))}"\n| sort timestamp asc\n| limit 80`, 80).catch(() => []) : Promise.resolve([] as Row[]);
  const [eventRows, logRows, historyRows, snapshotRows] = await Promise.all([events, logs, history, snapshots]);
  return { problem: p, events: eventRows, logs: logRows, history: historyRows, snapshots: snapshotRows };
}

function extractAssistText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractAssistText).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'answer', 'content', 'message']) {
    const candidate = extractAssistText(record[key]);
    if (candidate) return candidate;
  }
  const tokens = record.tokens;
  return Array.isArray(tokens) ? tokens.map(text).join('').trim() : '';
}

function fact(value: unknown, fallback = 'Not available') { return text(value) || fallback; }

function fallbackRca(id: string, e: Evidence, assistError?: string): string {
  const p = e.problem;
  const title = fact(p['event.name'], 'Dynatrace problem');
  const status = fact(p['event.status']);
  const severity = fact(p['event.severity']);
  const category = fact(p['event.category']);
  const start = fact(p['event.start']);
  const end = text(p['event.end']);
  const root = text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id);
  const impact = fact(p['dt.davis.impact_level']);
  const users = fact(p['dt.davis.affected_users_count']);
  const strongest = e.events.find(x => x['dt.davis.is_rootcause_relevant'] === true) ?? e.events[0];
  const signal = text(strongest?.['event.description']) || text(strongest?.['event.name']) || text(p['event.description']);
  const entities = Array.isArray(p.affected_entity_names) ? p.affected_entity_names.map(text).filter(Boolean).slice(0, 20).join(', ') : text(p.affected_entity_names) || text(p.affected_entity_ids);
  const history = e.history.filter(x => text(x.display_id) !== id).slice(0, 10).map(x => `${text(x.display_id)} — ${text(x['event.start'])}`).filter(x => x !== ' — ');
  const timeline = e.snapshots.slice(0, 12).map(x => `${text(x.timestamp)} — ${text(x['event.status_transition']) || text(x['event.status']) || text(x['event.name'])}`).filter(x => x.trim() !== '—');
  const errorNote = assistError ? `Dynatrace Assist was unavailable for this run (${assistError}). The RCA below is generated directly from retrieved Davis evidence; no unverified root cause is asserted.` : 'The RCA below is generated directly from retrieved Davis evidence.';
  return `1. Executive Summary\n${title} (${id}) is ${status} with severity ${severity}. ${signal || 'No stronger causal signal was returned by Davis.'} ${root ? `Native root-cause entity: ${root}.` : 'No definitive native root-cause entity was returned.'} ${errorNote}\n\n2. Incident Overview\nProblem: ${id}\nTitle: ${title}\nCategory: ${category}\nImpact level: ${impact}\nAffected users: ${users}\nStarted: ${start}\nEnded: ${end || 'Still open / end time not returned'}\nAffected entities: ${entities || 'Not returned'}\n\n3. Root Cause Assessment\n${root ? `Observed native Davis root-cause entity: ${root}.` : 'No definitive root-cause entity is present in the retrieved problem record.'} ${signal ? `Supporting observed signal: ${signal}` : 'A supporting causal signal was not returned.'} This assessment does not convert correlation into a confirmed cause.\n\n4. Technical Root-Cause Chain\nObserved chain: Problem ${id} → Davis event evidence${strongest ? ` (${fact(strongest['event.name'])})` : ''} → affected entity context${entities ? ` (${entities})` : ''}. Any deeper infrastructure, deployment, database or code-level cause is not proven by the retrieved evidence.\n\n5. Incident Timeline\n${timeline.length ? timeline.join('\n') : `${start} — Problem started. ${end ? `${end} — Problem ended.` : 'Problem remains open / end time not returned.'}`}\n\n6. Past Occurrences & Recurrence Pattern\n${history.length ? history.join('\n') : `No additional matching occurrences were returned for event name '${title}'.`}\n\n7. Impact Assessment\nImpact level: ${impact}. Affected users: ${users}. Correlated event rows: ${e.events.length}. Incident log rows: ${e.logs.length}. These counts describe retrieved evidence, not business impact beyond what Davis reported.\n\n8. Immediate Remediation Plan\n1) Investigate the native root-cause entity or strongest causal event first. 2) Validate the underlying metric/event on the affected entity. 3) Check logs in the retrieved incident window. 4) Do not change production configuration until the causal signal is validated.\n\n9. Permanent / Preventive Actions\nUse the confirmed causal signal to define the permanent action. If the cause is not confirmed, continue correlation across the affected entity, event timeline and recurring problem history before implementing a permanent fix.\n\n10. Monitoring & Alerting Recommendations\nMonitor the affected entity and the root-cause-relevant Davis event where available; retain the problem ID/event ID correlation; alert on recurrence of the same event signature; and track resolution duration and recurrence frequency.\n\n11. Validation Checklist\n□ Root-cause entity/signal validated against the underlying telemetry.\n□ Affected service/workload recovered.\n□ Problem no longer reproduces.\n□ No recurrence in the agreed observation window.\n□ Permanent action documented only after causal validation.\n\n12. RCA Confidence & Evidence Gaps\nConfidence: ${root && signal ? 'Medium — native root-cause entity plus supporting signal were returned.' : signal ? 'Low/Medium — supporting evidence exists but no definitive native root-cause entity was returned.' : 'Low — insufficient causal evidence returned.'}\nEvidence retrieved: ${e.events.length} events, ${e.logs.length} logs, ${e.history.length} matching historical problems, ${e.snapshots.length} timeline snapshots. Missing or unproven items must not be treated as facts.`;
}

async function ask(id: string, e: Evidence): Promise<{ analysis: string; assistError?: string }> {
  const evidence = JSON.stringify({ problem: e.problem, timeline: e.snapshots.slice(0, 50), correlatedEvents: e.events.slice(0, 70), incidentLogs: e.logs.slice(0, 80), pastOccurrences: e.history.slice(0, 30) }).slice(0, 26000);
  const prompt = `Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. Analyze ONLY the retrieved evidence below. Do not claim lack of access and do not ask for telemetry already included. Separate observed facts from inference. Never invent metrics, timestamps, deployments, root causes, affected users, recurrence or remediation results. If unproven, say "Not proven by available evidence". Recommendations are proposals only. Return exactly these 12 sections: 1. Executive Summary 2. Incident Overview 3. Root Cause Assessment 4. Technical Root-Cause Chain 5. Incident Timeline 6. Past Occurrences & Recurrence Pattern 7. Impact Assessment 8. Immediate Remediation Plan 9. Permanent / Preventive Actions 10. Monitoring & Alerting Recommendations 11. Validation Checklist 12. RCA Confidence & Evidence Gaps.\n\nRETRIEVED DYNATRACE EVIDENCE:\n${evidence}`;
  try {
    const response = await publicClient.recommenderConversation({ body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: evidence }, { type: 'instruction', value: 'Analyze the supplied evidence directly. Do not produce a generic access limitation response.' }], annotations: { origin: 'Axis Davis Capacity Planner RCA', problemId: id } } });
    const answer = extractAssistText(response);
    if (answer) return { analysis: answer };
    return { analysis: fallbackRca(id, e, 'empty response'), assistError: 'empty response' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'request failed';
    return { analysis: fallbackRca(id, e, message), assistError: message };
  }
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  const evidence = await loadEvidence(payload.problemId);
  const result = await ask(payload.problemId, evidence);
  const p = evidence.problem;
  const nativeRootCauseEntity = text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id) || null;
  return { problemId: payload.problemId, analysis: result.analysis, generatedAt: new Date().toISOString(), nativeRootCauseEntity, definitiveRootCause: Boolean(nativeRootCauseEntity), assistFallback: Boolean(result.assistError), evidenceSummary: { correlatedEvents: evidence.events.length, incidentLogs: evidence.logs.length, historicalOccurrences: evidence.history.length, timelineSnapshots: evidence.snapshots.length } };
}
