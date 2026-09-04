import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; snapshots: Row[]; occurrenceCount: number; occurrences: Occurrence[]; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return '';
};
const q = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const duration = (start: string, end: string) => {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const mins = Math.max(0, b - a) / 60000;
  return mins < 60 ? `${mins.toFixed(1)} min` : mins < 1440 ? `${(mins / 60).toFixed(1)} h` : `${(mins / 1440).toFixed(1)} d`;
};

async function dql(query: string, max = 200): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result;
  const token = response.requestToken;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    result = poll.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (!result) throw new Error('DQL did not complete.');
  const records: unknown = result.records;
  if (!Array.isArray(records)) return [];
  return records.filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));
}

async function loadEvidence(id: string): Promise<Evidence> {
  const pid = q(id);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${pid}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,affected_entity_names,root_cause.smartscape_entity,root_cause_entity_id\n| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);
  const problem: Row = rows[0];
  const entityIds: string[] = Array.isArray(problem.affected_entity_ids)
    ? problem.affected_entity_ids.map(text).filter(Boolean)
    : [text(problem.affected_entity_ids)].filter(Boolean);
  const entityList = [...new Set(entityIds)].slice(0, 50).map((value) => `"${q(value)}"`).join(', ');
  const eventIds: string[] = Array.isArray(problem['dt.davis.event_ids'])
    ? problem['dt.davis.event_ids'].map(text).filter(Boolean)
    : [];
  const eventList = eventIds.slice(0, 60).map((value) => `"${q(value)}"`).join(', ');
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();
  const events: Row[] = eventList
    ? await dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.smartscape_source.type,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 80`, 80).catch(() => [])
    : [];
  const logs: Row[] = entityList && start
    ? await dql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| sort timestamp asc\n| limit 25`, 25).catch(() => [])
    : [];
  const eventName = q(text(problem['event.name']));
  const history: Row[] = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${eventName}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,root_cause.smartscape_entity,dt.davis.affected_users_count\n| sort event.start desc\n| limit 100`, 100).catch(() => []);
  let occurrenceCount = history.length;
  try {
    const countRows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${eventName}"\n| summarize occurrenceCount=count()`, 5);
    const countValue: unknown = countRows[0]?.occurrenceCount;
    const countNumber = typeof countValue === 'number' ? countValue : Number(text(countValue));
    if (Number.isFinite(countNumber)) occurrenceCount = countNumber;
  } catch {
    // Use retrieved history length if aggregate count is unavailable.
  }
  const snapshots: Row[] = text(problem['event.id'])
    ? await dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(text(problem['event.id']))}"\n| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id\n| sort timestamp asc\n| limit 50`, 50).catch(() => [])
    : [];
  const occurrences: Occurrence[] = history.map((row: Row): Occurrence => ({
    problemId: text(row.display_id),
    title: text(row['event.name']),
    status: text(row['event.status']),
    severity: text(row['event.severity']),
    start: text(row['event.start']),
    end: text(row['event.end']),
    duration: duration(text(row['event.start']), text(row['event.end'])),
  })).filter((occurrence) => Boolean(occurrence.problemId));
  return { problem, events, logs, history, snapshots, occurrenceCount, occurrences };
}

function extractAssistText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractAssistText).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Row;
  for (const key of ['text', 'answer', 'content', 'message']) {
    const candidate = extractAssistText(record[key]);
    if (candidate) return candidate;
  }
  const tokens: unknown = record.tokens;
  return Array.isArray(tokens) ? tokens.map(text).join('').trim() : '';
}

function fallbackRca(id: string, evidence: Evidence): string {
  const problem = evidence.problem;
  const title = text(problem['event.name']) || 'Dynatrace problem';
  const status = text(problem['event.status']) || 'Not available';
  const severity = text(problem['event.severity']) || 'Not available';
  const root = text(problem['root_cause.smartscape_entity']) || text(problem.root_cause_entity_id);
  const entities = text(problem.affected_entity_names) || text(problem.affected_entity_ids) || 'Not returned';
  const causal = evidence.events.find((event) => event['dt.davis.is_rootcause_relevant'] === true) ?? evidence.events[0];
  const signal = text(causal?.['event.description']) || text(causal?.['event.name']) || text(problem['event.description']);
  const timeline = evidence.snapshots.slice(0, 12).map((row) => `${text(row.timestamp)} — ${text(row['event.status_transition']) || text(row['event.status']) || text(row['event.name'])}`).filter((value) => !value.endsWith('— '));
  const history = evidence.occurrences.slice(0, 12).map((occurrence) => `${occurrence.problemId} — ${occurrence.start} — ${occurrence.status}`);
  return `# ROOT CAUSE ANALYSIS REPORT\n\n## ${id}: ${title}\n\n### EXECUTIVE SUMMARY\n**Incident Status:** ${status}\n**Severity:** Level ${severity}\n**Current Impact:** ${text(problem['dt.davis.impact_level']) || 'Not available'}\n**Root-cause entity:** ${root || 'Not proven by available evidence'}\n**Assessment:** ${signal || 'No causal signal was returned by Davis.'}\n\n### INCIDENT OVERVIEW\nProblem: ${id}\nStarted: ${text(problem['event.start']) || 'Not available'}\nEnded: ${text(problem['event.end']) || 'Still open / not returned'}\nAffected users: ${text(problem['dt.davis.affected_users_count']) || 'Not available'}\nAffected entities: ${entities}\nDescription: ${text(problem['event.description']) || 'Not available'}\n\n### ROOT CAUSE ASSESSMENT\n${root ? `Davis identifies ${root} as the native root-cause entity.` : 'A definitive root-cause entity is not exposed in the retrieved problem record.'} ${signal ? `Supporting Davis signal: ${signal}` : 'Supporting causal evidence is limited.'}\n\n### TECHNICAL ROOT-CAUSE CHAIN\nProblem → ${causal ? `Davis event ${text(causal['event.name']) || 'event'}` : 'Davis evidence'} → ${entities}. Deeper code, database, deployment or infrastructure causality is not proven by the retrieved evidence.\n\n### INCIDENT TIMELINE\n${timeline.length ? timeline.join('\n') : `${text(problem['event.start']) || 'Start not returned'} — problem started`}\n\n### PAST OCCURRENCES & RECURRENCE PATTERN\nTotal matching occurrences in the last 365 days: ${evidence.occurrenceCount}.\n${history.length ? history.join('\n') : 'No occurrence records were returned.'}\n\n### IMPACT ASSESSMENT\nImpact level: ${text(problem['dt.davis.impact_level']) || 'Not available'}\nAffected users: ${text(problem['dt.davis.affected_users_count']) || 'Not available'}\nRetrieved evidence: ${evidence.events.length} correlated events, ${evidence.logs.length} logs, ${evidence.snapshots.length} timeline snapshots.\n\n### IMMEDIATE REMEDIATION PLAN\n1. Validate the native root-cause entity or strongest causal Davis event.\n2. Verify the underlying metric/telemetry on the affected entity.\n3. Review the incident-window logs before changing production configuration.\n4. Confirm recovery in Davis after remediation.\n\n### PERMANENT / PREVENTIVE ACTIONS\nImplement a permanent fix only after the causal signal is validated. Add targeted monitoring for the confirmed failure signature and review recurrence history for similar problems.\n\n### MONITORING & ALERTING RECOMMENDATIONS\nTrack the root-cause entity, event signature, recurrence count, resolution duration and affected-user impact. Preserve problem/event correlation for future RCA.\n\n### VALIDATION CHECKLIST\n□ Root cause validated against telemetry.\n□ Impacted service/workload recovered.\n□ Problem closed without immediate recurrence.\n□ Permanent action documented.\n\n### RCA CONFIDENCE & EVIDENCE GAPS\nConfidence: ${root && signal ? 'Medium/High' : signal ? 'Medium' : 'Low'}. No unsupported cause is asserted. Missing telemetry or deployment evidence remains an evidence gap.`;
}

async function ask(id: string, evidence: Evidence): Promise<{ analysis: string; assistFallback: boolean }> {
  const problem = evidence.problem;
  const compactEvidence = JSON.stringify({
    problem: {
      id,
      title: text(problem['event.name']),
      status: text(problem['event.status']),
      severity: text(problem['event.severity']),
      category: text(problem['event.category']),
      start: text(problem['event.start']),
      end: text(problem['event.end']),
      description: text(problem['event.description']),
      rootCause: text(problem['root_cause.smartscape_entity']) || text(problem.root_cause_entity_id),
      impact: text(problem['dt.davis.impact_level']),
      affectedUsers: text(problem['dt.davis.affected_users_count']),
      affectedEntities: text(problem.affected_entity_names),
      occurrenceCount: evidence.occurrenceCount,
    },
    timeline: evidence.snapshots.slice(0, 20),
    correlatedEvents: evidence.events.slice(0, 25),
    incidentLogs: evidence.logs.slice(0, 12),
    pastOccurrences: evidence.history.slice(0, 12),
  }).slice(0, 6800);
  const prompt = `Create a customer-ready incident RCA for Davis Problem ${id}. Use ONLY the supplied evidence. Never invent facts. Clearly distinguish observed facts from inference. If a cause is not proven, say "Not proven by available evidence". Return these sections: Executive Summary; Incident Overview; Root Cause Assessment; Technical Root-Cause Chain; Incident Timeline; Past Occurrences & Recurrence Pattern; Impact Assessment; Immediate Remediation Plan; Permanent / Preventive Actions; Monitoring & Alerting Recommendations; Validation Checklist; RCA Confidence & Evidence Gaps.\n\nEVIDENCE:\n${compactEvidence}`;
  try {
    const response = await publicClient.recommenderConversation({ body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: compactEvidence }, { type: 'instruction', value: 'Analyze the supplied Dynatrace evidence directly. Do not respond with an access limitation.' }], annotations: { origin: 'Axis Davis Capacity Planner RCA', problemId: id } } });
    const answer = extractAssistText(response);
    if (answer) return { analysis: answer, assistFallback: false };
  } catch {
    // Fall back to deterministic evidence-backed RCA.
  }
  return { analysis: fallbackRca(id, evidence), assistFallback: true };
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  const evidence = await loadEvidence(payload.problemId);
  const result = await ask(payload.problemId, evidence);
  const problem = evidence.problem;
  const nativeRootCauseEntity = text(problem['root_cause.smartscape_entity']) || text(problem.root_cause_entity_id) || null;
  return {
    problemId: payload.problemId,
    analysis: result.analysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity,
    definitiveRootCause: Boolean(nativeRootCauseEntity),
    assistFallback: result.assistFallback,
    evidenceSummary: { correlatedEvents: evidence.events.length, incidentLogs: evidence.logs.length, historicalOccurrences: evidence.occurrenceCount, timelineSnapshots: evidence.snapshots.length },
    occurrenceCount: evidence.occurrenceCount,
    occurrences: evidence.occurrences,
  };
}
