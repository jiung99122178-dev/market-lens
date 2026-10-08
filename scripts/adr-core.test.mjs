import test from 'node:test';import assert from 'node:assert/strict';
import {parseCloses,signsForDates,aggregateAdr,yahooSymbol} from './adr-core.mjs';
const dates=Array.from({length:25},(_,i)=>'2026-01-'+String(i+1).padStart(2,'0'));
const universe=[{ticker:'A',sector:'Tech',subsector:'AI'},{ticker:'B',sector:'Tech',subsector:'Cloud'},{ticker:'C',sector:'Other',subsector:'Retail'}];
test('20-day sum ratio, flat excluded; warmup and group totals',()=>{
 const r=aggregateAdr(universe,dates,{A:{signs:'+'.repeat(25)},B:{signs:'-'.repeat(25)},C:{signs:'='.repeat(25)}},{from:dates[0]});
 assert.equal(r[0].points.length,6);assert.deepEqual(r[0].points[0],[dates[19],100,1,1,1,20,20]);
 assert.equal(r.find(g=>g.id==='sector:Tech').points[0][1],100);assert.equal(r.find(g=>g.id==='subsector:AI').points[0][1],null);
});
test('not the average of daily ratios; rolling oldest observation removed',()=>{
 const r=aggregateAdr(universe,dates,{A:{signs:'+'+'-'.repeat(24)},B:{signs:'+'.repeat(25)},C:{signs:'-'.repeat(25)}},{from:dates[0]});
 assert.equal(r[0].points[0][1],Math.round(21/39*10000)/100);assert.equal(r[0].points[1][1],50);
});
test('missing is neither flat nor a multi-day price change; equality tolerance',()=>{
 assert.equal(signsForDates(dates.slice(0,5),[[dates[0],100],[dates[1],101],[dates[3],102],[dates[4],102]]),'?+??=');
 assert.equal(aggregateAdr(universe,dates,{A:{signs:'?'.repeat(25)}},{from:dates[0]})[0].points[0][1],null);
});
test('reject dividends-adjusted fallback; reject wrong instrument, incomplete current session',()=>{
 const b={chart:{result:[{meta:{symbol:'A',currency:'USD',instrumentType:'EQUITY'},timestamp:[Date.parse('2026-01-05T14:30Z')/1000,Date.parse('2026-01-06T14:30Z')/1000,Date.parse('2026-01-07T14:30Z')/1000],indicators:{quote:[{close:[100,101,102]}],adjclose:[{adjclose:[90,90,90]}]}}]}};
 assert.deepEqual(parseCloses(b,'A',new Date('2026-01-07T20:00Z')).rows,[['2026-01-05',100],['2026-01-06',101]]);
 assert.throws(()=>parseCloses(b,'B'));delete b.chart.result[0].indicators.quote;assert.throws(()=>parseCloses(b,'A'));
});
test('explicit class mappings only',()=>{assert.equal(yahooSymbol('BRK.B'),'BRK-B');assert.equal(yahooSymbol('COMP.EQ'),'COMP.EQ');});
test('missing reference price does not erase the trading session',()=>{
 const b={chart:{result:[{meta:{symbol:'SPY',currency:'USD',instrumentType:'ETF'},timestamp:['2026-01-05','2026-01-06','2026-01-07'].map(d=>Date.parse(d+'T14:30Z')/1000),indicators:{quote:[{close:[100,null,102]}]}}]}};
 const p=parseCloses(b,'SPY',new Date('2026-01-08T03:00Z'));assert.deepEqual(p.sessionDates,['2026-01-05','2026-01-06','2026-01-07']);assert.equal(signsForDates(p.sessionDates,p.rows),'???');
});
