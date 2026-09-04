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

const duration = (a: string, b: string) => {
  const x = new Date(a).getTime();
  const y = b ? new Date(b).getTime() : Date.now();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return Math.max(0, y - x) / 60000;
};

async function loadEvidence(id: string): Promise<Evidence> {
  const pid = q(id);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${pid}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,root_cause.smartscape_entity,root_cause_entity_id\n| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);
  const p = rows[0];
  const ids = Array.isArray(p.affected_entity_ids) ? p.affected_entity_ids.map(text).filter(Boolean) : [text(p.affected_entity_ids)].filter(Boolean);
  const entityList = [...new Set(ids)].slice(0, 80).map(x => `"${q(x)}"`).join(', ');
  const eventIds = Array.isArray(p['dt.davis.event_ids']) ? p['dt.davis.event_ids'].map(text).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 80).map(x => `"${q(x)}"`).join(', ');
  const start = text(p['event.start']);
  const end = text(p['event.end']) || new Date().toISOString();
  const events = eventList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.query,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 100`, 100).catch(() => []) : Promise.resolve([] as Row[]);
  const logs = entityList ? dql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 100`, 100).catch(() => []) : Promise.resolve([] as Row[]);
  const history = dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(text(p['event.name']))}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,resolved_problem_duration,root_cause.smartscape_entity\n| sort event.start desc\n| limit 40`, 40).catch(() => []);
  const snapshots = dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(text(p['event.id']))}"\n| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id\n| sort timestamp asc\n| limit 80`, 80).catch(() => []);
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
  if (Array.isArray(tokens)) return tokens.map(text).join('').trim();
  return '';
}

async function ask(id: string, e: Evidence): Promise<string> {
  const p = e.problem;
  const evidence = JSON.stringify({
    problem: {
      id: text(p.display_id), title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), category: text(p['event.category']),
      start: text(p['event.start']), end: text(p['event.end']), durationMinutes: duration(text(p['event.start']), text(p['event.end'])), description: text(p['event.description']),
      rootCause: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id), impact: text(p['dt.davis.impact_level']), affectedUsers: text(p['dt.davis.affected_users_count'])
    },
    timeline: e.snapshots.slice(0, 50), correlatedEvents: e.events.slice(0, 70), incidentLogs: e.logs.slice(0, 80), pastOccurrences: e.history.slice(0, 30)
  }).slice(0, 26000);
  const prompt = `Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. Analyze ONLY the retrieved evidence below. Do not claim lack of access and do not ask for telemetry already included. Separate observed facts from inference. Never invent metrics, timestamps, deployments, root causes, affected users, recurrence or remediation results. If unproven, say "Not proven by available evidence". Recommendations are proposals only.\n\nReturn exactly: 1. Executive Summary 2. Incident Overview 3. Root Cause Assessment 4. Technical Root-Cause Chain 5. Incident Timeline 6. Past Occurrences & Recurrence Pattern 7. Impact Assessment 8. Immediate Remediation Plan 9. Permanent / Preventive Actions 10. Monitoring & Alerting Recommendations 11. Validation Checklist 12. RCA Confidence & Evidence Gaps.\n\nRETRIEVED DYNATRACE EVIDENCE:\n${evidence}`;
  const response = await publicClient.recommenderConversation({ body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: evidence }, { type: 'instruction', value: 'Analyze the supplied evidence directly. Do not produce a generic access limitation response.' }], annotations: { origin: 'Axis Davis Capacity Planner RCA', problemId: id } } });
  const answer = extractAssistText(response);
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  const evidence = await loadEvidence(payload.problemId);
  const analysis = await ask(payload.problemId, evidence);
  return {
    problemId: payload.problemId,
    analysis,
    generatedAt: new Date().toISOString(),
    evidenceSummary: {
      correlatedEvents: evidence.events.length,
      incidentLogs: evidence.logs.length,
      historicalOccurrences: evidence.history.length,
      timelineSnapshots: evidence.snapshots.length
    }
  };
}
