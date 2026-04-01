/* ============================================================
   FOUR EYES COFFEE — dashboard.js
   Revenue summary panel. Inventory lives in Store Hub.
   ============================================================ */

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
  const totalRevenue   = paidOrders.reduce((s, o) => s + (o.total || 0), 0);
  const curMonthTotal  = paidOrders.filter(o => getSaleMonthKey(o) === curKey)
                                   .reduce((s, o) => s + (o.total || 0), 0);
  const prevMonthTotal = paidOrders.filter(o => getSaleMonthKey(o) === prevKey)
                                   .reduce((s, o) => s + (o.total || 0), 0);

  const annualEl = document.getElementById('dash-annual');
  if (annualEl) annualEl.textContent = fmtMoney(totalRevenue);

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
  const totalRevEl = document.getElementById('total-rev');
  if (totalRevEl) totalRevEl.textContent = fmtMoney(totalRevenue);

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

}

