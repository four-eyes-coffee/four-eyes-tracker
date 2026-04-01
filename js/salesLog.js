/* ============================================================
   FOUR EYES COFFEE — history/salesLog.js
   Sales history: month filter, accordion groups, edit, delete.
   ============================================================ */

function initSalesLog() {
  const panel = document.getElementById('inner-saleslog');
  if (!panel) return;

  panel.innerHTML = `
    <div class="hist-header" style="margin-top:8px;">
      <span class="hist-title">Sales History</span>
      <span class="hist-count" id="hist-count">0</span>
    </div>
    <div class="hist-filter-wrap">
      <select class="hist-filter" id="hist-filter" onchange="renderHistory()">
        <option value="current">This Month</option>
      </select>
    </div>
    <div id="hist-list">
      <div class="empty-state">No sales yet.</div>
    </div>
  `;
}

// ── Sale card builder ─────────────────────────────────────────────

function buildSaleCard(s) {
  const lines   = (s.items || []).map(i =>
    `<div class="sc-item-line"><b>${esc(i.skuName)}</b> ×${i.qty} — $${i.price * i.qty}</div>`
  ).join('');
  const bottles  = s.discount > 0 ? Math.round(s.discount / 3) : 0;
  const discTag  = bottles > 0
    ? `<span class="tag tdisc">${bottles} bottle${bottles > 1 ? 's' : ''} returned</span>`
    : '';
  const payClass = s.pay === 'Gift' ? ' gift' : '';

  return `<div class="sale-card">
    <div class="sc-top">
      <div class="sc-name">${esc(s.name)}</div>
      <div class="sc-amt">
        ${fmtMoney(s.total)}
        ${s.discount > 0
          ? `<span class="sc-disc-tag">&#x2212;$${s.discount} (${Math.round(s.discount/3)} returned)</span>`
          : ''}
      </div>
    </div>
    <div class="sc-items">${lines}</div>
    <div class="sc-bot">
      <div class="sc-tags">
        <span class="tag tpay${payClass}">${esc(s.pay)}</span>
        ${discTag}
        <span class="tag ttime">${esc(s.time)}</span>
      </div>
      <div class="sc-actions">
        <button class="edit-btn" onclick="openEditSale(${s.id})">Edit</button>
        <button class="del-btn"  onclick="deleteSale(${s.id})">&#x2715;</button>
      </div>
    </div>
  </div>`;
}

// ── History render ────────────────────────────────────────────────

function renderHistory() {
  const list     = document.getElementById('hist-list');
  const filterEl = document.getElementById('hist-filter');
  if (!list || !filterEl) return;

  const now    = new Date();
  const curKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

  // Build sorted unique month keys from all orders
  const allKeys = [...new Set(state.orders.map(getSaleMonthKey))].sort().reverse();

  // Rebuild dropdown, preserving current selection
  const prevSel = filterEl.value;
  filterEl.innerHTML = '<option value="all">All Time</option>' +
    allKeys.map(k => `<option value="${k}">${getMonthLabel(k)}</option>`).join('');

  if (!prevSel || prevSel === 'current') {
    filterEl.value = allKeys.includes(curKey) ? curKey : 'all';
  } else if (prevSel === 'all' || allKeys.includes(prevSel)) {
    filterEl.value = prevSel;
  } else {
    filterEl.value = allKeys.includes(curKey) ? curKey : 'all';
  }

  const selKey     = filterEl.value;
  const keysToShow = selKey === 'all'
    ? allKeys
    : (allKeys.includes(selKey) ? [selKey] : []);

  // Count badge
  const countEl = document.getElementById('hist-count');
  if (countEl) countEl.textContent = state.orders.length;

  if (!state.orders.length) {
    list.innerHTML = '<div class="empty-state">No sales yet.</div>';
    return;
  }
  if (!keysToShow.length) {
    list.innerHTML = '<div class="empty-state">No sales for this period.</div>';
    return;
  }

  list.innerHTML = keysToShow.map(key => {
    const orders = state.orders.filter(o => getSaleMonthKey(o) === key);
    if (!orders.length) return '';

    const monthTotal = orders
      .filter(o => o.pay !== 'Gift')
      .reduce((sum, o) => sum + (o.total || 0), 0);
    const isOpen = key === curKey;
    const label  = getMonthLabel(key);

    return `<div class="month-group">
      <div class="month-group-hdr${isOpen ? ' open' : ''}" onclick="toggleMonthGroup(this)">
        <div class="month-group-left">
          <span class="month-group-name">${label}</span>
          <span class="month-group-meta">
            ${orders.length} sale${orders.length !== 1 ? 's' : ''} · ${fmtMoney(monthTotal)}
          </span>
        </div>
        <span class="month-group-chevron">&#x25BE;</span>
      </div>
      <div class="month-group-body" style="${isOpen ? '' : 'display:none'}">
        ${orders.map(buildSaleCard).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleMonthGroup(hdr) {
  const body   = hdr.nextElementSibling;
  const isOpen = hdr.classList.contains('open');
  hdr.classList.toggle('open', !isOpen);
  body.style.display = isOpen ? 'none' : 'block';
}

// ── Edit sale ─────────────────────────────────────────────────────

function openEditSale(id) {
  const s = state.orders.find(x => x.id === id);
  if (!s) return;

  document.getElementById('esm-id').value   = id;
  document.getElementById('esm-name').value = s.name;

  // Normalize to valid select options
  const validPay = ['Venmo', 'Cash', 'Zelle', 'Card', 'Gift'];
  document.getElementById('esm-pay').value = validPay.includes(s.pay) ? s.pay : 'Venmo';

  document.getElementById('esm-discount').value =
    s.discount > 0 ? Math.round(s.discount / 3) : 0;

  document.getElementById('esm-items-wrap').innerHTML = (s.items || []).map((item, idx) =>
    `<div class="field">
      <label>${esc(item.skuName)} qty</label>
      <input type="number" id="esm-qty-${idx}" value="${item.qty}" min="1" inputmode="numeric">
    </div>`
  ).join('');

  document.getElementById('sale-modal').classList.add('open');
}

async function saveSaleEdit() {
  const id   = parseInt(document.getElementById('esm-id').value);
  const name = document.getElementById('esm-name').value.trim();
  const pay  = document.getElementById('esm-pay').value;
  const disc = (parseInt(document.getElementById('esm-discount').value) || 0) * 3;

  if (!name || !pay) { alert('Fill in all fields.'); return; }

  const s = state.orders.find(x => x.id === id);
  if (!s) return;

  // Revert inventory to pre-edit state
  (s.items || []).forEach(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    if (sku) sku.sold = Math.max(0, sku.sold - item.qty);
  });

  // Validate and apply new quantities
  let valid = true;
  (s.items || []).forEach((item, i) => {
    const newQty = parseInt(document.getElementById(`esm-qty-${i}`).value) || 1;
    const sku    = state.skus.find(sk => sk.id === item.skuId);
    if (sku && sku.sold + newQty > sku.stock) {
      alert(`Not enough stock for ${item.skuName}`);
      valid = false;
    } else {
      item.qty = newQty;
      if (sku) sku.sold += newQty;
    }
  });
  if (!valid) return;

  const subtotal = (s.items || []).reduce((sum, i) => sum + i.price * i.qty, 0);
  s.name     = name;
  s.pay      = pay;
  s.discount = disc;
  s.total    = Math.max(0, subtotal - disc);

  closeSaleModal();
  saveLocal();
  renderDashboard();
  renderHistory();

  dbUpdateOrder(s).catch(e => console.error('Update order failed:', e));
}

async function deleteSale(id) {
  const idx = state.orders.findIndex(o => o.id === id);
  if (idx === -1) return;

  // Revert sold counts
  (state.orders[idx].items || []).forEach(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    if (sku) sku.sold = Math.max(0, sku.sold - item.qty);
  });

  state.orders.splice(idx, 1);
  saveLocal();
  renderDashboard();
  renderHistory();

  dbDeleteOrder(id).catch(e => console.error('Delete order failed:', e));
}

function closeSaleModal() {
  document.getElementById('sale-modal').classList.remove('open');
}

// Backdrop click to close
const _saleModal = document.getElementById('sale-modal');
if (_saleModal) {
  _saleModal.addEventListener('click', function(e) {
    if (e.target === this) closeSaleModal();
  });
}

// initSalesLog() called from index.html after all scripts load
