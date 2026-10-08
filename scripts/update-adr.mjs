import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseCloses,signsForDates,aggregateAdr,yahooSymbol,nyDate} from './adr-core.mjs';
import {buildWeeklySnapshot} from './weekly-sma-core.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function read(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.tmp',JSON.stringify(value));await fs.rename(file+'.tmp',file);}
export async function fetchCloses(symbol,start,now){
 let failure;
 for(let attempt=0;attempt<3;attempt++)try{
  const url=new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  for(const [k,v] of Object.entries({period1:Math.floor(new Date(start+'T00:00:00Z').getTime()/1000),period2:Math.floor(+now/1000),interval:'1d',events:'splits',includeAdjustedClose:'true'}))url.searchParams.set(k,String(v));
  const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000)});
  if(r.status===404||r.status===400)throw Object.assign(Error('Yahoo HTTP '+r.status),{permanent:true});
  if(!r.ok)throw Error('Yahoo HTTP '+r.status);
  return parseCloses(await r.json(),symbol,now);
 }catch(e){failure=e;if(e.permanent)break;if(attempt<2)await sleep(1500*(attempt+1));}
 throw failure;
}
export async function updateAdr({dataDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../data'),universeFile=path.join(dataDir,'adr-universe.json'),cacheDir=path.resolve(dataDir,'../.adr-cache'),now=new Date(),fetcher=fetchCloses,concurrency=4,limit=Infinity}={}){
 const universe=await read(universeFile);if(!universe?.rows?.length)throw Error('Missing ADR universe');
 const rows=universe.rows;if(new Set(rows.map(r=>r.ticker)).size!==rows.length)throw Error('Duplicate universe ticker');
 const before=await read(path.join(dataDir,'adr-state.json'),null);
 const today=nyDate(now),startDate=new Date(today+'T00:00:00Z');startDate.setUTCFullYear(startDate.getUTCFullYear()-5);
 const from=startDate.toISOString().slice(0,10),warmStart=new Date(+startDate-70*86400000).toISOString().slice(0,10);
 const calendar=await fetcher('SPY',warmStart,now),asOf=calendar.rows.at(-1)[0];
 // A missing reference price must not remove an actual trading day and turn
 // a multi-session price move into a daily advance/decline observation.
 const dates=(calendar.sessionDates??calendar.rows.map(r=>r[0])).filter(d=>d<=asOf);
 if(dates.length<1200)throw Error('Reference trading calendar shorter than five years');
 if(before?.asOf>asOf)throw Error('ADR calendar regressed');
 // The same request feeds ADR and the 20-week screener. Refetch 30 weeks
 // together so all weekly prices share the latest split adjustment basis.
 const overlap=new Date(Date.parse(asOf+'T00:00:00Z')-210*86400000).toISOString().slice(0,10),oldIndex=new Map((before?.dates??[]).map((d,i)=>[d,i]));
 const results={},weeklyPrices={},issues=[];let next=0,done=0,success=0;
 const selected=rows.slice(0,limit);
 await fs.mkdir(cacheDir,{recursive:true});
 async function worker(){while(next<selected.length){const item=selected[next++],symbol=yahooSymbol(item.ticker),old=before?.series?.[item.ticker];
   // Keep odd provider identifiers unresolved rather than silently substituting companies.
   if(/\.(EQ|T)$/.test(symbol)){issues.push({ticker:item.ticker,reason:'Provider identifier needs Yahoo mapping'});done++;continue;}
   const start=old&&before?.universeHash===universe.sourceSha256?overlap:warmStart;
   const cache=path.join(cacheDir,encodeURIComponent(symbol)+'.json');
   let requested=false;try{
    let value=await read(cache,null);
    if(!value||value.requestedStart>start||value.asOf!==asOf){requested=true;value={...await fetcher(symbol,start,now),requestedStart:start,asOf};}
    await atomic(cache,value);
    weeklyPrices[item.ticker]=value;
    const fresh=signsForDates(dates,value.rows),replaceFrom=value.rows[1]?.[0]??asOf;
    const signs=dates.map((date,i)=>date>=replaceFrom?fresh[i]:(old?.signs[oldIndex.get(date)]??fresh[i])).join('');
    results[item.ticker]={symbol,name:value.name,firstTradeDate:value.firstTradeDate,latest:value.rows.at(-1)[0],signs};success++;
    if(value.rows.at(-1)[0]<asOf)issues.push({ticker:item.ticker,reason:'Stale last close',lastDate:value.rows.at(-1)[0]});
   }catch(e){
    issues.push({ticker:item.ticker,reason:e.message});
    if(old)results[item.ticker]={...old,signs:dates.map(d=>old.signs[oldIndex.get(d)]??'?').join('')};
   }
   done++;if(done%100===0||done===selected.length)console.log(`ADR ${done}/${selected.length}: ${success} fetched, ${issues.length} issues`);if(requested)await sleep(180);
 }}
 await Promise.all(Array.from({length:concurrency},worker));
 const groups=aggregateAdr(rows,dates,results,{from});
 const latest=groups[0].points.at(-1),valid=latest[2]+latest[3]+latest[4];
 const report={attemptedAt:now.toISOString(),asOf,from,universe:rows.length,fetched:success,latestValid:valid,issues};
 await atomic(path.join(cacheDir,'report.json'),report);
 // A failed collection must never overwrite the last usable public snapshot.
 if(limit<rows.length||success<rows.length*.9||valid<rows.length*.85)throw Error(`ADR publication blocked: ${success}/${rows.length} fetched; ${valid} valid latest. See report.json`);
 if(before&&valid<(before.latestValid??valid)*.97)throw Error('Latest ADR coverage dropped more than 3%; previous snapshot preserved');
 const snapshot={version:1,source:'Yahoo Finance',priceBasis:'split-adjusted-close-excluding-dividends',classificationAsOf:universe.classificationAsOf,updatedAt:now.toISOString(),asOf,latestSession:calendar.latestSession??asOf,from,period:20,total:rows.length,fetched:success,latestValid:valid,columns:['date','adr','advances','declines','unchanged','advances20','declines20'],issues,groups};
 const state={version:1,universeHash:universe.sourceSha256,asOf,latestValid:valid,dates,series:results};
 // Both are written only after all validation. Workflow commits them together.
 await atomic(path.join(dataDir,'adr-state.json'),state);await atomic(path.join(dataDir,'adr.json'),snapshot);
 // A weekly failure preserves its own prior snapshot without discarding valid ADR.
 const weekly=buildWeeklySnapshot(universe,weeklyPrices,calendar,now),oldWeekly=await read(path.join(dataDir,'weekly-sma.json'),null);
 if(weekly.valid<rows.length*.8||(oldWeekly&&weekly.valid<oldWeekly.valid*.97)||oldWeekly?.asOf>weekly.asOf)throw Error('Weekly SMA coverage/date check failed; prior weekly snapshot preserved');
 await atomic(path.join(dataDir,'weekly-sma.json'),weekly);
 console.log(JSON.stringify({weeklyAsOf:weekly.asOf,weeklyValid:weekly.valid,counts:weekly.counts}));
 console.log(JSON.stringify({saved:true,from,asOf,groups:groups.length,days:groups[0].points.length,fetched:success,latestValid:valid,issues:issues.length}));return snapshot;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await updateAdr({...(process.env.ADR_DATA_DIR?{dataDir:path.resolve(process.env.ADR_DATA_DIR)}:{}),...(process.env.ADR_UNIVERSE_FILE?{universeFile:path.resolve(process.env.ADR_UNIVERSE_FILE)}:{}),...(process.env.ADR_CACHE_DIR?{cacheDir:path.resolve(process.env.ADR_CACHE_DIR)}:{}),...(process.env.ADR_LIMIT?{limit:Number(process.env.ADR_LIMIT)}:{})});
