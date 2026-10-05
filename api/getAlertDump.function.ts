import { problemsClient, settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

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

type ProblemPage = {
  problems?: Problem[];
  totalCount?: number;
  nextPageKey?: string;
};

type AlertDumpResult = {
  rows: Record<string, unknown>[];
  totalCount: number;
  nextPageKey?: string;
};

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
  problemFilters?: Array<{ id?: string; name?: string }>;
  ['event.description']?: string;
};

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};

const normalizeKey = (value: unknown): string => text(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '');

const appCodeKey = (value: unknown): string => {
  const normalized = normalizeKey(value);
  return normalized.replace(/(?:mzal|managementzone|alertingprofile|alertprofile)$/i, '');
};

function resolveZoneLabel(rawValue: unknown, zones: Zone[], profileToZone: Map<string, string>): string {
  const raw = text(rawValue).trim();
  if (!raw || raw.toLowerCase() === 'unassigned') return 'Unassigned';

  const rawKey = normalizeKey(raw);
  const rawAppKey = appCodeKey(raw);

  const exact = zones.find((zone) => normalizeKey(zone.name) === rawKey || normalizeKey(zone.id) === rawKey);
  if (exact) return exact.name;

  const profileZone = profileToZone.get(rawKey);
  if (profileZone) return profileZone;

  const appMatch = zones.find((zone) => {
    const zoneKey = normalizeKey(zone.name);
    const zoneAppKey = appCodeKey(zone.name);
    return zoneAppKey === rawAppKey || zoneKey === rawKey;
  });
  if (appMatch) return appMatch.name;

  return `Alerting Profile / App Code: ${raw}`;
}

function findZoneByReference(reference: unknown, zones: Zone[]): string {
  if (typeof reference === 'string') {
    const key = normalizeKey(reference);
    return zones.find((zone) => normalizeKey(zone.name) === key || normalizeKey(zone.id) === key)?.name ?? '';
  }
  if (!reference || typeof reference !== 'object') return '';
  const value = reference as Record<string, unknown>;
  const direct = [value.name, value.id, value.objectId];
  for (const item of direct) {
    const found = findZoneByReference(item, zones);
    if (found) return found;
  }
  for (const key of ['value', 'managementZone', 'reference']) {
    const found = findZoneByReference(value[key], zones);
    if (found) return found;
  }
  return '';
}

async function loadAlertingProfileMappings(zones: Zone[]): Promise<Map<string, string>> {
  const mappings = new Map<string, string>();
  try {
    let response = await settingsObjectsClient.getSettingsObjects({
      schemaIds: 'builtin:alerting.profile',
      scopes: 'environment',
      fields: 'objectId,value',
      pageSize: 500,
    });

    const collect = (items: unknown) => {
      if (!Array.isArray(items)) return;
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const record = item as { value?: unknown };
        if (!record.value || typeof record.value !== 'object') continue;
        const value = record.value as Record<string, unknown>;
        const profileName = typeof value.name === 'string' ? value.name.trim() : '';
        if (!profileName) continue;
        const zoneName = findZoneByReference(value.managementZone, zones);
        if (zoneName) mappings.set(normalizeKey(profileName), zoneName);
      }
    };

    collect(response.items);
    for (let page = 0; response.nextPageKey && page < 20; page += 1) {
      response = await settingsObjectsClient.getSettingsObjects({ nextPageKey: response.nextPageKey });
      collect(response.items);
    }
  } catch {
    // Alerting-profile metadata is enrichment only; Problems API data remains usable.
  }
  return mappings;
}

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
    criteria.push(`managementZones("${zone.replace(/\\/g, '\\\\').replace(/"/g, '\\' + '"')}")`);
  }

  return criteria.length ? criteria.join(',') : undefined;
}

function dqlTime(value: string): string {
  if (!value) return 'now()';
  if (value === 'now' || value === 'now()') return 'now()';
  return value.replace(/^now-(\d+[mhdwMy])$/, 'now()-$1');
}

async function loadDescriptions(
  displayIds: string[],
  from: string,
  to: string,
): Promise<Map<string, string>> {
  const ids = [...new Set(displayIds.map((id) => id.trim()).filter(Boolean))];
  const descriptions = new Map<string, string>();
  if (!ids.length) return descriptions;

  const values = ids.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(', ');
  const query = `fetch dt.davis.problems, from:${dqlTime(from)}, to:${dqlTime(to)}
| filter in(display_id, array(${values}))
| fields display_id, event.description, timestamp
| filter isNotNull(event.description)
| dedup display_id, sort: { timestamp desc }
| fields display_id, event.description
| limit ${Math.min(ids.length, 500)}`;

  try {
    const response = await queryExecutionClient.queryExecute({
      body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: Math.min(ids.length, 500) },
    });
    let result = response.result;
    for (let attempt = 0; !result && response.requestToken && attempt < 30; attempt += 1) {
      const poll = await queryExecutionClient.queryPoll({
        requestToken: response.requestToken,
        requestTimeoutMilliseconds: 30000,
      });
      result = poll.result;
      if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 300));
    }
    if (!result || !Array.isArray(result.records)) return descriptions;

    for (const record of result.records) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
      const row = record as Record<string, unknown>;
      const id = text(row.display_id).trim();
      const description = text(row['event.description']).trim();
      if (id && description) descriptions.set(id, description);
    }
  } catch {
    // Description enrichment is best-effort; the Problems API result remains usable.
  }

  return descriptions;
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

function transform(problem: Problem, zones: Zone[], profileToZone: Map<string, string>): Record<string, unknown> {
  const affected = (problem.affectedEntities ?? []).map((entity) => entity.name || entity.entityId).filter(Boolean);
  const rawZoneValues = (problem.managementZones ?? []).map((zone) => zone.name || zone.id).filter(Boolean);
  const alertingProfiles = (problem.problemFilters ?? []).map((profile) => profile.name || profile.id).filter(Boolean);
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
    management_zones: rawZoneValues.length ? rawZoneValues.map((value) => resolveZoneLabel(value, zones, profileToZone)).filter(Boolean).join('; ') : 'Unassigned',
    alerting_profiles: alertingProfiles.length ? alertingProfiles.join('; ') : 'None',
    'event.description': text(problem['event.description']),
  };
}

async function getProblems(
  from: string,
  to: string,
  status: string,
  severity: string,
  zoneName: string,
  limit: number,
  zones: Zone[],
  profileToZone: Map<string, string>,
  nextPageKey?: string,
): Promise<AlertDumpResult> {
  const selector = buildProblemSelector(status, severity, zoneName);
  let response: ProblemPage;
  try {
    response = await problemsClient.getProblems(
      nextPageKey
        ? { nextPageKey }
        : {
            from,
            ...(to && to !== 'now' && to !== 'now()' ? { to } : {}),
            pageSize: Math.min(limit, 500),
            ...(selector ? { problemSelector: selector } : {}),
          },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Problems API getProblems failed: ${detail}`);
  }

  const problems = Array.isArray(response.problems) ? response.problems : [];
  const rows = problems.flatMap((problem) => {
    try {
      return [transform(problem, zones, profileToZone)];
    } catch {
      return [];
    }
  });

  const descriptions = await loadDescriptions(
    rows.map((row) => text(row.display_id)),
    from,
    to,
  );
  for (const row of rows) {
    const id = text(row.display_id);
    const description = descriptions.get(id);
    if (description) row['event.description'] = description;
  }

  return {
    rows,
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

  const profileToZone = await loadAlertingProfileMappings(zones);

  let result: AlertDumpResult;
  try {
    result = await getProblems(from, to, status, severity, zoneName, limit, zones, profileToZone, payload.nextPageKey);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      rows: [],
      count: 0,
      totalCount: 0,
      managementZones: zones,
      availableSeverities: ['1', '2', '3', '4', '5'],
      generatedAt: new Date().toISOString(),
      source: 'Dynatrace Problems API v2',
      resultLimit: limit,
      nextPageKey: undefined,
      error: detail,
    };
  }

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
