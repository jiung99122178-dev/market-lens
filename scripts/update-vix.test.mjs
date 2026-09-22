import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseVix} from './update-vix.mjs';
test('VIX excludes open session and invalid values, uses close not adjusted close',()=>{
 const body={chart:{result:[{timestamp:['2026-09-17','2026-09-18','2026-09-21','2026-09-22'].map(d=>Date.parse(d+'T13:30Z')/1000),indicators:{quote:[{close:[18,19,null,21]}],adjclose:[{adjclose:[1,1,1,1]}]}}]}};
 assert.deepEqual(parseVix(body,new Date('2026-09-22T16:00Z')),[{date:'2026-09-17',close:18},{date:'2026-09-18',close:19}]);
 assert.equal(parseVix(body,new Date('2026-09-22T23:00Z')).at(-1).close,21);
 assert.throws(()=>parseVix({}));
});
