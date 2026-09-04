import React, { useMemo, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { useNavigate } from 'react-router-dom';

type Row = Record<string, unknown>;
interface Zone { id: string; name: string; }
interface Response { rows: Row[]; count: number; managementZones: Zone[]; availableSeverities: string[]; generatedAt: string; source: string; }
const text = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') return JSON.stringify(value) ?? '';
  return '';
};
const download = (content: string, type: string, name: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const escCsv = (value: unknown) => `"${text(value).replace(/"/g, '""')}"`;
const escHtml = (value: unknown) => text(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

export const AlertDump = () => {
  const navigate = useNavigate();
  const [range, setRange] = useState('24h');
  const [status, setStatus] = useState('ALL');
  const [severity, setSeverity] = useState('ALL');
  const [zoneId, setZoneId] = useState('ALL');
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const request = useMemo(() => ({ from: `now-${range}`, status, severity, managementZoneId: zoneId, limit: 1000 }), [range, status, severity, zoneId]);
  const query = useAppFunction<Response>({ name: 'getAlertDump', data: request }, { autoFetch: true, autoFetchOnUpdate: true });
  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const zones = useMemo(() => query.data?.managementZones ?? [], [query.data]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = useMemo(() => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize), [rows, currentPage]);
  const exportRows = () => rows.map((row) => ({ id: row.display_id, title: row['event.name'], status: row['event.status'], severity: row['event.severity'], category: row['event.category'], impact: row['dt.davis.impact_level'], started: row['event.start'], ended: row['event.end'], duration: row['problem.duration'], entities: row.affected_entity_names, root: row.root_cause_entity_id, description: row['event.description'] }));
  const csv = () => { const data = exportRows(); const columns = ['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Root Cause Entity','Description']; const keys = ['id','title','status','severity','category','impact','started','ended','duration','entities','root','description'] as const; return `\uFEFF${[columns.map(escCsv).join(','), ...data.map((row) => keys.map((key) => escCsv(row[key])).join(','))].join('\r\n')}`; };
  const excel = () => csv();
  return <Flex flexDirection="column" padding={24} gap={16}>
    <div style={{ border: '1px solid #dbe3ec', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '20px 24px', background: '#f5f9fd' }}>
        <Heading>Dynatrace Alert Dump</Heading>
        <Paragraph>Live Davis problems with Management Zone, status, severity and time filtering.</Paragraph>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap', padding: '15px 24px', borderBlock: '1px solid #e2e8ef', background: '#f7f9fb' }}>
        <label>Time range<select value={range} onChange={(e) => { setRange(e.target.value); setPage(1); }}><option value="1h">Last 1 hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label>Status<select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="CLOSED">Closed / Resolved</option></select></label>
        <label>Severity<select value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}><option value="ALL">All severities</option>{(query.data?.availableSeverities ?? []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>Management Zone<select value={zoneId} onChange={(e) => { setZoneId(e.target.value); setPage(1); }}><option value="ALL">All Management Zones</option>{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}</select></label>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isLoading}>{query.isLoading ? 'Loading…' : 'Load problems'}</button>
        <button type="button" onClick={() => download(csv(), 'text/csv;charset=utf-8', 'dynatrace-alert-dump.csv')} disabled={!rows.length}>Download CSV</button>
        <button type="button" onClick={() => download(excel(), 'application/vnd.ms-excel;charset=utf-8', 'dynatrace-alert-dump.xls')} disabled={!rows.length}>Download Excel</button>
        <button type="button" onClick={() => navigate('/')}>Back to Problems</button>
      </div>
      {query.error && <div style={{ margin: '0 24px', padding: 10, border: '1px solid #e5aaa5', background: '#fff5f4', borderRadius: 8 }}>Unable to load Alert Dump: {query.error.message}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '11px 24px', fontSize: 12 }}><span><strong>{rows.length}</strong> problems loaded · page {currentPage} of {pageCount}</span><span>{query.data?.generatedAt ? new Date(query.data.generatedAt).toLocaleString() : ''}</span></div>
      <div style={{ margin: '0 24px', border: '1px solid #dbe3ec', borderRadius: 9, overflow: 'auto', maxHeight: 'calc(100vh - 360px)', minHeight: 260 }}>
        <table style={{ width: '100%', minWidth: 1400, borderCollapse: 'collapse', fontSize: 11 }}><thead><tr>{['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Root Cause Entity','Description'].map((head) => <th key={head} style={{ position: 'sticky', top: 0, background: '#edf3f8', padding: 9, textAlign: 'left' }}>{head}</th>)}</tr></thead><tbody>{visible.length ? visible.map((row, index) => <tr key={`${text(row.display_id)}-${index}`}><td><strong>{text(row.display_id)}</strong></td><td>{text(row['event.name'])}</td><td>{text(row['event.status'])}</td><td>{text(row['event.severity'])}</td><td>{text(row['event.category'])}</td><td>{text(row['dt.davis.impact_level'])}</td><td>{text(row['event.start'])}</td><td>{text(row['event.end']) || '—'}</td><td>{text(row['problem.duration'])}</td><td>{text(row.affected_entity_names)}</td><td>{text(row.root_cause_entity_id) || 'Not identified'}</td><td>{text(row['event.description'])}</td></tr>) : <tr><td colSpan={12} style={{ textAlign: 'center', padding: 35 }}>{query.isLoading ? 'Reading live Dynatrace problems…' : 'No problems matched the selected filters.'}</td></tr>}</tbody></table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px' }}><button type="button" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</button><span>Showing {rows.length ? (currentPage - 1) * pageSize + 1 : 0}–{Math.min(currentPage * pageSize, rows.length)} of {rows.length}</span><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>Next</button></div>
    </div>
  </Flex>;
};
