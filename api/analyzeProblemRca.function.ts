import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AnalyzePayload { problemId: string; }
interface Occurrence { problemId: string; title: string; status: string; severity: string; start: string; end: string; duration: string; }
interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; snapshots: Row[]; occurrenceCount: number; occurrences: Occurrence[]; managementZones: string[]; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const r = value as Row;
    for (const k of ['name', 'entityName', 'displayName', 'id', 'entityId', 'value']) { const v = text(r[k]); if (v) return v; }
  }
  return '';
};
const q = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const duration = (start: string, end: string) => { const a = new Date(start).getTime(); const b = end ? new Date(end).getTime() : Date.now(); if (!Number.isFinite(a) || !Number.isFinite(b)) return '—'; const mins = Math.max(0, b - a) / 60000; return mins < 60 ? `${mins.toFixed(1)} min` : mins < 1440 ? `${(mins / 60).toFixed(1)} h` : `${(mins / 1440).toFixed(1)} d`; };
const normalizeRows = (value: unknown): Row[] => !Array.isArray(value) ? [] : value.filter((x): x is Row => Boolean(x) && typeof x === 'object' && !Array.isArray(x));

function findValue(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) { for (const item of value) { const found = findValue(item, keys); if (found) return found; } return ''; }
  const r = value as Row;
  for (const key of keys) { const v = text(r[key]); if (v) return v; }
  for (const child of Object.values(r)) { const found = findValue(child, keys); if (found) return found; }
  return '';
}

async function boundedDql(query: string, max = 50): Promise<Row[]> {
  try {
    const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 2500, maxResultRecords: max } });
    if (response.result) return normalizeRows(response.result.records);
    if (response.requestToken) { const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 2000 }); return normalizeRows(poll.result?.records); }
  } catch (error) { void error; }
  return [];
}

function nativeToProblem(native: unknown, id: string): Row {
  const p = (native && typeof native === 'object' ? native : {}) as Row;
  const root = findValue(p, ['rootCauseEntity', 'root_cause_entity_id', 'rootCause', 'smartscapeEntity']);
  return { ...p, display_id: text(p.displayId) || text(p.display_id) || id, 'event.name': text(p.title) || text(p.problemTitle) || text(p.eventName) || 'Dynatrace Problem', 'event.status': text(p.status) || 'UNKNOWN', 'event.severity': text(p.severityLevel) || text(p.severity) || 'UNKNOWN', 'event.start': text(p.startTime) || text(p.start), 'event.end': text(p.endTime) || text(p.end), 'dt.davis.impact_level': text(p.impactLevel) || text(p.impact), root_cause_entity_id: root, nativeProblem: p };
}

async function loadEvidence(id: string): Promise<Evidence> {
  const native = await problemsClient.getProblem({ problemId: id, fields: 'evidenceDetails,impactAnalysis,recentComments' });
  const problem = nativeToProblem(native, id);
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();
  const title = text(problem['event.name']);
  const affectedNames = findValue(native, ['affectedEntityNames', 'affectedEntities']);
  const names = affectedNames.split(';').map((x) => x.trim()).filter(Boolean).slice(0, 30);
  const entityFilter = names.length ? `| filter in(dt.source_entity,array(${names.map((x) => `"${q(x)}"`).join(',')}))` : '';
  const eventsQuery = start ? `fetch dt.davis.events, from:now()-2h, to:now()\n| filter event.start >= toTimestamp("${q(start)}") - 15m and event.start <= toTimestamp("${q(end)}") + 15m\n| fields event.id,event.name,event.type,event.status,event.severity,event.start,event.end,event.description,dt.source_entity,dt.davis.is_rootcause_relevant,root_cause_entity_id\n| sort event.start asc\n| limit 40` : '';
  const logsQuery = start && names.length ? `fetch logs, from:now()-2h, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n${entityFilter}\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 20` : '';
  const historyQuery = title ? `fetch dt.davis.problems, from:now()-30d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(title)}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,root_cause.smartscape_entity,root_cause_entity_id\n| sort event.start desc\n| limit 100` : '';
  const [events, logs, history] = await Promise.all([eventsQuery ? boundedDql(eventsQuery, 40) : Promise.resolve([] as Row[]), logsQuery ? boundedDql(logsQuery, 20) : Promise.resolve([] as Row[]), historyQuery ? boundedDql(historyQuery, 100) : Promise.resolve([] as Row[])]);
  const occurrences: Occurrence[] = history.map((row) => ({ problemId: text(row.display_id), title: text(row['event.name']), status: text(row['event.status']), severity: text(row['event.severity']), start: text(row['event.start']), end: text(row['event.end']), duration: duration(text(row['event.start']), text(row['event.end'])) })).filter((x) => Boolean(x.problemId));
  const managementZones = [...new Set([findValue(native, ['managementZoneName', 'managementZone'])].filter(Boolean))];
  return { problem, events, logs, history, snapshots: [], occurrenceCount: occurrences.length, occurrences, managementZones };
}

function fallbackRca(id: string, evidence: Evidence): string {
  const p = evidence.problem;
  const root = text(p.root_cause_entity_id) || findValue(p.nativeProblem, ['rootCauseEntity', 'rootCause', 'smartscapeEntity']);
  const impact = text(p['dt.davis.impact_level']) || 'Not available';
  const signal = text(evidence.events.find((e) => e['dt.davis.is_rootcause_relevant'] === true)?.['event.description']) || text(p['event.description']);
  const rootLine = root ? `Davis exposed ${root} as the root-cause entity.` : 'Davis did not expose a definitive root-cause entity. Not proven by available evidence.';
  return `## Executive Summary\nProblem ${id} is ${text(p['event.status']) || 'in an unknown state'} with severity ${text(p['event.severity']) || 'not available'}. ${signal || 'The retrieved evidence confirms the incident but does not expose a definitive causal signal.'}\n\n## Incident Overview\nTitle: ${text(p['event.name']) || 'Dynatrace Problem'}\nStarted: ${text(p['event.start']) || 'Not available'}\nEnded: ${text(p['event.end']) || 'Open / not available'}\nImpact: ${impact}\n\n## Root Cause Assessment\n${rootLine}\n\n## Technical Root-Cause Chain\nObserved problem symptom → retrieved Davis evidence → affected problem entities. Any deeper causal relationship is not proven by available evidence.\n\n## Incident Timeline\n${text(p['event.start']) || 'Start not available'} → ${text(p['event.end']) || 'Open / not available'}\n\n## Past Occurrences & Recurrence Pattern\n${evidence.occurrenceCount} matching occurrences were retrieved from the last 30 days.\n\n## Impact Assessment\nImpact level: ${impact}. Affected users/entities are reported by the native Dynatrace problem response where available.\n\n## Immediate Remediation Plan\nValidate the retrieved Davis signal against the affected entity and confirm recovery in Dynatrace before closing the incident.\n\n## Permanent / Preventive Actions\nAddress the causal component only after the root cause is confirmed; add monitoring for the observed failure pattern.\n\n## Monitoring & Alerting Recommendations\nMonitor the affected service/entity, response time, error rate, dependency health and recurrence frequency.\n\n## Validation Checklist\nConfirm root cause, correlate metrics/logs/traces, validate remediation, verify recovery and monitor recurrence.\n\n## RCA Confidence & Evidence Gaps\n${root && signal ? 'Medium' : 'Low'} — ${rootLine}`;
}

function extractAssistText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractAssistText).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const r = value as Row;
  for (const key of ['text', 'answer', 'content', 'message']) { const v = extractAssistText(r[key]); if (v) return v; }
  return Array.isArray(r.tokens) ? r.tokens.map(text).join('').trim() : '';
}

async function ask(id: string, evidence: Evidence): Promise<{ analysis: string; assistFallback: boolean }> {
  const p = evidence.problem;
  const compactEvidence = JSON.stringify({ problem: { id, title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), start: text(p['event.start']), end: text(p['event.end']), impact: text(p['dt.davis.impact_level']), rootCause: text(p.root_cause_entity_id), nativeEvidence: p.nativeProblem }, correlatedEvents: evidence.events.slice(0, 20), incidentLogs: evidence.logs.slice(0, 10), pastOccurrences: evidence.history.slice(0, 20), managementZones: evidence.managementZones }).slice(0, 14000);
  const prompt = `Create a customer-ready Dynatrace incident RCA for Problem ${id}. Use ONLY the supplied evidence. Never invent facts. Clearly distinguish observed facts from inference. If a cause is not proven, say "Not proven by available evidence". Return exactly these 12 sections with markdown headings: Executive Summary; Incident Overview; Root Cause Assessment; Technical Root-Cause Chain; Incident Timeline; Past Occurrences & Recurrence Pattern; Impact Assessment; Immediate Remediation Plan; Permanent / Preventive Actions; Monitoring & Alerting Recommendations; Validation Checklist; RCA Confidence & Evidence Gaps.\n\nEVIDENCE:\n${compactEvidence}`;
  try {
    const response = await Promise.race([publicClient.recommenderConversation({ body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: compactEvidence }, { type: 'instruction', value: 'Analyze the supplied Dynatrace evidence directly.' }], annotations: { origin: 'Axis Problem Intelligence RCA', problemId: id } } }), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Assist timeout')), 9000))]);
    const answer = extractAssistText(response);
    if (answer) return { analysis: answer, assistFallback: false };
  } catch (error) { void error; }
  return { analysis: fallbackRca(id, evidence), assistFallback: true };
}

export default async function (payload: AnalyzePayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  if (!/^P-\d+$/.test(payload.problemId)) throw new Error('A valid Dynatrace Problem ID such as P-260948426 is required.');
  const evidence = await loadEvidence(payload.problemId);
  const result = await ask(payload.problemId, evidence);
  const p = evidence.problem;
  const nativeRootCauseEntity = text(p.root_cause_entity_id) || findValue(p.nativeProblem, ['rootCauseEntity', 'rootCause', 'smartscapeEntity']) || text(evidence.events.find((e) => e['dt.davis.is_rootcause_relevant'] === true)?.root_cause_entity_id) || null;
  return { problemId: payload.problemId, analysis: result.analysis, generatedAt: new Date().toISOString(), nativeRootCauseEntity, definitiveRootCause: Boolean(nativeRootCauseEntity), assistFallback: result.assistFallback, recurrenceWindow: '30d', managementZones: evidence.managementZones, occurrenceCount: evidence.occurrenceCount, occurrences: evidence.occurrences, problemFacts: { title: text(p['event.name']) || 'Dynatrace Problem', status: text(p['event.status']) || 'Not available', severity: text(p['event.severity']) || 'Not available', start: text(p['event.start']), end: text(p['event.end']), duration: duration(text(p['event.start']), text(p['event.end'])), impactLevel: text(p['dt.davis.impact_level']) || 'Not available', affectedUsers: findValue(p.nativeProblem, ['affectedUsersCount', 'affected_users_count']), affectedEntities: findValue(p.nativeProblem, ['affectedEntityNames', 'affectedEntities']) }, evidenceSummary: { correlatedEvents: evidence.events.length, incidentLogs: evidence.logs.length, historicalOccurrences: evidence.history.length, timelineSnapshots: evidence.snapshots.length } };
}
