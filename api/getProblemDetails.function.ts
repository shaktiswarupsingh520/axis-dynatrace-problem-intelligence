import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

interface GetProblemDetailsPayload {
  problemId: string;
}

interface EvidenceLike {
  displayName?: string;
  evidenceType?: string;
  entity?: { name?: string };
  rootCauseRelevant?: boolean;
}

interface ImpactLike {
  impactType?: string;
  impactedEntity?: { name?: string };
  estimatedAffectedUsers?: number;
  numberOfPotentiallyAffectedServiceCalls?: number;
}

const text = (value?: string) => (value ?? '').trim();

const buildAnalysis = (problem: {
  title?: string;
  severityLevel?: string;
  impactLevel?: string;
  rootCauseEntity?: { name?: string };
  evidenceDetails?: { details?: EvidenceLike[] };
  impactAnalysis?: { impacts?: ImpactLike[] };
}) => {
  const title = text(problem.title) || 'Dynatrace problem';
  const evidence = problem.evidenceDetails?.details ?? [];
  const rootCauseEvidence = evidence.find((item) => item.rootCauseRelevant);
  const rootCause =
    text(problem.rootCauseEntity?.name) ||
    text(rootCauseEvidence?.entity?.name) ||
    'Davis did not return a definitive root-cause entity';

  const evidenceText = evidence
    .map((item) => `${text(item.displayName) || text(item.evidenceType)}${item.entity?.name ? ` on ${item.entity.name}` : ''}`)
    .filter(Boolean);

  const combined = `${title} ${evidenceText.join(' ')}`.toLowerCase();
  let probableCause = 'The problem is correlated from the available Davis evidence. Review the listed evidence and affected entity before remediation.';
  let remediation = 'Validate the root-cause entity, review the related metric/log evidence, and confirm whether the condition is still active before making a change.';

  if (combined.includes('cpu') || combined.includes('processor') || combined.includes('saturation')) {
    probableCause = 'CPU resource saturation or insufficient CPU capacity is the most likely contributing factor based on the problem evidence.';
    remediation = 'Check CPU utilization and CPU requests/limits on the affected workload or host, identify competing workloads, and scale or rebalance capacity if sustained saturation is confirmed.';
  } else if (combined.includes('memory') || combined.includes('out of memory') || combined.includes('oom')) {
    probableCause = 'Memory pressure or insufficient memory capacity is the most likely contributing factor based on the problem evidence.';
    remediation = 'Check memory utilization, container limits and JVM/process memory behavior; investigate leaks or workload growth and increase or rebalance memory capacity where required.';
  } else if (combined.includes('response time') || combined.includes('slowdown') || combined.includes('latency')) {
    probableCause = 'Elevated response time or latency is the primary observed symptom and may be caused by downstream dependency, resource or application performance degradation.';
    remediation = 'Trace the affected service path, identify the slowest dependency or endpoint, and validate database, connection-pool and host resource health before tuning the application.';
  } else if (combined.includes('error') || combined.includes('exception') || combined.includes('failure')) {
    probableCause = 'An application or dependency error condition is the primary observed signal. The correlated evidence should be used to identify the failing component.';
    remediation = 'Review the correlated exceptions and failing service/dependency, validate recent deployments or configuration changes, and address the first failing component in the dependency chain.';
  } else if (combined.includes('disk') || combined.includes('storage')) {
    probableCause = 'Disk or storage capacity/health degradation is the most likely contributing factor.';
    remediation = 'Check filesystem utilization, I/O latency and storage health; remove unnecessary data only under the approved retention policy and increase capacity if growth is expected.';
  } else if (combined.includes('connection pool') || combined.includes('jdbc')) {
    probableCause = 'Connection-pool exhaustion or database connectivity pressure is the most likely contributing factor.';
    remediation = 'Check pool usage, active/idle connections, wait time and database health; identify long-running queries or leaked connections before increasing pool limits.';
  } else if (combined.includes('unavailable') || combined.includes('monitoring unavailable')) {
    probableCause = 'The affected entity or its monitoring path became unavailable, so availability or connectivity is the primary suspected cause.';
    remediation = 'Validate host/process/network availability, OneAgent status and the affected dependency path. Restore the first unavailable component and then confirm monitoring recovery.';
  }

  const impacts = problem.impactAnalysis?.impacts ?? [];
  const users = impacts.reduce((sum, item) => sum + (item.estimatedAffectedUsers ?? 0), 0);
  const calls = impacts.reduce((sum, item) => sum + (item.numberOfPotentiallyAffectedServiceCalls ?? 0), 0);
  const impactParts = [
    problem.impactLevel ? `Impact level: ${problem.impactLevel}.` : '',
    users > 0 ? `Estimated affected users: ${users}.` : '',
    calls > 0 ? `Potentially affected service calls: ${calls}.` : '',
    impacts.length > 0 ? `Davis identified ${impacts.length} impact relationship${impacts.length === 1 ? '' : 's'}.` : '',
  ].filter(Boolean);

  return {
    description: evidenceText.length > 0 ? evidenceText.slice(0, 12).join('. ') : title,
    rootCause,
    probableCause,
    impactSummary: impactParts.join(' ') || `Impact level: ${problem.impactLevel ?? 'not provided'}.`,
    remediation,
    confidence: rootCauseEvidence || problem.rootCauseEntity ? 'High' : 'Medium',
  };
};

export default async function (payload: GetProblemDetailsPayload) {
  if (!payload?.problemId) {
    throw new Error('problemId is required');
  }

  const problem = await problemsClient.getProblem({
    problemId: payload.problemId,
    fields: 'evidenceDetails,impactAnalysis,recentComments',
  });

  return {
    ...problem,
    problemAnalysis: buildAnalysis(problem),
  };
}
