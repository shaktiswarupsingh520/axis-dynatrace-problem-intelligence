import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface Payload { from?: string; status?: string; severity?: string; managementZoneId?: string; limit?: number; }
interface Zone { id: string; name: string; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};

const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function dql(query: string, max = 1000): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result;
  const token = response.requestToken;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    result = poll.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
  if (!result) throw new Error('Problem query did not return a result.');
  return Array.isArray(result.records)
    ? result.records.filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record))
    : [];
}

function buildProblemQuery(range: string, status: string, severity: string, zone: string): string {
  const safeRange = ['1h', '6h', '24h', '7d', '30d'].includes(range) ? range : '24h';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (status !== 'ALL') filters.push(`event.status == "${esc(status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED')}"`);
  if (severity !== 'ALL') filters.push(`event.severity == ${Number(severity)}`);
  let query = `fetch dt.davis.problems, from:now()-${safeRange}, to:now() | filter ${filters.join(' and ')}`;
  if (zone) {
    query += `\n| expand related_entity_names\n| lookup sourceField:related_entity_names, lookupField:entity.name, [\n  fetch dt.entity.host\n  | expand managementZones\n  | filter managementZones == "${esc(zone)}"\n  | fields entity.name\n], fields:{zoneHostName=entity.name}\n| filter isNotNull(zoneHostName)\n| dedup display_id`;
  }
  return `${query} | sort event.start desc | limit 1000`;
}

async function loadZones(): Promise<Zone[]> {
  const rows = await dql(`fetch dt.entity.host\n| expand managementZones\n| filter isNotNull(managementZones)\n| dedup managementZones\n| sort managementZones asc\n| limit 500`, 500);
  return rows.map((row): Zone | undefined => {
    const name = text(row.managementZones);
    return name ? { id: name, name } : undefined;
  }).filter((zone): zone is Zone => Boolean(zone));
}

function transform(row: Row): Row {
  return {
    display_id: text(row.display_id),
    'event.name': text(row['event.name']),
    'event.status': text(row['event.status']),
    'event.severity': text(row['event.severity']),
    'event.category': text(row['event.category']),
    'dt.davis.impact_level': text(row['dt.davis.impact_level']),
    'event.start': text(row['event.start']),
    'event.end': text(row['event.end']),
    'problem.duration': text(row['problem.duration']),
    affected_entity_names: text(row.affected_entity_names),
    affected_entity_ids: text(row.affected_entity_ids),
    root_cause_entity_id: text(row.root_cause_entity_id),
    'event.description': text(row['event.description']),
  };
}

export default async function (payload: Payload = {}) {
  const requestedRange = payload.from?.replace('now-', '');
  const range = requestedRange && ['1h', '6h', '24h', '7d', '30d'].includes(requestedRange) ? requestedRange : '24h';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const zone = payload.managementZoneId && payload.managementZoneId !== 'ALL' ? payload.managementZoneId : '';
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);

  const [problemRows, managementZones] = await Promise.all([
    dql(buildProblemQuery(range, status, severity, zone), 1000),
    loadZones(),
  ]);
  const rows = problemRows.map(transform).slice(0, limit);
  return {
    rows,
    count: rows.length,
    managementZones,
    availableSeverities: ['1', '2', '3', '4', '5'],
    generatedAt: new Date().toISOString(),
    source: 'Dynatrace Grail / Davis Problems',
  };
}
