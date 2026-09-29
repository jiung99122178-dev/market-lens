import {test} from 'node:test';
import assert from 'node:assert/strict';
import {yahooSymbol,parseEarningsPrices} from './earnings-prices-core.mjs';
const t=d=>Date.parse(d+'T20:00:00Z')/1000;
const body={chart:{result:[{meta:{symbol:'AAPL',currency:'USD'},timestamp:[t('2026-09-25'),t('2026-09-28'),t('2026-09-29')],indicators:{adjclose:[{adjclose:[100,110,120]}],quote:[{close:[101,111,121]}]}}]}};
test('symbol mapping rejects paths',()=>{assert.equal(yahooSymbol('BRK.B'),'BRK-B');assert.throws(()=>yahooSymbol('../A'));});
test('only completed US dates, adjusted closes and explicit units',()=>{const r=parseEarningsPrices(body,'AAPL',new Date('2026-09-29T18:00:00Z'));assert.equal(r.points.length,2);assert.equal(r.points[1].price,110);assert.equal(r.currency,'USD');assert.equal(r.priceBasis,'adjusted-close');});
test('no guessed symbols and no invalid prices',()=>{assert.throws(()=>parseEarningsPrices(body,'MSFT'));const b=structuredClone(body);b.chart.result[0].indicators.adjclose[0].adjclose=[null,-1,NaN];assert.throws(()=>parseEarningsPrices(b,'AAPL'));});
test('ordinary close is labelled, not passed as adjusted',()=>{const b=structuredClone(body);delete b.chart.result[0].indicators.adjclose;assert.equal(parseEarningsPrices(b,'AAPL',new Date('2026-09-30')).priceBasis,'close');});
