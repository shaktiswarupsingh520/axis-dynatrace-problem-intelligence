import React, { useMemo, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { useNavigate } from 'react-router-dom';

type Row = Record<string, unknown>;
interface Response { rows: Row[]; count: number; managementZones: string[]; generatedAt: string; query: string; }
const v = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map(v).filter(Boolean).join('; ');
  return JSON.stringify(value) ?? '';
};
const fields=['display_id','event.name','event.status','event.severity','event.category','dt.davis.impact_level','event.start','event.end','affected_entity_names','root_cause_entity_id','event.description'];
const heads=['Problem ID','Title','Status','Severity','Category','Impact','Started','Ended','Affected Entities','Root Cause Entity','Description'];
const makeCsv=(rows:Row[])=>{const esc=(x:unknown)=>`"${v(x).replace(/"/g,'""')}"`;return `\uFEFF${[heads.map(esc).join(','),...rows.map(r=>fields.map(f=>esc(r[f])).join(','))].join('\r\n')}`;};
const styles = [
  '.adbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;padding:14px;border:1px solid #dce3ea;border-radius:10px;background:#f7f9fb}',
  '.adbar label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700}',
  '.adbar select,.adbar button{height:36px;border:1px solid #c8d2dd;border-radius:7px;padding:0 10px;background:#fff}',
  '.adbar button{font-weight:700;cursor:pointer}',
  '.adprimary{background:#174a7e!important;color:#fff;border-color:#174a7e!important}',
  '.admeta{display:flex;justify-content:space-between;font-size:12px;color:#65758a}',
  '.adwrap{overflow:auto;border:1px solid #dce3ea;border-radius:10px;max-height:calc(100vh - 300px)}',
  '.adtable{width:100%;min-width:1500px;border-collapse:collapse;font-size:12px}',
  '.adtable th,.adtable td{padding:9px 11px;border-bottom:1px solid #e7ebef;text-align:left;vertical-align:top}',
  '.adtable th{position:sticky;top:0;background:#edf3f8;z-index:1;white-space:nowrap}',
  '.adpager{display:flex;align-items:center;justify-content:space-between;padding:10px 0}',
  '.adpager button{height:32px;border:1px solid #c8d2dd;border-radius:7px;background:#fff;padding:0 12px;font-weight:700}',
  '.adpager button:disabled{opacity:.45}',
  '.aderror{padding:12px;border:1px solid #e5aaa5;background:#fff5f4;border-radius:8px;color:#9b241b}',
].join('');

export const AlertDump=()=>{
  const nav=useNavigate();
  const[range,setRange]=useState('24h');
  const[status,setStatus]=useState('ALL');
  const[severity,setSeverity]=useState('ALL');
  const[zone,setZone]=useState('ALL');
  const[page,setPage]=useState(1);
  const pageSize=50;
  const req={from:`now-${range}`,status,severity,managementZone:zone,limit:1000};
  const{data,isLoading,error,refetch}=useAppFunction<Response>({name:'getAlertDump',data:req},{autoFetch:true,autoFetchOnUpdate:true});
  const rows=useMemo(()=>data?.rows ?? [],[data?.rows]);
  const zones=useMemo(()=>data?.managementZones ?? [],[data?.managementZones]);
  const pageCount=Math.max(1,Math.ceil(rows.length/pageSize));
  const visible=useMemo(()=>rows.slice((page-1)*pageSize,page*pageSize),[rows,page]);
  const change=(setter:React.Dispatch<React.SetStateAction<string>>,value:string)=>{setter(value);setPage(1);};
  const download=()=>{const url=URL.createObjectURL(new Blob([makeCsv(rows)],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`dynatrace-problem-alert-dump-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <Flex flexDirection="column" padding={24} gap={16}>
    <style>{styles}</style>
    <Heading>Dynatrace Alert Dump</Heading>
    <Paragraph>Live Davis problems with Management Zone filtering, status/severity filtering, investigation details and CSV export.</Paragraph>
    <div className="adbar">
      <label>Time range<select value={range} onChange={e=>change(setRange,e.target.value)}><option value="1h">Last 1 hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
      <label>Status<select value={status} onChange={e=>change(setStatus,e.target.value)}><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select></label>
      <label>Severity<select value={severity} onChange={e=>change(setSeverity,e.target.value)}><option value="ALL">All severities</option><option value="1">Level 1 — Critical</option><option value="2">Level 2</option><option value="3">Level 3</option><option value="4">Level 4</option><option value="5">Level 5 — Info</option></select></label>
      <label>Management Zone<select value={zone} onChange={e=>change(setZone,e.target.value)}><option value="ALL">All Management Zones</option>{zones.map(z=><option key={z} value={z}>{z}</option>)}</select></label>
      <button className="adprimary" type="button" onClick={()=>void refetch()} disabled={isLoading}>{isLoading?'Loading…':'Load problems'}</button>
      <button type="button" onClick={download} disabled={!rows.length}>Download CSV</button>
      <button type="button" onClick={()=>nav('/')}>Back to Problems</button>
    </div>
    {error&&<div className="aderror">Unable to load alert dump: {error.message}</div>}
    <div className="admeta"><span>{rows.length} problems loaded · page {Math.min(page,pageCount)} of {pageCount} · duplicates excluded</span><span>{data?.generatedAt?new Date(data.generatedAt).toLocaleString():''}</span></div>
    <div className="adwrap"><table className="adtable"><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.length?visible.map((r,i)=>{const s=new Date(v(r['event.start']));return <tr key={`${v(r.display_id)}-${i}`}><td><strong>{v(r.display_id)}</strong></td><td>{v(r['event.name'])}</td><td>{v(r['event.status'])}</td><td>{v(r['event.severity'])}</td><td>{v(r['event.category'])}</td><td>{v(r['dt.davis.impact_level'])}</td><td>{Number.isNaN(s.getTime())?v(r['event.start']):s.toLocaleString()}</td><td>{v(r['event.end'])}</td><td>{v(r.affected_entity_names||r.affected_entity_ids)}</td><td>{v(r.root_cause_entity_id)||'Not returned'}</td><td>{v(r['event.description'])}</td></tr>}) : <tr><td colSpan={heads.length}>{isLoading?'Reading Davis problems…':'No problems matched the selected filters.'}</td></tr>}</tbody></table></div>
    <div className="adpager"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><span>Showing {(rows.length?((page-1)*pageSize)+1:0)}–{Math.min(page*pageSize,rows.length)} of {rows.length}</span><button type="button" disabled={page>=pageCount} onClick={()=>setPage(p=>Math.min(pageCount,p+1))}>Next</button></div>
  </Flex>;
};
