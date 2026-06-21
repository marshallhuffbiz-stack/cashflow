// Cash Flow Tracker — pure core logic. No DOM, no storage. Tested by test/logic.test.mjs.
// Dates are "YYYY-MM-DD" strings; math is done in UTC to avoid timezone drift.

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function fmtDate(dt) {
  return dt.toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  const dt = parseDate(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return fmtDate(dt);
}
export function addWeeks(iso, n) {
  return addDays(iso, n * 7);
}
// Anchor-based: addMonths(anchor, k) clamps to the target month's last day, no drift.
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, (m - 1) + n, 1));
  const ty = target.getUTCFullYear(), tm = target.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return fmtDate(new Date(Date.UTC(ty, tm, Math.min(d, daysInMonth))));
}
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
// weekday: 0=Sun..6=Sat. Returns the first date >= iso falling on that weekday (inclusive).
export function nextWeekday(iso, weekday) {
  const dt = parseDate(iso);
  const diff = (weekday - dt.getUTCDay() + 7) % 7;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return fmtDate(dt);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const signed = (o) => (o.direction === 'in' ? o.amount : -o.amount);

function makeOcc(item, date) {
  return {
    id: `${item.id}#${date}`,
    itemId: item.id,
    name: item.name,
    amount: item.amount,
    direction: item.direction,
    tag: item.tag,
    date,
    approx: !!item.approx,
    note: item.note || '',
    recurrence: item.recurrence,
    settled: false,
  };
}

// Materialize occurrences of one item within [rangeStart, rangeEnd].
export function expandItem(item, rangeStart, rangeEnd) {
  const occ = [];
  if (item.recurrence === 'none' || !item.recurrence) {
    if (item.date >= rangeStart && item.date <= rangeEnd) occ.push(makeOcc(item, item.date));
    return occ;
  }
  for (let k = 0; k < 1200; k++) {
    let date;
    if (item.recurrence === 'weekly') date = addDays(item.date, k * 7);
    else if (item.recurrence === 'biweekly') date = addDays(item.date, k * 14);
    else if (item.recurrence === 'monthly') date = addMonths(item.date, k);
    else break;
    if (date > rangeEnd) break;
    if (date >= rangeStart) occ.push(makeOcc(item, date));
  }
  return occ;
}

// All occurrences across items in range, with per-occurrence overrides applied, sorted by (date, name).
export function buildOccurrences(state, rangeStart, rangeEnd) {
  const out = [];
  for (const item of state.items) {
    for (const o of expandItem(item, rangeStart, rangeEnd)) {
      const ov = state.occurrences && state.occurrences[o.id];
      if (ov) {
        if (ov.skipped) continue;
        if (ov.amount != null) o.amount = ov.amount;
        if (ov.date != null) o.date = ov.date;
        if (ov.note != null) o.note = ov.note;
        o.settled = !!ov.settled;
        if (ov.settledAt) o.settledAt = ov.settledAt;
      }
      out.push(o);
    }
  }
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.direction !== b.direction) return a.direction === 'in' ? -1 : 1; // same day: income credited before bills
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return out;
}

// Occurrences + running balance (balanceAfter) walking from settings.startingBalance.
export function buildLedger(state, rangeStart, rangeEnd) {
  const occ = buildOccurrences(state, rangeStart, rangeEnd);
  let bal = state.settings.startingBalance;
  return occ.map((o) => {
    bal += signed(o);
    return { ...o, balanceAfter: bal };
  });
}

// Real money: starting balance + everything actually settled.
export function onHandNow(state) {
  const start = addDays(state.settings.anchorDate, -400);
  const end = addDays(state.settings.anchorDate, 400);
  const occ = buildOccurrences(state, start, end);
  let bal = state.settings.startingBalance;
  for (const o of occ) if (o.settled) bal += signed(o);
  return bal;
}

// Balance after the last ledger row on/before dateISO (null if none).
export function projectedBalanceAt(ledger, dateISO) {
  let bal = null;
  for (const r of ledger) {
    if (r.date <= dateISO) bal = r.balanceAfter;
    else break;
  }
  return bal;
}

// Minimum running balance in [fromISO, toISO], including the balance entering the window.
export function lowestPoint(ledger, startingBalance, fromISO, toISO) {
  let entering = startingBalance;
  for (const r of ledger) {
    if (r.date < fromISO) entering = r.balanceAfter;
    else break;
  }
  let best = { date: fromISO, balance: entering };
  for (const r of ledger) {
    if (r.date >= fromISO && r.date <= toISO && r.balanceAfter < best.balance) {
      best = { date: r.date, balance: r.balanceAfter };
    }
  }
  return best;
}

// How much more you can spend (on/before the next dip) while staying above the cushion.
export function maxSafeAdSpend(state, todayISO) {
  const end = addDays(todayISO, state.settings.horizonDays);
  const led = buildLedger(state, state.settings.anchorDate, end);
  const lp = lowestPoint(led, state.settings.startingBalance, todayISO, end);
  return Math.max(0, Math.round(lp.balance - state.settings.cushion));
}

// Start a fresh month: carry settled balance forward, archive realized rows, drop the past.
export function rolloverMonth(state, asOfISO) {
  const ending = onHandNow(state);
  const occWindow = buildOccurrences(state, addDays(asOfISO, -400), asOfISO);
  const rows = occWindow.filter((o) => o.settled).map((o) => ({ date: o.date, name: o.name, amount: signed(o) }));
  const archives = [...(state.archives || []), { closedOn: asOfISO, label: asOfISO.slice(0, 7), endingBalance: ending, rows }];
  const occurrences = {};
  for (const [k, v] of Object.entries(state.occurrences || {})) {
    if (k.split('#')[1] > asOfISO) occurrences[k] = v;
  }
  const items = state.items.filter((i) => !((i.recurrence === 'none' || !i.recurrence) && i.date <= asOfISO));
  return { ...state, settings: { ...state.settings, startingBalance: ending, anchorDate: asOfISO }, occurrences, archives, items };
}

/* ---------- month views ---------- */
export function monthKeyOf(iso) { return iso.slice(0, 7); }
export function monthStart(mk) { return mk + '-01'; }
export function monthEnd(mk) {
  const [y, m] = mk.split('-').map(Number);
  return fmtDate(new Date(Date.UTC(y, m, 0))); // day 0 of next month = last day of this month
}
export function addMonthKey(mk, n) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m - 1) + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(mk) {
  const [y, m] = mk.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

// Summary for one calendar month: opening (entering) balance, income/expense/net, closing, month rows.
export function monthSummary(state, mk) {
  const ms = monthStart(mk), me = monthEnd(mk);
  const led = buildLedger(state, state.settings.anchorDate, me);
  const rows = led.filter((r) => r.date >= ms && r.date <= me);
  let opening = state.settings.startingBalance;
  for (const r of led) { if (r.date < ms) opening = r.balanceAfter; else break; }
  let income = 0, expense = 0;
  for (const r of rows) { if (r.direction === 'in') income += r.amount; else expense += r.amount; }
  const closing = rows.length ? rows[rows.length - 1].balanceAfter : opening;
  return { monthKey: mk, opening, income, expense, net: income - expense, closing, rows };
}

// Actionable budget / spending insights (structured; the UI turns these into advice text).
export function buildInsights(state, today) {
  const cushion = state.settings.cushion;
  const end = addDays(today, state.settings.horizonDays);
  const led = buildLedger(state, state.settings.anchorDate, end);
  const lp = lowestPoint(led, state.settings.startingBalance, today, end);
  const mk = monthKeyOf(today);
  const ms = monthSummary(state, mk);
  const outRows = ms.rows.filter((r) => r.direction === 'out');
  let biggest = null;
  for (const r of outRows) if (!biggest || r.amount > biggest.amount) biggest = r;
  const bizSpend = outRows.filter((r) => r.tag === 'business').reduce((s, r) => s + r.amount, 0);
  return {
    floor: { belowFloor: lp.balance < cushion, lowBalance: lp.balance, lowDate: lp.date, cushion, gap: Math.round(lp.balance - cushion) },
    ads: { amount: maxSafeAdSpend(state, today) },
    month: { monthKey: mk, opening: ms.opening, income: ms.income, expense: ms.expense, net: ms.net, closing: ms.closing },
    biggest: biggest ? { name: biggest.name, amount: biggest.amount } : null,
    business: { spend: bizSpend },
    discretionary: Math.max(0, Math.round(ms.closing - cushion)),
  };
}
