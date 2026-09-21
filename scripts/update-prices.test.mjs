import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closedDate,parseSeries,validate} from './update-prices.mjs';
test('summer and winter close guard',()=>{
 assert.equal(closedDate('2026-09-21',new Date('2026-09-21T20:30Z')),false);
 assert.equal(closedDate('2026-09-21',new Date('2026-09-21T22:30Z')),true);
 assert.equal(closedDate('2026-01-05',new Date('2026-01-05T22:30Z')),false);
 assert.equal(closedDate('2026-01-05',new Date('2026-01-05T23:30Z')),true);
 assert.equal(closedDate('2026-09-22',new Date('2026-09-21T23:30Z')),false);
});
test('invalid latest values abort publication',()=>{
 const old={dates:['2026-09-18'],series:{A:{prices:{'2026-09-18':10}}}};
 assert.throws(()=>validate(old,{dates:['2026-09-21'],series:{A:{prices:{'2026-09-18':10}}}}));
 assert.throws(()=>validate(old,{dates:['2026-09-17'],series:{}}));
 assert.throws(()=>parseSeries({chart:{result:[]}},new Date()));
 validate(old,{dates:['2026-09-18','2026-09-21'],series:{A:{prices:{'2026-09-18':10,'2026-09-21':11}}}});
});
