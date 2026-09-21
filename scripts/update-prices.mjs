import fs from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

export function closedDate(date, now) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(now);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 return date<today || (date===today && hour>=18);
}
export function parseSeries(body, now) {
 const chart=body.chart?.result?.[0];
 if(!chart?.timestamp?.length)throw Error('Missing prices');
 const values=chart.indicators?.adjclose?.[0]?.adjclose ?? chart.indicators?.quote?.[0]?.close;
 if(!values)throw Error('Missing close values');
 const prices={};
 chart.timestamp.forEach((t,i)=>{const d=new Date(t*1000).toISOString().slice(0,10),v=values[i];if(closedDate(d,now)&&Number.isFinite(v)&&v>0)prices[d]=v;});
 if(!Object.keys(prices).length)throw Error('No completed trading days');
 return {name:chart.meta?.longName??chart.meta?.shortName??'',prices};
}
export function validate(old, next) {
 const last=next.dates.at(-1);
 if(!last || last<old.dates.at(-1))throw Error('Benchmark would regress');
 for(const [id,series] of Object.entries(next.series)) {
  if(!Number.isFinite(series.prices[last]))throw Error(id+': latest close missing; keeping old snapshot');
  for(const date of Object.keys(old.series[id]?.prices??{}))if(!(date in series.prices))throw Error(id+': history would be lost');
 }
}
async function fetchSeries(symbol,now,start) {
 for(let attempt=0;attempt<4;attempt++) {
  const host=attempt%2?'query2':'query1';
  const url=new URL(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  for(const [k,v] of Object.entries({period1:Math.floor(new Date(start+'T00:00:00Z').getTime()/1000),period2:Math.floor(now.getTime()/1000),interval:'1d',events:'history',includeAdjustedClose:'true'}))url.searchParams.set(k,String(v));
  try{const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('HTTP '+r.status);return parseSeries(await r.json(),now);}
  catch(e){if(attempt===3)throw Error(symbol+': '+e.message);await sleep(3000*2**attempt);}
 }
}
async function main(){
 const old=JSON.parse(await fs.readFile('data/history.json','utf8'));
 const ledgers=JSON.parse(await fs.readFile('data/ledgers.json','utf8'));
 const manifest=JSON.parse(await fs.readFile('data/manifest.json','utf8'));
 const ids=new Set([...Object.keys(old.series),...Object.values(ledgers).flatMap(l=>l.trades.map(t=>t[2]+'-US'))]);ids.add('SP50');
 const now=new Date(), yearAgo=new Date(now);yearAgo.setUTCFullYear(yearAgo.getUTCFullYear()-1);yearAgo.setUTCDate(yearAgo.getUTCDate()-14);
 const start=[yearAgo.toISOString().slice(0,10),...Object.values(old.series).flatMap(s=>Object.keys(s.prices)),...Object.values(ledgers).flatMap(l=>l.trades.map(t=>t[0]))].sort()[0];
 const series={};
 for(const id of ids){const symbol=id==='SP50'?'^GSPC':id.replace(/-US$/,'');series[id]=await fetchSeries(symbol,now,start);if(id==='SP50')series[id].name='S&P 500';console.log(id,Object.keys(series[id].prices).sort().at(-1));await sleep(500);}
 const dates=Object.keys(series.SP50.prices).filter(d=>d>=old.dates[0]).sort();
 const next={...old,dates,series};validate(old,next);
 // Do not touch published files until every series has passed validation.
 await fs.writeFile('data/history.json',JSON.stringify(next));
 await fs.writeFile('data/manifest.json',JSON.stringify({...manifest,priceDate:dates.at(-1),priceUpdatedAt:now.toISOString()}));
 console.log('Validated snapshot:',dates.at(-1));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
