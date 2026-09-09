import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; snapshots: Row[]; occurrences: Occurrence[]; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const record = value as Row;
    for (const key of ['name', 'entityName', 'displayName', 'id', 'entityId', 'value']) {
      const found = text(record[key]);
      if (found) return found;
    }
  }
  return '';
};

const q = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const duration = (start: string, end: string): string => {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const mins = Math.max(0, b - a) / 60000;
  return mins < 60 ? `${mins.toFixed(1)} min` : mins < 1440 ? `${(mins / 60).toFixed(1)} h` : `${(mins / 1440).toFixed(1)} d`;
};
const rows = (value: unknown): Row[] => !Array.isArray(value) ? [] : value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item));

async function dql(query: string, max = 100): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max },
  });
  if (response.result) return rows(response.result.records);
  if (!response.requestToken) throw new Error('DQL did not return a result or request token.');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 30000 });
    if (polled.result) return rows(polled.result.records);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('DQL did not complete within the polling window.');
}

async function loadEvidence(id: string): Promise<Evidence> {
  const escapedId = q(id);
  const problemRows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate) and display_id == "${escapedId}"
| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,root_cause.smartscape_entity,root_cause_entity_id
| limit 1`, 1);
  if (!problemRows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);

  const problem = problemRows[0];
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();
  const title = text(problem['event.name']);
  const eventIds = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(text).filter(Boolean) : [];
  const entityIds = Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(text).filter(Boolean) : [text(problem.affected_entity_ids)].filter(Boolean);
  const eventList = [...new Set(eventIds)].slice(0, 80).map((value) => `"${q(value)}"`).join(', ');
  const entityList = [...new Set(entityIds)].slice(0, 80).map((value) => `"${q(value)}"`).join(', ');

  const eventQuery = eventList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()
| filter in(event.id,array(${eventList}))
| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.query,dt.davis.is_rootcause_relevant,root_cause_entity_id
| sort event.start asc
| limit 100`, 100).catch(() => [] as Row[]) : Promise.resolve([] as Row[]);

  const logQuery = start && entityList ? dql(`fetch logs, from:now()-365d, to:now()
| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m
| filter in(dt.source_entity,array(${entityList}))
| fields timestamp,dt.source_entity,status,severity,content,message
| sort timestamp asc
| limit 100`, 100).catch(() => [] as Row[]) : Promise.resolve([] as Row[]);

  const historyQuery = title ? dql(`fetch dt.davis.problems, from:now()-30d, to:now()
| filter not(dt.davis.is_duplicate) and event.name == "${q(title)}"
| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,resolved_problem_duration,root_cause.smartscape_entity,root_cause_entity_id
| sort event.start desc
| limit 40`, 40).catch(() => [] as Row[]) : Promise.resolve([] as Row[]);

  const snapshotQuery = text(problem['event.id']) ? dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()
| filter event.id == "${q(text(problem['event.id']))}"
| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id
| sort timestamp asc
| limit 80`, 80).catch(() => [] as Row[]) : Promise.resolve([] as Row[]);

  const [events, logs, history, snapshots] = await Promise.all([eventQuery, logQuery, historyQuery, snapshotQuery]);
  const occurrences: Occurrence[] = history.map((row) => ({
    problemId: text(row.display_id),
    title: text(row['event.name']),
    status: text(row['event.status']),
    severity: text(row['event.severity']),
    start: text(row['event.start']),
    end: text(row['event.end']),
    duration: duration(text(row['event.start']), text(row['event.end'])),
  })).filter((item) => Boolean(item.problemId));

  return { problem, events, logs, history, snapshots, occurrences };
}

function fallbackRca(id: string, evidence: Evidence, reason = ''): string {
  const problem = evidence.problem;
  const root = text(problem['root_cause.smartscape_entity']) || text(problem.root_cause_entity_id);
  const signal = text(evidence.events.find((event) => event['dt.davis.is_rootcause_relevant'] === true)?.['event.description']) || text(problem['event.description']);
  const rootLine = root ? `Davis exposed ${root} as the root-cause entity.` : 'Davis did not expose a definitive root-cause entity. Not proven by available evidence.';
  const assistNote = reason ? `\n\nDavis Assist status: ${reason}` : '';
  return `## Executive Summary\nProblem ${id} is ${text(problem['event.status']) || 'in an unknown state'} with severity ${text(problem['event.severity']) || 'not available'}. ${signal || 'The retrieved evidence confirms the incident but does not expose a definitive causal signal.'}${assistNote}\n\n## Incident Overview\nTitle: ${text(problem['event.name']) || 'Dynatrace Problem'}\nStarted: ${text(problem['event.start']) || 'Not available'}\nEnded: ${text(problem['event.end']) || 'Open / not available'}\nImpact: ${text(problem['dt.davis.impact_level']) || 'Not available'}\n\n## Root Cause Assessment\n${rootLine}\n\n## Technical Root-Cause Chain\nObserved symptom → retrieved Davis evidence → affected entity. Any deeper causal relationship is not proven by available evidence.\n\n## Incident Timeline\n${text(problem['event.start']) || 'Start not available'} → ${text(problem['event.end']) || 'Open / not available'}\n\n## Past Occurrences & Recurrence Pattern\n${evidence.occurrences.length === 40 ? 'At least 40' : evidence.occurrences.length} matching occurrence records were retrieved from the last 30 days.\n\n## Impact Assessment\nImpact level: ${text(problem['dt.davis.impact_level']) || 'Not available'}.\n\n## Immediate Remediation Plan\nValidate the retrieved Davis signal against the affected entity and confirm recovery in Dynatrace before closing the incident.\n\n## Permanent / Preventive Actions\nAddress the causal component only after root cause confirmation; add monitoring for the observed failure pattern.\n\n## Monitoring & Alerting Recommendations\nMonitor the affected service/entity, response time, error rate, dependency health and recurrence frequency.\n\n## Validation Checklist\nConfirm root cause, correlate metrics/logs/traces, validate remediation, verify recovery and monitor recurrence.\n\n## RCA Confidence & Evidence Gaps\n${root && signal ? 'Medium' : 'Low'} — ${rootLine}`;
}

function assistEvidence(id: string, evidence: Evidence): string {
  const p = evidence.problem;
  const payload = {
    problem: {
      id,
      title: text(p['event.name']),
      status: text(p['event.status']),
      severity: text(p['event.severity']),
      category: text(p['event.category']),
      start: text(p['event.start']),
      end: text(p['event.end']),
      duration: duration(text(p['event.start']), text(p['event.end'])),
      description: text(p['event.description']),
      rootCause: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id),
      impact: text(p['dt.davis.impact_level']),
      affectedUsers: text(p['dt.davis.affected_users_count']),
    },
    timeline: evidence.snapshots.slice(0, 50),
    correlatedEvents: evidence.events.slice(0, 70),
    incidentLogs: evidence.logs.slice(0, 50),
    pastOccurrences: evidence.history.slice(0, 30),
  };
  return JSON.stringify(payload).slice(0, 18000);
}

async function ask(id: string, evidence: Evidence): Promise<{ analysis: string; assistFallback: boolean; assistStatus: string }> {
  const evidenceText = assistEvidence(id, evidence);
  // IMPORTANT: Dynatrace Davis Copilot validates body.text independently and limits it to 10,000 chars.
  // Keep the instruction prompt small; put retrieved evidence in the supplementary context instead.
  const prompt = `Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. Analyze ONLY the supplied retrieved evidence. Do not claim lack of access. Separate observed facts from inference. Never invent metrics, timestamps, deployments, root causes, affected users, recurrence or remediation results. If unproven, say "Not proven by available evidence". Recommendations are proposals only. Return exactly these 12 sections: Executive Summary; Incident Overview; Root Cause Assessment; Technical Root-Cause Chain; Incident Timeline; Past Occurrences & Recurrence Pattern; Impact Assessment; Immediate Remediation Plan; Permanent / Preventive Actions; Monitoring & Alerting Recommendations; Validation Checklist; RCA Confidence & Evidence Gaps.`;

  try {
    const response = await publicClient.recommenderConversation({
      body: {
        text: prompt,
        context: [
          { type: 'document-retrieval', value: 'disabled' },
          { type: 'supplementary', value: evidenceText },
          { type: 'instruction', value: 'Analyze the supplied evidence directly. Do not produce a generic access limitation response.' },
        ],
        annotations: { origin: 'Axis Problem Intelligence RCA', problemId: id },
      },
    });

    if (Array.isArray(response)) {
      return { analysis: fallbackRca(id, evidence, 'Assist returned a streaming event array; the app expects the non-streaming response.'), assistFallback: true, assistStatus: 'unexpected streaming response' };
    }

    const result = response as { status?: string; text?: string; answer?: string; content?: string };
    if (result.status === 'FAILED') {
      return { analysis: fallbackRca(id, evidence, 'Dynatrace Assist returned FAILED.'), assistFallback: true, assistStatus: 'FAILED' };
    }

    const answer = [result.text, result.answer, result.content]
      .find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
    if (!answer) {
      return { analysis: fallbackRca(id, evidence, 'Dynatrace Assist returned an empty RCA.'), assistFallback: true, assistStatus: 'empty response' };
    }
    return { analysis: answer, assistFallback: false, assistStatus: result.status || 'SUCCESSFUL' };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown Dynatrace Assist error.';
    return { analysis: fallbackRca(id, evidence, reason), assistFallback: true, assistStatus: reason };
  }
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  if (!/^P-\d+$/.test(payload.problemId)) throw new Error('A valid Dynatrace Problem ID such as P-260948426 is required.');

  const evidence = await loadEvidence(payload.problemId);
  const result = await ask(payload.problemId, evidence);
  const problem = evidence.problem;
  const nativeRootCauseEntity = text(problem['root_cause.smartscape_entity']) || text(problem.root_cause_entity_id) || text(evidence.events.find((event) => event['dt.davis.is_rootcause_relevant'] === true)?.root_cause_entity_id) || null;

  return {
    problemId: payload.problemId,
    analysis: result.analysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity,
    definitiveRootCause: Boolean(nativeRootCauseEntity),
    assistFallback: result.assistFallback,
    assistStatus: result.assistStatus,
    recurrenceWindow: '30d',
    managementZones: [],
    occurrenceCount: evidence.occurrences.length,
    occurrences: evidence.occurrences,
    problemFacts: {
      title: text(problem['event.name']) || 'Dynatrace Problem',
      status: text(problem['event.status']) || 'Not available',
      severity: text(problem['event.severity']) || 'Not available',
      start: text(problem['event.start']),
      end: text(problem['event.end']),
      duration: duration(text(problem['event.start']), text(problem['event.end'])),
      impactLevel: text(problem['dt.davis.impact_level']) || 'Not available',
      affectedUsers: text(problem['dt.davis.affected_users_count']),
      affectedEntities: text(problem.affected_entity_ids),
    },
    evidenceSummary: {
      correlatedEvents: evidence.events.length,
      incidentLogs: evidence.logs.length,
      historicalOccurrences: evidence.history.length,
      timelineSnapshots: evidence.snapshots.length,
    },
  };
}