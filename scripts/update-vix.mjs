import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
export function parseVix(body, now = new Date()) {
 const result=body.chart?.result?.[0];
 if(!result?.timestamp?.length)throw Error('VIX history missing');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(now);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 const prices=result.indicators?.quote?.[0]?.close ?? [];
 const rows=result.timestamp.map((t,i)=>({date:new Date(t*1000).toISOString().slice(0,10),close:prices[i]})).filter(r=>Number.isFinite(r.close)&&r.close>0&&(r.date<today||(r.date===today&&hour>=18)));
 if(rows.length<2)throw Error('Insufficient completed VIX closes');
 return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
async function main(){
 const file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/vix.json');
 let old=null;try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const now=new Date(),start=new Date(now);start.setUTCFullYear(start.getUTCFullYear()-5);start.setUTCDate(start.getUTCDate()-14);
 let rows,error;
 for(const host of ['query1','query2'])try{
  const url=new URL(`https://${host}.finance.yahoo.com/v8/finance/chart/%5EVIX`);
  url.searchParams.set('period1',String(Math.floor(start.getTime()/1000)));url.searchParams.set('period2',String(Math.floor(now.getTime()/1000)));url.searchParams.set('interval','1d');
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Yahoo HTTP '+response.status);
  rows=parseVix(await response.json(),now);break;
 }catch(e){error=e;}
 if(!rows)throw error;
 if(old?.rows?.at(-1)?.date>rows.at(-1).date)throw Error('VIX date regressed; previous file preserved');
 // Keep previously collected exact-day closes when Yahoo temporarily omits them.
 const merged=new Map((old?.rows??[]).map(r=>[r.date,r]));for(const row of rows)merged.set(row.date,row);
 rows=[...merged.values()].sort((a,b)=>a.date.localeCompare(b.date));
 await fs.mkdir(path.dirname(file),{recursive:true});
 await fs.writeFile(file,JSON.stringify({symbol:'^VIX',source:'Yahoo Finance',updatedAt:now.toISOString(),rows}));
 console.log('VIX saved:',rows.length,'daily closes; latest',rows.at(-1).date,rows.at(-1).close);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
