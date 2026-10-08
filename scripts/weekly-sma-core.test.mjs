import test from 'node:test';import assert from 'node:assert/strict';
import {completedWeeks,weeklyRow,buildWeeklySnapshot} from './weekly-sma-core.mjs';
const item={ticker:'TEST',sector:'Tech',subsector:'AI'};
test('completed Friday only; DST and standard-time 18:00 cutoff',()=>{
 assert.equal(completedWeeks(new Date('2026-10-08T03:00Z')).at(-1).weekEnding,'2026-10-02');
 assert.equal(completedWeeks(new Date('2026-10-09T21:59Z')).at(-1).weekEnding,'2026-10-02');
 assert.equal(completedWeeks(new Date('2026-10-09T22:00Z')).at(-1).weekEnding,'2026-10-09');
 assert.equal(completedWeeks(new Date('2026-12-11T22:59Z')).at(-1).weekEnding,'2026-12-04');
 assert.equal(completedWeeks(new Date('2026-12-11T23:00Z')).at(-1).weekEnding,'2026-12-11');
});
test('holiday Friday uses Thursday; early-close Friday is retained',()=>{
 assert.equal(completedWeeks(new Date('2026-07-04T03:00Z')).at(-1).date,'2026-07-02');
 assert.equal(completedWeeks(new Date('2026-04-04T03:00Z')).at(-1).date,'2026-04-02');
 assert.equal(completedWeeks(new Date('2026-11-28T03:00Z')).at(-1).date,'2026-11-27');
 assert.equal(completedWeeks(new Date('2028-01-01T03:00Z')).at(-1).date,'2027-12-31');
});
test('20 weekly closes, not 100 daily closes; exact crossing and equality',()=>{
 const weeks=completedWeeks(new Date('2026-10-08T03:00Z'));
 const priceData={name:'Test',rows:weeks.map((w,i)=>[w.date,i===20?110:100])};
 const r=weeklyRow(item,priceData,weeks);assert.equal(r.sma20,100.5);assert.equal(r.position,'above');assert.equal(r.crossUp,true);
 const flat=weeklyRow(item,{rows:weeks.map(w=>[w.date,100])},weeks);assert.equal(flat.position,'at');assert.equal(flat.crossUp,false);
 const down=weeklyRow(item,{rows:weeks.map((w,i)=>[w.date,i===20?90:100])},weeks);assert.equal(down.position,'below');
});
test('incomplete current-week prices ignored and missing weekly close never filled',()=>{
 const weeks=completedWeeks(new Date('2026-10-08T03:00Z')),p=weeks.map(w=>[w.date,100]);p.push(['2026-10-07',1000]);
 assert.equal(weeklyRow(item,{rows:p},weeks).sma20,100);
 p.splice(5,1);const r=weeklyRow(item,{rows:p},weeks);assert.equal(r.sma20,null);assert.equal(r.validWeeks,19);
 assert.equal(weeklyRow(item,{rows:p.slice(-5)},weeks).position,'unavailable');
});
test('missing oldest week permits SMA but not a crossing claim',()=>{const w=completedWeeks(new Date('2026-10-08T03:00Z'));const r=weeklyRow(item,{rows:w.slice(1).map((v,i)=>[v.date,100+i])},w);assert.equal(r.validWeeks,20);assert.equal(r.crossUp,null);});
test('reference gap refuses publishing rather than using a wrong weekly date',()=>{
 const now=new Date('2026-10-08T03:00Z'),w=completedWeeks(now);assert.throws(()=>buildWeeklySnapshot({rows:[item]},{},{rows:w.slice(0,-1).map(x=>[x.date,100])},now),/reference close missing/);
 assert.throws(()=>completedWeeks(new Date('2030-01-08')),/calendar needs review/);
});
