import * as L from './logic.js?v=4';
import { loadState, saveState, defaultState, exportState, importStateFromFile, importStateFromJSON, pullRemote, pushRemote, syncOnLoad } from './storage.js?v=4';

let state = loadState();
let filter = 'all';
let tab = 'home';
let month = L.monthKeyOf(L.todayISO());

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const view = $('#view');
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n) => usd.format(Math.round(n || 0));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}`; };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 1800);
}
function setSync(status) {
  const s = $('#sync-status'), label = $('#sync-label');
  s.classList.remove('synced', 'error');
  if (!state.settings.syncUrl) { label.textContent = 'on device'; return; }
  if (status === 'synced') { s.classList.add('synced'); label.textContent = 'synced'; }
  else if (status === 'error') { s.classList.add('error'); label.textContent = 'offline'; }
  else label.textContent = 'syncing…';
}
async function commit() {
  saveState(state);
  render();
  if (state.settings.syncUrl) {
    setSync('syncing');
    try { await pushRemote(state.settings.syncUrl, state); setSync('synced'); }
    catch { setSync('error'); }
  }
}

function window_() {
  const today = L.todayISO();
  const start = state.settings.anchorDate < today ? state.settings.anchorDate : today;
  const end = L.addDays(today, state.settings.horizonDays);
  return { today, start, end };
}
function adBaseline() {
  const { today, start, end } = window_();
  const clone = { ...state, items: state.items.filter((i) => i.id !== 'fb-ads') };
  const led = L.buildLedger(clone, start, end);
  const lp = L.lowestPoint(led, clone.settings.startingBalance, today, end);
  return { lowestNoAds: lp.balance, today, end };
}

function spark(values, lowIdx) {
  if (values.length < 2) return '';
  const W = 300, H = 64, P = 7;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const x = (i) => ((i / (values.length - 1)) * W);
  const y = (v) => (H - P) - ((v - min) / span) * (H - 2 * P);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  const area = `M 0,${H} ` + values.map((v, i) => `L ${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ') + ` L ${W},${H} Z`;
  let dots = `<circle cx="${x(0).toFixed(1)}" cy="${y(values[0]).toFixed(1)}" r="3" fill="var(--accent)"></circle>`;
  if (lowIdx != null) dots += `<circle cx="${x(lowIdx).toFixed(1)}" cy="${y(values[lowIdx]).toFixed(1)}" r="3.5" fill="var(--warn)"></circle>`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Projected balance">
    <defs><linearGradient id="cf-sg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--accent)" stop-opacity="0.20"></stop>
      <stop offset="1" stop-color="var(--accent)" stop-opacity="0"></stop>
    </linearGradient></defs>
    <path d="${area}" fill="url(#cf-sg)" stroke="none"></path>
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>${dots}</svg>`;
}

function rowHTML(o, showBal) {
  const sign = o.direction === 'in' ? '+' : '−';
  return `<div class="row ${o.settled ? 'settled' : ''}" data-occ="${esc(o.id)}">
    <button class="check" data-action="settle" data-occ="${esc(o.id)}" aria-label="Mark ${o.direction === 'in' ? 'received' : 'paid'}">✓</button>
    <div class="mid" data-action="edit" data-occ="${esc(o.id)}">
      <div class="nm"><span class="tag-dot ${o.tag}"></span>${esc(o.name)}${o.approx ? ' <span class="approx">≈</span>' : ''}</div>
      <div class="meta">${fmtDay(o.date)}${o.settled ? ' · ' + (o.direction === 'in' ? 'received' : 'paid') : ''}</div>
    </div>
    <div class="amt ${o.direction}">${sign}${money(o.amount)}</div>
    ${showBal ? `<div class="bal">${money(o.balanceAfter)}</div>` : ''}
  </div>`;
}
const filterBar = () => `<div class="filter">${['all', 'business', 'personal'].map((f) => `<button data-action="filter" data-filter="${f}" class="${filter === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>`;

/* ---------- Home ---------- */
function statusBanner() {
  if (!state.items.length) return '';
  const today = L.todayISO();
  const s = L.statusSummary(state, today);
  const end = L.addDays(today, state.settings.horizonDays);
  let head, sub;
  if (s.tone === 'good') { head = "You're in good shape"; sub = `Lowest you dip is ${money(s.lowBalance)} on ${fmtDay(s.lowDate)} — comfortably above your floor.`; }
  else if (s.tone === 'tight') {
    const recToday = s.recoversOn === today, lowToday = s.lowDate === today;
    if (!s.recoversOn) {
      head = 'Money stays tight';
      sub = `Stays under your ${money(s.cushion)} floor through ${fmtDay(end)} — go easy on spending.`;
    } else if (s.lowDate === s.recoversOn) {
      head = recToday ? 'Tight today, then clear' : `Tight on ${fmtDay(s.lowDate)}, then clear`;
      sub = `You're at your low of ${money(s.lowBalance)}${lowToday ? ' right now' : ''} — money landing ${recToday ? 'today' : `on ${fmtDay(s.recoversOn)}`} puts you back above your ${money(s.cushion)} floor.`;
    } else {
      head = `Tight until ${fmtDay(s.recoversOn)}`;
      sub = `Dips to ${money(s.lowBalance)} on ${fmtDay(s.lowDate)}, then back above your ${money(s.cushion)} floor by ${fmtDay(s.recoversOn)}.`;
    }
  } else { head = "Money's short right now"; sub = `You dip to ${money(s.lowBalance)} on ${fmtDay(s.lowDate)} — something needs to move soon.`; }
  return `<div class="status status-${s.tone}" data-action="goto-insights"><span class="status-dot"></span><div class="status-txt"><div class="status-head">${head}</div><div class="status-sub">${sub}</div></div><span class="status-chev">›</span></div>`;
}
function renderHome() {
  const { today, start, end } = window_();
  const ledger = L.buildLedger(state, start, end);
  const onHand = L.onHandNow(state);
  const lp = L.lowestPoint(ledger, state.settings.startingBalance, today, end);
  const projEnd = ledger.length ? ledger[ledger.length - 1].balanceAfter : state.settings.startingBalance;
  const safe = L.maxSafeAdSpend(state, today);
  const cushion = state.settings.cushion;
  const thisMk = L.monthKeyOf(today);
  const ms = L.monthSummary(state, thisMk);

  const fwd = ledger.filter((r) => r.date >= today);
  const enter = L.projectedBalanceAt(ledger, today);
  const sparkVals = [enter == null ? state.settings.startingBalance : enter, ...fwd.map((r) => r.balanceAfter)];
  let lowIdx = 0; sparkVals.forEach((v, i) => { if (v < sparkVals[lowIdx]) lowIdx = i; });

  const upcoming = ledger.filter((r) => r.date >= today);
  const list = filter === 'all' ? upcoming : upcoming.filter((r) => r.tag === filter);
  let listHTML;
  if (!state.items.length) listHTML = `<div class="empty">No items yet. Tap <b>+</b> to add what's coming in and going out.</div>`;
  else if (!list.length) listHTML = `<div class="empty">Nothing ${filter !== 'all' ? filter + ' ' : ''}coming up.</div>`;
  else listHTML = `<div class="rows">${list.slice(0, 40).map((o) => rowHTML(o, filter === 'all')).join('')}</div>`;

  view.innerHTML = `
    ${statusBanner()}
    <div class="card hero-card">
      <p class="hero-label">On hand now${state.items.length ? ' <span class="reconcile-hint">tap to update</span>' : ''}</p>
      <p class="hero-value ${onHand < 0 ? 'neg' : ''}" data-action="reconcile" role="button" tabindex="0">${money(onHand)}</p>
      <p class="hero-sub">settled · ${state.items.length ? L.monthLabel(thisMk) : 'set your starting balance in Settings'}</p>
      ${state.items.length ? spark(sparkVals, lowIdx) : ''}
    </div>
    <div class="stat-grid">
      <div class="stat ${lp.balance < cushion ? 'warn' : ''}"><div class="l">Lowest point</div><div class="v">${money(lp.balance)}</div><div class="d">${fmtDay(lp.date)}${lp.balance < cushion ? ' · below floor' : ' · above floor'}</div></div>
      <div class="stat"><div class="l">${L.monthLabel(thisMk).split(' ')[0]} net</div><div class="v">${ms.net >= 0 ? '+' : ''}${money(ms.net)}</div><div class="d">ends ~${money(ms.closing)}</div></div>
    </div>
    <div class="chip-safe ${safe === 0 ? 'tight' : ''}" data-action="goto-insights">
      <span class="t">Safe to add to ads</span><span class="a">${money(safe)}</span>
    </div>
    ${filterBar()}
    <div class="section-label">Coming up</div>
    ${listHTML}`;
}

/* ---------- Months ---------- */
function renderMonths() {
  const ms = L.monthSummary(state, month);
  const list = filter === 'all' ? ms.rows : ms.rows.filter((r) => r.tag === filter);
  view.innerHTML = `
    <div class="monthbar">
      <button data-action="month-prev" aria-label="Previous month">‹</button>
      <span class="mlabel">${L.monthLabel(month)}</span>
      <button data-action="month-next" aria-label="Next month">›</button>
    </div>
    <div class="card msum">
      <div class="msum-row"><span>Starting</span><b>${money(ms.opening)}</b></div>
      <div class="msum-row in"><span>Coming in</span><b>+${money(ms.income)}</b></div>
      <div class="msum-row out"><span>Going out</span><b>−${money(ms.expense)}</b></div>
      <div class="msum-row net"><span>Net</span><b>${ms.net >= 0 ? '+' : ''}${money(ms.net)}</b></div>
      <div class="msum-row end"><span>Projected end</span><b>${money(ms.closing)}</b></div>
    </div>
    ${filterBar()}
    ${list.length ? `<div class="rows">${list.map((o) => rowHTML(o, filter === 'all')).join('')}</div>` : `<div class="empty">Nothing ${filter !== 'all' ? filter + ' ' : ''}in ${L.monthLabel(month)}.</div>`}`;
}

/* ---------- Insights ---------- */
function insightCard(tone, title, body) {
  return `<div class="card insight ${tone}"><div class="ititle">${title}</div><div class="ibody">${body}</div></div>`;
}
function renderInsights() {
  if (!state.items.length) { view.innerHTML = `<div class="empty">Add some items and your recommendations will appear here.</div>`; return; }
  const i = L.buildInsights(state, L.todayISO());
  const c = (n) => money(n);
  let cards = '';

  if (i.floor.belowFloor)
    cards += insightCard('warn', 'Tight spot — hold non-essentials', `You dip to <b>${c(i.floor.lowBalance)}</b> on ${fmtDay(i.floor.lowDate)} — about <b>${c(Math.abs(i.floor.gap))}</b> below your ${c(i.floor.cushion)} floor. Pause anything that can wait until after that.`);
  else
    cards += insightCard('good', "You're above your floor", `The lowest you dip is <b>${c(i.floor.lowBalance)}</b> on ${fmtDay(i.floor.lowDate)} — <b>${c(i.floor.gap)}</b> above your ${c(i.floor.cushion)} cushion.`);

  if (i.ads.amount > 0)
    cards += insightCard('good', 'Facebook ads budget', `You can put up to <b>${c(i.ads.amount)}</b> toward ads right now and stay above your floor. Use the slider below to test a number.`);
  else
    cards += insightCard('warn', 'No ad room right now', `You're below your floor at the moment — wait until your next income lands before putting money into ads.`);

  cards += insightCard('info', `Discretionary in ${L.monthLabel(i.month.monthKey).split(' ')[0]}`, `After this month's bills and your ${c(i.floor.cushion)} floor, about <b>${c(i.discretionary)}</b> is free to spend or save.`);
  cards += insightCard('info', `${L.monthLabel(i.month.monthKey)} at a glance`, `In <b>+${c(i.month.income)}</b>, out <b>−${c(i.month.expense)}</b>, net <b>${i.month.net >= 0 ? '+' : ''}${c(i.month.net)}</b>. Projected to end the month at <b>${c(i.month.closing)}</b>.`);
  if (i.biggest) cards += insightCard('info', 'Biggest expense this month', `<b>${esc(i.biggest.name)}</b> at ${c(i.biggest.amount)} is your largest single outgo.`);
  if (i.business.spend > 0) cards += insightCard('info', 'Business spending this month', `<b>${c(i.business.spend)}</b> is tagged business — keep it separate at tax time.`);

  const { lowestNoAds } = adBaseline();
  const cushion = state.settings.cushion;
  const maxSafe = Math.max(0, Math.round(lowestNoAds - cushion));
  const current = (state.items.find((x) => x.id === 'fb-ads') || {}).amount || 0;
  const sliderMax = Math.max(Math.ceil((maxSafe * 1.6) / 50) * 50, 500);

  view.innerHTML = `<div class="section-label" style="margin-top:0">Recommendations</div>${cards}
    <div class="card">
      <div class="ititle">Try an ad-spend number</div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:14px 0 8px">
        <span style="font-size:13px;color:var(--muted)">Ad spend</span><span style="font-size:20px;font-weight:650" id="wf-spend">${money(current)}</span>
      </div>
      <input type="range" id="wf-slider" min="0" max="${sliderMax}" step="10" value="${current}" aria-label="Facebook ad spend" />
      <div class="whatif-readout">
        <div class="row2"><span style="font-size:13px;color:var(--muted)">Lowest balance becomes</span><span class="big" id="wf-low"></span></div>
        <div class="status-pill" id="wf-status"></div>
      </div>
      <div class="btn-row"><button class="btn" data-action="wf-clear">Clear ad item</button><button class="btn primary" data-action="wf-apply">Apply as ad item</button></div>
    </div>`;

  const slider = $('#wf-slider');
  const upd = () => {
    const v = +slider.value, low = lowestNoAds - v, delta = low - cushion;
    $('#wf-spend').textContent = money(v); $('#wf-low').textContent = money(low);
    const pill = $('#wf-status');
    if (delta >= 0) { pill.className = 'status-pill'; pill.textContent = `Safe — ${money(delta)} above your ${money(cushion)} floor`; }
    else { pill.className = 'status-pill tight'; pill.textContent = `Too tight — ${money(Math.abs(delta))} below your ${money(cushion)} floor`; }
  };
  slider.addEventListener('input', upd); upd();
}

/* ---------- Settings (incl. manage all items) ---------- */
function renderSettings() {
  const s = state.settings;
  const itemRows = state.items.length
    ? state.items.map((it) => {
        const rec = { none: 'one-time', weekly: 'weekly', biweekly: 'every 2 wks', monthly: 'monthly' }[it.recurrence] || 'one-time';
        return `<div class="row">
          <div class="mid" data-action="edit-item" data-id="${esc(it.id)}">
            <div class="nm"><span class="tag-dot ${it.tag}"></span>${esc(it.name)}${it.approx ? ' <span class="approx">≈</span>' : ''}</div>
            <div class="meta">${rec} · from ${fmtDay(it.date)}</div>
          </div>
          <div class="amt ${it.direction}">${it.direction === 'in' ? '+' : '−'}${money(it.amount)}</div>
          <button class="check" data-action="del-item" data-id="${esc(it.id)}" aria-label="Delete" style="border-color:var(--out);color:var(--out)">×</button>
        </div>`;
      }).join('')
    : `<div class="empty">No items yet.</div>`;

  view.innerHTML = `
    <div class="card">
      <label class="fld"><span class="lab">On hand now (starting balance)</span><input type="number" id="set-bal" value="${s.startingBalance}" inputmode="decimal" /></label>
      <label class="fld"><span class="lab">As of (anchor date)</span><input type="date" id="set-anchor" value="${s.anchorDate}" /></label>
      <label class="fld"><span class="lab">Don't-go-below floor</span><input type="number" id="set-cushion" value="${s.cushion}" inputmode="decimal" /></label>
      <label class="fld"><span class="lab">Look ahead (days)</span><input type="number" id="set-horizon" value="${s.horizonDays}" inputmode="numeric" /></label>
      <button class="btn primary" data-action="save-settings">Save settings</button>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div class="section-label" style="margin:0">All items — edit or delete</div>
        <button class="btn" style="width:auto;padding:6px 12px;font-size:13px" data-action="add">+ Add</button>
      </div>
      <div class="rows">${itemRows}</div>
    </div>
    <div class="card">
      <div class="section-label" style="margin-top:0">Data &amp; backup</div>
      <div class="btn-row"><button class="btn" data-action="export">Export backup</button><button class="btn" data-action="import">Import / restore</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
      <div class="btn-row"><button class="btn" data-action="rollover">Start fresh month</button></div>
    </div>
    <div class="card">
      <label class="fld" style="margin-bottom:8px"><span class="lab">Cloud sync URL</span><input type="url" id="set-sync" value="${esc(s.syncUrl)}" placeholder="paste to turn on sync" /></label>
      <button class="btn" data-action="save-sync">Save sync URL</button>
      <div class="meta" style="margin-top:10px">${s.syncUrl ? 'Cloud sync is on — synced across your devices.' : 'Blank = on this device only (with manual backup).'}</div>
    </div>
    <div class="card"><button class="btn danger" data-action="reset">Erase all data</button></div>`;
}

function render() {
  setSync(state.settings.syncUrl ? 'synced' : '');
  $$('.tab[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'home') renderHome();
  else if (tab === 'months') renderMonths();
  else if (tab === 'insights') renderInsights();
  else if (tab === 'settings') renderSettings();
}

/* ---------- modals ---------- */
function closeModal() { $('#modal-root').innerHTML = ''; }
const findItem = (id) => state.items.find((i) => i.id === id);
const occToItem = (occId) => findItem(occId.split('#')[0]);
function currentOcc() { return $('#modal-root .modal').dataset.occ; }
function deleteItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  for (const k of Object.keys(state.occurrences)) if (k.split('#')[0] === id) delete state.occurrences[k];
}
const uid = () => 'i' + Math.random().toString(36).slice(2, 9);

function openOccModal(occId) {
  const item = occToItem(occId); if (!item) return;
  const ov = state.occurrences[occId] || {};
  const plannedDate = occId.split('#')[1];
  const amt = ov.amount != null ? ov.amount : item.amount;
  const date = ov.date || plannedDate;
  const recurring = item.recurrence && item.recurrence !== 'none';
  $('#modal-root').innerHTML = `
    <div class="modal-bg" data-action="close-bg"><div class="modal" data-occ="${esc(occId)}">
      <button class="x" data-action="close">×</button>
      <h2>${esc(item.name)}</h2>
      <button class="btn ${ov.settled ? 'primary' : ''}" data-action="occ-settle" style="margin-bottom:14px">${ov.settled ? '✓ ' : ''}Mark ${item.direction === 'in' ? 'received' : 'paid'}</button>
      <label class="fld"><span class="lab">Amount${recurring ? ' (this one)' : ''}</span><input type="number" id="occ-amt" value="${amt}" inputmode="decimal" /></label>
      <label class="fld"><span class="lab">Date${recurring ? ' (this one)' : ''}</span><input type="date" id="occ-date" value="${date}" /></label>
      ${recurring ? `<label class="fld" style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="occ-skip" ${ov.skipped ? 'checked' : ''} style="width:auto"/> <span class="lab" style="margin:0">Skip just this one</span></label>` : ''}
      <button class="btn primary" data-action="occ-save">Save</button>
      <div class="btn-row">
        <button class="btn" data-action="occ-series">Edit ${recurring ? 'series' : 'item'}</button>
        ${!recurring ? `<button class="btn danger" data-action="occ-delete">Delete</button>` : ''}
      </div>
    </div></div>`;
}

function openReconcile() {
  $('#modal-root').innerHTML = `
    <div class="modal-bg" data-action="close-bg"><div class="modal">
      <button class="x" data-action="close">×</button>
      <h2>Update your balance</h2>
      <p class="meta" style="margin:-8px 0 16px">What's actually in your account right now? Everything projects forward from this number.</p>
      <label class="fld"><span class="lab">Cash on hand</span><input type="number" id="rc-bal" inputmode="decimal" value="${state.settings.startingBalance}" /></label>
      <button class="btn primary" data-action="rc-save">Save</button>
    </div></div>`;
  setTimeout(() => { const e = $('#rc-bal'); if (e) { e.focus(); e.select(); } }, 60);
}

function openItemModal(id) {
  const it = id ? findItem(id) : { id: '', name: '', amount: '', direction: 'out', tag: 'personal', date: L.todayISO(), recurrence: 'none', approx: false, note: '' };
  $('#modal-root').innerHTML = `
    <div class="modal-bg" data-action="close-bg"><div class="modal">
      <button class="x" data-action="close">×</button>
      <h2>${id ? 'Edit item' : 'New item'}</h2>
      <label class="fld"><span class="lab">Name</span><input id="it-name" value="${esc(it.name)}" placeholder="Rent, Paycheck, Internet…" /></label>
      <label class="fld"><span class="lab">Amount</span><input id="it-amount" type="number" inputmode="decimal" value="${it.amount}" placeholder="0" /></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <label class="fld"><span class="lab">Direction</span><div class="seg" id="it-dir">
          <button type="button" data-v="in" class="${it.direction === 'in' ? 'on' : ''}">Coming in</button>
          <button type="button" data-v="out" class="${it.direction === 'out' ? 'on' : ''}">Going out</button></div></label>
        <label class="fld"><span class="lab">Tag</span><div class="seg" id="it-tag">
          <button type="button" data-v="personal" class="${it.tag === 'personal' ? 'on' : ''}">Personal</button>
          <button type="button" data-v="business" class="${it.tag === 'business' ? 'on' : ''}">Business</button></div></label>
      </div>
      <label class="fld"><span class="lab">Date${it.recurrence !== 'none' ? ' (first one)' : ''}</span><input id="it-date" type="date" value="${it.date}" /></label>
      <label class="fld"><span class="lab">Repeats</span><select id="it-rec">
        ${[['none', 'One-time'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']].map(([v, t]) => `<option value="${v}" ${it.recurrence === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>
      <label class="fld" style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="it-approx" ${it.approx ? 'checked' : ''} style="width:auto"/> <span class="lab" style="margin:0">Rough number (shows ≈)</span></label>
      <button class="btn primary" data-action="it-save" data-id="${esc(it.id)}">Save</button>
      ${id ? `<div class="btn-row"><button class="btn danger" data-action="it-delete" data-id="${esc(it.id)}">Delete ${it.recurrence !== 'none' ? 'series' : ''}</button></div>` : ''}
    </div></div>`;
  let dir = it.direction, tagv = it.tag;
  $('#it-dir').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; dir = b.dataset.v; $$('#it-dir button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#it-tag').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; tagv = b.dataset.v; $$('#it-tag button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#modal-root')._getDir = () => dir; $('#modal-root')._getTag = () => tagv;
  if (!id) setTimeout(() => { const e = $('#it-name'); if (e) e.focus(); }, 60);
}

/* ---------- actions ---------- */
async function onAction(action, ds, target) {
  if (action === 'filter') { filter = ds.filter; render(); return; }
  if (action === 'goto-insights') { tab = 'insights'; render(); return; }
  if (action === 'reconcile') { openReconcile(); return; }
  if (action === 'rc-save') { state.settings.startingBalance = Math.round(+$('#rc-bal').value || 0); state.settings.anchorDate = L.todayISO(); closeModal(); commit(); toast('Balance updated'); return; }
  if (action === 'month-prev') { month = L.addMonthKey(month, -1); render(); return; }
  if (action === 'month-next') { month = L.addMonthKey(month, 1); render(); return; }
  if (action === 'settle') {
    const ov = state.occurrences[ds.occ] || {};
    ov.settled = !ov.settled; ov.settledAt = ov.settled ? new Date().toISOString() : undefined;
    state.occurrences[ds.occ] = ov; commit(); toast(ov.settled ? 'Marked done' : 'Unmarked'); return;
  }
  if (action === 'edit') { openOccModal(ds.occ); return; }
  if (action === 'edit-item') { openItemModal(ds.id); return; }
  if (action === 'del-item') { if (confirm('Delete this item?')) { deleteItem(ds.id); commit(); toast('Deleted'); } return; }
  if (action === 'add') { openItemModal(null); return; }
  if (action === 'close') { closeModal(); return; }
  if (action === 'close-bg') { if (target === target.closest('.modal-bg')) closeModal(); return; }

  if (action === 'occ-settle') {
    const id = currentOcc(); const ov = state.occurrences[id] || {};
    ov.settled = !ov.settled; ov.settledAt = ov.settled ? new Date().toISOString() : undefined;
    state.occurrences[id] = ov; closeModal(); commit(); return;
  }
  if (action === 'occ-save') {
    const id = currentOcc(); const ov = state.occurrences[id] || {};
    ov.amount = Math.round(+$('#occ-amt').value || 0);
    ov.date = $('#occ-date').value;
    if ($('#occ-skip')) ov.skipped = $('#occ-skip').checked;
    state.occurrences[id] = ov; closeModal(); commit(); toast('Saved'); return;
  }
  if (action === 'occ-series') { const it = occToItem(currentOcc()); closeModal(); openItemModal(it.id); return; }
  if (action === 'occ-delete') { const it = occToItem(currentOcc()); deleteItem(it.id); closeModal(); commit(); toast('Deleted'); return; }

  if (action === 'it-save') {
    const name = $('#it-name').value.trim();
    const amount = Math.round(+$('#it-amount').value || 0);
    if (!name || !amount) { toast('Add a name and amount'); return; }
    const id = ds.id || uid();
    const obj = { id, name, amount, direction: $('#modal-root')._getDir(), tag: $('#modal-root')._getTag(), date: $('#it-date').value, recurrence: $('#it-rec').value, approx: $('#it-approx').checked, note: (findItem(id) || {}).note || '' };
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx >= 0) state.items[idx] = obj; else state.items.push(obj);
    closeModal(); commit(); toast('Saved'); return;
  }
  if (action === 'it-delete') { deleteItem(ds.id); closeModal(); commit(); toast('Deleted'); return; }

  if (action === 'save-settings') {
    state.settings.startingBalance = Math.round(+$('#set-bal').value || 0);
    state.settings.anchorDate = $('#set-anchor').value || L.todayISO();
    state.settings.cushion = Math.round(+$('#set-cushion').value || 0);
    state.settings.horizonDays = Math.max(7, Math.round(+$('#set-horizon').value || 60));
    commit(); toast('Settings saved'); return;
  }
  if (action === 'save-sync') {
    const url = $('#set-sync').value.trim();
    state.settings.syncUrl = url; saveState(state);
    if (!url) { render(); toast('Sync off'); return; }
    setSync('syncing');
    try {
      const remote = await pullRemote(url);
      if (remote && Array.isArray(remote.items) && remote.items.length) { remote.settings.syncUrl = url; state = saveState(remote); toast('Synced — loaded your cloud data'); }
      else { await pushRemote(url, state); toast('Sync on'); }
      setSync('synced');
    } catch { setSync('error'); toast('Could not reach that sync URL'); }
    render(); return;
  }
  if (action === 'export') { exportState(state); toast('Backup downloaded'); return; }
  if (action === 'import') { $('#import-file').click(); return; }
  if (action === 'rollover') {
    if (!confirm('Start a fresh month? Carries your settled balance forward and archives the past.')) return;
    state = L.rolloverMonth(state, L.todayISO()); month = L.monthKeyOf(L.todayISO()); commit(); tab = 'home'; render(); toast('Fresh month started'); return;
  }
  if (action === 'reset') { if (confirm('Erase ALL data on this device? Export a backup first if unsure.')) { state = defaultState(); commit(); tab = 'home'; render(); toast('Erased'); } return; }

  if (action === 'wf-apply') {
    const v = Math.round(+$('#wf-slider').value || 0);
    const idx = state.items.findIndex((i) => i.id === 'fb-ads');
    const obj = { id: 'fb-ads', name: 'Facebook ads', amount: v, direction: 'out', tag: 'business', date: L.todayISO(), recurrence: 'none', approx: true, note: '' };
    if (v === 0) { if (idx >= 0) state.items.splice(idx, 1); }
    else if (idx >= 0) state.items[idx] = obj; else state.items.push(obj);
    commit(); tab = 'home'; render(); toast('Ad spend applied'); return;
  }
  if (action === 'wf-clear') { const idx = state.items.findIndex((i) => i.id === 'fb-ads'); if (idx >= 0) state.items.splice(idx, 1); commit(); render(); toast('Ad item cleared'); return; }
}

/* ---------- wiring ---------- */
document.addEventListener('click', (e) => { const a = e.target.closest('[data-action]'); if (a) onAction(a.dataset.action, a.dataset, e.target); });
document.addEventListener('change', async (e) => {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    try { state = await importStateFromFile(e.target.files[0]); commit(); tab = 'home'; render(); toast('Data imported'); }
    catch (err) { toast(err.message); }
  }
});
$$('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; closeModal(); render(); }));
$('#add-btn').addEventListener('click', () => openItemModal(null));

/* ---------- boot ---------- */
(async () => {
  if (location.hash.startsWith('#import=')) {
    try {
      const json = decodeURIComponent(escape(atob(location.hash.slice(8))));
      const incoming = importStateFromJSON(JSON.parse(json));
      const keepSync = state.settings.syncUrl;
      if (keepSync) incoming.settings.syncUrl = keepSync;
      state = saveState(incoming);
      if (keepSync) { try { await pushRemote(keepSync, state); } catch {} }
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => toast('Your data loaded'), 300);
    } catch {}
  }
  render();
  state = await syncOnLoad(state);
  render();
})();
