import {completedWeeks} from './weekly-sma-core.mjs';
const shift=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const weeklyGroupId=(type,sector='',subsector='')=>JSON.stringify([type,sector,subsector]);

// Reference session dates retain missing prices. A missing reference close must
// not silently turn a Thursday into a Friday close. Current classification is
// deliberately fixed over history, not represented as historical constituents.
export function buildWeeklyBreadth(universe,prices,calendar,now=new Date(),{previous=null,rebuildStart='0000-01-01'}={}){
 const last=completedWeeks(now,1)[0].weekEnding,reference=new Map(calendar.rows);
 const byWeek=new Map();
 for(const date of [...new Set(calendar.sessionDates??calendar.rows.map(r=>r[0]))].sort()){
  const day=new Date(date+'T00:00:00Z').getUTCDay();if(day<1||day>5)continue;
  const week=shift(date,5-day);if(week<=last)byWeek.set(week,date);
 }
 const weeks=[...byWeek].map(([weekEnding,date])=>({weekEnding,date}));
 const eligible=weeks.map((w,i)=>({w,i})).filter(({i})=>i>=19&&weeks[i-19].date>=rebuildStart);
 if(!eligible.length||eligible.at(-1).w.weekEnding!==last)throw Error('Weekly breadth history lacks completed reference weeks');
 const groups=new Map();
 const add=(type,sector='',subsector='')=>{const id=weeklyGroupId(type,sector,subsector);if(!groups.has(id))groups.set(id,{id,type,name:type==='all'?'전체':type==='sector'?sector:subsector,sector,total:0,points:eligible.map(({w})=>[w.weekEnding,null,0,0])});return groups.get(id);};
 const memberships=universe.rows.map(item=>[add('all'),add('sector',item.sector),add('subsector',item.sector,item.subsector)]);
 memberships.forEach(ms=>ms.forEach(g=>g.total++));
 const goodWindow=eligible.map(({i})=>weeks.slice(i-19,i+1).every((w,j,arr)=>reference.get(w.date)>0&&(j===0||shift(arr[j-1].weekEnding,7)===w.weekEnding)));
 universe.rows.forEach((item,rowIndex)=>{
  const raw=new Map(prices[item.ticker]?.rows??[]),values=weeks.map(w=>raw.get(w.date));
  eligible.forEach(({i},pointIndex)=>{
   if(!goodWindow[pointIndex])return;
   const window=values.slice(i-19,i+1);if(!window.every(v=>Number.isFinite(v)&&v>0))return;
   const above=values[i]>window.reduce((a,b)=>a+b,0)/20;
   for(const group of memberships[rowIndex]){group.points[pointIndex][3]++;if(above)group.points[pointIndex][2]++;}
  });
 });
 const previousGroups=previous?.universeHash===universe.sourceSha256?new Map(previous.groups.map(g=>[g.id,g])):new Map();
 const cutoffDate=new Date(last+'T00:00:00Z');cutoffDate.setUTCFullYear(cutoffDate.getUTCFullYear()-5);const cutoff=cutoffDate.toISOString().slice(0,10);
 for(const group of groups.values()){
  for(const point of group.points)point[1]=point[3]?point[2]/point[3]*100:null;
  const older=(previousGroups.get(group.id)?.points??[]).filter(p=>p[0]<group.points[0][0]&&p[0]>=cutoff);
  group.points=[...older,...group.points.filter(p=>p[0]>=cutoff)];
 }
 const all=groups.get(weeklyGroupId('all'));if(!all?.points.at(-1)?.[3])throw Error('Weekly breadth has no valid latest observations');
 return {version:1,universeHash:universe.sourceSha256,classificationMode:'current-universe-backcast',columns:['weekEnding','percentAbove','above','valid'],from:all.points[0][0],asOf:last,groups:[...groups.values()]};
}
