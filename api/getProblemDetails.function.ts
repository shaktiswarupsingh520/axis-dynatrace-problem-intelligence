async function assist(id: string, evidence: Evidence): Promise<string> {
  const p = evidence.problem;
  const native = p.__nativeRootCauseEntity as NativeRootCause | null | undefined;
  const facts = {
    problemId: id,
    title: s(p['event.name']),
    status: s(p['event.status']),
    severity: s(p['event.severity']),
    category: s(p['event.category']),
    start: s(p['event.start']),
    end: s(p['event.end']),
    duration: duration(s(p['event.start']), s(p['event.end'])),
    rootCause: native?.name || null,
    rootCauseEntityId: native?.id || null,
    rootCauseEntityType: native?.type || null,
    managementZones: evidence.managementZones,
    affectedEntities: entityNames(p.affected_entity_names),
    affectedUsers: s(p['dt.davis.affected_users_count']),
    eventCount: evidence.events.length,
    rootCauseRelevantEventCount: evidence.events.filter((event) => event['dt.davis.is_rootcause_relevant'] === true).length,
    logCount: evidence.logs.length,
    snapshotCount: evidence.snapshots.length,
  };
  const prompt = `You are an optional Dynatrace Assist writing layer. Do NOT determine or invent root cause, metrics, timestamps, recurrence, affected users, deployments, or infrastructure causes. Those facts are already fixed in the supplied JSON. Return only a short "Assist Interpretation" and "Assist Proposed Actions". If a fact is null or unavailable, say "Not available from retrieved evidence". Proposed actions must be explicitly framed as proposals, never completed remediation. Do not add numeric values that are not present in the JSON. Keep below 1800 characters.

FIXED FACTS:
${JSON.stringify(facts)}

RETRIEVED CAUSAL EVENTS:
${JSON.stringify(evidence.events.filter((event) => event['dt.davis.is_rootcause_relevant'] === true).slice(0, 10).map((event) => ({
    name: s(event['event.name']),
    description: s(event['event.description']),
    entityId: s(event['dt.smartscape_source.id']) || s(event['dt.source_entity']),
  })))}
`;
  const response = await publicClient.recommenderConversation({
    body: {
      text: prompt,
      context: [
        { type: 'document-retrieval', value: 'disabled' },
        { type: 'supplementary', value: JSON.stringify(facts) },
        { type: 'instruction', value: 'The deterministic RCA is authoritative. You are only a wording/recommendation layer and must not introduce new facts.' },
      ],
      annotations: { origin: 'Axis Problem Intelligence RCA Assist Layer', problemId: id },
    },
  }) as unknown as Row;
  if (s(response.status) === 'FAILED') throw new Error('Dynatrace Assist returned FAILED.');
  const answer = extract(response);
  if (!answer) throw new Error('Dynatrace Assist returned an empty interpretation.');
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
  const currentAffectedIds = new Set(entityIds(p.affected_entity_ids).concat(entityIds(p['smartscape.affected_entities'])));
  const currentCategory = s(p['event.category']);
  const occurrences = evidence.history.filter((row) => {
    const rowId = s(row.display_id);
    if (!rowId || rowId === currentId) return false;
    const rowCategory = s(row['event.category']);
    const rowAffectedIds = entityIds(row.affected_entity_ids).concat(entityIds(row['smartscape.affected_entities']));
    const sharedEntity = rowAffectedIds.some((id) => currentAffectedIds.has(id));
    const sameRoot = rootEntityId && (
      s(row.root_cause_entity_id) === rootEntityId ||
      (row.root_cause && typeof row.root_cause === 'object' && s((row.root_cause as Row).id) === rootEntityId)
    );
    const sameCategory = currentCategory && rowCategory && currentCategory === rowCategory;
    return Boolean(sameRoot || (sharedEntity && sameCategory) || (sharedEntity && !currentCategory));
  }).slice(0, 100);

  const deterministicRca = buildDeterministicRca(payload.problemId, p, evidence, resolvedRoot, occurrences);
  let assistAnalysis = '';
  let assistFallback = false;
  let assistStatus = 'SUCCESSFUL';
  try {
    assistAnalysis = await assist(payload.problemId, evidence);
  } catch (error) {
    assistFallback = true;
    assistStatus = error instanceof Error ? error.message : 'Assist request failed';
  }

  const probableEvidence = evidence.events
    .filter((event) => event['dt.davis.is_rootcause_relevant'] === true)
    .map((event) => s(event['event.description']) || s(event['event.name']))
    .filter(Boolean)
    .slice(0, 12);

  const occurrenceRecords = occurrences.map((row) => ({
    problemId: s(row.display_id),
    title: s(row['event.name']) || 'Dynatrace Problem',
    status: s(row['event.status']) || 'Not available',
    severity: s(row['event.severity']) || 'Not available',
    start: s(row['event.start']),
    end: s(row['event.end']),
    duration: duration(s(row['event.start']), s(row['event.end'])),
  }));
  const safeOccurrences = jsonSafe(occurrenceRecords) as Row[];
  const safeLogs = jsonSafe(evidence.logs) as Row[];
  const safeHistoricalOccurrences = jsonSafe(occurrences.slice(0, 100)) as Row[];
  const safeTimelineSnapshots = jsonSafe(evidence.snapshots) as Row[];
  const safeEvents = jsonSafe(evidence.events.slice(0, 100)) as Row[];

  return {
    problemId: currentId,
    displayId: currentId,
    displayName: s(p['event.name']) || 'Dynatrace Problem',
    analysis: deterministicRca,
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
      details: safeEvents.map((event) => ({
        displayName: s(event['event.name']) || s(event['event.type']) || 'Davis event',
        evidenceType: s(event['event.type']),
        rootCauseRelevant: event['dt.davis.is_rootcause_relevant'] === true,
        entity: {
          name: s(event['dt.smartscape_source.id']) || s(event['dt.source_entity']),
          entityId: {
            id: s(event['dt.smartscape_source.id']) || s(event['dt.source_entity']),
            type: s(event['dt.smartscape_source.type']),
          },
        },
      })),
    },
    impactAnalysis: {
      impacts: s(p['dt.davis.affected_users_count'])
        ? [{ impactType: 'Davis affected users', estimatedAffectedUsers: Number(s(p['dt.davis.affected_users_count'])) || undefined }]
        : [],
    },
    problemFacts: {
      title: s(p['event.name']) || 'Dynatrace Problem',
      status: s(p['event.status']) || 'Not available',
      severity: s(p['event.severity']) || 'Not available',
      category: s(p['event.category']) || 'Not available',
      start: s(p['event.start']),
      end: s(p['event.end']),
      duration: duration(s(p['event.start']), s(p['event.end'])),
      impactLevel: s(p['dt.davis.impact_level']) || 'Not available',
      affectedUsers: s(p['dt.davis.affected_users_count']) || 'Not available',
      affectedEntities: s(p.affected_entity_names) || s(p.affected_entity_ids) || 'Not available',
      managementZones: evidence.managementZones,
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
      probableCause: root
        ? `Davis exposed ${root} as the root-cause entity.`
        : 'Not proven by available evidence. This is evidence, not a confirmed root cause.',
      impactSummary: `Impact level: ${s(p['dt.davis.impact_level']) || 'not available'}. Affected users: ${s(p['dt.davis.affected_users_count']) || 'not available'}.`,
      remediation: 'Validate the causal signal and affected dependency before making a production change.',
      confidence: root ? 'High' : (p['dt.analysis.ready'] === false ? 'Pending Davis analysis' : 'Evidence based'),
      evidence: probableEvidence,
      eventIds: Array.isArray(p['dt.davis.event_ids']) ? p['dt.davis.event_ids'].map(s).filter(Boolean) : [],
      causalEvents: evidence.events.filter((e) => e['dt.davis.is_rootcause_relevant'] === true).slice(0, 10).map((e) => ({
        id: s(e['event.id']),
        name: s(e['event.name']),
        description: s(e['event.description']),
        entityId: s(e['dt.smartscape_source.id']) || s(e['dt.source_entity']),
        entityType: s(e['dt.smartscape_source.type']),
      })),
      fullRca: deterministicRca,
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

