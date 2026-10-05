import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Payload = { from?: string; to?: string; status?: string };
type Zone = { id: string; name: string };
type ProblemPage = { totalCount?: number; problems?: unknown[] };

const escapeSelectorValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\\"');

async function loadZones(): Promise<Zone[]> {
  const zones: Zone[] = [];

  let response = await settingsObjectsClient.getSettingsObjects({
    schemaIds: 'builtin:management-zones',
    scopes: 'environment',
    fields: 'objectId,value',
    pageSize: 500,
  });

  const collect = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as { objectId?: unknown; value?: { name?: unknown } };
      const objectId = typeof record.objectId === 'string' ? record.objectId : '';
      const name = typeof record.value?.name === 'string' ? record.value.name.trim() : '';
      if (objectId && name) zones.push({ id: objectId, name });
    }
  };

  collect(response.items);
  for (let page = 0; response.nextPageKey && page < 20; page += 1) {
    response = await settingsObjectsClient.getSettingsObjects({
      nextPageKey: response.nextPageKey,
    });
    collect(response.items);
  }

  return [...new Map(zones.map((zone) => [zone.name, zone])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
}

function buildProblemSelector(status?: string, managementZoneName?: string): string | undefined {
  const criteria: string[] = [];

  if (status === 'ACTIVE') criteria.push('status("open")');
  if (status === 'CLOSED') criteria.push('status("closed")');
  if (managementZoneName) {
    criteria.push(`managementZones("${escapeSelectorValue(managementZoneName)}")`);
  }

  return criteria.length ? criteria.join(',') : undefined;
}

async function getProblemCount(
  from: string,
  to: string,
  status?: string,
  managementZoneName?: string,
): Promise<number> {
  const problemSelector = buildProblemSelector(status, managementZoneName);
  const config: {
    from: string;
    to: string;
    pageSize: number;
    problemSelector?: string;
  } = {
    from,
    to,
    pageSize: 1,
  };

  if (problemSelector) config.problemSelector = problemSelector;

  const response = await problemsClient.getProblems(config);
  return Number((response as ProblemPage).totalCount ?? 0);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  worker: (value: T) => Promise<R>,
  concurrency = 8,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  const runners = Array.from(
    { length: Math.min(Math.max(concurrency, 1), values.length || 1) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await worker(values[index]);
      }
    },
  );

  await Promise.all(runners);
  return results;
}

export default async function (payload: Payload = {}) {
  const from = payload.from ?? 'now-1y';
  const to = payload.to ?? 'now';

  const [managementZones, totalAlertCount] = await Promise.all([
    loadZones(),
    getProblemCount(from, to, payload.status),
  ]);

  const zoneCounts = await mapWithConcurrency(
    managementZones,
    async (zone) => ({
      managementZoneId: zone.id,
      managementZone: zone.name,
      alertCount: await getProblemCount(from, to, payload.status, zone.name),
    }),
    8,
  );

  const counts = zoneCounts
    .filter((item) => item.alertCount > 0)
    .sort((a, b) => b.alertCount - a.alertCount || a.managementZone.localeCompare(b.managementZone));

  const assignedProblemCount = counts.reduce((sum, item) => sum + item.alertCount, 0);

  return {
    from,
    to,
    totalAlertCount,
    counts,
    managementZoneCount: managementZones.length,
    managementZonesWithAlerts: counts.length,
    assignedProblemCount,
    generatedAt: new Date().toISOString(),
    source: 'Dynatrace Problems API v2',
    semantics: {
      alertCount: 'Unique Davis problems returned by Problems API for the timeframe.',
      managementZoneCount: 'A problem can belong to more than one management zone, so MZ counts can overlap and their sum can exceed totalAlertCount.',
      defaultAlertingProfile: 'Not used for Management Zone attribution; it remains a separate alerting-profile concept.',
    },
  };
};
