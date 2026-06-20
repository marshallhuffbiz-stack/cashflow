import * as L from './logic.js';
import { loadState, saveState, defaultState, exportState, importStateFromFile, importStateFromJSON, pushRemote, syncOnLoad } from './storage.js';

let state = loadState();
let filter = 'all';
let tab = 'home';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const money = (n) => usd.format(Math.round(n || 0));
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
  else { label.textContent = 'syncing…'; }
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

/* ---------- shared compute ---------- */
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
  return { lowestNoAds: lp.balance, lowDate: lp.date, today, end };
}

/* ---------- sparkline ---------- */
function spark(values, lowIdx) {
  if (values.length < 2) return '';
  const W = 300, H = 60, P = 5;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = (H - P) - ((v - min) / span) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  let dot = '';
  if (lowIdx != null) {
    const [lx, ly] = pts[lowIdx].split(',');
    dot = `<circle cx="${lx}" cy="${ly}" r="3.5" fill="var(--warn)"></circle>`;
  }
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Projected balance over time">
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>${dot}</svg>`;
}

/* ---------- rows ---------- */
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

/* ---------- views ---------- */
function renderHome() {
  const { today, start, end } = window_();
  const ledger = L.buildLedger(state, start, end);
  const onHand = L.onHandNow(state);
  const lp = L.lowestPoint(ledger, state.settings.startingBalance, today, end);
  const projEnd = ledger.length ? ledger[ledger.length - 1].balanceAfter : state.settings.startingBalance;
  const safe = L.maxSafeAdSpend(state, today);
  const cushion = state.settings.cushion;

  // sparkline from today forward
  const fwd = ledger.filter((r) => r.date >= today);
  const enter = L.projectedBalanceAt(ledger, today);
  const sparkVals = [enter == null ? state.settings.startingBalance : enter, ...fwd.map((r) => r.balanceAfter)];
  let lowIdx = 0; sparkVals.forEach((v, i) => { if (v < sparkVals[lowIdx]) lowIdx = i; });

  // next up / filtered list
  const upcoming = ledger.filter((r) => r.date >= today);
  const list = filter === 'all' ? upcoming : upcoming.filter((r) => r.tag === filter);
  let listHTML;
  if (!state.items.length) {
    listHTML = `<div class="empty">No items yet. Tap <b>+</b> to add what's coming in and going out — or load your starting numbers in Settings.</div>`;
  } else if (!list.length) {
    listHTML = `<div class="empty">Nothing ${filter !== 'all' ? filter + ' ' : ''}coming up in the next ${state.settings.horizonDays} days.</div>`;
  } else if (filter === 'all') {
    listHTML = `<div class="rows">${list.slice(0, 40).map((o) => rowHTML(o, true)).join('')}</div>`;
  } else {
    const out = list.filter((r) => r.direction === 'out').reduce((a, r) => a + r.amount, 0);
    const inc = list.filter((r) => r.direction === 'in').reduce((a, r) => a + r.amount, 0);
    listHTML = `<div class="rows">${list.slice(0, 40).map((o) => rowHTML(o, false)).join('')}</div>
      <div class="meta" style="padding:10px 4px;color:var(--muted)">${filter} this period — out ${money(out)}${inc ? ', in ' + money(inc) : ''}</div>`;
  }

  view.innerHTML = `
    <div class="card">
      <p class="hero-label">On hand now</p>
      <p class="hero-value ${onHand < 0 ? 'neg' : ''}">${money(onHand)}</p>
      <p class="hero-sub">settled · ${state.items.length ? 'projecting to ' + fmtDay(end) : 'set your starting balance in Settings'}</p>
      ${state.items.length ? spark(sparkVals, lowIdx) : ''}
    </div>
    <div class="stat-grid">
      <div class="stat ${lp.balance < cushion ? 'warn' : ''}"><div class="l">Projected low</div><div class="v">${money(lp.balance)}</div><div class="d">${fmtDay(lp.date)}${lp.balance < cushion ? ' · below floor' : ' · above floor'}</div></div>
      <div class="stat"><div class="l">End of period</div><div class="v">${money(projEnd)}</div><div class="d">${fmtDay(end)}</div></div>
    </div>
    <div class="chip-safe ${safe === 0 ? 'tight' : ''}" data-action="goto-whatif">
      <span class="t">Safe to add to ads</span><span class="a">${money(safe)}</span>
    </div>
    <div class="filter">
      ${['all', 'business', 'personal'].map((f) => `<button data-action="filter" data-filter="${f}" class="${filter === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
    </div>
    <div class="section-label">Next up</div>
    ${listHTML}`;
}

function renderLedger() {
  const { today, start, end } = window_();
  const ledger = L.buildLedger(state, start, end);
  const list = filter === 'all' ? ledger : ledger.filter((r) => r.tag === filter);
  view.innerHTML = `
    <div class="filter">
      ${['all', 'business', 'personal'].map((f) => `<button data-action="filter" data-filter="${f}" class="${filter === f ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}
    </div>
    <div class="section-label">${fmtDay(start)} – ${fmtDay(end)}</div>
    ${list.length ? `<div class="rows">${list.map((o) => rowHTML(o, filter === 'all')).join('')}</div>` : `<div class="empty">No items in this window.</div>`}`;
}

function renderWhatIf() {
  const { lowestNoAds, today, end } = adBaseline();
  const cushion = state.settings.cushion;
  const maxSafe = Math.max(0, Math.round(lowestNoAds - cushion));
  const current = (state.items.find((i) => i.id === 'fb-ads') || {}).amount || 0;
  const sliderMax = Math.max(Math.ceil((maxSafe * 1.6) / 50) * 50, 500);
  view.innerHTML = `
    <div class="card">
      <p class="hero-label">Facebook ads what-if</p>
      <p class="hero-sub" style="margin-top:2px">How much can you put toward ads before you dip below your ${money(cushion)} floor on ${fmtDay(L.todayISO())}–${fmtDay(end)}?</p>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin:18px 0 8px">
        <span style="font-size:13px;color:var(--muted)">Ad spend</span>
        <span style="font-size:20px;font-weight:650" id="wf-spend">${money(current)}</span>
      </div>
      <input type="range" id="wf-slider" min="0" max="${sliderMax}" step="10" value="${current}" aria-label="Facebook ad spend" />
      <div class="whatif-readout">
        <div class="row2"><span style="font-size:13px;color:var(--muted)">Lowest balance becomes</span><span class="big" id="wf-low"></span></div>
        <div class="status-pill" id="wf-status"></div>
        <div class="meta" style="margin-top:10px">Max safe right now: <b id="wf-max">${money(maxSafe)}</b></div>
      </div>
      <div class="btn-row">
        <button class="btn" data-action="wf-clear">Clear ad item</button>
        <button class="btn primary" data-action="wf-apply">Apply as ad item</button>
      </div>
    </div>`;
  const slider = $('#wf-slider');
  const upd = () => {
    const v = +slider.value;
    const low = lowestNoAds - v, delta = low - cushion;
    $('#wf-spend').textContent = money(v);
    $('#wf-low').textContent = money(low);
    const pill = $('#wf-status');
    if (delta >= 0) { pill.className = 'status-pill'; pill.textContent = `Safe — ${money(delta)} above your ${money(cushion)} floor`; }
    else { pill.className = 'status-pill tight'; pill.textContent = `Too tight — ${money(Math.abs(delta))} below your ${money(cushion)} floor`; }
  };
  slider.addEventListener('input', upd); upd();
}

function renderSettings() {
  const s = state.settings;
  view.innerHTML = `
    <div class="card">
      <label class="fld"><span class="lab">On hand now (starting balance)</span><input type="number" id="set-bal" value="${s.startingBalance}" inputmode="decimal" /></label>
      <label class="fld"><span class="lab">As of (anchor date)</span><input type="date" id="set-anchor" value="${s.anchorDate}" /></label>
      <label class="fld"><span class="lab">Don't-go-below floor</span><input type="number" id="set-cushion" value="${s.cushion}" inputmode="decimal" /></label>
      <label class="fld"><span class="lab">Look ahead (days)</span><input type="number" id="set-horizon" value="${s.horizonDays}" inputmode="numeric" /></label>
      <button class="btn primary" data-action="save-settings">Save settings</button>
    </div>
    <div class="card">
      <div class="section-label" style="margin-top:0">Data &amp; backup</div>
      <div class="btn-row"><button class="btn" data-action="export">Export backup</button><button class="btn" data-action="import">Import / restore</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
      <div class="btn-row"><button class="btn" data-action="rollover">Start fresh month</button></div>
    </div>
    <div class="card">
      <label class="fld" style="margin-bottom:8px"><span class="lab">Cloud sync URL (Apps Script web app)</span><input type="url" id="set-sync" value="${esc(s.syncUrl)}" placeholder="paste to turn on cross-device sync" /></label>
      <button class="btn" data-action="save-sync">Save sync URL</button>
      <div class="meta" style="margin-top:10px">${s.syncUrl ? 'Cloud sync is on. Data backs up automatically.' : 'Leaving this blank keeps everything on this device (with manual backup above).'}</div>
    </div>
    <div class="card">
      <button class="btn danger" data-action="reset">Erase all data</button>
    </div>`;
}

function render() {
  setSync(state.settings.syncUrl ? 'synced' : '');
  document.querySelectorAll('.tab[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (tab === 'home') renderHome();
  else if (tab === 'ledger') renderLedger();
  else if (tab === 'whatif') renderWhatIf();
  else if (tab === 'settings') renderSettings();
}

/* ---------- modals ---------- */
function closeModal() { $('#modal-root').innerHTML = ''; }

function findItem(id) { return state.items.find((i) => i.id === id); }
function occToItem(occId) { return findItem(occId.split('#')[0]); }

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
        <button class="btn" data-action="occ-series">Edit series</button>
        ${!recurring ? `<button class="btn danger" data-action="occ-delete">Delete</button>` : ''}
      </div>
    </div></div>`;
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
        <label class="fld"><span class="lab">Direction</span>
          <div class="seg" id="it-dir">
            <button type="button" data-v="in" class="${it.direction === 'in' ? 'on' : ''}">Coming in</button>
            <button type="button" data-v="out" class="${it.direction === 'out' ? 'on' : ''}">Going out</button>
          </div></label>
        <label class="fld"><span class="lab">Tag</span>
          <div class="seg" id="it-tag">
            <button type="button" data-v="personal" class="${it.tag === 'personal' ? 'on' : ''}">Personal</button>
            <button type="button" data-v="business" class="${it.tag === 'business' ? 'on' : ''}">Business</button>
          </div></label>
      </div>
      <label class="fld"><span class="lab">Date</span><input id="it-date" type="date" value="${it.date}" /></label>
      <label class="fld"><span class="lab">Repeats</span>
        <select id="it-rec">
          ${[['none', 'One-time'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['monthly', 'Monthly']].map(([v, t]) => `<option value="${v}" ${it.recurrence === v ? 'selected' : ''}>${t}</option>`).join('')}
        </select></label>
      <label class="fld" style="display:flex;align-items:center;gap:10px"><input type="checkbox" id="it-approx" ${it.approx ? 'checked' : ''} style="width:auto"/> <span class="lab" style="margin:0">Rough number (shows ≈, easy to fix)</span></label>
      <button class="btn primary" data-action="it-save" data-id="${esc(it.id)}">Save</button>
      ${id ? `<div class="btn-row"><button class="btn danger" data-action="it-delete" data-id="${esc(it.id)}">Delete ${it.recurrence !== 'none' ? 'series' : ''}</button></div>` : ''}
    </div></div>`;
  let dir = it.direction, tagv = it.tag;
  $('#it-dir').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; dir = b.dataset.v; $$('#it-dir button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#it-tag').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; tagv = b.dataset.v; $$('#it-tag button').forEach((x) => x.classList.toggle('on', x === b)); });
  $('#modal-root')._getDir = () => dir; $('#modal-root')._getTag = () => tagv;
}
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function uid() { return 'i' + Math.random().toString(36).slice(2, 9); }

/* ---------- actions ---------- */
function genId() { return uid(); }

async function onAction(action, ds, target) {
  if (action === 'filter') { filter = ds.filter; render(); return; }
  if (action === 'goto-whatif') { tab = 'whatif'; render(); return; }
  if (action === 'settle') {
    const ov = state.occurrences[ds.occ] || {};
    ov.settled = !ov.settled; ov.settledAt = ov.settled ? new Date().toISOString() : undefined;
    state.occurrences[ds.occ] = ov; commit(); toast(ov.settled ? 'Marked done' : 'Unmarked'); return;
  }
  if (action === 'edit') { openOccModal(ds.occ); return; }
  if (action === 'close' || action === 'close-bg') { if (action === 'close-bg' && target !== target.closest('.modal-bg')) return; closeModal(); return; }

  // occurrence modal
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

  // item modal
  if (action === 'it-save') {
    const name = $('#it-name').value.trim();
    const amount = Math.round(+$('#it-amount').value || 0);
    if (!name || !amount) { toast('Add a name and amount'); return; }
    const id = ds.id || genId();
    const obj = { id, name, amount, direction: $('#modal-root')._getDir(), tag: $('#modal-root')._getTag(), date: $('#it-date').value, recurrence: $('#it-rec').value, approx: $('#it-approx').checked, note: '' };
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx >= 0) state.items[idx] = obj; else state.items.push(obj);
    closeModal(); commit(); toast('Saved'); return;
  }
  if (action === 'it-delete') { deleteItem(ds.id); closeModal(); commit(); toast('Deleted'); return; }

  // settings
  if (action === 'save-settings') {
    state.settings.startingBalance = Math.round(+$('#set-bal').value || 0);
    state.settings.anchorDate = $('#set-anchor').value || L.todayISO();
    state.settings.cushion = Math.round(+$('#set-cushion').value || 0);
    state.settings.horizonDays = Math.max(7, Math.round(+$('#set-horizon').value || 60));
    commit(); toast('Settings saved'); return;
  }
  if (action === 'save-sync') { state.settings.syncUrl = $('#set-sync').value.trim(); commit(); toast(state.settings.syncUrl ? 'Sync on' : 'Sync off'); return; }
  if (action === 'export') { exportState(state); toast('Backup downloaded'); return; }
  if (action === 'import') { $('#import-file').click(); return; }
  if (action === 'rollover') {
    if (!confirm('Start a fresh month? Carries your settled balance forward and archives the past.')) return;
    state = L.rolloverMonth(state, L.todayISO()); commit(); tab = 'home'; render(); toast('Fresh month started'); return;
  }
  if (action === 'reset') { if (confirm('Erase ALL data on this device? Export a backup first if unsure.')) { state = defaultState(); commit(); tab = 'home'; render(); toast('Erased'); } return; }

  // what-if
  if (action === 'wf-apply') {
    const v = Math.round(+$('#wf-slider').value || 0);
    const idx = state.items.findIndex((i) => i.id === 'fb-ads');
    const obj = { id: 'fb-ads', name: 'Facebook ads', amount: v, direction: 'out', tag: 'business', date: L.todayISO(), recurrence: 'none', approx: true, note: '' };
    if (v === 0) { if (idx >= 0) state.items.splice(idx, 1); }
    else if (idx >= 0) state.items[idx] = obj; else state.items.push(obj);
    commit(); tab = 'home'; render(); toast('Ad spend applied'); return;
  }
  if (action === 'wf-clear') {
    const idx = state.items.findIndex((i) => i.id === 'fb-ads');
    if (idx >= 0) state.items.splice(idx, 1);
    commit(); render(); toast('Ad item cleared'); return;
  }
}

function currentOcc() { return $('#modal-root .modal').dataset.occ; }
function deleteItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  for (const k of Object.keys(state.occurrences)) if (k.split('#')[0] === id) delete state.occurrences[k];
}

/* ---------- wiring ---------- */
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  onAction(a.dataset.action, a.dataset, e.target);
});
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
  // one-time deep-link import: open .../#import=<base64 json> to load data on a fresh device
  if (location.hash.startsWith('#import=')) {
    try {
      const json = decodeURIComponent(escape(atob(location.hash.slice(8))));
      state = saveState(importStateFromJSON(JSON.parse(json)));
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => toast('Your data loaded'), 300);
    } catch { /* bad link — ignore, keep existing data */ }
  }
  render();
  state = await syncOnLoad(state);
  render();
})();
