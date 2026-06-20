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
