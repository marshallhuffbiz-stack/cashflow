# Cash Flow Tracker — spec (design of record)

A simple, private, phone-first personal cash-flow tracker for Marshall. One pool of money,
forward ledger anchored to today's cash, planned-vs-settled, recurring items, a Facebook-ads
what-if, monthly rollover, and export/import backup.

## Data model

```
state = {
  version: 1,
  settings: {
    startingBalance: number,   // cash on hand as of anchorDate, BEFORE any listed occurrence
    anchorDate: "YYYY-MM-DD",  // when startingBalance was true (default: today)
    cushion: number,           // floor the what-if protects (default 300)
    horizonDays: number,       // how far ahead to generate occurrences (default 60)
    syncUrl: string            // Apps Script web-app URL; "" = local-only
  },
  items: [ {
    id: string,
    name: string,
    amount: number,            // positive
    direction: "in" | "out",
    tag: "business" | "personal",
    date: "YYYY-MM-DD",        // first/anchor occurrence
    recurrence: "none" | "weekly" | "biweekly" | "monthly",
    approx: boolean,           // the ≈ flag (rough numbers, e.g. Thursday check, car)
    note: string
  } ],
  // sparse per-occurrence state, keyed "<itemId>#<YYYY-MM-DD>"
  occurrences: { [occId]: { amount?, date?, skipped?, settled?, settledAt?, note? } },
  archives: [ { closedOn, label, endingBalance, rows: [...] } ]
}
```

Occurrence id = `${itemId}#${plannedDate}`. Recurrence generates planned occurrences; the
`occurrences` map overrides individual ones (edit the rough Thursday check, settle Jun 25's
paycheck, skip one) without touching the item definition.

## Core pure functions (logic.js — TDD'd, no DOM/storage)

Date utils: `parseDate`, `fmtDate`, `addDays`, `addWeeks`, `addMonths` (clamp short months),
`daysBetween`, `nextWeekday`.

- `expandItem(item, rangeStartISO, rangeEndISO) -> [occ]` — materialize occurrences in range.
  none → [item.date] if in range. weekly/biweekly → +7/+14 from date. monthly → same
  day-of-month each month, clamped (e.g. 31 → 30/28).
- `buildOccurrences(state, rangeStartISO, rangeEndISO) -> [occ]` — expand all items, apply
  overrides from `occurrences` map (amount/date/skip/settle), drop skipped, sort by (date, name).
- `buildLedger(state, rangeStartISO, rangeEndISO) -> [row]` — occurrences + `balanceAfter`
  (running, signed, from settings.startingBalance) + `settled` flag.
- `onHandNow(state) -> number` — startingBalance + Σ signed(settled occurrences). Real money.
- `projectedBalanceAt(ledger, dateISO) -> number` — running balance through dateISO.
- `lowestPoint(ledger, fromISO, toISO) -> { date, balance }` — min running balance in window.
- `maxSafeAdSpend(state, todayISO) -> number` — max(0, lowestPoint(today→horizon) - cushion).
- `rolloverMonth(state, asOfISO) -> state'` — new startingBalance = onHandNow; anchorDate =
  asOfISO; archive settled past rows; clear past overrides; recurring items regenerate forward.

All amounts in whole dollars; round at display.

## Screens (mobile-first SPA)

1. Home / "Where I stand" — hero `on hand now`; cards `projected low` (date) + `end of period`;
   `safe to add to ads` chip; mini running-balance sparkline; All/Business/Personal filter;
   "Next up" list (tap to settle/edit); add button.
2. Ledger — full chronological list with running balance, in/out color, ≈ marks, settle toggle, filter.
3. Add / Edit item — name, amount, in/out, tag, date, recurrence, ≈ approx, note.
4. What-if (ads) — slider + live lowest-point + cushion status + max-safe; "apply" updates the ads item.
5. Settings / Data — starting balance, anchor date, cushion, horizon, cloud-sync URL, export, import.
6. Rollover — "Start fresh month" → carry balance, archive, regenerate recurring.

## Architecture

- Static SPA on GitHub Pages. ES modules: `logic.js` (pure) ← `app.js` (DOM) + `storage.js`.
- `storage.js`: localStorage is the source of truth + offline cache; export/import JSON; optional
  push/pull to Apps Script `syncUrl` when set (POST `text/plain` for CORS; `?client=` not `?c=`).
- PWA: `manifest.webmanifest` + `sw.js` (cache-first shell) so it installs + works offline.
- Backend (`backend/Code.gs`): Apps Script web app, `doGet` returns state JSON, `doPost` saves it,
  backed by a Google Sheet (one cell holds the JSON blob; simple + robust for one user). DEFERRED deploy.
- Privacy: real figures live ONLY in `seed/my-data.json` (gitignored) + Downloads, never in the repo.
```
