import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

interface GetProblemsPayload {
  from?: string;
  to?: string;
  problemSelector?: string;
  pageSize?: number;
}

export default async function (
  payload: GetProblemsPayload = {},
) {
  const {
    from = 'now-24h',
    to = 'now',
    problemSelector,
    pageSize = 100,
  } = payload;

  const response = await problemsClient.getProblems({
    from,
    to,
    problemSelector,
    pageSize,
  });

  return {
    problems: response.problems,
    totalCount: response.totalCount,
    nextPageKey: response.nextPageKey,
    pageSize: response.pageSize,
    warnings: response.warnings ?? [],
  };
}
