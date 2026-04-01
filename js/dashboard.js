/* ============================================================
   FOUR EYES COFFEE — dashboard.js
   Revenue summary panel. Inventory lives in Store Hub.
   ============================================================ */

function initDashboard() {
  const panel = document.getElementById('panel-dashboard');
  if (!panel) return;

  panel.innerHTML = `
    <div class="sec-row" style="margin-top:0;">
      <span class="sec-label">Revenue</span>
    </div>

    <div class="rev-card">
      <div class="rev-stat-row">
        <div class="rev-stat">
          <div class="rev-stat-label">Annual Total</div>
          <div class="rev-stat-value" id="dash-annual">$0</div>
          <div class="rev-stat-sub"  id="dash-annual-sub">all sales</div>
        </div>
        <div class="rev-stat-divider"></div>
        <div class="rev-stat">
          <div class="rev-stat-label">This Month</div>
          <div class="rev-stat-value" id="dash-month">$0</div>
          <div class="rev-stat-sub"  id="dash-month-sub">loading...</div>
        </div>
      </div>
      <hr class="rev-div rev-div--top">
      <div id="rev-rows"></div>
      <hr class="rev-div">
      <div class="rev-total">
        <span class="l">Net</span>
        <span class="v" id="total-rev">$0</span>
      </div>
      <div id="rev-gift-line" class="rev-gift-line" style="display:none;"></div>
    </div>

    <div class="sec-row">
      <span class="sec-label">Today</span>
    </div>
    <div class="rev-card" id="session-card" style="background:var(--card); color:var(--white); border-radius:3px; padding:14px 16px;">
      <div id="session-content">
        <span style="font-size:10px; font-weight:700; letter-spacing:2px; text-transform:uppercase; color:var(--muted);">No sales today</span>
      </div>
    </div>

    <button id="refresh-btn" onclick="refreshApp()" class="refresh-btn">
      <svg id="refresh-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16"
           viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
        <path d="M21 3v5h-5"/>
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
        <path d="M8 16H3v5"/>
      </svg>
      <span id="refresh-label">Refresh Data</span>
    </button>

    <button id="update-app-btn" onclick="checkForUpdate()" class="update-app-btn">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <span id="update-app-label">Check for App Update</span>
    </button>
  `;
}

function renderDashboard() {
  const now        = new Date();
  const curMonth   = now.getMonth();
  const curYear    = now.getFullYear();
  const curKey     = curYear + '-' + String(curMonth + 1).padStart(2, '0');
  const prevMonth  = curMonth === 0 ? 11 : curMonth - 1;
  const prevYear   = curMonth === 0 ? curYear - 1 : curYear;
  const prevKey    = prevYear + '-' + String(prevMonth + 1).padStart(2, '0');

  const paidOrders = state.orders.filter(o => o.pay !== 'Gift');
  const giftOrders = state.orders.filter(o => o.pay === 'Gift');

  // ── Annual + monthly totals ──────────────────────────────────
  const annualTotal    = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  const curMonthTotal  = paidOrders.filter(o => getSaleMonthKey(o) === curKey)
                                   .reduce((s, o) => s + (o.total || 0), 0);
  const prevMonthTotal = paidOrders.filter(o => getSaleMonthKey(o) === prevKey)
                                   .reduce((s, o) => s + (o.total || 0), 0);

  const annualEl = document.getElementById('dash-annual');
  if (annualEl) annualEl.textContent = fmtMoney(annualTotal);

  const monthEl = document.getElementById('dash-month');
  if (monthEl) monthEl.textContent = fmtMoney(curMonthTotal);

  const annualSubEl = document.getElementById('dash-annual-sub');
  if (annualSubEl) {
    annualSubEl.textContent = paidOrders.length + ' paid sale' +
      (paidOrders.length !== 1 ? 's' : '');
  }

  const monthSubEl = document.getElementById('dash-month-sub');
  if (monthSubEl) {
    if (prevMonthTotal > 0) {
      const diff = curMonthTotal - prevMonthTotal;
      const pct  = Math.abs(Math.round((diff / prevMonthTotal) * 100));
      monthSubEl.innerHTML = diff >= 0
        ? `<span class="trend-up">↑ ${pct}%</span> vs last month`
        : `<span class="trend-down">↓ ${pct}%</span> vs last month`;
    } else {
      monthSubEl.textContent = 'no prior month data';
    }
  }

  // ── Per-SKU revenue rows ─────────────────────────────────────
  const revRowsHtml = state.skus.map(sku => {
    const soldQty = paidOrders.reduce((s, o) =>
      s + (o.items || []).filter(i => i.skuId === sku.id)
                         .reduce((a, i) => a + i.qty, 0), 0);
    const giftQty = giftOrders.reduce((s, o) =>
      s + (o.items || []).filter(i => i.skuId === sku.id)
                         .reduce((a, i) => a + i.qty, 0), 0);
    const skuRev  = paidOrders.reduce((s, o) =>
      s + (o.items || []).filter(i => i.skuId === sku.id)
                         .reduce((a, i) => a + i.qty * i.price, 0), 0);

    if (soldQty === 0 && giftQty === 0) return '';
    const giftBit = giftQty > 0
      ? ` <span class="rev-row-gift">· ${giftQty} gifted</span>`
      : '';
    return `<div class="rev-row">
      <span class="n">${esc(sku.name)}<span class="rev-row-meta">${soldQty} sold${giftBit}</span></span>
      <span class="a">${fmtMoney(skuRev)}</span>
    </div>`;
  }).filter(Boolean).join('');

  const revRowsEl = document.getElementById('rev-rows');
  if (revRowsEl) {
    revRowsEl.innerHTML = revRowsHtml ||
      '<div class="rev-row"><span class="n" style="opacity:.45">No paid sales yet</span></div>';
  }

  // ── Net total ────────────────────────────────────────────────
  const netRevenue = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  const totalRevEl = document.getElementById('total-rev');
  if (totalRevEl) totalRevEl.textContent = fmtMoney(netRevenue);

  // ── Gift line ────────────────────────────────────────────────
  const giftQtyMap = {};
  giftOrders.forEach(o =>
    (o.items || []).forEach(i => {
      giftQtyMap[i.skuId] = (giftQtyMap[i.skuId] || 0) + i.qty;
    })
  );
  const totalGiftQty = Object.values(giftQtyMap).reduce((a, b) => a + b, 0);
  const giftEl = document.getElementById('rev-gift-line');
  if (giftEl) {
    if (totalGiftQty > 0) {
      const giftVal = state.skus.reduce((s, sku) =>
        s + (giftQtyMap[sku.id] || 0) * sku.price, 0);
      giftEl.style.display = 'flex';
      giftEl.innerHTML = `
        <span class="gift-qty-label">🎁 ${totalGiftQty} bottle${totalGiftQty > 1 ? 's' : ''} gifted</span>
        <span class="gift-val-label">${fmtMoney(giftVal)} value</span>`;
    } else {
      giftEl.style.display = 'none';
    }
  }

  // ── Today's session summary ──────────────────────────────────
  const today       = now.toISOString().slice(0, 10);
  const todayOrders = state.orders.filter(o =>
    o.createdAt && o.createdAt.slice(0, 10) === today
  );
  const sessionEl = document.getElementById('session-content');
  if (sessionEl) {
    if (!todayOrders.length) {
      sessionEl.innerHTML = `<span style="font-size:10px; font-weight:700; letter-spacing:2px;
        text-transform:uppercase; color:var(--muted);">No sales today</span>`;
    } else {
      const sessionRev   = todayOrders.filter(o => o.pay !== 'Gift')
                                      .reduce((s, o) => s + (o.total || 0), 0);
      const sessionUnits = todayOrders.reduce((s, o) =>
        s + (o.items || []).reduce((a, i) => a + i.qty, 0), 0);
      sessionEl.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:baseline;">
          <span style="font-size:10px; font-weight:900; letter-spacing:2px;
            text-transform:uppercase; color:var(--muted);">
            ${todayOrders.length} sale${todayOrders.length !== 1 ? 's' : ''}
            · ${sessionUnits} bottle${sessionUnits !== 1 ? 's' : ''}
          </span>
          <span style="font-size:22px; font-weight:900;">${fmtMoney(sessionRev)}</span>
        </div>`;
    }
  }

  // Keep inventory in sync whenever dashboard re-renders
  if (typeof renderInventory === 'function') renderInventory();
}

// initDashboard() called from index.html after all scripts load
