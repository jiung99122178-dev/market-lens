import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {parseAdjusted,joinBreadth,updateBreadth} from './update-breadth.mjs';
const body=(symbol='SPY')=>({chart:{result:[{meta:{symbol,currency:'USD'},timestamp:['2026-09-28','2026-09-29','2026-09-30','2026-10-01'].map(d=>Date.parse(d+'T13:30Z')/1000),indicators:{quote:[{close:[500,510,520,530]}],adjclose:[{adjclose:[100,101,null,103]}]}}]}});
test('requires correct symbol, USD and adjusted prices; excludes incomplete session',()=>{
 const result=parseAdjusted(body(),'SPY',new Date('2026-10-01T18:00Z'));
 assert.deepEqual(result,[{date:'2026-09-28',price:100},{date:'2026-09-29',price:101}]);
 assert.equal(parseAdjusted(body(),'SPY',new Date('2026-10-01T23:00Z')).at(-1).price,103);
 const raw=body();delete raw.chart.result[0].indicators.adjclose;assert.throws(()=>parseAdjusted(raw,'SPY'));
 assert.throws(()=>parseAdjusted(body('RSP'),'SPY'));const foreign=body();foreign.chart.result[0].meta.currency='EUR';assert.throws(()=>parseAdjusted(foreign,'SPY'));
});
test('pairs exact dates and never forward fills missing observations',()=>{
 const a=[{date:'2026-01-01',price:100},{date:'2026-01-02',price:101},{date:'2026-01-03',price:102}];
 assert.deepEqual(joinBreadth(a,[a[0],a[2]]).map(r=>r.date),['2026-01-01','2026-01-03']);
 assert.throws(()=>joinBreadth(a,[]));
});
test('failed pair fetch, regressed dates and truncation preserve previous bytes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'market-lens-breadth-')),file=path.join(dir,'breadth.json');
 const rows=Array.from({length:300},(_,i)=>({date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10),spy:100+i,rsp:80+i}));
 const before=JSON.stringify({rows});await fs.writeFile(file,before);
 await assert.rejects(updateBreadth({file,fetcher:async()=>{throw Error('source down');}}));assert.equal(await fs.readFile(file,'utf8'),before);
 const points=rows.map(r=>({date:r.date,price:r.spy}));
 await assert.rejects(updateBreadth({file,fetcher:async()=>points.slice(0,-1)}));assert.equal(await fs.readFile(file,'utf8'),before);
 await assert.rejects(updateBreadth({file,fetcher:async()=>points.slice(40)}));assert.equal(await fs.readFile(file,'utf8'),before);
 await assert.rejects(updateBreadth({file,fetcher:async()=>points.slice(1)}),/early history missing/);assert.equal(await fs.readFile(file,'utf8'),before);
 const snapshot=await updateBreadth({file,fetcher:async()=>points.map(r=>({...r,price:r.price*.99}))});assert.equal(snapshot.rows[0].spy,99);assert.equal(snapshot.rows.length,300);
 // Only remove the exact temporary files created by this test.
 await fs.unlink(file);await fs.rmdir(dir);
});
