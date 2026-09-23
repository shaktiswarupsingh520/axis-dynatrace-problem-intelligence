import { problemsClient, settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

interface GetProblemsPayload {
  from?: string;
  to?: string;
  problemSelector?: string;
  managementZoneId?: string;
  managementZoneName?: string;
  pageSize?: number;
}

const escapeSelectorValue = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function loadManagementZones(): Promise<Array<{ id: string; name: string }>> {
  try {
    const zones: Array<{ id: string; name: string }> = [];
    let response = await settingsObjectsClient.getSettingsObjects({
      schemaIds: 'builtin:management-zones',
      scope: 'environment',
      fields: 'objectId,value',
      pageSize: 500,
    });

    const collect = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { objectId?: string; value?: { name?: unknown } };
        const name = typeof record.value?.name === 'string' ? record.value.name.trim() : '';
        if (name) zones.push({ id: name, name });
      }
    };

    collect(response.items);
    for (let page = 0; response.nextPageKey && page < 10; page += 1) {
      response = await settingsObjectsClient.getSettingsObjects({ nextPageKey: response.nextPageKey });
      collect(response.items);
    }

    return [...new Map(zones.map((zone) => [zone.name, zone])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export default async function (payload: GetProblemsPayload = {}) {
  const {
    from = 'now-24h',
    to = 'now',
    problemSelector,
    managementZoneId,
    managementZoneName,
    pageSize = 100,
  } = payload;

  const selectors: string[] = [];
  if (problemSelector) selectors.push(problemSelector);
  if (managementZoneId) {
    selectors.push(`managementZoneIds("${escapeSelectorValue(managementZoneId)}")`);
  } else if (managementZoneName) {
    selectors.push(`managementZones("${escapeSelectorValue(managementZoneName)}")`);
  }

  const finalProblemSelector = selectors.length > 0 ? selectors.join(',') : undefined;
  const [response, managementZones] = await Promise.all([
    problemsClient.getProblems({
      from,
      to,
      problemSelector: finalProblemSelector,
      pageSize,
      sort: '-startTime',
    }),
    loadManagementZones(),
  ]);

  return {
    problems: response.problems,
    totalCount: response.totalCount,
    nextPageKey: response.nextPageKey,
    pageSize: response.pageSize,
    warnings: response.warnings ?? [],
    managementZones,
  };
}
