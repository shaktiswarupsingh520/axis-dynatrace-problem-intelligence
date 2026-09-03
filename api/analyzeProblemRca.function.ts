import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Evidence { problem: Row; events: Row[]; snapshots: Row[]; history: Row[]; related: Row[]; logs: Row[]; deployments: Row[]; }

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  const serialized = JSON.stringify(value);
  return serialized ?? '';
};
const dqlEscape = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface DqlResponse {
  result?: { records?: Array<Row | null> };
  state?: string;
  requestToken?: string;
}

const rowsFromResponse = (response: DqlResponse): Row[] =>
  (response.result?.records ?? []).filter((record): record is Row => record !== null);

async function dql(query: string, max = 200): Promise<Row[]> {
  const response: DqlResponse = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max },
  });
  let result = response.result;
  let state = response.state;
  const token = response.requestToken;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll: DqlResponse = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = poll.state;
    result = poll.result;
    if (!result && state === 'RUNNING') await sleep(250);
  }
  if (!result) throw new Error(`RCA evidence query did not complete (state: ${state}).`);
  return rowsFromResponse({ result });
}

const durationMinutes = (start: string, end: string) => {
  const a = new Date(start).getTime();
  const b = new Date(end || new Date().toISOString()).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) / 60000 : null;
};

async function loadEvidence(problemId: string): Promise<Evidence> {
  const id = dqlEscape(problemId);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${id}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,event.kind,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,dt.analysis.ready,resolved_problem_duration,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids,smartscape.affected_entities\n| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);
  const problem = rows[0];
  const ids = Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(text).filter(Boolean) : [text(problem.affected_entity_ids)].filter(Boolean);
  const entityList = [...new Set(ids)].slice(0, 100).map((x) => `"${dqlEscape(x)}"`).join(', ');
  const eventIds = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(text).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 100).map((x) => `"${dqlEscape(x)}"`).join(', ');
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();
  const events = eventList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,event.provider,dt.source_entity,dt.smartscape_source.id,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 120`, 120).catch(() => []) : Promise.resolve([] as Row[]);
  const snapshots = dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${dqlEscape(text(problem['event.id']))}"\n| fields timestamp,event.id,event.status,event.status_transition,event.severity,event.name,event.start,event.end,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids\n| sort timestamp asc\n| limit 120`, 120).catch(() => []);
  const history = dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${dqlEscape(text(problem['event.name']))}"\n| fields display_id,event.name,event.status,event.severity,event.category,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity,root_cause_entity_id,dt.davis.affected_users_count\n| sort event.start desc\n| limit 50`, 50).catch(() => []);
  const related = entityList ? dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate)\n| expand affected_entity_ids\n| filter in(affected_entity_ids,array(${entityList}))\n| fields display_id,event.name,event.status,event.severity,event.category,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity,root_cause_entity_id,affected_entity_ids\n| sort event.start desc\n| limit 50`, 50).catch(() => []) : Promise.resolve([] as Row[]);
  const logs = entityList ? dql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${dqlEscape(start)}") - 30m and timestamp <= toTimestamp("${dqlEscape(end)}") + 30m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 120`, 120).catch(() => []) : Promise.resolve([] as Row[]);
  const deployments = entityList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter event.type == "CUSTOM_DEPLOYMENT"\n| filter event.start >= toTimestamp("${dqlEscape(start)}") - 2h and event.start <= toTimestamp("${dqlEscape(end)}") + 2h\n| filter in(dt.source_entity,array(${entityList}))\n| fields event.id,event.name,event.type,event.start,event.end,event.description,event.provider,dt.source_entity,dt.smartscape_source.id\n| sort event.start asc\n| limit 50`, 50).catch(() => []) : Promise.resolve([] as Row[]);

  const [eventRows, snapshotRows, historyRows, relatedRows, logRows, deploymentRows] = await Promise.all([events, snapshots, history, related, logs, deployments]);
  return { problem, events: eventRows, snapshots: snapshotRows, history: historyRows, related: relatedRows, logs: logRows, deployments: deploymentRows };
}

async function askAssist(problemId: string, evidence: Evidence): Promise<{ text: string; status: string }> {
  const p = evidence.problem;
  const context = JSON.stringify({
    problem: { id: text(p.display_id), title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), category: text(p['event.category']), start: text(p['event.start']), end: text(p['event.end']), durationMinutes: durationMinutes(text(p['event.start']), text(p['event.end'])), description: text(p['event.description']), nativeRootCauseEntity: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id), impact: text(p['dt.davis.impact_level']), affectedUsers: text(p['dt.davis.affected_users_count']), analysisReady: text(p['dt.analysis.ready']), affectedEntityIds: text(p.affected_entity_ids) },
    timeline: evidence.snapshots.slice(0, 60), correlatedEvents: evidence.events.slice(0, 90), pastOccurrences: evidence.history.slice(0, 35), relatedProblems: evidence.related.slice(0, 35), incidentLogs: evidence.logs.slice(0, 100), nearbyDeployments: evidence.deployments.slice(0, 40),
  }).slice(0, 45000);
  const prompt = `You are the senior Dynatrace SRE RCA analyst. Produce an evidence-first RCA for Dynatrace Problem ${problemId}. The application already retrieved the relevant Davis/Grail evidence. Do not give generic troubleshooting advice and do not claim a root cause that is not supported by the evidence.\n\nROOT-CAUSE RULES:\n- First check nativeRootCauseEntity. If present, treat it as the strongest Davis root-cause signal and name the exact entity.\n- If nativeRootCauseEntity is empty, inspect root-cause-relevant events, snapshots, affected entities, correlated events, logs and deployments for a causal chain.\n- Distinguish PROVEN ROOT CAUSE from PROBABLE CAUSE.\n- If no definitive causal entity is supported, explicitly say: "Davis did not return a definitive root-cause entity; the following is an evidence-based probable cause."\n- Never invent metrics, entities, deployments, timestamps, affected users, remediation results or service names.\n- Recommendations are proposed actions only.\n- Use recurrence evidence from pastOccurrences and relatedProblems.\n\nReturn exactly these sections:\n1. Executive Summary\n2. Root Cause Assessment\n3. Technical Root-Cause Chain\n4. Evidence & Timeline\n5. Recurrence Pattern\n6. Business / Technical Impact\n7. Deployment / Change Correlation\n8. Immediate Remediation\n9. Permanent Prevention\n10. Validation Checklist\n11. Confidence & Evidence Gaps\n\nRoot Cause Assessment must contain: definitive root-cause entity (or explicitly not proven), supporting evidence, confidence High/Medium/Low, and why alternative causes are weaker. Technical Root-Cause Chain must connect signal -> contributing condition -> impacted component -> observed problem.\n\nDYNATRACE EVIDENCE:\n${context}`;
  const response = await publicClient.recommenderConversation({ acceptType: 'application/json', body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: context }, { type: 'instruction', value: 'Use only the supplied incident evidence. Do not produce a generic RCA. State clearly when a definitive root cause is not proven.' }], annotations: { origin: 'Axis Problem Intelligence RCA', problemId } } });
  if (response.status === 'FAILED') throw new Error('Dynatrace Assist RCA failed. Verify davis-copilot:conversations:execute and tenant availability.');
  const responseText = response.text;
  const normalizedText = typeof responseText === 'string' ? responseText.trim() : '';
  return { text: normalizedText, status: response.status };
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  const evidence = await loadEvidence(payload.problemId);
  const rootCauseEntity = text(evidence.problem['root_cause.smartscape_entity']) || text(evidence.problem.root_cause_entity_id) || '';
  const assist = await askAssist(payload.problemId, evidence);
  if (!assist.text) throw new Error('Dynatrace Assist returned an empty RCA.');
  return { problemId: payload.problemId, nativeRootCauseEntity: rootCauseEntity || null, definitiveRootCause: Boolean(rootCauseEntity), analysis: assist.text, generatedAt: new Date().toISOString(), evidenceSummary: { correlatedEvents: evidence.events.length, snapshots: evidence.snapshots.length, historicalOccurrences: evidence.history.length, relatedProblems: evidence.related.length, incidentLogs: evidence.logs.length, nearbyDeployments: evidence.deployments.length } };
}
