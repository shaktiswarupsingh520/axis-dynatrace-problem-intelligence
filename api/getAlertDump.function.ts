import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type ProblemRecord = Record<string, unknown>;
interface Payload { from?: string; status?: string; severity?: string; managementZoneId?: string; limit?: number; }
interface Zone { id: string; name: string; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return '';
};

const duration = (start: unknown, end: unknown) => {
  const startMs = new Date(text(start)).getTime();
  const endMs = end ? new Date(text(end)).getTime() : Date.now();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '—';
  const minutes = Math.max(0, endMs - startMs) / 60000;
  return minutes < 60 ? `${minutes.toFixed(1)} min` : minutes < 1440 ? `${(minutes / 60).toFixed(1)} h` : `${(minutes / 1440).toFixed(1)} d`;
};

const zoneObject = (value: unknown): Zone | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const id = text(record.id);
  return id ? { id, name: text(record.name) || id } : undefined;
};

async function fetchProblems(from: string, managementZoneId?: string): Promise<ProblemRecord[]> {
  const safeSelector = managementZoneId
    ? `managementZoneIds("${managementZoneId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
    : undefined;
  const rows: ProblemRecord[] = [];
  let nextPageKey: string | undefined;

  for (let page = 0; page < 3; page += 1) {
    const response = await problemsClient.getProblems({
      from,
      to: 'now',
      problemSelector: safeSelector,
      pageSize: 500,
      sort: '-startTime',
      ...(nextPageKey ? { nextPageKey } : {}),
    });
    const problems: unknown = response.problems;
    if (Array.isArray(problems)) {
      rows.push(...problems.filter((problem): problem is ProblemRecord => problem !== null && typeof problem === 'object' && !Array.isArray(problem)));
    }
    nextPageKey = response.nextPageKey;
    if (!nextPageKey || rows.length >= 1000) break;
  }
  return rows.slice(0, 1000);
}

function transform(problem: ProblemRecord): ProblemRecord {
  const root = problem.rootCauseEntity && typeof problem.rootCauseEntity === 'object' && !Array.isArray(problem.rootCauseEntity)
    ? problem.rootCauseEntity as Record<string, unknown>
    : undefined;
  const entities: string[] = Array.isArray(problem.affectedEntities)
    ? problem.affectedEntities.map((entity): string => {
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return text(entity);
      return text((entity as Record<string, unknown>).name);
    }).filter(Boolean)
    : [];
  const zones: Zone[] = Array.isArray(problem.managementZones)
    ? problem.managementZones.map(zoneObject).filter((zone): zone is Zone => Boolean(zone))
    : [];

  return {
    display_id: text(problem.displayId) || text(problem.problemId),
    'event.name': text(problem.title),
    'event.status': text(problem.status),
    'event.severity': text(problem.severityLevel),
    'event.category': text(problem.impactLevel),
    'dt.davis.impact_level': text(problem.impactLevel),
    'event.start': problem.startTime ? new Date(Number(problem.startTime)).toISOString() : '',
    'event.end': problem.endTime ? new Date(Number(problem.endTime)).toISOString() : '',
    'problem.duration': duration(problem.startTime, problem.endTime),
    affected_entity_names: entities.join('; '),
    root_cause_entity_id: text(root?.name) || text(root?.entityId),
    'event.description': text(problem.title),
    'labels.alerting_profile': '',
    'dt.davis.is_duplicate': false,
    'maintenance.is_under_maintenance': false,
    managementZones: zones,
  };
}

const collectZones = (rows: ProblemRecord[]): Zone[] => {
  const map = new Map<string, Zone>();
  for (const problem of rows) {
    if (!Array.isArray(problem.managementZones)) continue;
    for (const zoneValue of problem.managementZones) {
      const zone = zoneObject(zoneValue);
      if (zone) map.set(zone.id, zone);
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export default async function (payload: Payload = {}) {
  const requestedRange = payload.from?.replace('now-', '');
  const range = requestedRange && ['1h', '6h', '24h', '7d', '30d'].includes(requestedRange) ? `now-${requestedRange}` : 'now-24h';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const zoneId = payload.managementZoneId && payload.managementZoneId !== 'ALL' ? payload.managementZoneId : undefined;
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);

  const rawRows = await fetchProblems(range, zoneId);
  const zoneRows = zoneId ? await fetchProblems(range) : rawRows;
  const managementZones = collectZones(zoneRows);
  const rows = rawRows
    .filter((problem) => {
      const currentStatus = text(problem.status).toUpperCase();
      const currentSeverity = text(problem.severityLevel).toUpperCase();
      const statusMatches = status === 'ALL' || (status === 'ACTIVE' ? currentStatus === 'OPEN' : currentStatus === 'CLOSED' || currentStatus === 'RESOLVED');
      const severityMatches = severity === 'ALL' || currentSeverity === severity.toUpperCase();
      return statusMatches && severityMatches;
    })
    .map(transform)
    .slice(0, limit);

  return {
    rows,
    count: rows.length,
    managementZones,
    generatedAt: new Date().toISOString(),
    source: 'Dynatrace Problems API',
  };
}
