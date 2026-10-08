import test from 'node:test';import assert from 'node:assert/strict';
import {completedWeeks} from './weekly-sma-core.mjs';
import {buildWeeklyBreadth} from './weekly-breadth-core.mjs';
const now=new Date('2026-10-08T03:00Z'),weeks=completedWeeks(now,70);
const universe={sourceSha256:'test',rows:[{ticker:'A',sector:'Tech',subsector:'AI'},{ticker:'B',sector:'Tech',subsector:'AI'},{ticker:'C',sector:'Other',subsector:'AI'},{ticker:'D',sector:'Other',subsector:'Retail'}]};
const calendar={rows:weeks.map(w=>[w.date,100]),sessionDates:weeks.map(w=>w.date)};
const prices={A:{rows:weeks.map((w,i)=>[w.date,100+i])},B:{rows:weeks.map((w,i)=>[w.date,300-i])},C:{rows:weeks.map(w=>[w.date,100])},D:{rows:weeks.slice(-10).map(w=>[w.date,110])}};
test('equal-count ratio, missing denominator, equality and sector totals',()=>{
 const b=buildWeeklyBreadth(universe,prices,calendar,now),all=b.groups.find(g=>g.type==='all'),tech=b.groups.find(g=>g.type==='sector'&&g.name==='Tech'),other=b.groups.find(g=>g.type==='sector'&&g.name==='Other');
 assert.equal(all.points.length,51);assert(Math.abs(all.points.at(-1)[1]-100/3)<1e-10);assert.deepEqual(all.points.at(-1).slice(2),[1,3]);assert.equal(tech.points.at(-1)[1],50);assert.equal(other.points.at(-1)[1],0);
 assert.notEqual(all.points.at(-1)[1],(50+0)/2);assert.equal(b.groups.filter(g=>g.type==='subsector'&&g.name==='AI').length,2);
 for(let i=0;i<all.points.length;i++){assert.equal(tech.points[i][2]+other.points[i][2],all.points[i][2]);assert.equal(tech.points[i][3]+other.points[i][3],all.points[i][3]);}
});
test('20 completed weekly closes; no open week and no missing price carry-forward',()=>{
 const withCurrent={...prices,A:{rows:[...prices.A.rows,['2026-10-07',1]]}};
 assert.deepEqual(buildWeeklyBreadth(universe,prices,calendar,now),buildWeeklyBreadth(universe,withCurrent,calendar,now));
 const gap={...prices,A:{rows:prices.A.rows.filter(([d])=>d!==weeks[40].date)}};
 const b=buildWeeklyBreadth(universe,gap,calendar,now),all=b.groups.find(g=>g.type==='all');
 assert.deepEqual(all.points.find(p=>p[0]===weeks[40].weekEnding).slice(1),[0,0,2]);assert.equal(all.points.at(-1)[3],3);
 // Holiday Friday is represented by actual Thursday close, but labeled week-ending Friday.
 assert(b.groups[0].points.some(p=>p[0]==='2026-07-03'));
});
test('incremental overlap preserves older history and equals full rebuild',()=>{
 const full=buildWeeklyBreadth(universe,prices,calendar,now),start=weeks.at(-30).date;
 const short=Object.fromEntries(Object.entries(prices).map(([k,v])=>[k,{rows:v.rows.filter(([d])=>d>=start)}]));
 const inc=buildWeeklyBreadth(universe,short,calendar,now,{previous:full,rebuildStart:start});assert.deepEqual(inc,full);
 const different=buildWeeklyBreadth({...universe,sourceSha256:'changed'},short,calendar,now,{previous:full,rebuildStart:start});assert.equal(different.groups[0].points.length,11);
});
test('missing reference prices remain missing, and no observations fails safely',()=>{
 const c={...calendar,rows:calendar.rows.filter(([d])=>d!==weeks[25].date)};
 const b=buildWeeklyBreadth(universe,prices,c,now);assert.equal(b.groups[0].points.find(p=>p[0]===weeks[25].weekEnding)[1],null);
 assert.throws(()=>buildWeeklyBreadth(universe,{},calendar,now),/no valid latest/);
 assert.throws(()=>buildWeeklyBreadth(universe,prices,{rows:[]},now),/lacks completed/);
});
