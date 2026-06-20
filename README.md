# Cash Flow

A simple, private, phone-first personal cash-flow tracker. Open it on your phone, see what's
coming in, what's going out, and what's actually left — mark things received/paid so the balance
reflects reality, not just the plan.

## First run (1 minute)
1. Open the app and **add it to your home screen** (Share → Add to Home Screen on iPhone) so it
   opens like an app and works offline.
2. Go to **Settings → "On hand now (starting balance)"** and enter the cash you actually have right
   now. Everything projects forward from that number.
3. Add what's coming in and going out with the **+** button — or load your starting numbers in one
   tap (see below).

### Load your starting numbers
Your real figures live in `seed/my-data.json` (kept out of the public repo for privacy). To load
them: **Settings → Import / restore →** pick that file. Then set your starting balance.

## How it works
- **On hand now** = your starting balance plus everything you've marked settled. That's real money.
- The **ledger** walks every dated item in order and shows the running balance, so you can see the
  order things hit and whether you can cover something before the next check lands.
- **Projected low** is the lowest your balance dips to — the number your **$300 floor** protects.
- **Ads what-if** tells you the most you can put toward Facebook ads before that low dips below your
  floor.
- **Tags:** every item is business or personal; the filter shows business-only spend. It's still one
  pool of money.
- **Start fresh month** (Settings) carries your settled balance forward, archives the past, and lets
  recurring items regenerate.
- **Backup:** Settings → Export downloads a JSON file. Import restores it.

Rough numbers (the first paycheck, the car) show a small **≈** and are one tap to fix.

## Turn on cloud sync (optional, ~3 min) — needs your Google login
Without this, everything is saved on the one device (with manual backup). Turn it on to sync across
phone + laptop and auto-back-up to your own Google Sheet.
1. Create a new Google Sheet (sheets.new).
2. Extensions → Apps Script. Delete the sample, paste `backend/Code.gs`, save.
3. Deploy → New deployment → **Web app** → Execute as **Me**, Access **Anyone** → Deploy. Authorize.
4. Copy the Web app URL (ends in `/exec`).
5. App → **Settings → Cloud sync URL →** paste → Save.

## Develop / test
- Logic is pure and tested: `npm test` (or `node test/logic.test.mjs`).
- It's a static site (ES modules) — serve over HTTP, e.g. `python3 -m http.server` then open the port.
- No build step, no dependencies.
