import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface Payload { problemId: string; }
interface Evidence {
  problem: Row;
  events: Row[];
  logs: Row[];
  history: Row[];
  snapshots: Row[];
  managementZones: string[];
}

const s = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(s).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    const o = v as Row;
    if ('name' in o && s(o.name)) return s(o.name);
    return JSON.stringify(v) ?? '';
  }
  return '';
};
const q = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const duration = (a: string, b: string) => {
  const x = new Date(a).getTime(); const y = b ? new Date(b).getTime() : Date.now();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '—';
  const m = Math.max(0, y - x) / 60000;
  return m < 60 ? `${m.toFixed(1)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`;
};

async function dql(query: string, max = 100): Promise<Row[]> {
  const started = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = started.result;
  for (let i = 0; !result && started.requestToken && i < 30; i += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: started.requestToken, requestTimeoutMilliseconds: 30000 });
    result = polled.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (!result) throw new Error('Dynatrace evidence query did not complete.');
  return Array.isArray(result.records) ? result.records.filter((r): r is Row => Boolean(r) && typeof r === 'object' && !Array.isArray(r)) : [];
}

async function optionalDql(query: string, max = 100): Promise<Row[]> {
  try { return await dql(query, max); } catch { return []; }
}

function extract(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extract).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const r = value as Row;
  for (const key of ['text', 'answer', 'content', 'message']) { const found = extract(r[key]); if (found) return found; }
  return Array.isArray(r.tokens) ? r.tokens.map(s).join('').trim() : '';
}

function flattenZones(rows: Row[]): string[] {
  const values: string[] = [];
  for (const row of rows) {
    const raw = row.managementZones;
    if (Array.isArray(raw)) raw.forEach((v) => { const value = s(v); if (value) values.push(value); });
    else { const value = s(raw); if (value) values.push(value); }
  }
  return [...new Set(values)].slice(0, 30);
}

function snapshotStatus(snapshot: Row): string {
  const raw = snapshot.event;
  const event = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Row : {};
  return s(event.status_transition) || s(event.status) || 'Davis state';
}

function fallback(id: string, p: Row, reason: string, events: Row[], history: Row[], logs: Row[], snapshots: Row[]): string {
  const title = s(p['event.name']) || 'Dynatrace Problem';
  const status = s(p['event.status']) || 'Not available';
  const severity = s(p['event.severity']) || 'Not available';
  const impact = s(p['dt.davis.impact_level']) || 'Not available';
  const start = s(p['event.start']); const end = s(p['event.end']);
  const rootValue = p['root_cause.smartscape_entity'];
  const root = typeof rootValue === 'object' && rootValue !== null ? s((rootValue as Row).name) || s((rootValue as Row).id) : s(rootValue) || s(p.root_cause_entity_id);
  const signal = events.map((e) => s(e['event.description']) || s(e['event.name'])).filter(Boolean).slice(0, 3).join(' | ');
  return `## Executive Summary\n${title} (${id}) is ${status.toLowerCase()} with severity ${severity}. ${root ? `Davis exposed ${root} as the root-cause entity.` : 'Not proven by available evidence.'}\n\n## Incident Overview\nTitle: ${title}\nStatus: ${status}\nSeverity: ${severity}\nStarted: ${start || 'Not available'}\nDuration: ${duration(start, end)}\n\n## Root Cause Assessment\n${root ? `Davis identified ${root} as the root-cause entity.` : 'Not proven by available evidence.'}\n\n## Technical Root-Cause Chain\n${signal || 'Not proven by available evidence.'}\n\n## Incident Timeline\n${snapshots.length ? snapshots.slice(0, 12).map((e) => `${s(e.timestamp) || 'Time unavailable'} — ${snapshotStatus(e)}`).join('\n') : events.length ? events.slice(0, 8).map((e) => `${s(e['event.start']) || 'Time unavailable'} — ${s(e['event.name']) || 'Davis event'}`).join('\n') : 'Not available.'}\n\n## Past Occurrences & Recurrence Pattern\n${history.length ? `${history.length} matching Davis occurrence(s) retrieved from the last 30 days.` : 'No matching past occurrences were retrieved from the last 30 days.'}\n\n## Impact Assessment\nImpact level: ${impact}. Affected-user count: ${s(p['dt.davis.affected_users_count']) || 'Not available'}. Incident logs retrieved: ${logs.length}.\n\n## Immediate Remediation Plan\nValidate the identified Davis evidence and affected dependency before making a production change.\n\n## Permanent / Preventive Actions\nNot proposed as completed actions; validate the causal signal first.\n\n## Monitoring & Alerting Recommendations\nMonitor the affected service, response time, errors, dependency health and the Davis causal signal.\n\n## Validation Checklist\nConfirm recovery, verify the causal metric returns to baseline, and verify that the problem does not recur.\n\n## RCA Confidence & Evidence Gaps\nEvidence based — Dynatrace Assist did not return the generated RCA. ${reason}`;
}

async function load(id: string): Promise<Evidence> {
  await problemsClient.getProblem({ problemId: id, fields: 'evidenceDetails,impactAnalysis,recentComments' }).catch(() => undefined);
  const problems = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${q(id)}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,affected_entity_names,root_cause.smartscape_entity,root_cause_entity_id,dt.analysis.ready\n| limit 1`, 5);
  if (!problems.length) throw new Error(`Problem ${id} was not found in Dynatrace Grail.`);

  const problem = problems[0];
  const affectedIds = Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(s).filter(Boolean) : [s(problem.affected_entity_ids)].filter(Boolean);
  const eventIds = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(s).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 80).map((x) => `"${q(x)}"`).join(', ');
  const start = s(problem['event.start']);
  const end = s(problem['event.end']) || new Date().toISOString();

  const events = eventList ? await optionalDql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.smartscape_source.type,dt.query,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 100`, 100) : [];

  const sourceIds = [...new Set([
    ...affectedIds,
    ...events.map((e) => s(e['dt.source_entity'])).filter(Boolean),
    ...events.map((e) => s(e['dt.smartscape_source.id'])).filter(Boolean),
  ])].slice(0, 100);
  const entityList = sourceIds.map((x) => `"${q(x)}"`).join(', ');

  const logs = entityList ? await optionalDql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 100`, 100) : [];

  const history = await optionalDql(`fetch dt.davis.problems, from:now()-30d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(s(problem['event.name']))}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,resolved_problem_duration,root_cause.smartscape_entity\n| sort event.start desc\n| limit 100`, 100);

  const snapshots = await optionalDql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(s(problem['event.id']))}"\n| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id\n| sort timestamp asc\n| limit 80`, 80);

  const entityIdsForZones = sourceIds.slice(0, 80);
  const zoneList = entityIdsForZones.map((x) => `"${q(x)}"`).join(', ');
  let zoneRows: Row[] = [];
  if (zoneList) {
    const zoneQueries = [
      `fetch dt.entity.host\n| filter in(id,array(${zoneList}))\n| fields id,entity.name,managementZones`,
      `fetch dt.entity.service\n| filter in(id,array(${zoneList}))\n| fields id,entity.name,managementZones`,
      `fetch dt.entity.service_instance\n| filter in(id,array(${zoneList}))\n| fields id,entity.name,managementZones`,
      `fetch dt.entity.process_group_instance\n| filter in(id,array(${zoneList}))\n| fields id,entity.name,managementZones`,
    ];
    const zoneResults = await Promise.all(zoneQueries.map((query) => optionalDql(query, 100)));
    zoneRows = zoneResults.flat();
  }

  return { problem, events, logs, history, snapshots, managementZones: flattenZones(zoneRows) };
}

async function assist(id: string, evidence: Evidence): Promise<string> {
  const p = evidence.problem;
  const compactEvidence = JSON.stringify({
    problem: {
      id,
      title: s(p['event.name']),
      status: s(p['event.status']),
      severity: s(p['event.severity']),
      category: s(p['event.category']),
      start: s(p['event.start']),
      end: s(p['event.end']),
      duration: duration(s(p['event.start']), s(p['event.end'])),
      description: s(p['event.description']),
      rootCause: s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id),
      impact: s(p['dt.davis.impact_level']),
      affectedUsers: s(p['dt.davis.affected_users_count']),
      affectedEntities: s(p.affected_entity_names) || s(p.affected_entity_ids),
      managementZones: evidence.managementZones,
    },
    timeline: evidence.snapshots.slice(0, 50),
    correlatedEvents: evidence.events.slice(0, 70),
    incidentLogs: evidence.logs.slice(0, 80),
    pastOccurrences: evidence.history.slice(0, 40),
  }).slice(0, 26000);

  const prompt = `Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. Analyze ONLY the retrieved Dynatrace evidence in the supplementary context. Do not claim lack of access and do not ask for telemetry already included. Separate observed facts from inference. Never invent metrics, timestamps, deployments, root causes, affected users, recurrence or remediation results. If unproven, say "Not proven by available evidence". Recommendations are proposals only. Return exactly these sections: 1. Executive Summary 2. Incident Overview 3. Root Cause Assessment 4. Technical Root-Cause Chain 5. Incident Timeline 6. Past Occurrences & Recurrence Pattern 7. Impact Assessment 8. Immediate Remediation Plan 9. Permanent / Preventive Actions 10. Monitoring & Alerting Recommendations 11. Validation Checklist 12. RCA Confidence & Evidence Gaps. Keep the response concise and below 7500 characters.`;

  const response = await publicClient.recommenderConversation({
    body: {
      text: prompt,
      context: [
        { type: 'document-retrieval', value: 'disabled' },
        { type: 'supplementary', value: compactEvidence },
        { type: 'instruction', value: 'Analyze the supplied evidence directly. Do not produce a generic access limitation response.' },
      ],
      annotations: { origin: 'Axis Problem Intelligence RCA', problemId: id },
    },
  }) as unknown as Row;
  if (s(response.status) === 'FAILED') throw new Error('Dynatrace Assist returned FAILED.');
  const answer = extract(response);
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

export default async function (payload: Payload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  if (!/^P-\d+$/.test(payload.problemId)) throw new Error('A valid Dynatrace Problem ID such as P-260948426 is required.');

  const evidence = await load(payload.problemId);
  let analysis = ''; let assistFallback = false; let assistStatus = 'SUCCESSFUL';
  try {
    analysis = await assist(payload.problemId, evidence);
  } catch (error) {
    assistFallback = true;
    assistStatus = error instanceof Error ? error.message : 'Assist request failed';
    analysis = fallback(payload.problemId, evidence.problem, assistStatus, evidence.events, evidence.history, evidence.logs, evidence.snapshots);
  }

  const p = evidence.problem;
  const rootData = p['root_cause.smartscape_entity'];
  const root = typeof rootData === 'object' && rootData !== null ? s((rootData as Row).name) || s((rootData as Row).id) : s(rootData) || s(p.root_cause_entity_id);
  const rootEntityId = typeof rootData === 'object' && rootData !== null ? s((rootData as Row).id) || s(p.root_cause_entity_id) : s(p.root_cause_entity_id) || (root ? root : '');
  const rootEntityType = typeof rootData === 'object' && rootData !== null ? s((rootData as Row).type) : '';
  const probableEvidence = evidence.events.map((e) => s(e['event.description']) || s(e['event.name'])).filter(Boolean).slice(0, 12);
  const currentId = payload.problemId;
  const occurrences = evidence.history.filter((row) => s(row.display_id) !== currentId);

  return {
    problemId: currentId,
    displayId: currentId,
    displayName: s(p['event.name']) || 'Dynatrace Problem',
    analysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity: root || null,
    definitiveRootCause: Boolean(root),
    assistFallback,
    assistStatus,
    recurrenceWindow: '30d',
    managementZones: evidence.managementZones,
    occurrenceCount: occurrences.length,
    occurrences,
    title: s(p['event.name']) || 'Dynatrace Problem',
    status: s(p['event.status']) || 'Not available',
    severityLevel: s(p['event.severity']) || 'Not available',
    impactLevel: s(p['dt.davis.impact_level']) || 'Not available',
    startTime: s(p['event.start']),
    endTime: s(p['event.end']),
    evidenceDetails: {
      details: evidence.events.slice(0, 80).map((event) => ({
        displayName: s(event['event.name']) || s(event['event.type']) || 'Davis event',
        evidenceType: s(event['event.type']),
        rootCauseRelevant: event['dt.davis.is_rootcause_relevant'] === true,
        entity: { name: s(event['dt.smartscape_source.id']) || s(event['dt.source_entity']), entityId: { id: s(event['dt.smartscape_source.id']) || s(event['dt.source_entity']), type: s(event['dt.smartscape_source.type']) }, },
      })),
    },
    impactAnalysis: { impacts: s(p['dt.davis.affected_users_count']) ? [{ impactType: 'Davis affected users', estimatedAffectedUsers: Number(s(p['dt.davis.affected_users_count'])) || undefined }] : [] },
    problemFacts: {
      title: s(p['event.name']) || 'Dynatrace Problem', status: s(p['event.status']) || 'Not available', severity: s(p['event.severity']) || 'Not available', category: s(p['event.category']) || 'Not available', start: s(p['event.start']), end: s(p['event.end']), duration: duration(s(p['event.start']), s(p['event.end'])), impactLevel: s(p['dt.davis.impact_level']) || 'Not available', affectedUsers: s(p['dt.davis.affected_users_count']) || 'Not available', affectedEntities: s(p.affected_entity_names) || s(p.affected_entity_ids) || 'Not available', managementZones: evidence.managementZones,
    },
    evidenceSummary: {
      correlatedEvents: evidence.events.length,
      incidentLogs: evidence.logs.length,
      historicalOccurrences: occurrences.length,
      timelineSnapshots: evidence.snapshots.length,
    },
    problemAnalysis: {
      rootCause: root || 'No definitive root-cause entity exposed yet',
      rootCauseEntityId: rootEntityId || undefined,
      rootCauseEntityType: rootEntityType || undefined,
      probableCause: root ? `Davis exposed ${root} as the root-cause entity. ${probableEvidence[0] || ''}`.trim() : 'Not proven by available evidence. This is evidence, not a confirmed root cause.',
      impactSummary: `Impact level: ${s(p['dt.davis.impact_level']) || 'not available'}. Affected users: ${s(p['dt.davis.affected_users_count']) || 'not available'}.`,
      remediation: 'Validate the causal signal and affected dependency before making a production change.',
      confidence: root ? 'High' : (p['dt.analysis.ready'] === false ? 'Pending Davis analysis' : 'Evidence based'),
      evidence: probableEvidence,
      eventIds: Array.isArray(p['dt.davis.event_ids']) ? p['dt.davis.event_ids'].map(s).filter(Boolean) : [],
      causalEvents: evidence.events.filter((e) => e['dt.davis.is_rootcause_relevant'] === true).slice(0, 10).map((e) => ({ id: s(e['event.id']), name: s(e['event.name']), description: s(e['event.description']), entityId: s(e['dt.smartscape_source.id']) || s(e['dt.source_entity']), entityType: s(e['dt.smartscape_source.type']) })),
      fullRca: analysis,
      assistFallback,
      assistStatus,
      analysisReady: p['dt.analysis.ready'],
      affectedUsers: s(p['dt.davis.affected_users_count']) || undefined,
      logs: evidence.logs.slice(0, 100),
      historicalOccurrences: occurrences.slice(0, 100),
      timelineSnapshots: evidence.snapshots.slice(0, 80),
      managementZones: evidence.managementZones,
    },
  };
}
