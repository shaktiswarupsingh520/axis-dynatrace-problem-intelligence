import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

interface GetProblemsPayload {
  from?: string;
  to?: string;
  problemSelector?: string;
  managementZoneId?: string;
  pageSize?: number;
}

const escapeSelectorValue = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export default async function (payload: GetProblemsPayload = {}) {
  const {
    from = 'now-24h',
    to = 'now',
    problemSelector,
    managementZoneId,
    pageSize = 100,
  } = payload;

  const selectors: string[] = [];

  if (problemSelector) selectors.push(problemSelector);
  if (managementZoneId) {
    selectors.push(`managementZoneIds("${escapeSelectorValue(managementZoneId)}")`);
  }

  const finalProblemSelector = selectors.length > 0 ? selectors.join(',') : undefined;

  try {
    const response = await problemsClient.getProblems({
      from,
      to,
      problemSelector: finalProblemSelector,
      pageSize,
      sort: '-startTime',
    });

    return {
      problems: response.problems,
      totalCount: response.totalCount,
      nextPageKey: response.nextPageKey,
      pageSize: response.pageSize,
      warnings: response.warnings ?? [],
    };
  } catch (error: unknown) {
    console.error('getProblems failed', {
      payload,
      problemSelector: finalProblemSelector,
      error,
    });
    throw error;
  }
}
