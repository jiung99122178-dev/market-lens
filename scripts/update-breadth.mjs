import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export function parseAdjusted(body,symbol,now=new Date()) {
 const chart=body.chart?.result?.[0];
 if(chart?.meta?.symbol!==symbol||chart.meta.currency!=='USD')throw Error(symbol+': unexpected symbol/currency');
 const values=chart.indicators?.adjclose?.[0]?.adjclose;
 if(!Array.isArray(values)||!chart.timestamp?.length)throw Error(symbol+': adjusted close missing; no raw-close fallback');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(now);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 const rows=new Map();
 chart.timestamp.forEach((t,i)=>{
  if(!Number.isFinite(t))return;
  const date=new Date(t*1000).toISOString().slice(0,10),price=values[i];
  if(Number.isFinite(price)&&price>0&&(date<today||(date===today&&hour>=18)))rows.set(date,{date,price});
 });
 const result=[...rows.values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(result.length<2)throw Error(symbol+': insufficient completed closes');
 return result;
}
export function joinBreadth(spy,rsp) {
 const right=new Map(rsp.map(r=>[r.date,r.price]));
 const rows=spy.flatMap(r=>right.has(r.date)?[{date:r.date,spy:r.price,rsp:right.get(r.date)}]:[]);
 if(rows.length<2)throw Error('Insufficient common trading dates');
 return rows;
}
async function fetchSymbol(symbol,now){
 // Fetch the full available daily history on every refresh, including dividend revisions.
 let failure;
 for(const host of ['query1','query2'])try{
  const url=new URL(`https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}`);
  for(const [k,v] of Object.entries({period1:0,period2:Math.floor(now.getTime()/1000),interval:'1d',includeAdjustedClose:'true'}))url.searchParams.set(k,String(v));
  const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(symbol+': Yahoo HTTP '+response.status);
  return parseAdjusted(await response.json(),symbol,now);
 }catch(e){failure=e;}
 throw failure;
}
export async function updateBreadth({file=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data/breadth.json'),fetcher=fetchSymbol,now=new Date()}={}) {
 let old;try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const [spy,rsp]=await Promise.all(['SPY','RSP'].map(s=>fetcher(s,now)));
 const rows=joinBreadth(spy,rsp);
 if(rows.length<252)throw Error('Breadth history too short; previous file preserved');
 if(old?.rows?.at(-1)?.date>rows.at(-1).date)throw Error('Breadth date regressed; previous file preserved');
 if(old?.rows?.[0]?.date<rows[0].date)throw Error('Breadth early history missing; previous file preserved');
 if(old?.rows?.length&&rows.length<old.rows.length*.95)throw Error('Breadth history unexpectedly truncated; previous file preserved');
 const snapshot={version:1,source:'Yahoo Finance',priceBasis:'adjusted-close',currency:'USD',updatedAt:now.toISOString(),symbolDates:{SPY:spy.at(-1).date,RSP:rsp.at(-1).date},rows};
 // Replace the entire validated pair together: dividend revisions must not mix with old adjusted prices.
 await fs.mkdir(path.dirname(file),{recursive:true});
 const temporary=file+'.tmp';await fs.writeFile(temporary,JSON.stringify(snapshot));await fs.rename(temporary,file);
 console.log('Breadth saved:',rows.length,'common daily closes; latest',rows.at(-1).date);
 return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await updateBreadth();
