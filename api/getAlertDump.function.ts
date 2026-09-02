import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QueryResult { records?: Array<Row | null>; }
interface AlertDumpPayload {
  from?: string;
  to?: string;
  status?: string;
  severity?: string;
  managementZone?: string;
  limit?: number;
}

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const escapeDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function executeDql(query: string, max: number): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max },
  });
  let result = response.result as QueryResult | undefined;
  let state = response.state;
  const token = response.requestToken;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = poll.state;
    result = poll.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(300);
  }
  if (!result) throw new Error(`Alert dump query did not complete (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as Row[];
}

export default async function (payload: AlertDumpPayload = {}) {
  const from = payload.from ?? 'now-24h';
  const to = payload.to ?? 'now';
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);
  const filters = ['not(dt.davis.is_duplicate)'];
  if (payload.status && payload.status !== 'ALL') filters.push(`event.status == "${escapeDql(payload.status)}"`);
  if (payload.severity && payload.severity !== 'ALL') filters.push(`event.severity == ${Number(payload.severity)}`);

  let query = `fetch dt.davis.problems, from:${from}, to:${to}\n| filter ${filters.join(' and ')}`;
  if (payload.managementZone && payload.managementZone !== 'ALL') {
    query += `\n| expand related_entity_names\n| lookup sourceField:related_entity_names, lookupField:entity.name, [fetch dt.entity.host | expand managementZones | filter managementZones == "${escapeDql(payload.managementZone)}" | fields entity.name], fields:{zoneHostName=entity.name}\n| filter isNotNull(zoneHostName)\n| dedup display_id`;
  }
  query += `\n| fields display_id,event.name,event.status,event.severity,event.category,dt.davis.impact_level,event.start,event.end,affected_entity_names,affected_entity_ids,root_cause_entity_id,event.description,labels.alerting_profile,dt.davis.is_duplicate,maintenance.is_under_maintenance\n| sort event.start desc\n| limit ${limit}`;

  const rows = await executeDql(query, limit);
  return { rows, count: rows.length, query, generatedAt: new Date().toISOString() };
}
