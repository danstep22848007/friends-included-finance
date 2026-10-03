import assert from 'node:assert/strict';
import { commission, totals } from '../src/lib/core.ts';

function sale(reference, project, amount, split, status = 'Approved') {
  return { reference, kind: 'sale', project, amount, status,
    approved_r: split[0], approved_a: split[1], approved_j: split[2] };
}
function expense(reference, amount, allocation) {
  return { reference, kind: 'expense', amount, final_allocation: allocation };
}

const test1 = [
  sale('S01', 'A', 1000, [50, 30, 20]),
  sale('S02', 'B', 2000, [20, 40, 40]),
  expense('E01', 120, 'A'), expense('E02', 80, 'A'), expense('E03', 100, 'Company overhead'),
];
const t1 = totals(test1);
assert.equal(t1.projects.A.result, 70000);
assert.equal(t1.projects.B.result, 180000);
assert.equal(t1.result, 240000);
assert.deepEqual(t1.earned, { richard: 9000, anastasia: 11000, jean_claude: 10000 });

const test2 = [...test1,
  sale('S03', 'A', 1500, [20, 30, 50]),
  sale('S04', 'B', 800, [25, 25, 50]),
  sale('S05', 'B', 600, [null, null, null], 'Pending approval'),
  expense('E04', 250, 'B'), expense('E05', 90, 'B'), expense('E06', 60, 'Company overhead'),
  expense('E07', 140, null),
];
const t2 = totals(test2);
assert.equal(t2.projects.A.result, 205000);
assert.equal(t2.projects.B.result, 218000);
assert.equal(t2.result, 393000);
assert.equal(t2.overhead, 16000);
assert.equal(t2.awaiting, 14000);
assert.deepEqual(t2.earned, { richard: 14000, anastasia: 17500, jean_claude: 21500 });

const rounding = commission(sale('ROUND', 'A', 0.10, [34, 33, 33]));
assert.equal(rounding.pool, rounding.r + rounding.a + rounding.j);
assert.equal(rounding.r, 1);
console.log('Assignment test totals and commission rounding passed.');
