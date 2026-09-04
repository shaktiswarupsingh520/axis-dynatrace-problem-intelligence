import React, { useMemo, useState } from 'react';
import { useAppFunction } from '@dynatrace-sdk/react-hooks';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading, Paragraph } from '@dynatrace/strato-components/typography';
import { useNavigate } from 'react-router-dom';

type Row = Record<string, unknown>;
interface Zone { id: string; name: string; }
interface Response { rows: Row[]; count: number; managementZones: Zone[]; availableSeverities: string[]; generatedAt: string; source: string; }
const v = (value: unknown): string => value == null ? '' : Array.isArray(value) ? value.map(v).filter(Boolean).join('; ') : typeof value === 'object' ? JSON.stringify(value) ?? '' : String(value);
const esc = (value: unknown) => v(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fields=['display_id','event.name','event.status','event.severity','event.category','dt.davis.impact_level','event.start','event.end','problem.duration','affected_entity_names','root_cause_entity_id','event.description'];
const heads=['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Root Cause Entity','Description'];
const csv=(rows:Row[])=>`\uFEFF${[heads.map(h=>`"${h.replace(/"/g,'""')}"`).join(','),...rows.map(r=>fields.map(f=>`"${v(r[f]).replace(/"/g,'""')}"`).join(','))].join('\r\n')}`;
const download=(content:BlobPart,type:string,name:string)=>{const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const excel=(rows:Row[])=>{const body=rows.map(r=>`<tr>${fields.map(f=>`<td>${esc(r[f])}</td>`).join('')}</tr>`).join('');return `\uFEFF<!doctype html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;font-family:Arial;font-size:10pt}th{background:#183b63;color:#fff;border:1px solid #b8c2cc;padding:7px}td{border:1px solid #d7dde4;padding:6px;vertical-align:top}tr:nth-child(even){background:#f4f7fa}</style></head><body><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></body></html>`;};

export const AlertDump=()=>{
  const nav=useNavigate();
  const[range,setRange]=useState('24h'); const[status,setStatus]=useState('ALL'); const[severity,setSeverity]=useState('ALL'); const[zone,setZone]=useState('ALL'); const[page,setPage]=useState(1); const pageSize=50;
  const req={from:`now-${range}`,status,severity,managementZoneId:zone,limit:1000};
  const{data,isLoading,error,refetch}=useAppFunction<Response>({name:'getAlertDump',data:req},{autoFetch:true,autoFetchOnUpdate:true});
  const rows=useMemo(()=>data?.rows??[],[data]); const zones=useMemo(()=>data?.managementZones??[],[data]); const pageCount=Math.max(1,Math.ceil(rows.length/pageSize)); const visible=useMemo(()=>rows.slice((page-1)*pageSize,page*pageSize),[rows,page]);
  const change=(setter:React.Dispatch<React.SetStateAction<string>>,value:string)=>{setter(value);setPage(1);};
  const fileBase=`dynatrace-problem-alert-dump-${new Date().toISOString().slice(0,10)}`;
  return <Flex flexDirection="column" padding={24} gap={16}>
    <style>{`.adpage{border:1px solid #dbe3ec;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(20,45,75,.07);overflow:hidden}.adhead{padding:20px 24px;background:linear-gradient(135deg,#eef7ff,#fff)}.adhead h2{margin:4px 0;font-size:25px}.adcontrols{display:flex;gap:10px;align-items:end;flex-wrap:wrap;padding:15px 24px;border-block:1px solid #e2e8ef;background:#f7f9fb}.adcontrols label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700}.adcontrols select{height:36px;min-width:145px;border:1px solid #cbd6e1;border-radius:7px;background:#fff;padding:0 10px}.adbtn{height:36px;border-radius:7px;padding:0 13px;font-weight:800;cursor:pointer}.adprimary{background:#174a7e;color:#fff;border:0}.adsecondary{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.adbtn:disabled{opacity:.45;cursor:not-allowed}.admeta{display:flex;justify-content:space-between;gap:12px;padding:11px 24px;font-size:12px;color:#607086}.adtablewrap{margin:0 24px;border:1px solid #dbe3ec;border-radius:9px;overflow:auto;max-height:calc(100vh - 360px);min-height:260px}.adtable{width:100%;min-width:1400px;border-collapse:collapse;font-size:11px}.adtable th{position:sticky;top:0;background:#edf3f8;color:#34485d;text-align:left;padding:9px;border-bottom:1px solid #cbd6e1;white-space:nowrap;z-index:2}.adtable td{padding:8px 9px;border-bottom:1px solid #e7ebef;text-align:left;vertical-align:top}.adtable tr:hover{background:#f8fbfd}.adempty{text-align:center!important;color:#77869a;padding:35px!important}.adpager{display:flex;justify-content:space-between;align-items:center;padding:12px 24px}.adpager button{height:32px;border:1px solid #c8d2dd;border-radius:7px;background:#fff;padding:0 12px;font-weight:700}.aderror{margin:0 24px;padding:10px 12px;border:1px solid #e5aaa5;background:#fff5f4;border-radius:8px;color:#9b241b;font-size:12px}`}</style>
    <div className="adpage">
      <div className="adhead"><div style={{fontSize:10,fontWeight:800,letterSpacing:'.14em',color:'#1476d4'}}>LIVE DYNATRACE</div><Heading>Dynatrace Alert Dump</Heading><Paragraph>Live Davis problems for investigation, reporting and RCA — with Management Zone scoping and Excel export.</Paragraph></div>
      <div className="adcontrols">
        <label>Time range<select value={range} onChange={e=>change(setRange,e.target.value)}><option value="1h">Last 1 hour</option><option value="6h">Last 6 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
        <label>Status<select value={status} onChange={e=>change(setStatus,e.target.value)}><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select></label>
        <label>Severity<select value={severity} onChange={e=>change(setSeverity,e.target.value)}><option value="ALL">All severities</option>{(data?.availableSeverities??[]).map(s=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select></label>
        <label>Management Zone<select value={zone} onChange={e=>change(setZone,e.target.value)}><option value="ALL">All Management Zones</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name}</option>)}</select></label>
        <button className="adbtn adprimary" type="button" onClick={()=>void refetch()} disabled={isLoading}>{isLoading?'Loading…':'Load problems'}</button>
        <button className="adbtn adsecondary" type="button" onClick={()=>download(csv(rows),'text/csv;charset=utf-8',`${fileBase}.csv`)} disabled={!rows.length}>Download CSV</button>
        <button className="adbtn adsecondary" type="button" onClick={()=>download(excel(rows),'application/vnd.ms-excel;charset=utf-8',`${fileBase}.xls`)} disabled={!rows.length}>Download Excel</button>
        <button className="adbtn adsecondary" type="button" onClick={()=>nav('/')}>Back to Problems</button>
      </div>
      {error&&<div className="aderror">Unable to load alert dump: {error.message}</div>}
      <div className="admeta"><span><strong>{rows.length}</strong> problems loaded · page {Math.min(page,pageCount)} of {pageCount} · duplicates excluded</span><span>{data?.generatedAt?new Date(data.generatedAt).toLocaleString():''}</span></div>
      <div className="adtablewrap"><table className="adtable"><thead><tr>{heads.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{visible.length?visible.map((r,i)=><tr key={`${v(r.display_id)}-${i}`}><td><strong>{v(r.display_id)}</strong></td><td>{v(r['event.name'])}</td><td>{v(r['event.status'])}</td><td>{v(r['event.severity'])}</td><td>{v(r['event.category'])}</td><td>{v(r['dt.davis.impact_level'])}</td><td>{v(r['event.start'])}</td><td>{v(r['event.end'])||'—'}</td><td>{v(r['problem.duration'])}</td><td>{v(r.affected_entity_names)}</td><td>{v(r.root_cause_entity_id)||'Not identified'}</td><td>{v(r['event.description'])}</td></tr>):<tr><td className="adempty" colSpan={heads.length}>{isLoading?'Reading live Dynatrace problems…':'No problems matched the selected filters.'}</td></tr>}</tbody></table></div>
      <div className="adpager"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button><span>Showing {rows.length?((page-1)*pageSize)+1:0}–{Math.min(page*pageSize,rows.length)} of {rows.length}</span><button type="button" disabled={page>=pageCount} onClick={()=>setPage(p=>Math.min(pageCount,p+1))}>Next</button></div>
    </div>
  </Flex>;
};
