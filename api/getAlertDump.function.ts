import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface AlertDumpPayload { from?: string; to?: string; status?: string; severity?: string; managementZone?: string; limit?: number; }
interface QueryResult { records?: Array<Row | null>; }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const escapeDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql(query: string, max = 1000): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result as QueryResult | undefined;
  let state = response.state;
  if (!result && response.requestToken) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const poll = await queryExecutionClient.queryPoll({ requestToken: response.requestToken, requestTimeoutMilliseconds: 30000 });
      state = poll.state;
      result = poll.result as QueryResult | undefined;
      if (result || state !== 'RUNNING') break;
      await sleep(300);
    }
  }
  if (!result) throw new Error(`Alert dump DQL did not return a result (state: ${state}).`);
  return (result.records ?? []).filter((record): record is Row => record !== null && typeof record === 'object' && !Array.isArray(record));
}

export default async function (payload: AlertDumpPayload = {}) {
  const from = payload.from ?? 'now-24h';
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);
  const rawRange = from.startsWith('now-') ? from.slice(4) : '24h';
  const range = ['1h', '6h', '24h', '7d', '30d'].includes(rawRange) ? rawRange : '24h';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (payload.status && payload.status !== 'ALL') {
    const status = payload.status === 'ACTIVE' ? 'OPEN' : payload.status;
    filters.push(`event.status == "${escapeDql(status)}"`);
  }
  if (payload.severity && payload.severity !== 'ALL') filters.push(`event.severity == ${Number(payload.severity)}`);

  let query = `fetch dt.davis.problems, from:now()-${range}, to:now() | filter ${filters.join(' and ')}`;
  if (payload.managementZone && payload.managementZone !== 'ALL') {
    query += `\n| expand related_entity_names\n| lookup sourceField:related_entity_names, lookupField:entity.name,\n  [\n    fetch dt.entity.host\n    | expand managementZones\n    | filter managementZones == "${escapeDql(payload.managementZone)}"\n    | fields entity.name\n  ], fields:{zoneHostName=entity.name}\n| filter isNotNull(zoneHostName)\n| dedup display_id`;
  }
  query += ` | fields display_id,event.name,event.status,event.severity,event.category,dt.davis.impact_level,event.start,event.end,affected_entity_names,affected_entity_ids,root_cause_entity_id,event.description,labels.alerting_profile,dt.davis.is_duplicate,maintenance.is_under_maintenance | sort event.start desc | limit ${limit}`;
  const rows = await executeDql(query, limit);
  return { rows, count: rows.length, query, generatedAt: new Date().toISOString() };
}
