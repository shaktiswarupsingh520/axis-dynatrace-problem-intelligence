import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface GetProblemDetailsPayload { problemId: string; }
interface EvidenceLike { displayName?: string; evidenceType?: string; entity?: { name?: string; entityId?: { id?: string; type?: string } }; groupingEntity?: { name?: string }; rootCauseRelevant?: boolean; }
interface ImpactLike { impactType?: string; impactedEntity?: { name?: string }; estimatedAffectedUsers?: number; numberOfPotentiallyAffectedServiceCalls?: number; }
const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};
const recordValue = (value: unknown): Row | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : undefined;
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const escapeDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
async function executeDql(query: string): Promise<Row[]> {
  try {
    const started = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 100 } });
    const startedRecords: unknown = started.result?.records;
    if (Array.isArray(startedRecords)) return startedRecords.filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));
    if (!started.requestToken) return [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const polled = await queryExecutionClient.queryPoll({ requestToken: started.requestToken, requestTimeoutMilliseconds: 30000 });
      const polledRecords: unknown = polled.result?.records;
      if (Array.isArray(polledRecords)) return polledRecords.filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));
      if (polled.state === 'FAILED' || polled.state === 'CANCELLED' || polled.state === 'RESULT_GONE') return [];
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
  } catch { return []; }
  return [];
}
async function loadGrailProblemContext(problemId: string): Promise<{ problemRecord: Row; eventRecords: Row[] } | undefined> {
  const safeId = escapeDql(problemId);
  const problemRecords: Row[] = await executeDql(`fetch dt.davis.problems\n| filter not(dt.davis.is_duplicate) and display_id == "${safeId}"\n| fields display_id,event.id,event.name,event.description,event.start,event.end,event.status,event.severity,event.category,dt.analysis.ready,dt.davis.event_ids,dt.davis.affected_users_count,dt.davis.impact_level,root_cause.smartscape_entity,root_cause_entity_id,affected_entity_ids,affected_entity_names\n| limit 1`);
  const problemRecord: Row | undefined = problemRecords[0];
  if (!problemRecord) return undefined;
  const rawEventIds: unknown = problemRecord['dt.davis.event_ids'];
  const eventIds = stringArray(rawEventIds);
  if (!eventIds.length) return { problemRecord, eventRecords: [] };
  const eventArray = eventIds.slice(0, 60).map((id: string) => `"${escapeDql(id)}"`).join(', ');
  const eventRecords: Row[] = await executeDql(`fetch dt.davis.events\n| filter in(event.id,array(${eventArray}))\n| fields event.id,event.name,event.description,event.start,event.end,event.type,event.category,event.severity,dt.smartscape_source.id,dt.smartscape_source.type,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 80`);
  return { problemRecord, eventRecords };
}
function buildCausalAnalysis(problem: { title?: string; impactLevel?: string; rootCauseEntity?: { name?: string; entityId?: { id?: string; type?: string } }; evidenceDetails?: { details?: EvidenceLike[] }; impactAnalysis?: { impacts?: ImpactLike[] } }, context?: { problemRecord: Row; eventRecords: Row[] }) {
  const title = text(problem.title) || 'Dynatrace problem';
  const evidence = problem.evidenceDetails?.details ?? [];
  const rootEvidence = evidence.find((item: EvidenceLike) => item.rootCauseRelevant);
  const grailRoot = recordValue(context?.problemRecord['root_cause.smartscape_entity']);
  const rootCauseName = text(grailRoot?.name) || text(problem.rootCauseEntity?.name) || text(rootEvidence?.entity?.name);
  const rootCauseId = text(grailRoot?.id) || text(problem.rootCauseEntity?.entityId?.id) || text(rootEvidence?.entity?.entityId?.id);
  const rootCauseType = text(grailRoot?.type) || text(problem.rootCauseEntity?.entityId?.type) || text(rootEvidence?.entity?.entityId?.type);
  const events = context?.eventRecords ?? [];
  const causalEvent = events.find((event: Row) => event['dt.davis.is_rootcause_relevant'] === true) ?? events[0];
  const eventDescriptions = events.map((event: Row) => text(event['event.description'])).filter(Boolean);
  const evidenceText = evidence.map((item: EvidenceLike) => [text(item.displayName) || text(item.evidenceType), item.entity?.name ? `entity ${item.entity.name}` : '', item.groupingEntity?.name ? `grouped by ${item.groupingEntity.name}` : ''].filter(Boolean).join(' — ')).filter(Boolean);
  const combinedEvidence = [...new Set([...eventDescriptions, ...evidenceText])].slice(0, 12);
  const ready = context?.problemRecord['dt.analysis.ready'];
  const supporting = text(causalEvent?.['event.description']) || text(causalEvent?.['event.name']) || combinedEvidence[0];
  let probableCause = ''; let remediation = ''; let confidence = '';
  if (rootCauseName) { const entity = `${rootCauseName}${rootCauseType ? ` (${rootCauseType})` : ''}`; probableCause = `Davis identified ${entity} as the root-cause entity. ${supporting ? `Supporting signal: ${supporting}.` : 'No additional root-cause event description was returned.'}`; remediation = `Investigate ${entity} first, validate the triggering telemetry, and follow the dependency path to the impacted component before remediation.`; confidence = supporting ? 'High' : 'Medium'; }
  else if (causalEvent && text(causalEvent['dt.smartscape_source.id'])) { probableCause = `Davis did not expose a definitive root-cause entity. The strongest root-cause-relevant event points to ${text(causalEvent['dt.smartscape_source.id'])}. ${supporting ? `Signal: ${supporting}.` : ''}`; remediation = `Investigate ${text(causalEvent['dt.smartscape_source.id'])} and correlate its telemetry, logs and dependency path before changing production configuration.`; confidence = 'Medium'; }
  else if (supporting) { probableCause = `Davis did not expose a definitive root-cause entity. Strongest available evidence: ${supporting}. This is evidence, not a confirmed root cause.`; remediation = 'Correlate the affected entity, Davis event timeline and incident logs before assigning a definitive root cause.'; confidence = ready === false ? 'Pending Davis analysis' : 'Low'; }
  else { probableCause = 'Davis has not exposed enough causal evidence to determine a root cause yet.'; remediation = 'Refresh the problem after Davis analysis completes and validate the underlying telemetry.'; confidence = ready === false ? 'Pending Davis analysis' : 'Insufficient evidence'; }
  const impacts = problem.impactAnalysis?.impacts ?? [];
  const users = impacts.reduce((sum: number, item: ImpactLike) => sum + (item.estimatedAffectedUsers ?? 0), 0);
  const calls = impacts.reduce((sum: number, item: ImpactLike) => sum + (item.numberOfPotentiallyAffectedServiceCalls ?? 0), 0);
  const impactSummary = [problem.impactLevel ? `Impact level: ${problem.impactLevel}.` : '', users > 0 ? `Estimated affected users: ${users}.` : '', calls > 0 ? `Potentially affected service calls: ${calls}.` : ''].filter(Boolean).join(' ') || `Impact level: ${problem.impactLevel ?? 'not provided'}.`;
  return { description: text(context?.problemRecord['event.description']) || combinedEvidence.join('. ') || title, rootCause: rootCauseName || 'No definitive root-cause entity exposed yet', rootCauseEntityId: rootCauseId || undefined, rootCauseEntityType: rootCauseType || undefined, probableCause, impactSummary, remediation, confidence, evidence: combinedEvidence, eventIds: stringArray(context?.problemRecord['dt.davis.event_ids']), analysisReady: ready, affectedUsers: typeof context?.problemRecord['dt.davis.affected_users_count'] === 'number' ? context.problemRecord['dt.davis.affected_users_count'] : undefined, eventNames: [...new Set(events.map((event: Row) => text(event['event.name'])).filter(Boolean))].slice(0, 12), causalEvents: events.filter((event: Row) => event['dt.davis.is_rootcause_relevant'] === true).slice(0, 10).map((event: Row) => ({ id: text(event['event.id']), name: text(event['event.name']), description: text(event['event.description']), entityId: text(event['dt.smartscape_source.id']), entityType: text(event['dt.smartscape_source.type']) })) };
}
function extractAssistText(value: unknown): string { if (typeof value === 'string') return value.trim(); if (Array.isArray(value)) return value.map(extractAssistText).filter(Boolean).join('\n').trim(); if (!value || typeof value !== 'object') return ''; const record = value as Row; for (const key of ['text','answer','content','message']) { const candidate = extractAssistText(record[key]); if (candidate) return candidate; } const tokens: unknown = record.tokens; return Array.isArray(tokens) ? tokens.map(text).join('').trim() : ''; }
async function enhanceWithAssist(problemId: string, context?: { problemRecord: Row; eventRecords: Row[] }) { if (!context) return undefined; const p = context.problemRecord; const evidence = JSON.stringify({ problem: { id: problemId, title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), impact: text(p['dt.davis.impact_level']), start: text(p['event.start']), end: text(p['event.end']), description: text(p['event.description']), rootCause: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id), affectedUsers: text(p['dt.davis.affected_users_count']), affectedEntities: text(p.affected_entity_names) }, events: context.eventRecords.slice(0, 20) }).slice(0, 6200); const prompt = `Give a concise, technically specific RCA summary for Dynatrace Problem ${problemId}. Use ONLY this evidence. Do not invent a root cause. If not proven, explicitly say so. Return exactly four labeled lines: ROOT CAUSE, EVIDENCE, CONFIDENCE, REMEDIATION. Keep the response under 1800 characters.\nEVIDENCE:\n${evidence}`; try { const response = await publicClient.recommenderConversation({ acceptType: 'application/json', body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: evidence }, { type: 'instruction', value: 'Analyze the supplied Dynatrace evidence directly.' }], annotations: { origin: 'Axis Problem Intelligence Overview RCA', problemId } }); const answer = extractAssistText(response); if (!answer) return undefined; const get = (label: string) => { const match = answer.match(new RegExp(`${label}\\s*:\\s*(.*?)(?=\\n[A-Z ]+\\s*:|$)`, 'is')); return match?.[1]?.trim(); }; return { probableCause: get('ROOT CAUSE') || undefined, evidenceText: get('EVIDENCE') || undefined, confidence: get('CONFIDENCE') || undefined, remediation: get('REMEDIATION') || undefined }; } catch { return undefined; } }
export default async function (payload: GetProblemDetailsPayload) { if (!payload?.problemId) throw new Error('problemId is required'); const problem = await problemsClient.getProblem({ problemId: payload.problemId, fields: 'evidenceDetails,impactAnalysis,recentComments' }); const context = await loadGrailProblemContext(payload.problemId); const causal = buildCausalAnalysis(problem, context); const ai = await enhanceWithAssist(payload.problemId, context); const problemAnalysis = { ...causal, probableCause: ai?.probableCause || causal.probableCause, remediation: ai?.remediation || causal.remediation, confidence: ai?.confidence || causal.confidence, evidence: ai?.evidenceText ? [ai.evidenceText, ...causal.evidence] : causal.evidence }; return { ...problem, problemAnalysis }; }
