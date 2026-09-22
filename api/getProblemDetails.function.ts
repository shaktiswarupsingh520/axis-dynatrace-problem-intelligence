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
interface NativeRootCause {
  name: string;
  id: string;
  type: string;
}
interface NativeProblemLookup {
  details?: Row;
  available: boolean;
}

const s = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(s).filter(Boolean).join('; ');
  if (typeof v === 'object') {
    const o = v as Row;
    if ('name' in o && s(o.name)) return s(o.name);
    try { return JSON.stringify(v) ?? ''; } catch { return '[Unserializable]'; }
  }
  return '';
};
const q = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function jsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const output: Row = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonSafe(item, seen);
    return output;
  }
  return value;
}
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

function resolveNativeRootCause(details: unknown): NativeRootCause | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const row = details as Row;
  const raw = row.rootCauseEntity;
  const fallbackId = s(row.rootCauseEntityId);
  if (typeof raw === 'string' || typeof raw === 'number') {
    const name = s(raw);
    return name ? { name, id: fallbackId, type: '' } : null;
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const entity = raw as Row;
    const name = s(entity.name);
    const entityId = entity.entityId;
    const nestedEntityId = entityId && typeof entityId === 'object' && !Array.isArray(entityId)
      ? entityId as Row
      : {};
    const id = s(entity.id) || s(nestedEntityId.id) || fallbackId;
    const type = s(entity.type) || s(nestedEntityId.type);
    return name ? { name, id, type } : null;
  }
  return null;
}

async function loadNativeProblem(id: string): Promise<NativeProblemLookup> {
  try {
    // The UI supplies the human-facing display ID (for example P-260996132).
    // Problems API v2 getProblem() expects the internal problemId, so resolve
    // the display ID through getProblems() first.
    const response = await problemsClient.getProblems({
      from: 'now-365d',
      to: 'now',
      pageSize: 1,
      problemSelector: `displayId("${q(id)}")`,
      fields: 'evidenceDetails,impactAnalysis,recentComments',
    });
    const problems = Array.isArray(response.problems) ? response.problems : [];
    return { details: problems[0] as unknown as Row, available: true };
  } catch {
    return { details: undefined, available: false };
  }
}

async function load(id: string): Promise<Evidence> {
  const nativeProblem = await loadNativeProblem(id);
  let problems: Row[] = [];
  try {
    problems = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate) and display_id == "${q(id)}"
| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,affected_entity_names,root_cause.smartscape_entity,root_cause_entity_id,dt.analysis.ready
| limit 1`, 5);
  } catch {
    problems = [];
  }

  let problem = problems[0];
  if (!problem && nativeProblem.details && typeof nativeProblem.details === 'object' && !Array.isArray(nativeProblem.details)) {
    const native = nativeProblem.details;
    const root = resolveNativeRootCause(native);
    const affected = Array.isArray(native.affectedEntities) ? native.affectedEntities : [];
    problem = {
      display_id: s(native.displayId) || id,
      'event.id': s(native.problemId) || id,
      'event.name': s(native.title) || 'Dynatrace Problem',
      'event.status': s(native.status),
      'event.severity': s(native.severityLevel),
      'event.category': '',
      'event.start': typeof native.startTime === 'number' ? new Date(native.startTime).toISOString() : s(native.startTime),
      'event.end': typeof native.endTime === 'number' && native.endTime >= 0 ? new Date(native.endTime).toISOString() : s(native.endTime),
      'event.description': '',
      'dt.davis.event_ids': [],
      'dt.davis.impact_level': s(native.impactLevel),
      'dt.davis.affected_users_count': '',
      affected_entity_ids: [],
      affected_entity_names: affected.map((e) => s(e)).filter(Boolean),
      'dt.analysis.ready': true,
      root_cause: root ? { name: root.name, id: root.id, type: root.type } : null,
      root_cause_entity_id: root?.id || '',
    };
  }
  if (!problem) throw new Error(`Problem ${id} was not found in Dynatrace Problems API or Grail.`);

  const problemRecord = problem;
  const affectedIds = Array.isArray(problemRecord.affected_entity_ids) ? problemRecord.affected_entity_ids.map(s).filter(Boolean) : [s(problemRecord.affected_entity_ids)].filter(Boolean);
  const eventIds = Array.isArray(problemRecord['dt.davis.event_ids']) ? problemRecord['dt.davis.event_ids'].map(s).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 80).map((x) => `"${q(x)}"`).join(', ');
  const start = s(problemRecord['event.start']);
  const end = s(problemRecord['event.end']) || new Date().toISOString();

  const events = eventList ? await optionalDql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.smartscape_source.name,dt.smartscape_source.type,dt.query,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 100`, 100) : [];

  const sourceIds = [...new Set([
    ...affectedIds,
    ...events.map((e) => s(e['dt.source_entity'])).filter(Boolean),
    ...events.map((e) => s(e['dt.smartscape_source.id'])).filter(Boolean),
  ])].slice(0, 100);
  const entityList = sourceIds.map((x) => `"${q(x)}"`).join(', ');

  const logs = entityList ? await optionalDql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 100`, 100) : [];

  const historyCandidates = await optionalDql(`fetch dt.davis.problems, from:now()-30d, to:now()
| filter not(dt.davis.is_duplicate) and event.name == "${q(s(problemRecord['event.name']))}"
| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,resolved_problem_duration,affected_entity_ids,root_cause_entity_id,root_cause.smartscape_entity
| sort event.start desc
| limit 100`, 100);

  const currentAffectedIds = new Set(affectedIds);
  const nativeForHistory = nativeProblem.details && typeof nativeProblem.details === 'object' && !Array.isArray(nativeProblem.details)
    ? nativeProblem.details
    : undefined;
  const nativeHistoryRoot = nativeForHistory ? resolveNativeRootCause(nativeForHistory) : null;
  const grailHistoryRoot = s(problemRecord.root_cause_entity_id)
    || (problemRecord['root_cause.smartscape_entity'] && typeof problemRecord['root_cause.smartscape_entity'] === 'object'
      ? s((problemRecord['root_cause.smartscape_entity'] as Row).id)
      : '');
  const currentRootId = nativeHistoryRoot?.id || grailHistoryRoot;
  const history = historyCandidates.filter((row) => {
    const displayId = s(row.display_id);
    if (!displayId || displayId === s(problemRecord.display_id)) return false;
    const rowEntityIds = Array.isArray(row.affected_entity_ids)
      ? row.affected_entity_ids.map(s).filter(Boolean)
      : [s(row.affected_entity_ids)].filter(Boolean);
    const rowRootId = s(row.root_cause_entity_id)
      || (row['root_cause.smartscape_entity'] && typeof row['root_cause.smartscape_entity'] === 'object'
        ? s((row['root_cause.smartscape_entity'] as Row).id)
        : '');
    return rowEntityIds.some((entityId) => currentAffectedIds.has(entityId))
      || Boolean(currentRootId && rowRootId && currentRootId === rowRootId);
  });

  const snapshots = await optionalDql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(s(problemRecord['event.id']))}"\n| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id\n| sort timestamp asc\n| limit 80`, 80);

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

  const nativeZoneNames = nativeProblem.details && typeof nativeProblem.details === 'object' && !Array.isArray(nativeProblem.details)
    ? flattenZones([{ managementZones: nativeProblem.details.managementZones }])
    : [];

  return {
    problem: {
      ...problem,
      __nativeRootCauseEntity: resolveNativeRootCause(nativeProblem.details),
      __nativeProblemApiAvailable: nativeProblem.available,
    },
    events,
    logs,
    history,
    snapshots,
    managementZones: [...new Set([...nativeZoneNames, ...flattenZones(zoneRows)])].slice(0, 30),
  };
}

function deterministicRca(id: string, evidence: Evidence, root: NativeRootCause | null, occurrences: Row[]): string {
  const p = evidence.problem;
  const title = s(p['event.name']) || 'Dynatrace Problem';
  const status = s(p['event.status']) || 'Not available';
  const severity = s(p['event.severity']) || 'Not available';
  const start = s(p['event.start']);
  const end = s(p['event.end']);
  const causal = evidence.events.filter((e) => e['dt.davis.is_rootcause_relevant'] === true);
  const causalNames = causal.map((e) => s(e['event.name'])).filter(Boolean).slice(0, 6);
  const causalDescriptions = causal.map((e) => {
    const name = s(e['event.name']) || 'Davis event';
    const description = s(e['event.description']);
    const entity = s(e['dt.smartscape_source.name']) || s(e['dt.source_entity']) || s(e['dt.smartscape_source.id']);
    return [name, entity ? `on ${entity}` : '', description ? `— ${description}` : ''].filter(Boolean).join(' ');
  }).filter(Boolean).slice(0, 6);
  const affectedEntities = s(p.affected_entity_names) || s(p.affected_entity_ids) || 'Not available';
  const durationValue = duration(start, end);
  const technicalBoundary = root
    ? 'The retrieved evidence establishes the Davis root-cause entity, but it does not by itself establish a specific exception, deployment, resource saturation or downstream dependency as the technical trigger.'
    : 'A technical root cause is not established because Dynatrace did not expose a definitive root-cause entity in the retrieved evidence.';

  const rootLine = root
    ? `Dynatrace identified ${root.name} as the root-cause entity.`
    : 'Dynatrace did not expose a definitive root-cause entity for this problem.';
  return `## Executive Summary
Dynatrace detected a ${title.toLowerCase()} problem with status ${status} and severity ${severity}. ${rootLine}
The affected service scope includes ${affectedEntities}. The RCA retrieved ${causal.length} root-cause-relevant Davis event(s), ${evidence.snapshots.length} timeline observation(s), ${evidence.logs.length} incident log(s), and ${occurrences.length} evidence-matched historical occurrence(s).
${technicalBoundary}

## Incident Overview
Title: ${title}
Status: ${status}
Severity: ${severity}
Category: ${s(p['event.category']) || 'Not available'}
Duration: ${durationValue}
Affected entities: ${affectedEntities}
Management zones: ${evidence.managementZones.length ? evidence.managementZones.join(', ') : 'Not derived from retrieved evidence'}

## Root Cause Assessment
${rootLine}
Root-cause entity type: ${root?.type || 'Not available'}
The native Dynatrace Problems API result is the authoritative root-cause source.

## Technical Root-Cause Chain
1. Detection: Dynatrace reported a ${title.toLowerCase()} problem.
2. Davis root-cause finding: ${root?.name || 'No definitive root-cause entity exposed'}.
3. Supporting evidence: ${causal.length ? causalNames.join('; ') : 'No retrieved Davis event is marked root-cause relevant.'}
4. Validation boundary: ${technicalBoundary}
${causalDescriptions.length ? `Evidence details:
${causalDescriptions.join('\n')}` : 'Evidence details: No root-cause-relevant Davis event details were retrieved.'}

## Incident Timeline
Detailed chronological Davis observations are intentionally not displayed in this RCA view. The underlying Davis timeline remains available in Dynatrace.

## Past Occurrences & Recurrence Pattern
${occurrences.length ? `${occurrences.length} matching Davis occurrence(s) retrieved from the last 30 days.` : 'No matching past occurrences were retrieved from the last 30 days.'}

## Impact Assessment
Impact level: ${s(p['dt.davis.impact_level']) || 'Not available'}
Affected users: ${s(p['dt.davis.affected_users_count']) || 'Not available'}
Affected entities: ${affectedEntities}
Incident logs retrieved: ${evidence.logs.length}

## Immediate Remediation Plan
1. Validate ${root?.name || 'the affected service scope'} against the Davis evidence and current service health.
2. Correlate application exceptions and service metrics with the retrieved Davis event(s).
3. Check dependency telemetry and recent application/configuration changes.
4. Confirm recovery and verify that the same evidence signature does not remain active.
These are investigation actions only; no remediation result is claimed.

## Permanent / Preventive Actions
Permanent remediation should be assigned only after the technical trigger is validated.
If validation identifies an application defect, deployment/configuration issue, resource constraint or dependency failure, map the corrective action to that confirmed cause rather than inferring one from the problem title alone.

## Monitoring & Alerting Recommendations
Monitor the identified root-cause entity and its failure-rate signal.
Correlate Davis problems with application exceptions, dependency health and relevant service/resource telemetry.
Track recurrence using the same affected-entity/root-cause signature.
Where application logs are available, retain the relevant evidence around future incidents for RCA closure.

## Validation Checklist
1. Confirm the problem has recovered.
2. Verify the Davis root-cause signal returns to baseline.
3. Correlate the service with application exceptions and dependency telemetry.
4. Check recent deployments/configuration changes.
5. Confirm the same evidence signature does not recur.
6. Record the validated technical trigger before closing the RCA.

## RCA Confidence & Evidence Gaps
Confidence: ${root ? 'High — native Problems API exposed a root-cause entity.' : (p['dt.analysis.ready'] === false ? 'Pending Davis analysis.' : 'Evidence based — no definitive root cause exposed.')}
Observed evidence: ${evidence.events.length} Davis events, ${evidence.logs.length} logs, ${evidence.snapshots.length} timeline snapshots.
Evidence gap: ${evidence.logs.length === 0 ? 'No incident logs were retrieved.' : 'Incident logs were retrieved.'}
${technicalBoundary}
No unobserved metric values, deployments, exception types, infrastructure causes or user-impact values are asserted.`;
}

async function assist(id: string, evidence: Evidence): Promise<string> {
  const p = evidence.problem;
  const compactEvidence = JSON.stringify(jsonSafe({
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
      rootCause: (() => {
        const native = p.__nativeRootCauseEntity as NativeRootCause | null | undefined;
        if (p.__nativeProblemApiAvailable === true) return native?.name || '';
        return native?.name || (typeof p['root_cause.smartscape_entity'] === 'object' && p['root_cause.smartscape_entity'] !== null
          ? s((p['root_cause.smartscape_entity'] as Row).name) || s((p['root_cause.smartscape_entity'] as Row).id)
          : s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id));
      })(),
      impact: s(p['dt.davis.impact_level']),
      affectedUsers: s(p['dt.davis.affected_users_count']),
      affectedEntities: s(p.affected_entity_names) || s(p.affected_entity_ids),
      managementZones: evidence.managementZones,
    },
    timeline: evidence.snapshots.slice(0, 50),
    correlatedEvents: evidence.events.slice(0, 70),
    incidentLogs: evidence.logs.slice(0, 80),
    pastOccurrences: evidence.history.slice(0, 40),
  })).slice(0, 26000);

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
  const p = evidence.problem;
  const nativeRoot = p.__nativeRootCauseEntity as NativeRootCause | null | undefined;
  const nativeApiAvailable = p.__nativeProblemApiAvailable === true;
  const rootData = p['root_cause.smartscape_entity'];
  const grailRoot = typeof rootData === 'object' && rootData !== null
    ? { name: s((rootData as Row).name) || s((rootData as Row).id), id: s((rootData as Row).id) || s(p.root_cause_entity_id), type: s((rootData as Row).type) }
    : { name: s(rootData), id: s(p.root_cause_entity_id), type: '' };
  const resolvedRoot = nativeApiAvailable ? nativeRoot : (nativeRoot || (grailRoot.name ? grailRoot : null));
  const root = resolvedRoot?.name || '';
  const rootEntityId = resolvedRoot?.id || '';
  const rootEntityType = resolvedRoot?.type || grailRoot.type || '';
  const currentId = payload.problemId;
  const occurrences = evidence.history.filter((row) => s(row.display_id) !== currentId);
  const analysis = deterministicRca(currentId, evidence, resolvedRoot, occurrences);
  let assistAnalysis = ''; let assistFallback = false; let assistStatus = 'SUCCESSFUL';
  try {
    assistAnalysis = await assist(currentId, evidence);
  } catch (error) {
    assistFallback = true;
    assistStatus = error instanceof Error ? error.message : 'Assist request failed';
  }
  const probableEvidence = evidence.events.map((e) => s(e['event.description']) || s(e['event.name'])).filter(Boolean).slice(0, 12);
  // App functions must return JSON-serializable data. DQL/SDK records can contain
  // BigInt or other non-JSON values, which would otherwise surface as HTTP 540
  // during result serialization even when the function logic completed.
  const safeOccurrences = jsonSafe(occurrences) as Row[];
  const safeLogs = jsonSafe(evidence.logs) as Row[];
  const safeHistoricalOccurrences = jsonSafe(occurrences.slice(0, 100)) as Row[];
  const safeTimelineSnapshots = jsonSafe(evidence.snapshots) as Row[];

  return {
    problemId: currentId,
    displayId: currentId,
    displayName: s(p['event.name']) || 'Dynatrace Problem',
    analysis,
    assistAnalysis,
    generatedAt: new Date().toISOString(),
    nativeRootCauseEntity: root || null,
    definitiveRootCause: Boolean(root),
    assistFallback,
    assistStatus,
    recurrenceWindow: '30d',
    managementZones: evidence.managementZones,
    occurrenceCount: occurrences.length,
    occurrences: safeOccurrences,
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
      assistAnalysis,
      assistFallback,
      assistStatus,
      analysisReady: p['dt.analysis.ready'],
      affectedUsers: s(p['dt.davis.affected_users_count']) || undefined,
      logs: safeLogs.slice(0, 100),
      historicalOccurrences: safeHistoricalOccurrences,
      timelineSnapshots: safeTimelineSnapshots.slice(0, 80),
      managementZones: evidence.managementZones,
    },
  };
}
