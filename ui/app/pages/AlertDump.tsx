import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type Row = Record<string, unknown>;
interface Zone { id: string; name: string; }
interface Response { rows: Row[]; count: number; managementZones: Zone[]; availableSeverities: string[]; generatedAt: string; source: string; resultLimit?: number; }
interface MzCount { managementZone: string; alertCount: number; }
interface MzResponse { totalAlertCount: number; counts: MzCount[]; generatedAt: string; }

const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};
const download = (content: string, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const csvCell = (value: unknown) => `"${text(value).replace(/"/g, '""')}"`;
const formatExportTimestamp = (value: unknown): string => {
  if (value == null || value === '') return '';
  const numeric = typeof value === 'number' ? value : (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN);
  const date = Number.isFinite(numeric) ? new Date(numeric > 1e12 ? numeric : numeric * 1000) : new Date(String(value).replace(/^"|"$/g, ''));
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString('en-IN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};
const rowToCsv = (row: Row) => [
  row.display_id, row['event.name'], row['event.status'], row['event.severity'], row['event.category'],
  row['dt.davis.impact_level'], formatExportTimestamp(row['event.start']), formatExportTimestamp(row['event.end']),
  row['problem.duration'], row.affected_entity_names, row.management_zones, row.root_cause_entity_name, row['event.description'],
].map(csvCell).join(',');
const buttonStyle: React.CSSProperties = { height: 36, padding: '0 13px', border: '1px solid #b8c7d8', borderRadius: 7, background: '#ffffff', color: '#172334', fontWeight: 700, cursor: 'pointer' };
const selectStyle: React.CSSProperties = { height: 36, minWidth: 145, border: '1px solid #aebed0', borderRadius: 7, background: '#ffffff', color: '#172334', padding: '0 9px', fontSize: 12 };

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${url} failed with HTTP ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ''}`);
  if (!raw) throw new Error(`${url} returned an empty response.`);
  return JSON.parse(raw) as T;
}

export const AlertDump = () => {
  const navigate = useNavigate();
  const [range, setRange] = useState('24h');
  const [status, setStatus] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [zoneId, setZoneId] = useState('ALL');
  const [zoneSearch, setZoneSearch] = useState('');
  const [zoneOpen, setZoneOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summary, setSummary] = useState<MzResponse | null>(null);
  const [error, setError] = useState('');
  const [data, setData] = useState<Response | null>(null);
  const pageSize = 50;
  const zonePickerRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (nextRange = range, nextStatus = status, nextSeverity = severity, nextZone = zoneId) => {
    setLoading(true); setError('');
    try {
      const body = await postJson<Response>('/api/getAlertDump', {
        from: `now-${nextRange}`, to: 'now()', status: nextStatus, severity: nextSeverity,
        managementZoneId: nextZone, limit: nextRange === '1y' ? 50000 : 50000,
      });
      setData(body); setPage(1);
    } catch (cause: unknown) {
      setData(null); setError(cause instanceof Error ? cause.message : 'Unable to load Alert Dump.');
    } finally { setLoading(false); }
  }, [range, status, severity, zoneId]);

  const loadManagementZoneSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const body = await postJson<MzResponse>('/api/getAlertDumpManagementZoneSummary', { from: 'now()-1y', to: 'now()', status, severity });
      setSummary(body);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Management Zone summary.');
    } finally { setSummaryLoading(false); }
  }, [status, severity]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadManagementZoneSummary(); }, [loadManagementZoneSummary]);
  useEffect(() => {
    const handleOutside = (event: MouseEvent) => { if (zonePickerRef.current && !zonePickerRef.current.contains(event.target as Node)) setZoneOpen(false); };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const zones = data?.managementZones ?? [];
  const filteredZones = useMemo(() => {
    const query = zoneSearch.trim().toLowerCase();
    return query ? zones.filter((zone) => zone.name.toLowerCase().includes(query)) : zones;
  }, [zones, zoneSearch]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = rows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const exportCurrent = () => {
    const columns = ['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Management Zones','Root Cause Entity','Description'];
    const content = '\uFEFF' + [columns.map(csvCell).join(','), ...rows.map(rowToCsv)].join('\r\n');
    download(content, 'text/csv;charset=utf-8', `dynatrace-alert-dump-${range}.csv`);
  };

  const fetchWindow = async (olderDays: number, newerDays: number): Promise<Row[]> => {
    const body = await postJson<Response>('/api/getAlertDump', {
      from: `now()-${olderDays}d`, to: newerDays === 0 ? 'now()' : `now()-${newerDays}d`,
      status, severity, managementZoneId: zoneId, limit: 50000,
    });
    return body.rows;
  };

  const collectFullYear = async (olderDays: number, newerDays: number): Promise<Row[]> => {
    const rowsInWindow = await fetchWindow(olderDays, newerDays);
    if (rowsInWindow.length < 50000 || olderDays - newerDays <= 1) return rowsInWindow;
    const middle = Math.floor((olderDays + newerDays) / 2);
    const left = await collectFullYear(olderDays, middle);
    const right = await collectFullYear(middle, newerDays);
    return [...left, ...right];
  };

  const downloadFullYear = async () => {
    if (exporting) return;
    setExporting(true); setExportProgress('Preparing 1-year alert dump…'); setError('');
    try {
      const allRows = await collectFullYear(365, 0);
      const unique = new Map<string, Row>();
      for (const row of allRows) {
        const id = text(row.display_id);
        if (id && !unique.has(id)) unique.set(id, row);
      }
      const columns = ['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Management Zones','Root Cause Entity','Description'];
      const chunks = [columns.map(csvCell).join(',')];
      let index = 0;
      for (const row of unique.values()) {
        chunks.push(rowToCsv(row));
        index += 1;
        if (index % 5000 === 0) setExportProgress(`Preparing ${index.toLocaleString()} alerts…`);
      }
      download('\uFEFF' + chunks.join('\r\n'), 'text/csv;charset=utf-8', 'dynatrace-alert-dump-last-1-year.csv');
      setExportProgress(`Completed: ${unique.size.toLocaleString()} unique alerts`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Unable to prepare the 1-year Alert Dump.');
      setExportProgress('');
    } finally { setExporting(false); }
  };

  const downloadMzSummary = () => {
    if (!summary) return;
    const content = '\uFEFF' + [['Management Zone','Alert Count'], ...summary.counts.map((item) => [item.managementZone, item.alertCount])].map((row) => row.map(csvCell).join(',')).join('\r\n');
    download(content, 'text/csv;charset=utf-8', 'dynatrace-management-zone-alert-count-last-1-year.csv');
  };

  const apply = (kind: 'range' | 'status' | 'severity' | 'zone', value: string) => {
    const next = { range, status, severity, zoneId, [kind]: value };
    if (kind === 'range') setRange(value);
    if (kind === 'status') setStatus(value);
    if (kind === 'severity') setSeverity(value);
    if (kind === 'zone') setZoneId(value);
    void load(next.range, next.status, next.severity, next.zoneId);
  };

  const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 2, background: '#eaf1f7', color: '#172334', borderBottom: '1px solid #cbd7e3', padding: '10px 9px', textAlign: 'left', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { color: '#24364a', borderBottom: '1px solid #e3e9ef', padding: '9px', verticalAlign: 'top', lineHeight: 1.35 };

  return <main style={{ minHeight: '100vh', background: '#f4f7fa', color: '#172334', padding: 24, fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
    <section style={{ maxWidth: 1900, margin: '0 auto', background: '#ffffff', border: '1px solid #d5dfe9', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 28px rgba(20,45,75,.07)' }}>
      <header style={{ padding: '22px 26px', background: '#f5f9fd', borderBottom: '1px solid #dbe4ed' }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.12em', color: '#1769aa' }}>AXIS BANK • DYNATRACE OPERATIONS</div>
        <h1 style={{ margin: '7px 0 4px', color: '#172334', fontSize: 25 }}>Dynatrace Alert Dump</h1>
        <p style={{ margin: 0, color: '#52657a', fontSize: 13 }}>High-volume Davis problem export with 1-year retrieval and Management Zone attribution.</p>
      </header>

      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', padding: '15px 26px', background: '#ffffff', borderBottom: '1px solid #dbe4ed' }}>
        <label style={{ color: '#33485f', fontSize: 11, fontWeight: 800 }}>TIME RANGE
          <select style={selectStyle} value={range} onChange={(e) => apply('range', e.target.value)}>
            <option value="1h">Last 1 hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="1y">Last 1 year</option>
          </select>
        </label>
        <label style={{ color: '#33485f', fontSize: 11, fontWeight: 800 }}>STATUS
          <select style={selectStyle} value={status} onChange={(e) => apply('status', e.target.value)}>
            <option value="ALL">All</option><option value="ACTIVE">Active / Open</option><option value="CLOSED">Closed / Resolved</option>
          </select>
        </label>
        <label style={{ color: '#33485f', fontSize: 11, fontWeight: 800 }}>SEVERITY
          <select style={selectStyle} value={severity} onChange={(e) => apply('severity', e.target.value)}>
            <option value="ALL">All severities</option>{(data?.availableSeverities ?? ['1','2','3','4','5']).map((item) => <option key={item} value={item}>Severity {item}</option>)}
          </select>
        </label>
        <div ref={zonePickerRef} style={{ position: 'relative', minWidth: 280 }}>
          <label style={{ color: '#33485f', fontSize: 11, fontWeight: 800, display: 'block', marginBottom: 5 }}>MANAGEMENT ZONE</label>
          <button type="button" aria-haspopup="listbox" aria-expanded={zoneOpen} onClick={() => { setZoneOpen((open) => !open); setZoneSearch(''); }} style={{ ...selectStyle, minWidth: 280, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zoneId === 'ALL' ? 'All Management Zones' : zoneId}</span><span aria-hidden="true">⌄</span>
          </button>
          {zoneOpen && <div role="listbox" aria-label="Management Zone options" style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, width: '100%', marginTop: 4, padding: 8, background: '#ffffff', border: '1px solid #aebed0', borderRadius: 8, boxShadow: '0 12px 30px rgba(20,45,75,.16)' }}>
            <input autoFocus value={zoneSearch} onChange={(e) => setZoneSearch(e.target.value)} onClick={(e) => e.stopPropagation()} placeholder="Search management zones…" autoComplete="off" style={{ width: '100%', boxSizing: 'border-box', height: 34, border: '1px solid #c9d6e1', borderRadius: 6, padding: '0 10px', color: '#172334', marginBottom: 7 }} />
            <div style={{ maxHeight: 280, overflow: 'auto', borderTop: '1px solid #eef2f5' }}>
              <button type="button" role="option" aria-selected={zoneId === 'ALL'} onClick={() => { setZoneOpen(false); setZoneSearch(''); apply('zone', 'ALL'); }} style={{ display: 'block', width: '100%', border: 0, background: zoneId === 'ALL' ? '#f1f6fa' : '#ffffff', color: '#24364a', textAlign: 'left', padding: '8px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 5 }}>All Management Zones</button>
              {filteredZones.map((zone) => <button type="button" role="option" aria-selected={zoneId === zone.id} key={zone.id} onClick={() => { setZoneOpen(false); setZoneSearch(''); apply('zone', zone.id); }} style={{ display: 'block', width: '100%', border: 0, background: zoneId === zone.id ? '#f1f6fa' : '#ffffff', color: '#24364a', textAlign: 'left', padding: '8px 9px', fontSize: 11, cursor: 'pointer', borderRadius: 5 }}>{zone.name}</button>)}
              {!filteredZones.length && <div style={{ padding: 12, color: '#8293a3', fontSize: 10 }}>No matching Management Zone found.</div>}
            </div>
            <div style={{ marginTop: 5, color: '#8293a3', fontSize: 9 }}>{zoneSearch ? String(filteredZones.length) + (filteredZones.length === 1 ? ' match' : ' matches') : String(zones.length) + ' zones available'}</div>
          </div>}
        </div>
        <button type="button" style={{ ...buttonStyle, background: '#174a7e', color: '#ffffff', borderColor: '#174a7e' }} onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Load problems'}</button>
        <button type="button" style={buttonStyle} onClick={exportCurrent} disabled={!rows.length}>Download Current CSV</button>
        <button type="button" style={{ ...buttonStyle, background: '#0b6e4f', color: '#ffffff', borderColor: '#0b6e4f' }} onClick={() => void downloadFullYear()} disabled={exporting}>
          {exporting ? 'Building 1-Year Dump…' : 'Download Full 1-Year Dump'}
        </button>
        <button type="button" style={buttonStyle} onClick={() => navigate('/')}>Back to Problems</button>
      </div>

      {exportProgress && <div style={{ margin: '12px 26px 0', padding: 10, background: '#eef7f3', border: '1px solid #c8e5d8', borderRadius: 8, color: '#176342', fontSize: 12 }}>{exportProgress}</div>}
      {error && <div style={{ margin: '14px 26px 0', padding: 11, color: '#8d211a', background: '#fff2f0', border: '1px solid #efc1bc', borderRadius: 8, fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '13px 26px', color: '#40566d', fontSize: 12 }}>
        <span><strong style={{ color: '#172334' }}>{rows.length.toLocaleString()}</strong> problems loaded · page {currentPage} of {pageCount}{data?.resultLimit ? ` · query chunk limit ${data.resultLimit.toLocaleString()}` : ''}</span>
        <span>{data?.generatedAt ? new Date(data.generatedAt).toLocaleString() : ''}</span>
      </div>

      <div style={{ margin: '0 26px', border: '1px solid #d5dfe9', borderRadius: 9, overflow: 'auto', maxHeight: 'calc(100vh - 360px)', minHeight: 300 }}>
        <table style={{ width: '100%', minWidth: 1650, borderCollapse: 'collapse', background: '#ffffff', fontSize: 11 }}>
          <thead><tr>{['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Management Zones','Root Cause Entity','Description'].map((head) => <th key={head} style={th}>{head}</th>)}</tr></thead>
          <tbody>{visible.length ? visible.map((row, index) => <tr key={`${text(row.display_id)}-${index}`} style={{ background: index % 2 ? '#fbfcfd' : '#ffffff' }}>
            <td style={{ ...td, color: '#174a7e', fontWeight: 800 }}>{text(row.display_id)}</td>
            <td style={td}>{text(row['event.name']) || '—'}</td><td style={td}>{text(row['event.status']) || '—'}</td><td style={td}>{text(row['event.severity']) || '—'}</td>
            <td style={td}>{text(row['event.category']) || '—'}</td><td style={td}>{text(row['dt.davis.impact_level']) || '—'}</td><td style={td}>{text(row['event.start']) || '—'}</td>
            <td style={td}>{text(row['event.end']) || '—'}</td><td style={td}>{text(row['problem.duration']) || '—'}</td><td style={td}>{text(row.affected_entity_names) || '—'}</td>
            <td style={{ ...td, maxWidth: 240, whiteSpace: 'normal' }}>{text(row.management_zones) || 'Unassigned'}</td><td style={td}>{text(row.root_cause_entity_name) || 'Not identified'}</td><td style={{ ...td, maxWidth: 420, whiteSpace: 'normal' }}>{text(row['event.description']) || '—'}</td>
          </tr>) : <tr><td colSpan={13} style={{ ...td, textAlign: 'center', padding: 42, color: '#52657a' }}>{loading ? 'Reading live Dynatrace problems…' : 'No problems matched the selected filters.'}</td></tr>}</tbody>
        </table>
      </div>
      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '13px 26px', color: '#40566d' }}>
        <button type="button" style={buttonStyle} disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button>
        <span style={{ fontSize: 12 }}>Showing {rows.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, rows.length)} of {rows.length}</span>
        <button type="button" style={buttonStyle} disabled={currentPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button>
      </footer>

      <section style={{ margin: '18px 26px 26px', border: '1px solid #d5dfe9', borderRadius: 10, overflow: 'hidden', background: '#fbfcfd' }}>
        <div style={{ padding: '14px 16px', background: '#f1f6fa', borderBottom: '1px solid #d5dfe9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><div style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.1em', color: '#1769aa' }}>1-YEAR MANAGEMENT ZONE ANALYSIS</div><h2 style={{ margin: '4px 0 0', fontSize: 17, color: '#183b59' }}>Alert Count by Management Zone</h2><div style={{ marginTop: 3, fontSize: 11, color: '#66798d' }}>Last 1 year · duplicate Davis problems excluded · a problem is counted once per matched Management Zone.</div></div>
          <div style={{ display: 'flex', gap: 8 }}><button type="button" style={buttonStyle} onClick={() => void loadManagementZoneSummary()} disabled={summaryLoading}>{summaryLoading ? 'Refreshing…' : 'Refresh Counts'}</button><button type="button" style={buttonStyle} onClick={downloadMzSummary} disabled={!summary?.counts.length}>Download MZ Counts CSV</button></div>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, background: '#ffffff', border: '1px solid #dbe4ed', borderRadius: 8, padding: 12 }}><div style={{ fontSize: 9, color: '#718396', fontWeight: 900 }}>TOTAL 1-YEAR PROBLEMS</div><strong style={{ display: 'block', marginTop: 5, fontSize: 22, color: '#173b5b' }}>{summaryLoading ? '…' : (summary?.totalAlertCount ?? 0).toLocaleString()}</strong></div>
            <div style={{ flex: 1, background: '#ffffff', border: '1px solid #dbe4ed', borderRadius: 8, padding: 12 }}><div style={{ fontSize: 9, color: '#718396', fontWeight: 900 }}>MANAGEMENT ZONES WITH ALERTS</div><strong style={{ display: 'block', marginTop: 5, fontSize: 22, color: '#173b5b' }}>{summary?.counts.length.toLocaleString() ?? '0'}</strong></div>
          </div>
          <div style={{ maxHeight: 330, overflow: 'auto', border: '1px solid #dbe4ed', borderRadius: 8, background: '#fff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}><thead><tr><th style={th}>Management Zone</th><th style={{ ...th, textAlign: 'right' }}>Alert Count</th></tr></thead>
              <tbody>{summary?.counts.length ? summary.counts.map((item) => <tr key={item.managementZone}><td style={td}>{item.managementZone}</td><td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{item.alertCount.toLocaleString()}</td></tr>) : <tr><td colSpan={2} style={{ ...td, textAlign: 'center', padding: 28 }}>{summaryLoading ? 'Calculating 1-year Management Zone counts…' : 'No Management Zone counts available.'}</td></tr>}</tbody>
            </table>
          </div>
        </div>
      </section>
    </section>
  </main>;
};
