// ADR uses price changes (Yahoo Close: split-adjusted, not dividend total return).
export const yahooSymbol=t=>({'BRK.B':'BRK-B','BF.B':'BF-B','MOG.A':'MOG-A'}[t]??t);
export const nyDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(d);
export function parseCloses(body,symbol,now=new Date()){
 const c=body.chart?.result?.[0];
 if(!c||c.meta?.symbol!==symbol||c.meta.currency!=='USD'||c.meta.instrumentType!=='EQUITY'&&symbol!=='SPY')throw Error('Unexpected/missing identity, currency or instrument');
 const today=nyDate(now),hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 const values=c.indicators?.quote?.[0]?.close;
 if(!Array.isArray(values)||!Array.isArray(c.timestamp))throw Error('Missing daily closes');
 const points=new Map(),sessions=new Set();let latestSession='';
 c.timestamp.forEach((t,i)=>{if(!Number.isFinite(t))return;const date=nyDate(new Date(t*1000));if(date>today||(date===today&&hour<18))return;sessions.add(date);latestSession=date>latestSession?date:latestSession;const p=values[i];if(Number.isFinite(p)&&p>0)points.set(date,p);});
 const rows=[...points].sort((a,b)=>a[0].localeCompare(b[0]));
 if(rows.length<2)throw Error('Fewer than two completed closes');
 return {symbol,name:c.meta.longName??c.meta.shortName??symbol,firstTradeDate:Number.isFinite(c.meta.firstTradeDate)?nyDate(new Date(c.meta.firstTradeDate*1000)):null,latestSession,sessionDates:[...sessions].sort(),rows};
}
export function signsForDates(dates,rows){
 const p=new Map(rows);
 return dates.map((d,i)=>{const a=p.get(dates[i-1]),b=p.get(d);if(!Number.isFinite(a)||!Number.isFinite(b))return '?';const change=b/a-1;return Math.abs(change)<1e-8?'=':change>0?'+':'-';}).join('');
}
export function aggregateAdr(universe,dates,series,{from,period=20}={}){
 const groups=[{id:'all',name:'전체',kind:'all',members:universe}];
 for(const kind of ['sector','subsector'])for(const name of [...new Set(universe.map(r=>r[kind]))])groups.push({id:kind+':'+name,name,kind,members:universe.filter(r=>r[kind]===name)});
 return groups.map(g=>{
  const members=g.members.map(m=>series[m.ticker]);
  const daily=dates.map((date,i)=>{let up=0,down=0,flat=0;for(const m of members){const s=m?.signs[i];if(s==='+')up++;else if(s==='-')down++;else if(s==='=')flat++;}return [up,down,flat];});
  let a=0,d=0,empty=0;const points=[];
  for(let i=0;i<dates.length;i++){
   const row=daily[i];a+=row[0];d+=row[1];empty+=row[0]+row[1]+row[2]===0?1:0;
   if(i>=period){const old=daily[i-period];a-=old[0];d-=old[1];empty-=old[0]+old[1]+old[2]===0?1:0;}
   if(i>=period-1&&dates[i]>=from)points.push([dates[i],i>=period-1&&!empty&&d>0?Math.round(a/d*10000)/100:null,...row,a,d]);
  }
  return {id:g.id,name:g.name,kind:g.kind,total:g.members.length,points};
 });
}
