import {nyDate} from './adr-core.mjs';
// Friday exchange closures: Thursday is the actual weekly closing session.
// Source: NYSE/ICE published calendars, 2025–2028. Early closes remain trading days.
// https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx
const closedFridays=new Set(['2025-04-18','2025-07-04','2026-04-03','2026-06-19','2026-07-03','2026-12-25','2027-01-01','2027-03-26','2027-06-18','2027-12-24','2028-04-14']);
const shift=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function completedWeeks(now=new Date(),count=21){
 const today=nyDate(now),day=new Date(today+'T00:00:00Z').getUTCDay();
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 let friday=shift(today,-((day+2)%7));
 if(day===5&&hour<18)friday=shift(friday,-7);
 return Array.from({length:count},(_,i)=>{const weekEnding=shift(friday,-7*(count-1-i));const year=Number(weekEnding.slice(0,4));if(year<2025||year>2028)throw Error('Weekly exchange calendar needs review for '+year);return {weekEnding,date:closedFridays.has(weekEnding)?shift(weekEnding,-1):weekEnding};});
}
export function weeklyRow(item,priceData,weeks){
 const prices=new Map(priceData?.rows??[]),values=weeks.map(w=>prices.get(w.date)??null),window=values.slice(-20),close=values.at(-1),validWeeks=window.filter(v=>Number.isFinite(v)&&v>0).length;
 const base={...item,name:priceData?.name??item.ticker,close:close??null,sma20:null,distance:null,position:'unavailable',crossUp:null,validWeeks,reason:null};
 if(!priceData)return {...base,reason:'가격 조회 실패 / 티커 확인 필요'};
 if(close===null)return {...base,reason:'기준 주의 마지막 거래일 종가 없음'};
 if(validWeeks!==20)return {...base,reason:'연속 20주 종가 부족 (상장 전 / 결측)'};
 const sma20=window.reduce((a,b)=>a+b,0)/20,distance=(close/sma20-1)*100;
 const position=close>sma20?'above':close<sma20?'below':'at';
 const prior=values.slice(-21,-1),priorValid=prior.length===20&&prior.every(v=>Number.isFinite(v)&&v>0);
 const previousSma=priorValid?prior.reduce((a,b)=>a+b,0)/20:null;
 return {...base,sma20,distance,position,crossUp:priorValid?position==='above'&&prior.at(-1)<=previousSma:null};
}
export function buildWeeklySnapshot(universe,priceData,calendar,now=new Date()){
 const weeks=completedWeeks(now),reference=new Map(calendar.rows);
 // Do not mistake an absent Friday price for a Thursday weekly close.
 for(const w of weeks)if(!(reference.get(w.date)>0))throw Error('Weekly reference close missing: '+w.date);
 const rows=universe.rows.map(r=>weeklyRow(r,priceData[r.ticker],weeks));
 const counts={above:0,below:0,at:0,unavailable:0,crossUp:0};for(const r of rows){counts[r.position]++;if(r.crossUp)counts.crossUp++;}
 return {version:1,source:'Yahoo Finance',priceBasis:'split-adjusted-close-excluding-dividends',mode:'completed-week',period:20,classificationAsOf:universe.classificationAsOf,updatedAt:now.toISOString(),weekEnding:weeks.at(-1).weekEnding,asOf:weeks.at(-1).date,window:weeks.slice(-20),total:rows.length,valid:rows.length-counts.unavailable,counts,rows};
}
