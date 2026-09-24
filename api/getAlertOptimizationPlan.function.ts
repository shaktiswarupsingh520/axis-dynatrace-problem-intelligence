import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { problemsClient, settingsObjectsClient } from '@dynatrace-sdk/client-classic-environment-v2';

type Row=Record<string,unknown>;
type Payload={managementZoneName:string};
type Zone={id:string;name:string};
type ProblemRow={problemId?:string;displayId?:string;title?:string;status?:string;severityLevel?:string;impactLevel?:string;startTime?:number;endTime?:number;rootCauseEntity?:{name?:string};managementZones?:Array<{id?:string;name?:string}>};

const text=(v:unknown):string=>{
 if(v==null)return '';
 if(typeof v==='string')return v;
 if(typeof v==='number'||typeof v==='boolean'||typeof v==='bigint')return String(v);
 if(Array.isArray(v))return v.map(text).filter(Boolean).join('; ');
 if(typeof v==='object'){const r=v as Row;if('name' in r&&text(r.name))return text(r.name);try{return JSON.stringify(v)??'';}catch{return '';}}
 return '';
};
const safe=(v:string)=>v.replace(/\\/g,'\\\\').replace(/"/g,'\\"');
const duration=(s?:number,e?:number)=>{if(!Number.isFinite(s))return 0;const end=e!==undefined&&e>=0?e:Date.now();return Math.max(0,(end-(s as number))/60000);};

async function loadZones():Promise<Zone[]>{
 try{
  const zones:Zone[]=[];let response=await settingsObjectsClient.getSettingsObjects({schemaIds:'builtin:management-zones',scopes:'environment',fields:'objectId,value',pageSize:500});
  const collect=(items:unknown)=>{if(!Array.isArray(items))return;for(const item of items){if(!item||typeof item!=='object')continue;const r=item as {objectId?:string;value?:{name?:unknown}};const name=typeof r.value?.name==='string'?r.value.name.trim():'';if(name)zones.push({id:name,name});}};
  collect(response.items);
  for(let page=0;response.nextPageKey&&page<10;page++){response=await settingsObjectsClient.getSettingsObjects({nextPageKey:response.nextPageKey});collect(response.items);}
  return [...new Map(zones.map(z=>[z.name,z])).values()].sort((a,b)=>a.name.localeCompare(b.name));
 }catch{return [];}
}

async function loadProblems(zoneName:string):Promise<ProblemRow[]>{
 const rows:ProblemRow[]=[];
 let response=await problemsClient.getProblems({from:'now-30d',to:'now',pageSize:500,sort:'-startTime',problemSelector:`managementZones("${{safe(zoneName)}")`});
 rows.push(...((response.problems??[]) as unknown as ProblemRow[]));
 for(let page=0;response.nextPageKey&&page<4;page++){response=await problemsClient.getProblems({nextPageKey:response.nextPageKey});rows.push(...((response.problems??[]) as unknown as ProblemRow[]));}
 return rows;
}

const extract=(v:unknown):string=>{
 if(typeof v==='string')return v.trim();
 if(Array.isArray(v))return v.map(extract).filter(Boolean).join('\\n').trim();
 if(!v||typeof v!=='object')return '';
 const r=v as Row;for(const k of ['text','answer','content','message']){const x=extract(r[k]);if(x)return x;}
 return Array.isArray(r.tokens)?r.tokens.map(text).join('').trim():'';
};

export default async function(payload:Payload){
 const zone=text(payload?.managementZoneName).trim();
 const zones=await loadZones();
 if(zone==='__LOAD_ZONES_ONLY__')return {managementZone:'',generatedAt:new Date().toISOString(),window:'Last 30 days',totals:{problems:0,uniquePatterns:0,recurringPatterns:0,openProblems:0,thresholdReviewCandidates:0,immediateActionCandidates:0},severityCounts:{},patterns:[],thresholdCandidates:[],immediateActions:[],assistAnalysis:'',assistStatus:'Zone list only',availableManagementZones:zones,methodology:[]};
 if(!zone)throw new Error('Select a Management Zone before generating the Alert Optimization Plan.');
 const problems=await loadProblems(zone);

 type Pattern={key:string;title:string;rootCauseEntity:string;severity:string;impact:string;occurrences:number;openCount:number;closedCount:number;avgDurationMinutes:number;maxDurationMinutes:number;firstSeen:number;lastSeen:number;problemIds:string[]};
 const groups=new Map<string,Pattern>();
 for(const p of problems){
  const title=text(p.title)||'Untitled problem',root=text(p.rootCauseEntity?.name)||'Not identified',severity=text(p.severityLevel)||'Not available',impact=text(p.impactLevel)||'Not available';
  const key=[title,root,impact].join(' | '),start=Number(p.startTime)||0,d=duration(p.startTime,p.endTime),existing=groups.get(key);
  if(existing){existing.occurrences++;if(text(p.status).toUpperCase()==='OPEN')existing.openCount++;else existing.closedCount++;existing.avgDurationMinutes+=d;existing.maxDurationMinutes=Math.max(existing.maxDurationMinutes,d);existing.firstSeen=existing.firstSeen?Math.min(existing.firstSeen,start):start;existing.lastSeen=Math.max(existing.lastSeen,start);if(existing.problemIds.length<8)existing.problemIds.push(text(p.displayId)||text(p.problemId));}
  else groups.set(key,{key,title,rootCauseEntity:root,severity,impact,occurrences:1,openCount:text(p.status).toUpperCase()==='OPEN'?1:0,closedCount:text(p.status).toUpperCase()==='OPEN'?0:1,avgDurationMinutes:d,maxDurationMinutes:d,firstSeen:start,lastSeen:start,problemIds:[text(p.displayId)||text(p.problemId)]});
 }
 const patterns=[...groups.values()].map(p=>({...p,avgDurationMinutes:Number((p.avgDurationMinutes/Math.max(p.occurrences,1)).toFixed(1)),recurrenceRatePerWeek:Number((p.occurrences/4.2857).toFixed(1))})).sort((a,b)=>b.occurrences-a.occurrences||b.openCount-a.openCount);
 const recurring=patterns.filter(p=>p.occurrences>=2);
 const thresholdCandidates=patterns.filter(p=>p.occurrences>=5&&p.avgDurationMinutes<=15&&p.openCount===0).slice(0,15);
 const immediateActions=patterns.filter(p=>p.openCount>0||['ERROR','AVAILABILITY','RESOURCE_CONTENTION','MONITORING_UNAVAILABLE'].includes(p.severity.toUpperCase())||p.avgDurationMinutes>=60).slice(0,15);
 const severityCounts=patterns.reduce<Record<string,number>>((a,p)=>(a[p.severity]=(a[p.severity]??0)+p.occurrences,a),{});

 const context=JSON.stringify({managementZone:zone,window:'last 30 days',totals:{problems:problems.length,uniquePatterns:patterns.length,recurringPatterns:recurring.length,openProblems:problems.filter(p=>text(p.status).toUpperCase()==='OPEN').length,thresholdReviewCandidates:thresholdCandidates.length,immediateActionCandidates:immediateActions.length},severityCounts,topPatterns:patterns.slice(0,50),thresholdReviewCandidates:thresholdCandidates,immediateActionCandidates:immediateActions}).slice(0,30000);
 let assistAnalysis='',assistStatus='Not available';
 try{
  const prompt=`Create an evidence-based Alert Optimization Plan for Dynatrace Management Zone: ${{zone}. Analyze ONLY the supplied last-30-days problem-pattern data.

Return exactly these sections:
1. Executive Optimization Summary
2. Repeated / Noisy Alert Patterns
3. Threshold & Sensitivity Review
4. Immediate Action Queue
5. Automation / Routing Opportunities
6. 30-Day Monitoring Governance Plan
7. Risks, Evidence Gaps & Validation

Rules:
- Do not invent thresholds, metric values, entities, incidents or business impact.
- Treat threshold/sensitivity changes as review candidates when exact alert configuration is unavailable.
- Do not recommend disabling an alert solely because it recurs; state what must be validated first.
- Prioritize open, severe, long-duration and highly recurring patterns.
- Separate observed facts from recommendations.
- Recommendations are proposals and require owner validation before production changes.
- Keep the response below 9000 characters.`;
  const response=await publicClient.recommenderConversation({body:{text:prompt,context:[{type:'document-retrieval',value:'disabled'},{type:'supplementary',value:context},{type:'instruction',value:'Use only the supplied 30-day Dynatrace problem evidence and clearly label recommendations as proposed actions.'}],annotations:{origin:'Axis Problem Intelligence Alert Optimization',managementZone:zone}}}) as unknown as Row;
  assistAnalysis=extract(response);assistStatus=assistAnalysis?'Generated by Dynatrace Assist':'Assist returned no recommendation';
 }catch(error){assistStatus=error instanceof Error?`Assist unavailable: ${{error.message}`:'Assist unavailable';}

 return {managementZone:zone,generatedAt:new Date().toISOString(),window:'Last 30 days',totals:{problems:problems.length,uniquePatterns:patterns.length,recurringPatterns:recurring.length,openProblems:problems.filter(p=>text(p.status).toUpperCase()==='OPEN').length,thresholdReviewCandidates:thresholdCandidates.length,immediateActionCandidates:immediateActions.length},severityCounts,patterns:patterns.slice(0,80),thresholdCandidates,immediateActions,assistAnalysis,assistStatus,availableManagementZones:zones,methodology:[
 'Recurring pattern = same problem title + root-cause entity + impact level occurring at least twice in the 30-day window.',
 'Threshold/sensitivity review candidate = 5+ occurrences, average duration <=15 minutes, and no currently open occurrence. This is a review signal, not an automatic configuration change.',
 'Immediate-action candidate = currently open, severe problem category, or average duration >=60 minutes.',
 'Exact threshold values are not inferred because historical problem records do not expose the current anomaly-detection configuration.'
 ]};
};
