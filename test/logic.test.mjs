import assert from 'node:assert/strict';
import * as L from '../logic.js';

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`${name}\n    ${e.message.split('\n')[0]}`); }
}

/* ---------- date utils ---------- */
test('addDays basic', () => assert.equal(L.addDays('2026-06-20', 5), '2026-06-25'));
test('addDays cross-month', () => assert.equal(L.addDays('2026-06-28', 5), '2026-07-03'));
test('addWeeks biweekly', () => assert.equal(L.addWeeks('2026-06-25', 2), '2026-07-09'));
test('addMonths same day', () => assert.equal(L.addMonths('2026-06-15', 1), '2026-07-15'));
test('addMonths clamp Jan31->Feb28', () => assert.equal(L.addMonths('2026-01-31', 1), '2026-02-28'));
test('addMonths anchor no drift (Jan31 +3 = Apr30)', () => assert.equal(L.addMonths('2026-01-31', 3), '2026-04-30'));
test('addMonths cross-year', () => assert.equal(L.addMonths('2026-11-30', 2), '2027-01-30'));
test('daysBetween', () => assert.equal(L.daysBetween('2026-06-20', '2026-06-25'), 5));
test('nextWeekday Sat->Thu', () => assert.equal(L.nextWeekday('2026-06-20', 4), '2026-06-25'));
test('nextWeekday inclusive when same day', () => assert.equal(L.nextWeekday('2026-06-25', 4), '2026-06-25'));

/* ---------- expandItem ---------- */
const oneOff = { id: 'a', name: 'Rent', amount: 850, direction: 'out', tag: 'personal', date: '2026-06-28', recurrence: 'none' };
test('expandItem none in range', () => {
  const occ = L.expandItem(oneOff, '2026-06-20', '2026-08-19');
  assert.equal(occ.length, 1); assert.equal(occ[0].date, '2026-06-28'); assert.equal(occ[0].amount, 850);
});
test('expandItem none out of range', () => assert.equal(L.expandItem(oneOff, '2026-07-01', '2026-07-31').length, 0));

const biweekly = { id: 'b', name: 'Paycheck', amount: 450, direction: 'in', tag: 'personal', date: '2026-06-25', recurrence: 'biweekly' };
test('expandItem biweekly in range', () => {
  const d = L.expandItem(biweekly, '2026-06-20', '2026-07-31').map(o => o.date);
  assert.deepEqual(d, ['2026-06-25', '2026-07-09', '2026-07-23']);
});
test('expandItem biweekly anchor before range', () => {
  const d = L.expandItem(biweekly, '2026-07-01', '2026-07-31').map(o => o.date);
  assert.deepEqual(d, ['2026-07-09', '2026-07-23']);
});

const monthly = { id: 'c', name: 'Internet', amount: 60, direction: 'out', tag: 'personal', date: '2026-06-30', recurrence: 'monthly' };
test('expandItem monthly with clamp', () => {
  const d = L.expandItem(monthly, '2026-06-20', '2026-08-31').map(o => o.date);
  assert.deepEqual(d, ['2026-06-30', '2026-07-30', '2026-08-30']);
});
test('expandItem occ id is itemId#date', () => {
  assert.equal(L.expandItem(oneOff, '2026-06-20', '2026-08-19')[0].id, 'a#2026-06-28');
});

/* ---------- overrides / buildOccurrences ---------- */
const baseState = () => ({
  version: 1,
  settings: { startingBalance: 1000, anchorDate: '2026-06-20', cushion: 300, horizonDays: 60, syncUrl: '' },
  items: [
    { id: 'pay', name: 'Paycheck', amount: 450, direction: 'in', tag: 'personal', date: '2026-06-25', recurrence: 'none' },
    { id: 'rent', name: 'Rent', amount: 850, direction: 'out', tag: 'personal', date: '2026-06-28', recurrence: 'none' },
  ],
  occurrences: {},
  archives: [],
});
test('override amount applied', () => {
  const s = baseState(); s.occurrences['pay#2026-06-25'] = { amount: 430 };
  const occ = L.buildOccurrences(s, '2026-06-20', '2026-07-31').find(o => o.id === 'pay#2026-06-25');
  assert.equal(occ.amount, 430);
});
test('skipped occurrence dropped', () => {
  const s = baseState(); s.occurrences['rent#2026-06-28'] = { skipped: true };
  assert.equal(L.buildOccurrences(s, '2026-06-20', '2026-07-31').some(o => o.id === 'rent#2026-06-28'), false);
});
test('settled flag carried', () => {
  const s = baseState(); s.occurrences['pay#2026-06-25'] = { settled: true, settledAt: 'x' };
  assert.equal(L.buildOccurrences(s, '2026-06-20', '2026-07-31').find(o => o.id === 'pay#2026-06-25').settled, true);
});

/* ---------- ledger / balances ---------- */
test('buildLedger running balance + order', () => {
  const led = L.buildLedger(baseState(), '2026-06-20', '2026-07-31');
  assert.deepEqual(led.map(r => [r.date, r.balanceAfter]), [['2026-06-25', 1450], ['2026-06-28', 600]]);
});
test('same-day income is ordered before expenses', () => {
  const s = baseState();
  s.items = [
    { id: 'bill', name: 'Bill', amount: 300, direction: 'out', tag: 'personal', date: '2026-06-22', recurrence: 'none' },
    { id: 'inv', name: 'Invoice', amount: 2000, direction: 'in', tag: 'personal', date: '2026-06-22', recurrence: 'none' },
  ];
  const led = L.buildLedger(s, '2026-06-20', '2026-07-31');
  // income first: 1000 + 2000 = 3000, then -300 = 2700 (never dips to 700)
  assert.deepEqual(led.map(r => [r.name, r.balanceAfter]), [['Invoice', 3000], ['Bill', 2700]]);
});
test('onHandNow only counts settled', () => {
  const s = baseState();
  assert.equal(L.onHandNow(s), 1000);
  s.occurrences['pay#2026-06-25'] = { settled: true };
  assert.equal(L.onHandNow(s), 1450);
});
test('lowestPoint finds the dip', () => {
  const led = L.buildLedger(baseState(), '2026-06-20', '2026-07-31');
  const lp = L.lowestPoint(led, 1000, '2026-06-20', '2026-07-31');
  assert.deepEqual([lp.date, lp.balance], ['2026-06-28', 600]);
});
test('lowestPoint baseline when all inflow', () => {
  const s = baseState(); s.items = [{ id: 'x', name: 'In', amount: 100, direction: 'in', tag: 'personal', date: '2026-06-25', recurrence: 'none' }];
  const led = L.buildLedger(s, '2026-06-20', '2026-07-31');
  assert.equal(L.lowestPoint(led, 1000, '2026-06-20', '2026-07-31').balance, 1000);
});

/* ---------- what-if ---------- */
test('maxSafeAdSpend = lowest - cushion', () => {
  assert.equal(L.maxSafeAdSpend(baseState(), '2026-06-20'), 300); // lowest 600 - 300
});
test('maxSafeAdSpend floors at 0 when tight', () => {
  const s = baseState(); s.items.push({ id: 'fee', name: 'Fee', amount: 400, direction: 'out', tag: 'personal', date: '2026-06-27', recurrence: 'none' });
  // ledger: 06-25 1450, 06-27 1050, 06-28 200 -> lowest 200, 200-300 < 0 -> 0
  assert.equal(L.maxSafeAdSpend(s, '2026-06-20'), 0);
});

/* ---------- rollover ---------- */
test('rolloverMonth carries settled balance + archives + keeps future', () => {
  const s = baseState();
  s.occurrences['pay#2026-06-25'] = { settled: true, settledAt: 'x' }; // realized +450
  const s2 = L.rolloverMonth(s, '2026-06-26');
  assert.equal(s2.settings.startingBalance, 1450);          // onHandNow carried
  assert.equal(s2.settings.anchorDate, '2026-06-26');
  assert.equal(s2.archives.length, 1);
  assert.equal(s2.archives[0].endingBalance, 1450);
  assert.ok(s2.items.some(i => i.id === 'rent'));            // future one-off survives
  assert.ok(!s2.items.some(i => i.id === 'pay'));            // past one-off pruned
  assert.equal(s2.occurrences['pay#2026-06-25'], undefined); // past override cleared
});

/* ---------- month logic ---------- */
test('monthKeyOf', () => assert.equal(L.monthKeyOf('2026-06-22'), '2026-06'));
test('monthStart', () => assert.equal(L.monthStart('2026-06'), '2026-06-01'));
test('monthEnd 30-day', () => assert.equal(L.monthEnd('2026-06'), '2026-06-30'));
test('monthEnd Feb non-leap', () => assert.equal(L.monthEnd('2026-02'), '2026-02-28'));
test('addMonthKey', () => assert.equal(L.addMonthKey('2026-06', 2), '2026-08'));
test('addMonthKey cross-year', () => assert.equal(L.addMonthKey('2026-11', 3), '2027-02'));
test('monthLabel', () => assert.equal(L.monthLabel('2026-06'), 'June 2026'));

const monthState = () => ({
  version: 1,
  settings: { startingBalance: 1000, anchorDate: '2026-06-01', cushion: 300, horizonDays: 120, syncUrl: '' },
  items: [
    { id: 'pay', name: 'Pay', amount: 2000, direction: 'in', tag: 'personal', date: '2026-06-15', recurrence: 'monthly' },
    { id: 'rent', name: 'Rent', amount: 1200, direction: 'out', tag: 'personal', date: '2026-06-05', recurrence: 'monthly' },
  ],
  occurrences: {}, archives: [],
});
test('monthSummary June', () => {
  const m = L.monthSummary(monthState(), '2026-06');
  assert.deepEqual([m.opening, m.income, m.expense, m.net, m.closing, m.rows.length], [1000, 2000, 1200, 800, 1800, 2]);
});
test('monthSummary July carries opening from June close', () => {
  const m = L.monthSummary(monthState(), '2026-07');
  assert.deepEqual([m.opening, m.income, m.expense, m.net, m.closing], [1800, 2000, 1200, 800, 2600]);
});

/* ---------- insights ---------- */
test('buildInsights numbers', () => {
  const i = L.buildInsights(monthState(), '2026-06-10');
  assert.equal(i.floor.belowFloor, true);
  assert.equal(i.floor.lowBalance, -200);
  assert.equal(i.floor.gap, -500);
  assert.equal(i.ads.amount, 0);
  assert.deepEqual([i.month.income, i.month.expense, i.month.net, i.month.closing], [2000, 1200, 800, 1800]);
  assert.equal(i.biggest.name, 'Rent');
  assert.equal(i.biggest.amount, 1200);
  assert.equal(i.business.spend, 0);
  assert.equal(i.discretionary, 1500);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (failures.length) { console.log('\nFAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
