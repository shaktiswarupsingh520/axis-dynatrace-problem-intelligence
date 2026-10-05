import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Payload = {
  from?: string;
  to?: string;
  status?: string;
  severity?: string;
  managementZoneId?: string;
  limit?: number;
  nextPageKey?: string;
};

interface Zone { id: string; name: string; }

type Problem = {
  displayId?: string;
  title?: string;
  status?: string;
  severityLevel?: string;
  impactLevel?: string;
  startTime?: number;
  endTime?: number;
  affectedEntities?: Array<{ entityId?: string; name?: string; type?: string }>;
  rootCauseEntity?: { entityId?: string; name?: string; type?: string } | string;
  managementZones?: Array<{ id?: string; name?: string }>;
};

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};

async function loadZones(): Promise<Zone[]> {
  try {
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
        const id = typeof record.objectId === 'string' ? record.objectId : '';
        const name = typeof record.value?.name === 'string' ? record.value.name.trim() : '';
        if (id && name) zones.push({ id, name });
      }
    };

    collect(response.items);
    for (let page = 0; response.nextPageKey && page < 20; page += 1) {
      response = await settingsObjectsClient.getSettingsObjects({ nextPageKey: response.nextPageKey });
      collect(response.items);
    }

    return [...new Map(zones.map((zone) => [zone.name, zone])).values()]
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

function severitySelector(severity: string): string {
  if (!['1', '2', '3', '4', '5'].includes(severity)) return '';
  return `severityLevel("level-${severity}")`;
}

function buildProblemSelector(status: string, severity: string, zone: string): string | undefined {
  const criteria: string[] = [];

  if (status === 'ACTIVE') criteria.push('status("open")');
  if (status === 'CLOSED') criteria.push('status("closed")');

  const severityCriterion = severitySelector(severity);
  if (severityCriterion) criteria.push(severityCriterion);

  if (zone) {
    // managementZoneId is the settings object ID in this app. Problems API supports
    // management-zone-name filtering, so resolve the name before querying.
    criteria.push(`managementZones("${zone.replace(/\\/g, '\\\\').replace(/"/g, '\\\"')}")`);
  }

  return criteria.length ? criteria.join(',') : undefined;
}

function severityLabel(value: string): string {
  const map: Record<string, string> = {
    AVAILABILITY: '1',
    ERROR: '2',
    PERFORMANCE: '3',
    RESOURCE_CONTENTION: '3',
    CUSTOM_ALERT: '4',
    MONITORING_UNAVAILABLE: '1',
    INFO: '5',
  };
  return map[value] ?? value;
}

function transform(problem: Problem): Record<string, unknown> {
  const affected = (problem.affectedEntities ?? []).map((entity) => entity.name || entity.entityId).filter(Boolean);
  const zones = (problem.managementZones ?? []).map((zone) => zone.name || zone.id).filter(Boolean);
  const root = problem.rootCauseEntity;
  const rootName = typeof root === 'string' ? root : (root?.name || root?.entityId || '');

  return {
    display_id: text(problem.displayId),
    'event.name': text(problem.title),
    'event.status': text(problem.status),
    'event.severity': severityLabel(text(problem.severityLevel)),
    'event.category': '',
    'dt.davis.impact_level': text(problem.impactLevel),
    'event.start': text(problem.startTime),
    'event.end': problem.endTime && problem.endTime > 0 ? text(problem.endTime) : '',
    'problem.duration': problem.startTime
      ? `${Math.max(0, ((problem.endTime && problem.endTime > 0 ? problem.endTime : Date.now()) - problem.startTime) / 60000).toFixed(1)} min`
      : '—',
    affected_entity_names: affected.join('; '),
    affected_entity_ids: (problem.affectedEntities ?? []).map((entity) => entity.entityId).filter(Boolean).join('; '),
    root_cause_entity_id: typeof root === 'string' ? root : text(root?.entityId),
    root_cause_entity_name: rootName || 'Not identified',
    management_zones: zones.length ? zones.join('; ') : 'Unassigned',
    'event.description': '',
  };
}

async function getProblems(
  from: string,
  to: string,
  status: string,
  severity: string,
  zoneName: string,
  limit: number,
  nextPageKey?: string,
): Promise<{ rows: Record<string, unknown>[]; totalCount: number; nextPageKey?: string }> {
  const selector = buildProblemSelector(status, severity, zoneName);
  const response = await problemsClient.getProblems(
    nextPageKey
      ? { nextPageKey }
      : {
          from,
          to,
          pageSize: Math.min(limit, 500),
          ...(selector ? { problemSelector: selector } : {}),
        },
  );

  const problems = Array.isArray(response.problems) ? response.problems as Problem[] : [];
  return {
    rows: problems.map(transform),
    totalCount: Number(response.totalCount ?? problems.length),
    nextPageKey: response.nextPageKey ?? undefined,
  };
}

export default async function (payload: Payload = {}) {
  const from = payload.from ?? 'now-24h';
  const to = payload.to ?? 'now';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const requestedLimit = Number(payload.limit ?? 500);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 500) : 500;

  const zones = await loadZones();
  const zoneName = payload.managementZoneId && payload.managementZoneId !== 'ALL'
    ? zones.find((zone) => zone.id === payload.managementZoneId || zone.name === payload.managementZoneId)?.name ?? ''
    : '';

  const result = await getProblems(from, to, status, severity, zoneName, limit, payload.nextPageKey);

  return {
    rows: result.rows,
    count: result.rows.length,
    totalCount: result.totalCount,
    managementZones: zones,
    availableSeverities: ['1', '2', '3', '4', '5'],
    generatedAt: new Date().toISOString(),
    source: 'Dynatrace Problems API v2',
    resultLimit: limit,
    nextPageKey: result.nextPageKey,
  };
}
