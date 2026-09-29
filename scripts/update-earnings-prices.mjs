import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {fetchEarningsPrices,yahooSymbol} from './earnings-prices-core.mjs';

// A freshness cutoff, not a fabricated trading-day observation. On holidays the
// provider's actual dates remain unchanged and the later scheduled run retries.
export function expectedCloseDate(now=new Date()) {
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(now);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 const date=new Date(day+'T00:00:00Z');
 if(hour<18)date.setUTCDate(date.getUTCDate()-1);
 while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()-1);
 return date.toISOString().slice(0,10);
}
export function validateSnapshot(next,ticker,now=new Date(),old=null) {
 if(next.ticker!==ticker||next.symbol!==yahooSymbol(ticker)||!['close','adjusted-close'].includes(next.priceBasis)||!Array.isArray(next.points)||next.points.length<2)throw Error('Invalid symbol or snapshot');
 const lastAllowed=expectedCloseDate(now),seen=new Set();
 let previous='';
 for(const point of next.points) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(point.date)||point.date>lastAllowed||point.date<=previous||!Number.isFinite(point.price)||point.price<=0)throw Error('Invalid dated close');
  seen.add(point.date);previous=point.date;
 }
 if(old?.points?.length) {
  if(old.ticker!==ticker||old.symbol!==next.symbol||old.priceBasis!==next.priceBasis||(old.currency&&old.currency!==next.currency))throw Error('Price identity or basis changed; keeping previous snapshot');
  if(next.points.at(-1).date<old.points.at(-1).date)throw Error('Latest date would regress');
  const cutoff=new Date(now);cutoff.setUTCFullYear(cutoff.getUTCFullYear()-3);
  const start=cutoff.toISOString().slice(0,10);
  if(old.points.some(p=>p.date>=start&&!seen.has(p.date)))throw Error('Existing dates would be lost');
 }
}
export async function updateEarningsPrices({
 input='data/earnings.json',out='data/earnings-prices',now=new Date(),
 fetcher=fetchEarningsPrices,delayMs=300,concurrency=3,maxDurationMs=360000,
 force=false,log=console.log
}={}) {
 const catalog=JSON.parse(await fs.readFile(input,'utf8'));
 const tickers=[...new Set(catalog.rows.map(row=>row.ticker))];
 tickers.forEach(yahooSymbol);
 await fs.mkdir(out,{recursive:true});
 const started=Date.now(),target=expectedCloseDate(now);
 const status={version:1,startedAt:now.toISOString(),expectedCloseDate:target,total:tickers.length,checked:0,updated:0,skipped:0,failed:0,lagging:0,stopped:false,stopReason:null,errors:{}};
 let cursor=0,consecutive=0;
 async function worker(){while(cursor<tickers.length&&!status.stopped){
  if(Date.now()-started>=maxDurationMs){status.stopped=true;status.stopReason='Time budget reached; unprocessed snapshots retained';break;}
  const ticker=tickers[cursor++],file=path.join(out,'symbol-'+ticker+'.json');
  let old=null;
  try{old=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  if(!force&&old?.points?.at(-1)?.date>=target) {
   try{validateSnapshot(old,ticker,now);status.checked++;status.skipped++;continue;}catch{/* Re-fetch an invalid cached file. */}
  }
  try {
   const next=await fetcher(ticker,now);
   validateSnapshot(next,ticker,now,old);
   await fs.writeFile(file+'.tmp',JSON.stringify(next));await fs.rename(file+'.tmp',file);
   status.updated++;consecutive=0;
   if(next.points.at(-1).date<target)status.lagging++;
  }catch(e){
   status.failed++;status.errors[ticker]=e.message;
   // Missing/delisted names and validation failures are individual failures,
   // not evidence that the provider has become unavailable for every symbol.
   const transient=e.status>=500||['TimeoutError','AbortError','TypeError'].includes(e.name);
   consecutive=transient?consecutive+1:0;
   if(e.status===429||consecutive>=8){status.stopped=true;status.stopReason=e.status===429?'Provider rate limit; previous snapshots retained':'Repeated failures; previous snapshots retained';}
  }
  status.checked++;
  if(status.checked%100===0)log(JSON.stringify({checked:status.checked,updated:status.updated,skipped:status.skipped,failed:status.failed}));
  if(delayMs)await sleep(delayMs);
 }}
 await Promise.all(Array.from({length:concurrency},()=>worker()));
 status.finishedAt=new Date().toISOString();
 status.unprocessed=status.total-status.checked;
 await fs.writeFile(path.join(out,'status.json.tmp'),JSON.stringify(status));
 await fs.rename(path.join(out,'status.json.tmp'),path.join(out,'status.json'));
 log(JSON.stringify(status));
 return status;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const args=process.argv.slice(2),arg=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:args[i+1];};
 const status=await updateEarningsPrices({input:arg('--input','data/earnings.json'),out:arg('--out','data/earnings-prices'),force:args.includes('--force')});
 if(status.stopped||(status.updated+status.skipped===0&&status.failed>0))process.exitCode=1;
}
