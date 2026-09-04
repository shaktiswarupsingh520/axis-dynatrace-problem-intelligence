import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AlertDumpPayload { from?: string; status?: string; severity?: string; managementZone?: string; limit?: number; }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).filter(Boolean).join('; ') : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) ?? '' : String(value);
const escapeDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql(query: string, max = 1000): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result;
  let state = response.state;
  if (!result && response.requestToken) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 30000 });
      state = poll.state;
      result = poll.result;
      if (result || state !== 'RUNNING') break;
      await sleep(300);
    }
  }
  if (!result) throw new Error(`Problem query did not return a result (state: ${state}).`);
  return (result.records ?? []).filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));
}

function buildProblemQuery(range: string, status: string, severity: string, zone: string) {
  const safeRange = ['1h', '6h', '24h', '7d', '30d'].includes(range) ? range : '24h';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (status !== 'ALL') filters.push(`event.status == "${escapeDql(status)}"`);
  if (severity !== 'ALL') filters.push(`event.severity == ${severity}`);
  let query = `fetch dt.davis.problems, from:now()-${safeRange}, to:now() | filter ${filters.join(' and ')}`;
  if (zone !== 'ALL' && zone !== 'All Management Zones') {
    query += `
| expand related_entity_names
| lookup sourceField:related_entity_names, lookupField:entity.name,
  [
    fetch dt.entity.host
    | expand managementZones
    | filter managementZones == "${escapeDql(zone)}"
    | fields entity.name
  ], fields:{zoneHostName=entity.name}
| filter isNotNull(zoneHostName)
| dedup display_id`;
  }
  return `${query}
| fields display_id,event.name,event.status,event.severity,event.category,dt.davis.impact_level,event.start,event.end,affected_entity_names,affected_entity_ids,root_cause_entity_id,event.description,labels.alerting_profile,dt.davis.is_duplicate,maintenance.is_under_maintenance
| sort event.start desc
| limit 1000`;
}

export default async function (payload: AlertDumpPayload = {}) {
  const from = payload.from ?? 'now-24h';
  const range = from.startsWith('now-') && ['1h', '6h', '24h', '7d', '30d'].includes(from.slice(4)) ? from.slice(4) : '24h';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const zone = payload.managementZone ?? 'ALL';
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);
  const query = buildProblemQuery(range, status, severity, zone).replace('limit 1000', `limit ${limit}`);
  const rows = await executeDql(query, limit);
  return { rows, count: rows.length, query, generatedAt: new Date().toISOString() };
}
