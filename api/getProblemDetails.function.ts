import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface Payload { problemId: string; }

const s = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(s).filter(Boolean).join('; ');
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
};
const q = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const duration = (a: string, b: string) => {
  const x = new Date(a).getTime(); const y = b ? new Date(b).getTime() : Date.now();
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '—';
  const m = Math.max(0, y - x) / 60000;
  return m < 60 ? `${m.toFixed(1)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`;
};
const extract = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extract).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const r = value as Row;
  for (const key of ['text', 'answer', 'content', 'message']) { const found = extract(r[key]); if (found) return found; }
  return Array.isArray(r.tokens) ? r.tokens.map(s).join('').trim() : '';
};

async function dql(query: string, max = 100): Promise<Row[]> {
  const started = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = started.result;
  for (let i = 0; !result && started.requestToken && i < 30; i += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: started.requestToken, requestTimeoutMilliseconds: 30000 });
    result = polled.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  if (!result) throw new Error('Dynatrace problem query did not complete.');
  return Array.isArray(result.records) ? result.records.filter((r): r is Row => Boolean(r) && typeof r === 'object' && !Array.isArray(r)) : [];
}

async function load(id: string): Promise<{ problem: Row; events: Row[] }> {
  const problems = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${q(id)}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,affected_entity_names,root_cause.smartscape_entity,root_cause_entity_id,dt.analysis.ready\n| limit 1`, 5);
  if (!problems.length) throw new Error(`Problem ${id} was not found in Dynatrace Grail.`);
  const problem = problems[0];
  const ids = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(s).filter(Boolean) : [];
  if (!ids.length) return { problem, events: [] };
  const list = ids.slice(0, 80).map((x) => `"${q(x)}"`).join(', ');
  const events = await dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${list}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.smartscape_source.type,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 80`, 80).catch(() => []);
  return { problem, events };
}

function fallback(id: string, p: Row, events: Row[], reason: string): string {
  const title = s(p['event.name']) || 'Dynatrace Problem';
  const root = s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id);
  const signal = events.map((e) => s(e['event.description']) || s(e['event.name'])).filter(Boolean).slice(0, 4);
  return `## Executive Summary\n${title} (${id}) was analyzed from retrieved Dynatrace Davis evidence. ${root ? `Root-cause entity exposed by Davis: ${root}.` : 'Not proven by available evidence.'}\n\n## Incident Overview\nStatus: ${s(p['event.status']) || 'Not available'}\nSeverity: ${s(p['event.severity']) || 'Not available'}\nStarted: ${s(p['event.start']) || 'Not available'}\nDuration: ${duration(s(p['event.start']), s(p['event.end']))}\n\n## Root Cause Assessment\n${root ? `Davis exposed ${root} as the root-cause entity.` : 'Not proven by available evidence.'}\n\n## Technical Root-Cause Chain\n${signal.join(' | ') || 'Not proven by available evidence.'}\n\n## Incident Timeline\n${events.length ? events.slice(0, 8).map((e) => `${s(e['event.start']) || 'Time unavailable'} — ${s(e['event.name']) || 'Davis event'}`).join('\n') : 'Not available.'}\n\n## Past Occurrences & Recurrence Pattern\nNot available from this request.\n\n## Impact Assessment\nImpact level: ${s(p['dt.davis.impact_level']) || 'Not available'}. Affected users: ${s(p['dt.davis.affected_users_count']) || 'Not available'}.\n\n## Immediate Remediation Plan\nValidate the causal signal and affected dependency before changing production configuration.\n\n## Permanent / Preventive Actions\nNot proposed as completed actions.\n\n## Monitoring & Alerting Recommendations\nMonitor the affected service, response time, errors, dependency health and the Davis causal signal.\n\n## Validation Checklist\nConfirm recovery and verify that the causal metric returns to baseline.\n\n## RCA Confidence & Evidence Gaps\nLow — ${reason}`;
}

async function assist(id: string, evidence: { problem: Row; events: Row[] }): Promise<string> {
  const p = evidence.problem;
  const supplied = JSON.stringify({
    problem: { id, title: s(p['event.name']), status: s(p['event.status']), severity: s(p['event.severity']), category: s(p['event.category']), start: s(p['event.start']), end: s(p['event.end']), description: s(p['event.description']), rootCause: s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id), impact: s(p['dt.davis.impact_level']), affectedUsers: s(p['dt.davis.affected_users_count']), affectedEntities: s(p.affected_entity_names) },
    correlatedEvents: evidence.events.slice(0, 60),
  }).slice(0, 24000);
  const prompt = `Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. Analyze ONLY the supplied evidence. Never invent facts. Clearly distinguish observed evidence from inference and say "Not proven by available evidence" when appropriate. Recommendations are proposals only. Return exactly: 1. Executive Summary 2. Incident Overview 3. Root Cause Assessment 4. Technical Root-Cause Chain 5. Incident Timeline 6. Past Occurrences & Recurrence Pattern 7. Impact Assessment 8. Immediate Remediation Plan 9. Permanent / Preventive Actions 10. Monitoring & Alerting Recommendations 11. Validation Checklist 12. RCA Confidence & Evidence Gaps. Keep it below 7500 characters.\n\nRETRIEVED DYNATRACE EVIDENCE:\n${supplied}`;
  const response = await publicClient.recommenderConversation({ body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: supplied }, { type: 'instruction', value: 'Analyze the supplied evidence directly. Do not produce a generic access limitation response.' }], annotations: { origin: 'Axis Problem Intelligence RCA', problemId: id } } }) as unknown as Row;
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
  const root = s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id);
  let fullRca = ''; let assistStatus = 'SUCCESSFUL'; let assistFallback = false;
  try { fullRca = await assist(payload.problemId, evidence); } catch (error) { assistFallback = true; assistStatus = error instanceof Error ? error.message : 'Assist request failed'; fullRca = fallback(payload.problemId, p, evidence.events, assistStatus); }
  const details = evidence.events.slice(0, 80).map((event) => ({ displayName: s(event['event.name']) || s(event['event.type']) || 'Davis event', evidenceType: s(event['event.type']), rootCauseRelevant: event['dt.davis.is_rootcause_relevant'] === true, entity: { name: s(event['dt.smartscape_source.id']), entityId: { id: s(event['dt.smartscape_source.id']), type: s(event['dt.smartscape_source.type']) } } }));
  return {
    problemId: payload.problemId,
    displayId: payload.problemId,
    problemIdValue: payload.problemId,
    title: s(p['event.name']) || 'Dynatrace Problem',
    status: s(p['event.status']) || 'Not available',
    severityLevel: s(p['event.severity']) || 'Not available',
    impactLevel: s(p['dt.davis.impact_level']) || 'Not available',
    startTime: s(p['event.start']),
    endTime: s(p['event.end']),
    evidenceDetails: { details },
    impactAnalysis: { impacts: s(p['dt.davis.affected_users_count']) ? [{ impactType: 'Davis affected users', estimatedAffectedUsers: Number(s(p['dt.davis.affected_users_count')) || undefined }] : [] },
    problemAnalysis: {
      rootCause: root || 'No definitive root-cause entity exposed yet',
      rootCauseEntityId: root || undefined,
      probableCause: root ? `Davis exposed ${root} as the root-cause entity.` : 'Not proven by available evidence.',
      impactSummary: `Impact level: ${s(p['dt.davis.impact_level']) || 'not available'}. Affected users: ${s(p['dt.davis.affected_users_count']) || 'not available'}.`,
      remediation: 'Validate the causal signal and affected dependency before making a production change.',
      confidence: root ? 'High' : 'Evidence based',
      evidence: evidence.events.map((e) => s(e['event.description']) || s(e['event.name'])).filter(Boolean).slice(0, 12),
      eventIds: Array.isArray(p['dt.davis.event_ids']) ? p['dt.davis.event_ids'].map(s).filter(Boolean) : [],
      causalEvents: evidence.events.filter((e) => e['dt.davis.is_rootcause_relevant'] === true).slice(0, 10).map((e) => ({ id: s(e['event.id']), name: s(e['event.name']), description: s(e['event.description']), entityId: s(e['dt.smartscape_source.id']), entityType: s(e['dt.smartscape_source.type']) })),
      fullRca,
      assistFallback,
      assistStatus,
      analysisReady: p['dt.analysis.ready'],
      affectedUsers: s(p['dt.davis.affected_users_count']) || undefined,
    },
  };
}
