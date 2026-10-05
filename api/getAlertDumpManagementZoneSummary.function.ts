import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface Payload { from?: string; to?: string; status?: string; severity?: string; }

const text = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join('; ');
  return JSON.stringify(v) ?? '';
};

async function dql(query: string): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 60000, maxResultRecords: 10000 },
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

export default async function (payload: Payload = {}) {
  const from = payload.from ?? 'now()-1y';
  const to = payload.to ?? 'now()';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (payload.status === 'ACTIVE') filters.push('(event.status == "ACTIVE" or event.status == "OPEN")');
  if (payload.status === 'CLOSED') filters.push('(event.status == "CLOSED" or event.status == "RESOLVED")');
  if (payload.severity && payload.severity !== 'ALL' && ['1', '2', '3', '4', '5'].includes(payload.severity)) {
    filters.push(`event.severity == ${Number(payload.severity)}`);
  }

  const query = `fetch dt.davis.problems, from:${from}, to:${to}
| filter ${filters.join(' and ')}
| expand related_entity_names
| lookup sourceField:related_entity_names, lookupField:entity.name, [
  fetch dt.entity.host
  | expand managementZones
  | fields entity.name, managementZones
], fields:{zoneHostName=entity.name, zoneNames=managementZones}
| filter isNotNull(zoneHostName)
| expand zoneNames
| dedup display_id, zoneNames
| summarize alert_count = count(), by:{management_zone = zoneNames}
| sort alert_count desc
| limit 10000`;

  const rows = await dql(query);
  const counts = rows.map((row) => ({
    managementZone: text(row.management_zone) || 'Unassigned',
    alertCount: Number(row.alert_count ?? 0),
  }));

  const totalQuery = `fetch dt.davis.problems, from:${from}, to:${to}
| filter ${filters.join(' and ')}
| summarize total_alert_count = countDistinct(display_id)`;

  const totalRows = await dql(totalQuery);
  const totalAlertCount = Number(totalRows[0]?.total_alert_count ?? 0);

  return {
    from,
    to,
    totalAlertCount,
    counts,
    generatedAt: new Date().toISOString(),
    source: 'Dynatrace Grail / Davis Problems',
  };
}
