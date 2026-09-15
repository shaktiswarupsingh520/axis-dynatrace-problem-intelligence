import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface Payload { from?: string; status?: string; severity?: string; managementZoneId?: string; limit?: number; }
interface Zone { id: string; name: string; }
const text = (v: unknown): string => { if (v == null) return ''; if (typeof v === 'string') return v; if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v); if (Array.isArray(v)) return v.map(text).filter(Boolean).join('; '); return JSON.stringify(v) ?? ''; };
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function dql(query: string, max = 1000): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result;
  for (let attempt = 0; !result && response.requestToken && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 30000 });
    result = poll.result;
    if (!result) await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }
  if (!result) throw new Error('Dynatrace query did not return a result.');
  return Array.isArray(result.records) ? result.records.filter((r): r is Row => Boolean(r) && typeof r === 'object' && !Array.isArray(r)) : [];
}

function buildQuery(range: string, status: string, severity: string, zone: string): string {
  const safeRange = ['1h', '6h', '24h', '7d', '30d'].includes(range) ? range : '24h';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (status === 'ACTIVE') filters.push('(event.status == "ACTIVE" or event.status == "OPEN")');
  if (status === 'CLOSED') filters.push('(event.status == "CLOSED" or event.status == "RESOLVED")');
  if (severity !== 'ALL' && ['1','2','3','4','5'].includes(severity)) filters.push(`event.severity == ${Number(severity)}`);
  let query = `fetch dt.davis.problems, from:now()-${safeRange}, to:now()\n| filter ${filters.join(' and ')}`;
  if (zone) {
    query += `\n| expand related_entity_names\n| lookup sourceField:related_entity_names, lookupField:entity.name, [\n  fetch dt.entity.host\n  | expand managementZones\n  | filter managementZones == "${esc(zone)}"\n  | fields entity.name\n], fields:{zoneHostName=entity.name}\n| filter isNotNull(zoneHostName)\n| dedup display_id`;
  }
  return `${query}\n| sort event.start desc\n| limit 1000`;
}

async function loadZones(): Promise<Zone[]> {
  try {
    const rows = await dql(`fetch dt.entity.host\n| expand managementZones\n| filter isNotNull(managementZones)\n| dedup managementZones\n| sort managementZones asc\n| limit 500`, 500);
    return rows.map((row) => { const name = text(row.managementZones); return name ? { id: name, name } : undefined; }).filter((x): x is Zone => Boolean(x));
  } catch { return []; }
}

function transform(row: Row): Row {
  return { display_id: text(row.display_id), 'event.name': text(row['event.name']), 'event.status': text(row['event.status']), 'event.severity': text(row['event.severity']), 'event.category': text(row['event.category']), 'dt.davis.impact_level': text(row['dt.davis.impact_level']), 'event.start': text(row['event.start']), 'event.end': text(row['event.end']), 'problem.duration': text(row['problem.duration']), affected_entity_names: text(row.affected_entity_names), affected_entity_ids: text(row.affected_entity_ids), root_cause_entity_id: text(row.root_cause_entity_id), 'event.description': text(row['event.description']) };
}

export default async function (payload: Payload = {}) {
  const range = (payload.from ?? 'now-24h').replace('now-', '');
  const status = payload.status ?? 'ALL'; const severity = payload.severity ?? 'ALL';
  const zone = payload.managementZoneId && payload.managementZoneId !== 'ALL' ? payload.managementZoneId : '';
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);
  const [problemRows, managementZones] = await Promise.all([dql(buildQuery(range, status, severity, zone), 1000), loadZones()]);
  const rows = problemRows.map(transform).slice(0, limit);
  return { rows, count: rows.length, managementZones, availableSeverities: ['1','2','3','4','5'], generatedAt: new Date().toISOString(), source: 'Dynatrace Grail / Davis Problems' };
}
