import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Problem = Record<string, unknown>;
interface Payload { from?: string; status?: string; severity?: string; managementZoneId?: string; limit?: number; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return String(value);
};
const duration = (start: unknown, end: unknown) => {
  const a = new Date(text(start)).getTime();
  const b = end ? new Date(text(end)).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const mins = Math.max(0, b - a) / 60000;
  return mins < 60 ? `${mins.toFixed(1)} min` : mins < 1440 ? `${(mins / 60).toFixed(1)} h` : `${(mins / 1440).toFixed(1)} d`;
};
const zoneName = (zone: unknown) => {
  if (zone && typeof zone === 'object' && !Array.isArray(zone)) {
    const z = zone as Record<string, unknown>;
    return text(z.name) || text(z.id);
  }
  return text(zone);
};

async function fetchProblems(from: string, managementZoneId?: string) {
  const selectors: string[] = [];
  if (managementZoneId) selectors.push(`managementZoneIds("${managementZoneId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`);
  const selector = selectors.length ? selectors.join(',') : undefined;
  const rows: Problem[] = [];
  let nextPageKey: string | undefined;
  for (let page = 0; page < 3; page += 1) {
    const response = await problemsClient.getProblems({ from, to: 'now', problemSelector: selector, pageSize: 500, sort: '-startTime', ...(nextPageKey ? { nextPageKey } : {}) });
    rows.push(...(response.problems as unknown as Problem[]));
    nextPageKey = response.nextPageKey;
    if (!nextPageKey || rows.length >= 1000) break;
  }
  return rows.slice(0, 1000);
}

function transform(problem: Problem) {
  const zones = Array.isArray(problem.managementZones) ? problem.managementZones.map(zoneName).filter(Boolean) : [];
  const root = problem.rootCauseEntity && typeof problem.rootCauseEntity === 'object' ? problem.rootCauseEntity as Record<string, unknown> : undefined;
  const entities = Array.isArray(problem.affectedEntities) ? problem.affectedEntities.map(entity => entity && typeof entity === 'object' ? text((entity as Record<string, unknown>).name) : text(entity)).filter(Boolean) : [];
  return {
    display_id: problem.displayId ?? problem.problemId,
    'event.name': problem.title,
    'event.status': problem.status,
    'event.severity': problem.severityLevel,
    'event.category': problem.impactLevel,
    'dt.davis.impact_level': problem.impactLevel,
    'event.start': problem.startTime ? new Date(Number(problem.startTime)).toISOString() : '',
    'event.end': problem.endTime ? new Date(Number(problem.endTime)).toISOString() : '',
    'problem.duration': duration(problem.startTime, problem.endTime),
    affected_entity_names: entities.join('; '),
    root_cause_entity_id: text(root?.name) || text(root?.entityId),
    'event.description': problem.title ?? '',
    'labels.alerting_profile': '',
    'dt.davis.is_duplicate': false,
    'maintenance.is_under_maintenance': false,
    managementZones: zones,
  } as Problem;
}

export default async function (payload: Payload = {}) {
  const allowedRanges = ['1h', '6h', '24h', '7d', '30d'];
  const from = allowedRanges.includes(payload.from?.replace('now-', '') ?? '') ? payload.from as string : 'now-24h';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const managementZoneId = payload.managementZoneId && payload.managementZoneId !== 'ALL' ? payload.managementZoneId : undefined;
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);
  const raw = await fetchProblems(from, managementZoneId);
  const allZones = [...new Set(raw.flatMap(problem => Array.isArray(problem.managementZones) ? problem.managementZones.map(zoneName).filter(Boolean) : []))].sort((a, b) => a.localeCompare(b));
  const filtered = raw.filter(problem => {
    const normalizedStatus = text(problem.status).toUpperCase();
    const normalizedSeverity = text(problem.severityLevel).toUpperCase();
    const statusOk = status === 'ALL' || (status === 'ACTIVE' ? normalizedStatus === 'OPEN' : normalizedStatus === 'CLOSED');
    const severityOk = severity === 'ALL' || normalizedSeverity === severity.toUpperCase();
    return statusOk && severityOk;
  }).map(transform).slice(0, limit);
  return { rows: filtered, count: filtered.length, managementZones: allZones, generatedAt: new Date().toISOString(), source: 'Dynatrace Problems API' };
}
