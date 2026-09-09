import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; snapshots: Row[]; occurrences: Occurrence[]; managementZones: string[]; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const r = value as Row;
    for (const key of ['name', 'entityName', 'displayName', 'id', 'entityId', 'value']) {
      const found = text(r[key]);
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

const normalizeRows = (value: unknown): Row[] => !Array.isArray(value) ? [] : value.filter((item): item is Row => Boolean(item) && typeof item === 'object' && !Array.isArray(item));

function findValue(value: unknown, keys: string[], seen = new Set<object>()): string {
  if (!value || typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, keys, seen);
      if (found) return found;
    }
    return '';
  }
  const record = value as Row;
  for (const key of keys) {
    const found = text(record[key]);
    if (found) return found;
  }
  for (const child of Object.values(record)) {
    const found = findValue(child, keys, seen);
    if (found) return found;
  }
  return '';
}

async function safeDql(query: string, max = 50): Promise<Row[]> {
  try {
    const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 2500, maxResultRecords: max } });
    if (response.result) return normalizeRows(response.result.records);
    if (response.requestToken) {
      const polled = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 2000 });
      return normalizeRows(polled.result?.records);
    }
  } catch (error) {
    void error;
  }
  return [];
}

function problemFromRow(row: Row, id: string): Row {
  return {
    display_id: text(row.display_id) || id,
    'event.name': text(row['event.name']) || 'Dynatrace Problem',
    'event.status': text(row['event.status']) || 'UNKNOWN',
    'event.severity': text(row['event.severity']) || 'UNKNOWN',
    'event.start': text(row['event.start']),
    'event.end': text(row['event.end']),
    'event.description': text(row['event.description']),
    'dt.davis.impact_level': text(row['dt.davis.impact_level']),
    root_cause_entity_id: text(row.root_cause_entity_id) || text(row['root_cause.smartscape_entity']),
    affected_entity_names: text(row.affected_entity_names),
    affected_users_count: text(row.affected_users_count),
  };
}

function problemFromNative(native: unknown, id: string): Row {
  const record = (native && typeof native === 'object') ? native as Row : {};
  return {
    display_id: text(record.displayId) || text(record.display_id) || id,
    'event.name': text(record.title) || text(record.problemTitle) || text(record.eventName) || 'Dynatrace Problem',
    'event.status': text(record.status) || 'UNKNOWN',
    'event.severity': text(record.severityLevel) || text(record.severity) || 'UNKNOWN',
    'event.start': text(record.startTime) || text(record.start),
    'event.end': text(record.endTime) || text(record.end),
    'event.description': text(record.description) || text(record.eventDescription),
    'dt.davis.impact_level': text(record.impactLevel) || text(record.impact),
    root_cause_entity_id: findValue(record, ['rootCauseEntity', 'root_cause_entity_id', 'smartscapeEntity']),
    affected_entity_names: findValue(record, ['affectedEntityNames']),
    affected_users_count: findValue(record, ['affectedUsersCount', 'affected_users_count']),
  };
}

async function loadProblem(id: string): Promise<Row> {
  try {
    const native = await problemsClient.getProblem({ problemId: id, fields: 'evidenceDetails,impactAnalysis,recentComments' });
    return problemFromNative(native, id);
  } catch (error) {
    void error;
  }
  const rows = await safeDql(`fetch dt.davis.problems, from:now()-7d, to:now()\n| filter display_id == "${q(id)}"\n| limit 1`, 1);
  return rows[0] ? problemFromRow(rows[0], id) : { display_id: id, 'event.name': 'Dynatrace Problem', 'event.status': 'UNKNOWN', 'event.severity': 'UNKNOWN' };
}

async function loadEvidence(id: string): Promise<Evidence> {
  const problem = await loadProblem(id);
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();
  const title = text(problem['event.name']);
  const affected = text(problem.affected_entity_names);
  const entities = affected.split(';').map((item) => item.trim()).filter(Boolean).slice(0, 20);
  const entityFilter = entities.length ? `| filter in(dt.source_entity,array(${entities.map((name) => `"${q(name)}"`).join(',')}))` : '';

  const eventQuery = start ? `fetch dt.davis.events, from:now()-2h, to:now()\n| filter event.start >= toTimestamp("${q(start)}") - 15m and event.start <= toTimestamp("${q(end)}") + 15m\n| fields event.id,event.name,event.type,event.status,event.severity,event.start,event.end,event.description,dt.source_entity,dt.davis.is_rootcause_relevant,root_cause_entity_id\n| sort event.start asc\n| limit 40` : '';
  const logQuery = start && entities.length ? `fetch logs, from:now()-2h, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n${entityFilter}\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 20` : '';
  const historyQuery = title ? `fetch dt.davis.problems, from:now()-30d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(title)}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,root_cause.smartscape_entity,root_cause_entity_id\n| sort event.start desc\n| limit 100` : '';

  const [events, logs, history] = await Promise.all([
    eventQuery ? safeDql(eventQuery, 40) : Promise.resolve([] as Row[]),
    logQuery ? safeDql(logQuery, 20) : Promise.resolve([] as Row[]),
    historyQuery ? safeDql(historyQuery, 100) : Promise.resolve([] as Row[]),
  ]);

  const occurrences: Occurrence[] = history.map((row) => ({
    problemId: text(row.display_id),
    title: text(row['event.name']),
    status: text(row['event.status']),
    severity: text(row['event.severity']),
    start: text(row['event.start']),
    end: text(row['event.end']),
    duration: duration(text(row['event.start']), text(row['event.end'])),
  })).filter((item) => Boolean(item.problemId));

  return { problem, events, logs, history, snapshots: [], occurrences, managementZones: [] };
}

function fallbackRca(id: string, evidence: Evidence): string {
  const problem = evidence.problem;
  const root = text(problem.root_cause_entity_id);
  const signal = text(evidence.events.find((event) => event['dt.davis.is_rootcause_relevant'] === true)?.['event.description']) || text(problem['event.description']);
  const rootLine = root ? `Davis exposed ${root} as the root-cause entity.` : 'Davis did not expose a definitive root-cause entity. Not proven by available evidence.';
  const recurrence = evidence.occurrences.length === 100 ? 'At least 100' : String(evidence.occurrences.length);
  return `## Executive Summary\nProblem ${id} is ${text(problem['event.status']) || 'in an unknown state'} with severity ${text(problem['event.severity']) || 'not available'}. ${signal || 'The retrieved evidence confirms the incident but does not expose a definitive causal signal.'}\n\n## Incident Overview\nTitle: ${text(problem['event.name']) || 'Dynatrace Problem'}\nStarted: ${text(problem['event.start']) || 'Not available'}\nEnded: ${text(problem['event.end']) || 'Open / not available'}\nImpact: ${text(problem['dt.davis.impact_level']) || 'Not available'}\n\n## Root Cause Assessment\n${rootLine}\n\n## Technical Root-Cause Chain\nObserved symptom → retrieved Davis evidence → affected entity. Any deeper causal relationship is not proven by available evidence.\n\n## Incident Timeline\n${text(problem['event.start']) || 'Start not available'} → ${text(problem['event.end']) || 'Open / not available'}\n\n## Past Occurrences & Recurrence Pattern\n${recurrence} matching occurrence records were retrieved from the last 30 days.\n\n## Impact Assessment\nImpact level: ${text(problem['dt.davis.impact_level']) || 'Not available'}.\n\n## Immediate Remediation Plan\nValidate the retrieved Davis signal against the affected entity and confirm recovery in Dynatrace before closing the incident.\n\n## Permanent / Preventive Actions\nAddress the causal component only after root cause confirmation; add monitoring for the observed failure pattern.\n\n## Monitoring & Alerting Recommendations\nMonitor the affected service/entity, response time, error rate, dependency health and recurrence frequency.\n\n## Validation Checklist\nConfirm root cause, correlate metrics/logs/traces, validate remediation, verify recovery and monitor recurrence.\n\n## RCA Confidence & Evidence Gaps\n${root && signal ? 'Medium' : 'Low'} — ${rootLine}`;
}

function extractAssistText(value: unknown, seen = new Set<object>()): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((item) => extractAssistText(item, seen)).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  if (seen.has(value)) return '';
  seen.add(value);
  const record = value as Row;
  for (const key of ['text', 'answer', 'content', 'message']) {
    const found = extractAssistText(record[key], seen);
    if (found) return found;
  }
  return '';
}

function safeAssistEvidence(id: string, evidence: Evidence): string {
  const problem = evidence.problem;
  const payload = {
    problem: {
      id,
      title: text(problem['event.name']),
      status: text(problem['event.status']),
      severity: text(problem['event.severity']),
      start: text(problem['event.start']),
      end: text(problem['event.end']),
      impact: text(problem['dt.davis.impact_level']),
      rootCause: text(problem.root_cause_entity_id),
      affectedEntities: text(problem.affected_entity_names),
      affectedUsers: text(problem.affected_users_count),
      description: text(problem['event.description']),
    },
    correlatedEvents: evidence.events.slice(0, 20).map((event) => ({
      id: text(event['event.id']), name: text(event['event.name']), type: text(event['event.type']), status: text(event['event.status']), severity: text(event['event.severity']),
      start: text(event['event.start']), end: text(event['event.end']), description: text(event['event.description']), source: text(event['dt.source_entity']),
      rootRelevant: event['dt.davis.is_rootcause_relevant'] === true, rootCause: text(event.root_cause_entity_id),
    })),
    incidentLogs: evidence.logs.slice(0, 10).map((log) => ({ timestamp: text(log.timestamp), source: text(log['dt.source_entity']), status: text(log.status), severity: text(log.severity), content: text(log.content) || text(log.message) })),
    pastOccurrences: evidence.occurrences.slice(0, 20),
  };
  return JSON.stringify(payload);
}

async function ask(id: string, evidence: Evidence): Promise<{ analysis: string; assistFallback: boolean }> {
  const compactEvidence = safeAssistEvidence(id, evidence);
  const prompt = `Create a customer-ready Dynatrace incident RCA for Problem ${id}. Use ONLY the supplied evidence. Never invent facts. Clearly distinguish observed facts from inference. If a cause is not proven, say "Not proven by available evidence". Return exactly these 12 sections with markdown headings: Executive Summary; Incident Overview; Root Cause Assessment; Technical Root-Cause Chain; Incident Timeline; Past Occurrences & Recurrence Pattern; Impact Assessment; Immediate Remediation Plan; Permanent / Preventive Actions; Monitoring & Alerting Recommendations; Validation Checklist; RCA Confidence & Evidence Gaps.\n\nEVIDENCE:\n${compactEvidence}`;
  try {
    const response = await Promise.race([
      publicClient.recommenderConversation({
        body: {
          text: prompt,
          context: [
            { type: 'document-retrieval', value: 'disabled' },
            { type: 'supplementary', value: compactEvidence },
            { type: 'instruction', value: 'Analyze the supplied Dynatrace evidence directly.' },
          ],
          annotations: { origin: 'Axis Problem Intelligence RCA', problemId: id },
        },
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Assist timeout')), 9000)),
    ]);
    const answer = extractAssistText(response);
    if (answer) return { analysis: answer, assistFallback: false };
  } catch (error) {
    void error;
  }
  return { analysis: fallbackRca(id, evidence), assistFallback: true };
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  if (!/^P-\d+$/.test(payload.problemId)) throw new Error('A valid Dynatrace Problem ID such as P-260948426 is required.');
  const evidence = await loadEvidence(payload.problemId);
  const result = await ask(payload.problemId, evidence);
  const problem = evidence.problem;
  const nativeRootCauseEntity = text(problem.root_cause_entity_id) || text(evidence.events.find((event) => event['dt.davis.is_rootcause_relevant'] === true)?.root_cause_entity_id) || null;

  return {
    problemId: payload.problemId,
    analysis: result.analysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity,
    definitiveRootCause: Boolean(nativeRootCauseEntity),
    assistFallback: result.assistFallback,
    recurrenceWindow: '30d',
    managementZones: evidence.managementZones,
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
      affectedUsers: text(problem.affected_users_count),
      affectedEntities: text(problem.affected_entity_names),
    },
    evidenceSummary: {
      correlatedEvents: evidence.events.length,
      incidentLogs: evidence.logs.length,
      historicalOccurrences: evidence.history.length,
      timelineSnapshots: evidence.snapshots.length,
    },
  };
}
