import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; snapshots: Row[]; occurrenceCount: number; occurrences: Occurrence[]; managementZones: string[]; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};
const q = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const duration = (start: string, end: string) => {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const mins = Math.max(0, b - a) / 60000;
  return mins < 60 ? `${mins.toFixed(1)} min` : mins < 1440 ? `${(mins / 60).toFixed(1)} h` : `${(mins / 1440).toFixed(1)} d`;
};
const normalizeRows = (value: unknown): Row[] => !Array.isArray(value) ? [] : value.filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));

async function dql(query: string, max = 200): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result;
  const token = response.requestToken;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    result = poll.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
  if (!result) throw new Error('DQL did not complete.');
  return normalizeRows(result.records);
}

async function safeDql(query: string, max = 200): Promise<Row[]> {
  try { return await dql(query, max); } catch (error) { void error; return []; }
}

async function findManagementZones(problem: Row): Promise<string[]> {
  const names = Array.isArray(problem.related_entity_names) ? problem.related_entity_names.map(text).filter(Boolean) : [];
  if (!names.length) return [];
  const nameList = [...new Set(names)].slice(0, 80).map((name) => `"${q(name)}"`).join(', ');
  const rows = await safeDql(`fetch dt.entity.host\n| filter in(entity.name,array(${nameList}))\n| expand managementZones\n| filter isNotNull(managementZones)\n| dedup managementZones\n| fields managementZones\n| limit 50`, 50);
  return [...new Set(rows.map((row) => text(row.managementZones)).filter(Boolean))];
}

async function loadEvidence(id: string): Promise<Evidence> {
  const pid = q(id);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${pid}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,affected_entity_names,related_entity_names,root_cause.smartscape_entity,root_cause_entity_id\n| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);
  const problem: Row = rows[0];
  const managementZones = await findManagementZones(problem);
  const rawEntityIds: unknown = problem.affected_entity_ids;
  const entityIds = Array.isArray(rawEntityIds) ? rawEntityIds.map(text).filter(Boolean) : [text(rawEntityIds)].filter(Boolean);
  const entityList = [...new Set(entityIds)].slice(0, 50).map((value) => `"${q(value)}"`).join(', ');
  const rawEventIds: unknown = problem['dt.davis.event_ids'];
  const eventIds = Array.isArray(rawEventIds) ? rawEventIds.map(text).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 60).map((value) => `"${q(value)}"`).join(', ');
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();

  const eventQuery = eventList ? `fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.smartscape_source.type,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 80` : '';
  const logQuery = entityList && start ? `fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 25` : '';

  const zoneFilter = managementZones.length
    ? `\n| expand related_entity_names\n| lookup sourceField:related_entity_names, lookupField:entity.name, [\n  fetch dt.entity.host\n  | expand managementZones\n  | filter in(managementZones,array(${managementZones.map((zone) => `"${q(zone)}"`).join(', ')}))\n  | fields entity.name\n], fields:{zoneHostName=entity.name}\n| filter isNotNull(zoneHostName)\n| dedup display_id`
    : '';
  const historyQuery = `fetch dt.davis.problems, from:now()-30d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(text(problem['event.name']))}"${zoneFilter}\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,root_cause.smartscape_entity,dt.davis.affected_users_count\n| sort event.start desc\n| limit 100`;
  const snapshotQuery = text(problem['event.id']) ? `fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(text(problem['event.id']))}"\n| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id\n| sort timestamp asc\n| limit 50` : '';

  const [events, logs, history, snapshots] = await Promise.all([
    eventQuery ? safeDql(eventQuery, 80) : Promise.resolve([] as Row[]),
    logQuery ? safeDql(logQuery, 25) : Promise.resolve([] as Row[]),
    safeDql(historyQuery, 100),
    snapshotQuery ? safeDql(snapshotQuery, 50) : Promise.resolve([] as Row[]),
  ]);
  const occurrenceCount = history.length;
  const occurrences: Occurrence[] = history.map((row): Occurrence => ({
    problemId: text(row.display_id), title: text(row['event.name']), status: text(row['event.status']), severity: text(row['event.severity']),
    start: text(row['event.start']), end: text(row['event.end']), duration: duration(text(row['event.start']), text(row['event.end'])),
  })).filter((occurrence) => Boolean(occurrence.problemId));
  return { problem, events, logs, history, snapshots, occurrenceCount, occurrences, managementZones };
}

function extractAssistText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractAssistText).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Row;
  for (const key of ['text', 'answer', 'content', 'message']) { const candidate = extractAssistText(record[key]); if (candidate) return candidate; }
  const tokens: unknown = record.tokens;
  return Array.isArray(tokens) ? tokens.map(text).join('').trim() : '';
}

function fallbackRca(id: string, evidence: Evidence): string {
  const p = evidence.problem;
  const title = text(p['event.name']) || 'Dynatrace problem';
  const root = text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id);
  const signal = text(evidence.events.find((event) => event['dt.davis.is_rootcause_relevant'] === true)?.['event.description']) || text(evidence.events[0]?.['event.name']) || text(p['event.description']);
  const scope = evidence.managementZones.length ? evidence.managementZones.join(', ') : 'Management zone could not be derived from the problem entities';
  return `ROOT CAUSE ANALYSIS\n\nProblem: ${id}\nTitle: ${title}\nStatus: ${text(p['event.status']) || 'Not available'}\nSeverity: ${text(p['event.severity']) || 'Not available'}\nManagement zone scope: ${scope}\nRoot-cause entity: ${root || 'Not proven by available evidence'}\n\nExecutive Summary\n${signal || 'No causal signal was returned by Davis.'}\n\nRoot Cause Assessment\n${root ? `Davis identified ${root} as a root-cause entity.` : 'Davis did not return a definitive root-cause entity. The following assessment is based on available evidence.'} ${signal || ''}\n\nTechnical Root-Cause Chain\nProblem → ${signal || 'Davis event evidence'} → ${text(p.affected_entity_names) || text(p.affected_entity_ids) || 'affected entity not returned'}\n\nTimeline\n${text(p['event.start']) || 'Start not returned'} → ${text(p['event.end']) || 'Open / end not returned'}\n\nRecurrence\n${evidence.occurrenceCount} matching occurrences in the last 30 days within the derived management-zone scope.\n\nImpact\nImpact level: ${text(p['dt.davis.impact_level']) || 'Not available'}; affected users: ${text(p['dt.davis.affected_users_count']) || 'Not available'}\n\nRemediation\nValidate the root-cause signal on the affected entity, review the incident-window logs, and confirm recovery in Davis before closing the incident.\n\nConfidence\n${root && signal ? 'Medium/High' : 'Low'} — no unsupported root cause is asserted.`;
}

async function ask(id: string, evidence: Evidence): Promise<{ analysis: string; assistFallback: boolean }> {
  const p = evidence.problem;
  const compactEvidence = JSON.stringify({
    problem: { id, title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), category: text(p['event.category']), start: text(p['event.start']), end: text(p['event.end']), description: text(p['event.description']), rootCause: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id), impact: text(p['dt.davis.impact_level']), affectedUsers: text(p['dt.davis.affected_users_count']), affectedEntities: text(p.affected_entity_names), managementZones: evidence.managementZones, occurrenceCount: evidence.occurrenceCount },
    timeline: evidence.snapshots.slice(0, 20), correlatedEvents: evidence.events.slice(0, 25), incidentLogs: evidence.logs.slice(0, 12), pastOccurrences: evidence.history.slice(0, 20),
  }).slice(0, 9800);
  const prompt = `Create a customer-ready incident RCA for Davis Problem ${id}. Use ONLY the supplied evidence. Never invent facts. Clearly distinguish observed facts from inference. If a cause is not proven, say "Not proven by available evidence". The recurrence scope is authoritative: ONLY the last 30 days and ONLY the management-zone scope listed in the evidence. The field occurrenceCount is the authoritative total number of matching occurrences. The pastOccurrences array is only a display sample and may be truncated; NEVER use its array length as the total. In Past Occurrences & Recurrence Pattern, report the authoritative occurrenceCount and do not replace it with the number of sample rows. Return sections: Executive Summary; Incident Overview; Root Cause Assessment; Technical Root-Cause Chain; Incident Timeline; Past Occurrences & Recurrence Pattern; Impact Assessment; Immediate Remediation Plan; Permanent / Preventive Actions; Monitoring & Alerting Recommendations; Validation Checklist; RCA Confidence & Evidence Gaps.\n\nEVIDENCE:\n${compactEvidence}`;
  try {
    const response = await publicClient.recommenderConversation({ body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: compactEvidence }, { type: 'instruction', value: 'Analyze the supplied Dynatrace evidence directly. Do not respond with an access limitation.' }], annotations: { origin: 'Axis Davis Capacity Planner RCA', problemId: id } } });
    const answer = extractAssistText(response);
    if (answer) return { analysis: answer, assistFallback: false };
  } catch (error) { void error; }
  return { analysis: fallbackRca(id, evidence), assistFallback: true };
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  const evidence = await loadEvidence(payload.problemId);
  const result = await ask(payload.problemId, evidence);
  const p = evidence.problem;
  const nativeRootCauseEntity = text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id) || null;
  return {
    problemId: payload.problemId,
    analysis: result.analysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity,
    definitiveRootCause: Boolean(nativeRootCauseEntity),
    assistFallback: result.assistFallback,
    problemFacts: {
      title: text(p['event.name']) || 'Dynatrace problem',
      status: text(p['event.status']) || 'Not available',
      severity: text(p['event.severity']) || 'Not available',
      category: text(p['event.category']) || 'Not available',
      start: text(p['event.start']),
      end: text(p['event.end']),
      duration: duration(text(p['event.start']), text(p['event.end'])),
      impactLevel: text(p['dt.davis.impact_level']) || 'Not available',
      affectedUsers: text(p['dt.davis.affected_users_count']) || 'Not available',
      affectedEntities: text(p.affected_entity_names) || text(p.affected_entity_ids) || 'Not available',
    },
    evidenceSummary: { correlatedEvents: evidence.events.length, incidentLogs: evidence.logs.length, historicalOccurrences: evidence.occurrenceCount, timelineSnapshots: evidence.snapshots.length },
    occurrenceCount: evidence.occurrenceCount,
    occurrences: evidence.occurrences,
    managementZones: evidence.managementZones,
    recurrenceWindow: '30d',
  };
}
