import { problemsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Problem = Record<string, unknown>;
interface Payload { from?: string; status?: string; severity?: string; managementZoneId?: string; limit?: number; }
interface Zone { id: string; name: string; }
const text = (value: unknown): string => value == null ? '' : Array.isArray(value) ? value.map(text).filter(Boolean).join('; ') : typeof value === 'object' ? JSON.stringify(value) ?? '' : String(value);
const duration = (start: unknown, end: unknown) => { const a = new Date(text(start)).getTime(); const b = end ? new Date(text(end)).getTime() : Date.now(); if (!Number.isFinite(a) || !Number.isFinite(b)) return '—'; const mins = Math.max(0, b - a) / 60000; return mins < 60 ? `${mins.toFixed(1)} min` : mins < 1440 ? `${(mins / 60).toFixed(1)} h` : `${(mins / 1440).toFixed(1)} d`; };
const zoneObject = (value: unknown): Zone | undefined => { if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined; const z = value as Record<string, unknown>; const id = text(z.id); const name = text(z.name) || id; return id ? { id, name } : undefined; };

async function fetchProblems(from: string, managementZoneId?: string) {
  const selector = managementZoneId ? `managementZoneIds("${managementZoneId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")` : undefined;
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
  const root = problem.rootCauseEntity && typeof problem.rootCauseEntity === 'object' ? problem.rootCauseEntity as Record<string, unknown> : undefined;
  const entities = Array.isArray(problem.affectedEntities) ? problem.affectedEntities.map(entity => entity && typeof entity === 'object' ? text((entity as Record<string, unknown>).name) : text(entity)).filter(Boolean) : [];
  const zones = Array.isArray(problem.managementZones) ? problem.managementZones.map(zoneObject).filter((z): z is Zone => Boolean(z)) : [];
  return { display_id: problem.displayId ?? problem.problemId, 'event.name': problem.title, 'event.status': problem.status, 'event.severity': problem.severityLevel, 'event.category': problem.impactLevel, 'dt.davis.impact_level': problem.impactLevel, 'event.start': problem.startTime ? new Date(Number(problem.startTime)).toISOString() : '', 'event.end': problem.endTime ? new Date(Number(problem.endTime)).toISOString() : '', 'problem.duration': duration(problem.startTime, problem.endTime), affected_entity_names: entities.join('; '), root_cause_entity_id: text(root?.name) || text(root?.entityId), 'event.description': problem.title ?? '', 'labels.alerting_profile': '', 'dt.davis.is_duplicate': false, 'maintenance.is_under_maintenance': false, managementZones: zones } as Problem;
}

const collectZones = (rows: Problem[]) => {
  const map = new Map<string, Zone>();
  rows.forEach(problem => { if (Array.isArray(problem.managementZones)) problem.managementZones.map(zoneObject).filter((z): z is Zone => Boolean(z)).forEach(z => map.set(z.id, z)); });
  return map;
};

export default async function (payload: Payload = {}) {
  const range = ['1h', '6h', '24h', '7d', '30d'].includes(payload.from?.replace('now-', '') ?? '') ? payload.from as string : 'now-24h';
  const status = payload.status ?? 'ALL';
  const severity = payload.severity ?? 'ALL';
  const zoneId = payload.managementZoneId && payload.managementZoneId !== 'ALL' ? payload.managementZoneId : undefined;
  const limit = Math.min(Math.max(payload.limit ?? 1000, 1), 1000);
  const raw = await fetchProblems(range, zoneId);
  const zoneRows = zoneId ? await fetchProblems(range) : raw;
  const zoneMap = collectZones(zoneRows);
  const severitySet = new Set<string>();
  raw.forEach(problem => { const sev = text(problem.severityLevel); if (sev) severitySet.add(sev); });
  const rows = raw.filter(problem => { const s = text(problem.status).toUpperCase(); const sev = text(problem.severityLevel).toUpperCase(); return (status === 'ALL' || (status === 'ACTIVE' ? s === 'OPEN' : s === 'CLOSED')) && (severity === 'ALL' || sev === severity.toUpperCase()); }).map(transform).slice(0, limit);
  return { rows, count: rows.length, managementZones: [...zoneMap.values()].sort((a, b) => a.name.localeCompare(b.name)), availableSeverities: [...severitySet].sort(), generatedAt: new Date().toISOString(), source: 'Dynatrace Problems API' };
}
