import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expectedCloseDate,validateSnapshot,updateEarningsPrices} from './update-earnings-prices.mjs';
const now=new Date('2026-09-29T23:00:00Z');
const snapshot=(ticker,last='2026-09-29')=>({version:1,ticker,symbol:ticker,currency:'USD',priceBasis:'adjusted-close',savedAt:now.toISOString(),points:[{date:'2026-09-25',price:100},{date:'2026-09-28',price:110},...(last==='2026-09-29'?[{date:last,price:115}]:[])]});
test('cutoff follows NY session, weekends, DST and standard time',()=>{
 assert.equal(expectedCloseDate(now),'2026-09-29');
 assert.equal(expectedCloseDate(new Date('2026-09-29T18:00:00Z')),'2026-09-28');
 assert.equal(expectedCloseDate(new Date('2026-09-28T12:00:00Z')),'2026-09-25');
 assert.equal(expectedCloseDate(new Date('2026-12-01T22:00:00Z')),'2026-11-30');
 assert.equal(expectedCloseDate(new Date('2026-12-01T23:00:00Z')),'2026-12-01');
});
test('reject regression, missing history, currency/basis mismatch, invalid prices',()=>{
 const old=snapshot('A');
 assert.throws(()=>validateSnapshot(snapshot('A','2026-09-28'),'A',now,old),/regress/);
 const missing=snapshot('A');missing.points.splice(1,1);assert.throws(()=>validateSnapshot(missing,'A',now,old),/lost/);
 assert.throws(()=>validateSnapshot({...old,priceBasis:'close'},'A',now,old),/basis/);
 assert.throws(()=>validateSnapshot({...old,currency:'EUR'},'A',now,old),/basis/);
 const bad=snapshot('A');bad.points[1].price=null;assert.throws(()=>validateSnapshot(bad,'A',now),/Invalid/);
});
test('valid full-history revision replaces prices consistently',()=>{
 const old=snapshot('A','2026-09-28'),next=snapshot('A');next.points.forEach(p=>p.price/=2);validateSnapshot(next,'A',now,old);
});
async function fixture(t,tickers,old={}){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'earnings-refresh-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const input=path.join(dir,'catalog.json'),out=path.join(dir,'prices');await fs.mkdir(out);
 await fs.writeFile(input,JSON.stringify({rows:tickers.map(ticker=>({ticker}))}));
 for(const [ticker,data] of Object.entries(old))await fs.writeFile(path.join(out,'symbol-'+ticker+'.json'),JSON.stringify(data));
 return {input,out,now,delayMs:0,concurrency:1,log:()=>{}};
}
test('next session refreshes even if collected less than 24 hours earlier; retry skips current names',async t=>{
 const options=await fixture(t,['A','B'],{A:snapshot('A','2026-09-28'),B:snapshot('B')});const calls=[];
 const s=await updateEarningsPrices({...options,fetcher:async ticker=>{calls.push(ticker);return snapshot(ticker);}});
 assert.deepEqual(calls,['A']);assert.equal(s.updated,1);assert.equal(s.skipped,1);assert.equal(s.unprocessed,0);
});
test('per-symbol failure leaves previous file byte-identical and updates other symbols',async t=>{
 const old=snapshot('A','2026-09-28'),options=await fixture(t,['A','B'],{A:old});
 const file=path.join(options.out,'symbol-A.json'),before=await fs.readFile(file,'utf8');
 const s=await updateEarningsPrices({...options,fetcher:async ticker=>{if(ticker==='A')throw Error('HTTP 404');return snapshot(ticker);}});
 assert.equal(await fs.readFile(file,'utf8'),before);assert.equal(s.failed,1);assert.equal(s.updated,1);
 assert.equal(JSON.parse(await fs.readFile(path.join(options.out,'status.json'))).failed,1);
});
test('rate limit stops requests and retains files; symbols cannot escape directory',async t=>{
 const options=await fixture(t,['A','B']);let calls=0;
 const s=await updateEarningsPrices({...options,fetcher:async()=>{calls++;const e=Error('HTTP 429');e.status=429;throw e;}});
 assert.equal(calls,1);assert.equal(s.stopped,true);assert.equal(s.unprocessed,1);
 const invalid=await fixture(t,['../secret']);await assert.rejects(()=>updateEarningsPrices(invalid),/Invalid ticker/);
});
test('CON ticker uses a Windows-safe file name',async t=>{
 const options=await fixture(t,['CON']);await updateEarningsPrices({...options,fetcher:async ticker=>snapshot(ticker)});
 assert.equal(JSON.parse(await fs.readFile(path.join(options.out,'symbol-CON.json'))).ticker,'CON');
});
test('unavailable symbols do not stop collection for other names',async t=>{
 const tickers=Array.from({length:10},(_,i)=>'A'+i),options=await fixture(t,tickers);
 const s=await updateEarningsPrices({...options,fetcher:async ticker=>{if(ticker==='A9')return snapshot(ticker);const e=Error('HTTP 404');e.status=404;throw e;}});
 assert.equal(s.stopped,false);assert.equal(s.failed,9);assert.equal(s.updated,1);assert.equal(s.unprocessed,0);
});
