import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

interface GetProblemDetailsPayload { problemId: string; }
interface EvidenceLike { displayName?: string; evidenceType?: string; entity?: { name?: string; entityId?: { id?: string; type?: string } }; groupingEntity?: { name?: string }; rootCauseRelevant?: boolean; }
interface ImpactLike { impactType?: string; impactedEntity?: { name?: string }; estimatedAffectedUsers?: number; numberOfPotentiallyAffectedServiceCalls?: number; }
type DqlRecord = Record<string, unknown>;
const text = (value: unknown) => value == null ? '' : Array.isArray(value) ? value.map(text).filter(Boolean).join('; ') : typeof value === 'object' ? JSON.stringify(value) ?? '' : String(value);
const recordValue = (value: unknown): DqlRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as DqlRecord : undefined;
const stringArray = (value: unknown): string[] => Array.isArray(value) ? value.map(text).filter(Boolean) : [];
const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const executeDql = async (query: string): Promise<DqlRecord[]> => {
  try {
    const started = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 100 } });
    if (started.result?.records) return started.result.records;
    if (!started.requestToken) return [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const polled = await queryExecutionClient.queryPoll({ requestToken: started.requestToken, requestTimeoutMilliseconds: 30000 });
      if (polled.result?.records) return polled.result.records;
      if (polled.state === 'FAILED' || polled.state === 'CANCELLED' || polled.state === 'RESULT_GONE') return [];
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch { return []; }
  return [];
};

const loadGrailProblemContext = async (problemId: string) => {
  const safeId = escapeDqlString(problemId);
  const problemRecords = await executeDql(`fetch dt.davis.problems\n| filter not(dt.davis.is_duplicate) and display_id == "${safeId}"\n| fields display_id,event.id,event.name,event.description,event.start,event.end,event.status,event.severity,event.category,dt.analysis.ready,dt.davis.event_ids,dt.davis.affected_users_count,dt.davis.impact_level,root_cause.smartscape_entity,root_cause_entity_id,affected_entity_ids,affected_entity_names\n| limit 1`);
  const problemRecord = problemRecords[0];
  if (!problemRecord) return undefined;
  const eventIds = stringArray(problemRecord['dt.davis.event_ids']);
  let eventRecords: DqlRecord[] = [];
  if (eventIds.length) {
    const eventArray = eventIds.slice(0, 60).map(id => `"${escapeDqlString(id)}"`).join(', ');
    eventRecords = await executeDql(`fetch dt.davis.events\n| filter in(event.id,array(${eventArray}))\n| fields event.id,event.name,event.description,event.start,event.end,event.type,event.category,event.severity,dt.smartscape_source.id,dt.smartscape_source.type,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 80`);
  }
  return { problemRecord, eventRecords };
};

const buildCausalAnalysis = (problem: { title?: string; impactLevel?: string; rootCauseEntity?: { name?: string; entityId?: { id?: string; type?: string } }; evidenceDetails?: { details?: EvidenceLike[] }; impactAnalysis?: { impacts?: ImpactLike[] } }, grailContext?: { problemRecord: DqlRecord; eventRecords: DqlRecord[] }) => {
  const title = text(problem.title) || 'Dynatrace problem';
  const evidence = problem.evidenceDetails?.details ?? [];
  const rootCauseEvidence = evidence.find(item => item.rootCauseRelevant);
  const grailRootCause = recordValue(grailContext?.problemRecord['root_cause.smartscape_entity']);
  const grailRootCauseName = text(grailRootCause?.name), grailRootCauseId = text(grailRootCause?.id), grailRootCauseType = text(grailRootCause?.type);
  const apiRootCauseName = text(problem.rootCauseEntity?.name), apiRootCauseId = text(problem.rootCauseEntity?.entityId?.id), apiRootCauseType = text(problem.rootCauseEntity?.entityId?.type);
  const evidenceRootCauseName = text(rootCauseEvidence?.entity?.name), evidenceRootCauseId = text(rootCauseEvidence?.entity?.entityId?.id), evidenceRootCauseType = text(rootCauseEvidence?.entity?.entityId?.type);
  const rootCauseName = grailRootCauseName || apiRootCauseName || evidenceRootCauseName;
  const rootCauseId = grailRootCauseId || apiRootCauseId || evidenceRootCauseId;
  const rootCauseType = grailRootCauseType || apiRootCauseType || evidenceRootCauseType;
  const eventDescriptions = (grailContext?.eventRecords ?? []).map(event => text(event['event.description'])).filter(Boolean);
  const eventNames = (grailContext?.eventRecords ?? []).map(event => text(event['event.name'])).filter(Boolean);
  const causalEvents = (grailContext?.eventRecords ?? []).filter(event => event['dt.davis.is_rootcause_relevant'] === true).map(event => ({ id:text(event['event.id']), name:text(event['event.name']), description:text(event['event.description']), entityId:text(event['dt.smartscape_source.id']), entityType:text(event['dt.smartscape_source.type']), category:text(event['event.category']), severity:event['event.severity'], start:event['event.start'] })).filter(event => event.id || event.name || event.description);
  const apiEvidenceText = evidence.map(item => [text(item.displayName) || text(item.evidenceType), item.entity?.name ? `entity ${item.entity.name}` : '', item.groupingEntity?.name ? `grouped by ${item.groupingEntity.name}` : ''].filter(Boolean).join(' — ')).filter(Boolean);
  const allEvidence = [...new Set([...eventDescriptions, ...apiEvidenceText])].slice(0, 12);
  const primaryEvent = causalEvents[0];
  const ready = grailContext?.problemRecord['dt.analysis.ready'];
  let probableCause: string;
  let remediation: string;
  let confidence: string;
  if (rootCauseName) {
    const entityLabel = [rootCauseName, rootCauseType ? `(${rootCauseType})` : ''].filter(Boolean).join(' ');
    const supporting = primaryEvent?.description || primaryEvent?.name || allEvidence[0];
    probableCause = supporting ? `Dynatrace Intelligence identified ${entityLabel} as the root-cause entity. Strongest supporting signal: ${supporting}.` : `Dynatrace Intelligence identified ${entityLabel} as the root-cause entity for this problem.`;
    remediation = `Start investigation at ${entityLabel}. Validate the triggering metric/event and follow the dependency path to the impacted service before changing production configuration.`;
    confidence = 'High';
  } else if (primaryEvent?.entityId) {
    probableCause = `No explicit problem root-cause entity is exposed yet. The strongest root-cause-relevant Davis event points to ${primaryEvent.entityId}${primaryEvent.entityType ? ` (${primaryEvent.entityType})` : ''}. Supporting signal: ${primaryEvent.description || primaryEvent.name || 'Davis event'}.`;
    remediation = `Investigate ${primaryEvent.entityId} first. Correlate its event timeline with the affected entities and verify the underlying metric, log, deployment or dependency signal.`;
    confidence = ready === false ? 'Pending Dynatrace Intelligence analysis' : 'Medium';
  } else if (allEvidence.length) {
    probableCause = `Dynatrace has not exposed a definitive root-cause entity yet. Strongest observed evidence: ${allEvidence[0]}. This is evidence, not a confirmed root cause.`;
    remediation = 'Investigate the entities and causal signals named by Davis, then re-evaluate once Dynatrace Intelligence analysis is ready.';
    confidence = ready === false ? 'Pending Dynatrace Intelligence analysis' : 'Evidence only';
  } else {
    probableCause = 'Dynatrace has not exposed enough causal evidence to determine a root cause yet.';
    remediation = 'Refresh the problem after Dynatrace Intelligence analysis completes and validate the causal evidence before remediation.';
    confidence = ready === false ? 'Pending Dynatrace Intelligence analysis' : 'Insufficient evidence';
  }
  const impacts = problem.impactAnalysis?.impacts ?? [];
  const users = impacts.reduce((sum,item)=>sum+(item.estimatedAffectedUsers??0),0), calls = impacts.reduce((sum,item)=>sum+(item.numberOfPotentiallyAffectedServiceCalls??0),0);
  const impactParts = [problem.impactLevel ? `Impact level: ${problem.impactLevel}.` : '', users > 0 ? `Estimated affected users: ${users}.` : '', calls > 0 ? `Potentially affected service calls: ${calls}.` : '', impacts.length ? `Dynatrace Intelligence identified ${impacts.length} impact relationship${impacts.length===1?'':'s'}.` : ''].filter(Boolean);
  return { description:text(grailContext?.problemRecord['event.description']) || allEvidence.join('. ') || title, rootCause:rootCauseName || 'No definitive root-cause entity exposed yet', rootCauseEntityId:rootCauseId || undefined, rootCauseEntityType:rootCauseType || undefined, probableCause, impactSummary:impactParts.join(' ') || `Impact level: ${problem.impactLevel ?? 'not provided'}.`, remediation, confidence, evidence:allEvidence, causalEvents, eventIds:stringArray(grailContext?.problemRecord['dt.davis.event_ids']), analysisReady:ready, affectedUsers:typeof grailContext?.problemRecord['dt.davis.affected_users_count']==='number' ? grailContext.problemRecord['dt.davis.affected_users_count'] : undefined, eventNames:[...new Set(eventNames)].slice(0,12) };
};

const extractAssistText = (value: unknown): string => {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractAssistText).filter(Boolean).join('\n').trim();
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text','answer','content','message']) { const candidate = extractAssistText(record[key]); if (candidate) return candidate; }
  return Array.isArray(record.tokens) ? record.tokens.map(text).join('').trim() : '';
};

async function enhanceWithAssist(problemId: string, context?: { problemRecord: DqlRecord; eventRecords: DqlRecord[] }) {
  if (!context) return undefined;
  const p = context.problemRecord;
  const evidence = JSON.stringify({ problem:{id:problemId,title:text(p['event.name']),status:text(p['event.status']),severity:text(p['event.severity']),impact:text(p['dt.davis.impact_level']),start:text(p['event.start']),end:text(p['event.end']),description:text(p['event.description']),rootCause:text(p['root_cause.smartscape_entity'])||text(p.root_cause_entity_id),affectedUsers:text(p['dt.davis.affected_users_count']),affectedEntities:text(p.affected_entity_names)}, events:context.eventRecords.slice(0,20) }).slice(0,6200);
  const prompt = `Give a concise, technically specific RCA summary for Dynatrace Problem ${problemId}. Use ONLY this evidence. Do not invent a root cause. If not proven, explicitly say so. Return exactly four labeled lines: ROOT CAUSE, EVIDENCE, CONFIDENCE, REMEDIATION. Keep the entire response under 1800 characters.\nEVIDENCE:\n${evidence}`;
  try {
    const response = await publicClient.recommenderConversation({ body:{ text:prompt, context:[{type:'document-retrieval',value:'disabled'},{type:'supplementary',value:evidence},{type:'instruction',value:'Analyze the supplied Dynatrace evidence directly.'}], annotations:{origin:'Axis Problem Intelligence Overview RCA',problemId} } });
    const answer = extractAssistText(response);
    if (!answer) return undefined;
    const get = (label:string) => { const m=answer.match(new RegExp(`${label}\\s*:\\s*(.*?)(?=\\n[A-Z ]+\\s*:|$)`,`is`)); return m?.[1]?.trim(); };
    return { probableCause:get('ROOT CAUSE') || undefined, evidenceText:get('EVIDENCE') || undefined, confidence:get('CONFIDENCE') || undefined, remediation:get('REMEDIATION') || undefined };
  } catch { return undefined; }
}

export default async function (payload: GetProblemDetailsPayload) {
  if (!payload?.problemId) throw new Error('problemId is required');
  const problem = await problemsClient.getProblem({ problemId: payload.problemId, fields: 'evidenceDetails,impactAnalysis,recentComments' });
  const grailContext = await loadGrailProblemContext(payload.problemId);
  const causal = buildCausalAnalysis(problem, grailContext);
  const ai = await enhanceWithAssist(payload.problemId, grailContext);
  const problemAnalysis = { ...causal, probableCause: ai?.probableCause || causal.probableCause, remediation: ai?.remediation || causal.remediation, confidence: ai?.confidence || causal.confidence, evidence: ai?.evidenceText ? [ai.evidenceText, ...causal.evidence] : causal.evidence };
  return { ...problem, problemAnalysis };
}
