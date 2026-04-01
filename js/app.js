/* ============================================================
   FOUR EYES COFFEE — app.js
   Routing · shared state · utilities · PIN · boot sequence
   ============================================================ */

const APP_VERSION = '20260331-0001'; // auto-updated on each deploy

// ── Shared state ──────────────────────────────────────────────────
// Single source of truth. All modules read/write this object.
const state = {
  skus:       [],   // [{ id, name, stock, sold, price }]
  orders:     [],   // [{ id, name, items, pay, discount, total, time, createdAt }]
  pendingQty: {},   // { skuId: qty } — aggregated from pending orders
  nextSkuId:  1     // incremented locally for optimistic inserts
};

// ── Utilities ─────────────────────────────────────────────────────

// XSS-safe HTML escaping — use whenever rendering user-supplied strings
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Format a number as currency, dropping .00 for whole numbers
function fmtMoney(v) {
  const n = parseFloat(v) || 0;
  return '$' + (Number.isInteger(n) ? n : n.toFixed(2));
}

// Extract YYYY-MM month key from an order object
// Uses createdAt (Supabase ISO string) when available — fixes the
// old bug where integer IDs were parsed as timestamps.
function getSaleMonthKey(order) {
  if (order.createdAt) {
    const d = new Date(order.createdAt);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  // Legacy fallback: local-only sale with numeric timestamp id
  if (typeof order.id === 'number' && order.id > 1_000_000_000_000) {
    const d = new Date(order.id);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  // Final fallback: current month
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
}

// Format YYYY-MM key as "March 2026"
function getMonthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// ── localStorage cache ────────────────────────────────────────────

function saveLocal() {
  try {
    localStorage.setItem('fec_skus',   JSON.stringify(state.skus));
    localStorage.setItem('fec_orders', JSON.stringify(state.orders));
  } catch(e) { /* storage full or private mode */ }
}

function loadLocal() {
  try {
    const skus   = localStorage.getItem('fec_skus');
    const orders = localStorage.getItem('fec_orders');
    // Support legacy key name from old single-file build
    const legacy = localStorage.getItem('fec_sales');

    if (skus)   state.skus   = JSON.parse(skus);
    if (orders) state.orders = JSON.parse(orders);
    else if (legacy) state.orders = JSON.parse(legacy);

    if (state.skus.length) {
      state.nextSkuId = Math.max(...state.skus.map(s => s.id)) + 1;
    }
  } catch(e) { /* corrupt cache — start fresh */ }
}

// ── Bottom nav routing ────────────────────────────────────────────

const NAV_TABS = ['dashboard', 'newsale', 'history', 'storehub'];

function switchTab(name) {
  NAV_TABS.forEach(n => {
    const panel = document.getElementById('panel-' + n);
    const btn   = document.querySelector(`[data-tab="${n}"]`);
    if (panel) panel.classList.toggle('active', n === name);
    if (btn)   btn.classList.toggle('active',   n === name);
  });

  // Per-tab side effects
  if (name === 'newsale') {
    if (typeof renderSaleForm       === 'function') renderSaleForm();
    if (typeof loadPendingForNewSale === 'function') loadPendingForNewSale();
  }
  if (name === 'storehub') {
    if (typeof loadActiveCode   === 'function') loadActiveCode();
    if (typeof renderInventory  === 'function') renderInventory();
  }
  if (name === 'history') {
    if (typeof renderHistory === 'function') renderHistory();
  }
}

// ── Inner tab routing (History, Store Hub) ────────────────────────

function switchInnerTab(panelId, tabName) {
  const panel = document.getElementById(panelId);
  if (!panel) return;

  panel.querySelectorAll('.inner-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.inner === tabName)
  );
  panel.querySelectorAll('.inner-panel').forEach(p =>
    p.classList.toggle('active', p.id === 'inner-' + tabName)
  );
}

// ── PIN screen ────────────────────────────────────────────────────

const CORRECT_PIN = '0749'; // change your PIN here
let pinEntry = '';

function pinCheckSession() {
  if (sessionStorage.getItem('fec_unlocked') === '1') {
    document.getElementById('pin-overlay').classList.add('hidden');
  }
}

function pinUpdateDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById('pin-dot-' + i);
    if (dot) dot.classList.toggle('filled', i < pinEntry.length);
  }
}

function pinPress(digit) {
  if (pinEntry.length >= 4) return;
  pinEntry += digit;
  pinUpdateDots();
  if (pinEntry.length === 4) {
    setTimeout(() => {
      if (pinEntry === CORRECT_PIN) {
        sessionStorage.setItem('fec_unlocked', '1');
        document.getElementById('pin-overlay').classList.add('hidden');
      } else {
        const dots = document.getElementById('pin-dots');
        const err  = document.getElementById('pin-error');
        if (dots) dots.classList.add('shake');
        if (err)  err.classList.add('visible');
        setTimeout(() => {
          if (dots) dots.classList.remove('shake');
          if (err)  err.classList.remove('visible');
          pinEntry = '';
          pinUpdateDots();
        }, 600);
      }
    }, 80);
  }
}

function pinBack() {
  if (pinEntry.length === 0) return;
  pinEntry = pinEntry.slice(0, -1);
  pinUpdateDots();
}

// Keyboard support for PIN entry
document.addEventListener('keydown', e => {
  const overlay = document.getElementById('pin-overlay');
  if (!overlay || overlay.classList.contains('hidden')) return;
  if (e.key >= '0' && e.key <= '9') pinPress(e.key);
  else if (e.key === 'Backspace') pinBack();
});

// ── App update check ──────────────────────────────────────────────

async function checkForUpdate() {
  const btn     = document.getElementById('update-app-btn');
  const labelEl = document.getElementById('update-app-label');

  if (labelEl) labelEl.textContent = 'Checking...';
  if (btn) btn.disabled = true;

  try {
    const res   = await fetch('js/app.js?v=' + Date.now(), { cache: 'no-store' });
    const text  = await res.text();
    const match = text.match(/APP_VERSION = '([^']+)'/);
    const live  = match ? match[1] : null;

    if (!live) {
      if (labelEl) labelEl.textContent = 'Could not check';
    } else if (live !== APP_VERSION) {
      if (labelEl) labelEl.textContent = '↑ Update Available — Tap to Reload';
      if (btn) { btn.classList.add('has-update'); btn.onclick = () => location.reload(true); }
      const headerBtn = document.getElementById('update-btn');
      if (headerBtn) { headerBtn.style.display = 'flex'; headerBtn.classList.add('has-update'); }
    } else {
      if (labelEl) labelEl.textContent = 'App is up to date ✓';
      setTimeout(() => {
        if (labelEl) labelEl.textContent = 'Check for App Update';
        if (btn) btn.onclick = checkForUpdate;
      }, 2500);
    }
  } catch(e) {
    if (labelEl) labelEl.textContent = 'Check failed — try again';
    setTimeout(() => { if (labelEl) labelEl.textContent = 'Check for App Update'; }, 2000);
  }

  if (btn) btn.disabled = false;
}

async function refreshApp() {
  const btn   = document.getElementById('refresh-btn');
  const label = document.getElementById('refresh-label');
  const icon  = document.getElementById('refresh-icon');

  if (btn)   btn.disabled = true;
  if (label) label.textContent = 'Refreshing...';
  if (icon)  icon.style.animation = 'spin 0.8s linear infinite';

  try {
    await appLoadData();
    if (label) label.textContent = 'Updated ✓';
    setTimeout(() => { if (label) label.textContent = 'Refresh Data'; }, 1500);
  } catch(e) {
    if (label) label.textContent = 'Try Again';
    setTimeout(() => { if (label) label.textContent = 'Refresh Data'; }, 2000);
  }

  if (btn)  btn.disabled = false;
  if (icon) icon.style.animation = '';
}

// ── Data loading ──────────────────────────────────────────────────

async function appLoadData() {
  const refreshLabel = document.getElementById('refresh-label');

  try {
    const { skus, orders } = await dbLoad();

    if (skus.length) {
      state.skus      = skus;
      state.nextSkuId = Math.max(...skus.map(s => s.id)) + 1;
    }
    state.orders = orders;

    // Pending counts — non-blocking, don't let it fail the whole load
    try {
      state.pendingQty = await dbLoadPendingCounts();
    } catch(e) {
      console.warn('Pending counts failed (non-fatal):', e);
    }

    saveLocal();

  } catch(e) {
    console.error('Supabase load failed:', e.message || e);
    // Show the error visibly on the dashboard refresh button
    if (refreshLabel) {
      refreshLabel.textContent = 'Load failed — tap to retry';
      setTimeout(() => { refreshLabel.textContent = 'Refresh Data'; }, 4000);
    }
    // Still render with whatever state we have (cache or empty)
  }

  // Always render — worst case shows cache or empty state
  if (typeof renderDashboard       === 'function') renderDashboard();
  if (typeof renderInventory       === 'function') renderInventory();
  if (typeof renderHistory         === 'function') renderHistory();
  if (typeof renderSaleForm        === 'function') renderSaleForm();
  if (typeof loadPendingForNewSale  === 'function') loadPendingForNewSale();
}

// ── Silent background update check (3s after load) ───────────────

setTimeout(async () => {
  try {
    const res   = await fetch('js/app.js?v=' + Date.now(), { cache: 'no-store' });
    const text  = await res.text();
    const match = text.match(/APP_VERSION = '([^']+)'/);
    if (match && match[1] !== APP_VERSION) {
      const headerBtn = document.getElementById('update-btn');
      const appBtn    = document.getElementById('update-app-btn');
      const labelEl   = document.getElementById('update-app-label');
      if (headerBtn) { headerBtn.style.display = 'flex'; headerBtn.classList.add('has-update'); }
      if (appBtn)    { appBtn.classList.add('has-update'); appBtn.onclick = () => location.reload(true); }
      if (labelEl)   labelEl.textContent = '↑ Update Available — Tap to Reload';
    }
  } catch(e) { /* silent */ }
}, 3000);

// ── Boot sequence ─────────────────────────────────────────────────

(function boot() {
  // Set header date
  const dateEl = document.getElementById('session-date');
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  // PIN: restore session if already unlocked
  pinCheckSession();

  // Hydrate state from localStorage (gives instant cache while Supabase loads)
  loadLocal();

  // Wait for Supabase CDN, then init and pull live data
  function waitForSupabase(cb, attempts = 0) {
    if (typeof supabase !== 'undefined') cb();
    else if (attempts < 20) setTimeout(() => waitForSupabase(cb, attempts + 1), 100);
    else console.warn('Supabase CDN failed to load — check network');
  }

  waitForSupabase(() => {
    dbInit();
    appLoadData().catch(e => console.error('Initial load failed:', e));
  });
})();
