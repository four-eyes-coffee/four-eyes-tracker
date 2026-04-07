/* ============================================================
   FOUR EYES COFFEE — dashboard.js
   Revenue summary panel. Inventory lives in Store Hub.
   ============================================================ */

function renderDashboard() {
  const now     = new Date();
  const curKey  = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey  = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0');

  // ── Single-pass SKU stats ────────────────────────────────────
  // Build per-SKU sold/gifted/revenue from orders in one iteration
  // rather than triple-filtering paidOrders per SKU.
  const skuStats = {}; // { skuId: { soldQty, giftQty, rev } }
  let totalRevenue  = 0;
  let curMonthTotal = 0;
  let prevMonthTotal = 0;
  let totalPaidCount = 0;

  state.orders.forEach(o => {
    const isGift   = o.pay === 'Gift';
    const monthKey = getSaleMonthKey(o);
    const total    = o.total || 0;

    if (!isGift) {
      totalRevenue  += total;
      totalPaidCount++;
      if (monthKey === curKey)  curMonthTotal  += total;
      if (monthKey === prevKey) prevMonthTotal += total;
    }

    (o.items || []).forEach(i => {
      if (!skuStats[i.skuId]) skuStats[i.skuId] = { soldQty: 0, giftQty: 0, rev: 0 };
      if (isGift) {
        skuStats[i.skuId].giftQty += i.qty;
      } else {
        skuStats[i.skuId].soldQty += i.qty;
        skuStats[i.skuId].rev    += i.qty * i.price;
      }
    });
  });

  // ── Annual + monthly totals ──────────────────────────────────
  const annualEl = document.getElementById('dash-annual');
  if (annualEl) annualEl.textContent = fmtMoney(totalRevenue);

  const monthEl = document.getElementById('dash-month');
  if (monthEl) monthEl.textContent = fmtMoney(curMonthTotal);

  const annualSubEl = document.getElementById('dash-annual-sub');
  if (annualSubEl) {
    annualSubEl.textContent = totalPaidCount + ' paid sale' + (totalPaidCount !== 1 ? 's' : '');
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
    const s = skuStats[sku.id];
    if (!s || (s.soldQty === 0 && s.giftQty === 0)) return '';
    const giftBit = s.giftQty > 0
      ? ` <span class="rev-row-gift">· ${s.giftQty} gifted</span>`
      : '';
    return `<div class="rev-row">
      <span class="n">${esc(sku.name)}<span class="rev-row-meta">${s.soldQty} sold${giftBit}</span></span>
      <span class="a">${fmtMoney(s.rev)}</span>
    </div>`;
  }).filter(Boolean).join('');

  const revRowsEl = document.getElementById('rev-rows');
  if (revRowsEl) {
    revRowsEl.innerHTML = revRowsHtml ||
      '<div class="rev-row"><span class="n" style="opacity:.45">No paid sales yet</span></div>';
  }

  const totalRevEl = document.getElementById('total-rev');
  if (totalRevEl) totalRevEl.textContent = fmtMoney(totalRevenue);

  // ── Gift line ────────────────────────────────────────────────
  const totalGiftQty = Object.values(skuStats).reduce((a, s) => a + s.giftQty, 0);
  const giftEl = document.getElementById('rev-gift-line');
  if (giftEl) {
    if (totalGiftQty > 0) {
      const giftVal = state.skus.reduce((sum, sku) =>
        sum + (skuStats[sku.id]?.giftQty || 0) * sku.price, 0);
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

  // ── P&L card ─────────────────────────────────────────────────
  renderPnL(skuStats, totalRevenue);
}

// ── P&L card ──────────────────────────────────────────────────────

function calcPnL(skuStats, totalRevenue) {
  // Weighted average cost per bottle per SKU across all 'For Sale' batches
  const skuTotals = {}; // { skuId: { totalCost, totalBottles } }
  (state.batches || [])
    .filter(b => (b.batch_type || 'production') !== 'test' && b.sku_id)
    .forEach(b => {
      if (!skuTotals[b.sku_id]) skuTotals[b.sku_id] = { totalCost: 0, totalBottles: 0 };
      skuTotals[b.sku_id].totalCost    += parseFloat(b.total_cogs)        || 0;
      skuTotals[b.sku_id].totalBottles += parseFloat(b.bottles_produced)  || 0;
    });

  // COGS = units sold per SKU × weighted avg cost/bottle for that SKU
  let totalCogs    = 0;
  let hasBatchData = false;
  state.skus.forEach(sku => {
    const t = skuTotals[sku.id];
    if (!t || t.totalBottles === 0) return;
    hasBatchData = true;
    const cpb     = t.totalCost / t.totalBottles;
    const soldQty = skuStats[sku.id]?.soldQty || 0;
    totalCogs    += soldQty * cpb;
  });

  const grossProfit = totalRevenue - totalCogs;
  const marginPct   = totalRevenue > 0 ? (grossProfit / totalRevenue * 100) : null;
  const totalEquip  = (state.equipment || []).reduce((s, e) => s + (parseFloat(e.amount_paid) || 0), 0);

  return { totalCogs, grossProfit, marginPct, totalEquip, hasBatchData };
}

function renderPnL(skuStats, totalRevenue) {
  const card = document.getElementById('pnl-card');
  if (!card) return;

  const { totalCogs, grossProfit, marginPct, totalEquip, hasBatchData } = calcPnL(skuStats, totalRevenue);

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  set('pnl-revenue', fmtMoney(totalRevenue));
  set('pnl-cogs',    hasBatchData ? `− ${fmtMoney(totalCogs)}` : '—');
  set('pnl-profit',  hasBatchData ? fmtMoney(grossProfit) : '—');
  set('pnl-margin',  marginPct !== null && hasBatchData
    ? `${marginPct.toFixed(1)}% gross margin`
    : 'Add batch logs in COGS to calculate margin');

  const equipRow = document.getElementById('pnl-equip-row');
  if (equipRow) {
    equipRow.style.display = totalEquip > 0 ? 'flex' : 'none';
    set('pnl-equip', fmtMoney(totalEquip));
  }

  // Colour gross profit — yellow if positive, blue if negative
  const profitEl = document.getElementById('pnl-profit');
  if (profitEl) {
    profitEl.style.color = grossProfit >= 0 ? 'var(--yellow)' : 'var(--blue)';
  }
}
