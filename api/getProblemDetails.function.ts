import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

interface GetProblemDetailsPayload {
  problemId: string;
}

export default async function (payload: GetProblemDetailsPayload) {
  if (!payload?.problemId) {
    throw new Error('problemId is required');
  }

  return problemsClient.getProblem({
    problemId: payload.problemId,
    fields: 'evidenceDetails,impactAnalysis,recentComments',
  });
}
