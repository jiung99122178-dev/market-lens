// One validated US equity symbol per request. No calendar alignment is inferred.
export function yahooSymbol(ticker) {
 if(typeof ticker!=='string'||!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker))throw Error('Invalid ticker');
 return ticker.replaceAll('.', '-');
}
export function parseEarningsPrices(body,ticker,now=new Date()) {
 const symbol=yahooSymbol(ticker),chart=body.chart?.result?.[0];
 if(!chart?.timestamp?.length)throw Error('No price history');
 if(chart.meta?.symbol?.toUpperCase()!==symbol)throw Error('Symbol mismatch');
 const adjusted=chart.indicators?.adjclose?.[0]?.adjclose;
 const values=adjusted??chart.indicators?.quote?.[0]?.close;
 if(!values)throw Error('No close values');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(now);
 const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',hourCycle:'h23'}).format(now));
 const byDate=new Map();
 chart.timestamp.forEach((t,i)=>{
  if(!Number.isFinite(t))return;
  const date=new Date(t*1000).toISOString().slice(0,10),price=values[i];
  if(Number.isFinite(price)&&price>0&&(date<today||(date===today&&hour>=18)))byDate.set(date,{date,price});
 });
 const points=[...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
 if(points.length<2)throw Error('Not enough completed closes');
 return {version:1,ticker,symbol,currency:chart.meta?.currency??null,priceBasis:adjusted?'adjusted-close':'close',savedAt:now.toISOString(),points};
}
export async function fetchEarningsPrices(ticker,now=new Date()) {
 const symbol=yahooSymbol(ticker),url=new URL('https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(symbol));
 const start=new Date(now);start.setUTCFullYear(start.getUTCFullYear()-3);
 for(const [k,v] of Object.entries({period1:Math.floor(start.getTime()/1000),period2:Math.floor(now.getTime()/1000),interval:'1d',includeAdjustedClose:'true'}))url.searchParams.set(k,String(v));
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});
 if(!response.ok){const error=new Error('Yahoo HTTP '+response.status);error.status=response.status;throw error;}
 return parseEarningsPrices(await response.json(),ticker,now);
}
