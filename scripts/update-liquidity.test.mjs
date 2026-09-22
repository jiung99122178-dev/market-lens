import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,combine} from './update-liquidity.mjs';
test('units, blanks and genuine zero observations',()=>{
 assert.deepEqual(parseCsv('observation_date,WALCL\n2026-09-01,1000\n2026-09-02,.\n2026-09-03,0','WALCL',1000),[{date:'2026-09-01',value:1},{date:'2026-09-03',value:0}]);
 assert.throws(()=>parseCsv('<html>Error</html>','WALCL',1000));
});
test('date alignment never backfills and stale sources produce a gap',()=>{
 const rows=combine({assets:[{date:'2026-09-01',value:7000}],tga:[{date:'2026-09-02',value:900}],rrp:[{date:'2026-09-01',value:10},{date:'2026-09-03',value:0},{date:'2026-09-20',value:2}]});
 assert.equal(rows[0].date,'2026-09-02');assert.equal(rows[0].net,6090);
 assert.equal(rows[1].net,6100);assert.equal(rows[1].sourceDates.assets,'2026-09-01');assert.equal(rows.at(-1).net,null);
});
