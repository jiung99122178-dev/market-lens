import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
export const definitions=[
 {id:'WALCL',key:'assets',name:'연준 총자산',divisor:1000,frequency:'Weekly, Wednesday'},
 {id:'WDTGAL',key:'tga',name:'TGA · 수요일 잔액',divisor:1000,frequency:'Weekly, Wednesday'},
 {id:'RRPONTSYD',key:'rrp',name:'ON RRP',divisor:1,frequency:'Daily'},
];
export function parseCsv(text,id,divisor){
 const lines=text.trim().split(/\r?\n/);const header=lines.shift()?.replace(/^\uFEFF/,'').split(',');
 if(!header||!['observation_date','DATE'].includes(header[0])||header[1]!==id)throw Error(id+': invalid CSV header');
 const points=[];
 for(const line of lines){const [date,raw]=line.split(',');if(raw==='.'||raw===''||raw===undefined)continue;const value=Number(raw);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(value)||value<0)throw Error(id+': invalid observation');points.push({date,value:value/divisor});}
 if(points.length<2)throw Error(id+': insufficient history');
 return points.sort((a,b)=>a.date.localeCompare(b.date));
}
export function combine(series){
 const dates=[...new Set(definitions.flatMap(d=>series[d.key].map(r=>r.date)))].sort();
 const cursor={assets:0,tga:0,rrp:0},last={};const rows=[];
 for(const date of dates){
  for(const {key} of definitions){const p=series[key];while(cursor[key]<p.length&&p[cursor[key]].date<=date)last[key]=p[cursor[key]++];}
  // No invented history before all three constituents exist. Never backfill.
  if(definitions.some(d=>!last[d.key]))continue;
  const age=key=>(Date.parse(date)-Date.parse(last[key].date))/86400000;
  const valid=age('assets')<=10&&age('tga')<=10&&age('rrp')<=5;
  rows.push({date,assets:last.assets.value,tga:last.tga.value,rrp:last.rrp.value,
   net:valid?last.assets.value-last.tga.value-last.rrp.value:null,
   sourceDates:{assets:last.assets.date,tga:last.tga.date,rrp:last.rrp.date}});
 }
 if(!rows.length)throw Error('No overlapping history');
 return rows;
}
async function main(){
 const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data');
 const file=path.join(dir,'liquidity.json'),statusFile=path.join(dir,'liquidity-status.json');
 await fs.mkdir(dir,{recursive:true});const checkedAt=new Date().toISOString();
 try{
  let previous=null;try{previous=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const series={};
  for(const d of definitions){
   let error;
   for(let attempt=0;attempt<3;attempt++)try{
    const r=await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id='+d.id,{signal:AbortSignal.timeout(30000)});
    if(!r.ok)throw Error(d.id+': FRED HTTP '+r.status);
    const points=parseCsv(await r.text(),d.id,d.divisor);
    if(points.at(-1).date<previous?.sources?.find(s=>s.id===d.id)?.latestDate)throw Error(d.id+': observation date regressed');
    series[d.key]=points;error=null;break;
   }catch(e){error=e;if(attempt<2)await sleep(1500*(attempt+1));}
   if(error)throw error;
  }
  const rows=combine(series);
  const snapshot={updatedAt:checkedAt,unit:'USD billions',method:'WALCL / 1000 - WDTGAL / 1000 - RRPONTSYD; last observation carried forward; not a point-in-time backtest',
   sources:definitions.map(d=>({...d,url:'https://fred.stlouisfed.org/series/'+d.id,latestDate:series[d.key].at(-1).date})),rows};
  await fs.writeFile(file+'.tmp',JSON.stringify(snapshot));await fs.rename(file+'.tmp',file);
  await fs.writeFile(statusFile,JSON.stringify({ok:true,checkedAt,message:'수집 완료'}));
  console.log(JSON.stringify({rows:rows.length,latest:rows.at(-1),sources:snapshot.sources.map(s=>({id:s.id,date:s.latestDate}))}));
 }catch(e){await fs.writeFile(statusFile,JSON.stringify({ok:false,checkedAt,message:'FRED 수집 실패 · 이전 데이터 유지'}));throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
