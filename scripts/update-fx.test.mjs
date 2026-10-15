import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFxCsv, buildFxSnapshot, updateFx } from './update-fx.mjs';
const now = new Date('2026-10-15T00:00:00Z');
const csv = 'observation_date,DEXCHUS\n2026-10-09,6.6920\n2026-10-08,6.7021\n2026-10-12,.\n2026-10-13,\n';
test('correct quotation, sort, holidays and numeric values', () => {
  assert.deepEqual(parseFxCsv(csv, now), [{date:'2026-10-08',rate:6.7021},{date:'2026-10-09',rate:6.692}]);
  for (const bad of ['observation_date,OTHER\n2026-10-09,6.7', 'observation_date,DEXCHUS\n2026-02-30,7', 'observation_date,DEXCHUS\n2026-10-16,7', 'observation_date,DEXCHUS\n2026-10-09,7\n2026-10-09,8', ...['0','-1','NaN','Infinity','garbage'].map(v=>'observation_date,DEXCHUS\n2026-10-09,'+v)]) assert.throws(()=>parseFxCsv(bad,now));
});
const history = Array.from({length:1850},(_,i)=>({date:new Date(Date.UTC(2021,8,1+i)).toISOString().slice(0,10),rate:6.7+i/100000}));
test('five-year coverage, identity and non-regressing latest date',()=>{
  const snapshot=buildFxSnapshot(history,null,now);
  assert.equal(snapshot.pair,'USD/CNY');assert.equal(snapshot.unit,'CNY per USD');
  assert.throws(()=>buildFxSnapshot(history.slice(-100),null,now));
  assert.throws(()=>buildFxSnapshot(history,snapshot.asOf?{...snapshot,asOf:'2026-10-15'}:null,now));
  assert.throws(()=>buildFxSnapshot(history,{...snapshot,pair:'USD/CNH'},now));
  assert.throws(()=>buildFxSnapshot(history.filter((_,i)=>i%10!==0),snapshot,now));
});
test('failed refresh never overwrites the previous file; valid snapshot saves',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'market-lens-fx-test-')),file=path.join(dir,'usd-cny.json');
  const old=JSON.stringify(buildFxSnapshot(history,null,now));await fs.writeFile(file,old);
  for(const fetcher of [async()=>new Response('down',{status:503}),async()=>new Response(csv)]){
    await assert.rejects(updateFx({file,now,fetcher}));assert.equal(await fs.readFile(file,'utf8'),old);
  }
  const text='observation_date,DEXCHUS\n'+history.map(r=>r.date+','+r.rate).join('\n');
  const value=await updateFx({file,now,fetcher:async()=>new Response(text)});
  assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),value);
});
