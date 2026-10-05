import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import { settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Row = Record<string, unknown>;
interface Payload { from?: string; to?: string; status?: string; severity?: string; managementZoneId?: string; limit?: number; }
interface Zone { id: string; name: string; }

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('; ');
  return JSON.stringify(v) ?? '';
};
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function dql(query: string, max = 50000): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 60000, maxResultRecords: max },
  });
  let result = response.result;
  for (let attempt = 0; !result && response.requestToken && attempt < 60; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({
      requestToken: response.requestToken,
      requestTimeoutMilliseconds: 60000,
    });
    result = poll.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
  if (!result) throw new Error('Dynatrace query did not return a result.');
  return Array.isArray(result.records)
    ? result.records.filter((r): r is Row => Boolean(r) && typeof r === 'object' && !Array.isArray(r))
    : [];
}

function buildQuery(from: string, to: string, status: string, severity: string, zone: string, limit: number): string {
  const safeFrom = from || 'now()-24h';
  const safeTo = to || 'now()';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (status === 'ACTIVE') filters.push('(event.status == "ACTIVE" or event.status == "OPEN")');
  if (status === 'CLOSED') filters.push('(event.status == "CLOSED" or event.status == "RESOLVED")');
  if (severity !== 'ALL' && ['1', '2', '3', '4', '5'].includes(severity)) filters.push(`event.severity == ${Number(severity)}`);

  let query = `fetch dt.davis.problems, from:${safeFrom}, to:${safeTo}
| filter ${filters.join(' and ')}
| expand related_entity_names
| lookup sourceField:related_entity_names, lookupField:entity.name, [
  fetch dt.entity.host
  | expand managementZones
  | fields entity.name, managementZones
], fields:{zoneHostName=entity.name, zoneNames=managementZones}`;

  if (zone) {
    query += `\n| filter isNotNull(zoneHostName) and matchesValue(zoneNames, "${esc(zone)}")`;
  }

  query += `
| summarize {
    event_name = takeAny(event.name),
    event_status = takeAny(event.status),
    event_severity = takeAny(event.severity),
    event_category = takeAny(event.category),
    impact_level = takeAny(dt.davis.impact_level),
    event_start = takeAny(event.start),
    event_end = takeAny(event.end),
    affected_entity_names = takeAny(affected_entity_names),
    affected_entity_ids = takeAny(affected_entity_ids),
    root_cause_entity_id = takeAny(root_cause_entity_id),
    root_cause_entity_name = takeAny(root_cause_entity_name),
    event_description = takeAny(event.description),
    management_zones = collectDistinct(zoneNames, expand:true)
  }, by:{display_id}
| fieldsAdd problem_duration_minutes = toDouble((coalesce(event_end, now()) - event_start) / 1m)
| sort event_start desc
| limit ${limit}`;

  return query;
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
        const record = item as { objectId?: string; value?: { name?: unknown } };
        const name = typeof record.value?.name === 'string' ? record.value.name.trim() : '';
        if (name) zones.push({ id: name, name });
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

function transform(row: Row): Row {
  const zones = text(row.management_zones);
  return {
    display_id: text(row.display_id),
    'event.name': text(row.event_name),
    'event.status': text(row.event_status),
    'event.severity': text(row.event_severity),
    'event.category': text(row.event_category),
    'dt.davis.impact_level': text(row.impact_level),
    'event.start': text(row.event_start),
    'event.end': text(row.event_end),
    'problem.duration': Number.isFinite(Number(text(row.problem_duration_minutes)))
      ? `${Math.max(0, Number(text(row.problem_duration_minutes))).toFixed(1)} min`
      : '—',
    affected_entity_names: text(row.affected_entity_names),
    affected_entity_ids: text(row.affected_entity_ids),
    root_cause_entity_id: text(row.root_cause_entity_id),
    root_cause_entity_name: text(row.root_cause_entity_name) || 'Not identified',
    management_zones: zones || 'Unassigned',
    'event.description': text(row.event_description),
  };
}

export default async function (payload: Payload = {}) {
  const from = payload.from ?? 'now-24h';
  const to = payload.to ?? 'now()';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const zone = payload.managementZoneId && payload.managementZoneId !== 'ALL' ? payload.managementZoneId : '';
  const requestedLimit = Number(payload.limit ?? 50000);
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.floor(requestedLimit), 1), 100000) : 50000;
  const [problemRows, managementZones] = await Promise.all([
    dql(buildQuery(from, to, status, severity, zone, limit), limit),
    loadZones(),
  ]);
  const rows = problemRows.map(transform);
  return {
    rows,
    count: rows.length,
    managementZones,
    availableSeverities: ['1', '2', '3', '4', '5'],
    generatedAt: new Date().toISOString(),
    source: 'Dynatrace Grail / Davis Problems',
    resultLimit: limit,
  };
}
