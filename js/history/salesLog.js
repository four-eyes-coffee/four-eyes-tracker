/* ============================================================
   FOUR EYES COFFEE — history/salesLog.js
   Sales history: month filter, accordion groups, edit, delete.
   ============================================================ */

// ── Sale card builder ─────────────────────────────────────────────

function buildSaleCard(s) {
  const isGift  = s.pay === 'Gift';
  const bottles = s.discount > 0 ? Math.round(s.discount / 3) : 0;

  const lines = (s.items || []).map(i =>
    `<div class="sc-item-line">
      <span><b>${esc(i.skuName)}</b> ×${i.qty}</span>
      <span class="sc-item-price">$${i.price * i.qty}</span>
    </div>`
  ).join('');

  const discBlock = bottles > 0
    ? `<span class="sc-disc-tag">&#x2212;$${s.discount} · ${bottles} bottle${bottles > 1 ? 's' : ''} returned</span>`
    : '';

  return `<div class="sale-card">
    <div class="sc-top">
      <div class="sc-name">${esc(s.name)}</div>
      <div class="sc-amt${isGift ? ' gift' : ''}">
        ${fmtMoney(s.total)}
        ${discBlock}
      </div>
    </div>
    <div class="sc-items">${lines}</div>
    <div class="sc-bot">
      <div class="sc-tags">
        <span class="tag tpay${isGift ? ' gift' : ''}">${esc(s.pay)}</span>
        ${bottles > 0 ? `<span class="tag tdisc">${bottles} returned</span>` : ''}
        <span class="tag ttime">${esc(s.time)}</span>
      </div>
      <button class="edit-btn" onclick="openEditSale(${s.id})">Edit</button>
    </div>
  </div>`;
}

// ── History render ────────────────────────────────────────────────

function renderHistory() {
  const list     = document.getElementById('hist-list');
  const filterEl = document.getElementById('hist-filter');
  if (!list || !filterEl) return;

  const curKey     = currentMonthKey();

  const allKeys    = [...new Set(state.orders.map(getSaleMonthKey))].sort().reverse();
  const defaultKey = allKeys.includes(curKey) ? curKey : 'all';

  // Rebuild dropdown, preserving a valid prior selection
  const prevSel = filterEl.value;
  filterEl.innerHTML = '<option value="all">All Time</option>' +
    allKeys.map(k => `<option value="${k}">${getMonthLabel(k)}</option>`).join('');

  filterEl.value = (!prevSel || prevSel === 'current')
    ? defaultKey
    : (prevSel === 'all' || allKeys.includes(prevSel)) ? prevSel : defaultKey;

  const selKey     = filterEl.value;
  const keysToShow = selKey === 'all' ? allKeys : (allKeys.includes(selKey) ? [selKey] : []);

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

    return `<div class="month-group">
      <div class="month-group-hdr${isOpen ? ' open' : ''}" onclick="toggleMonthGroup(this)">
        <div class="month-group-left">
          <span class="month-group-name">${getMonthLabel(key)}</span>
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
  const isOpen = hdr.classList.contains('open');
  hdr.classList.toggle('open', !isOpen);
  hdr.nextElementSibling.style.display = isOpen ? 'none' : 'block';
}

// ── Edit sale ─────────────────────────────────────────────────────

function openEditSale(id) {
  const s = state.orders.find(x => x.id === id);
  if (!s) return;

  document.getElementById('esm-id').value   = id;
  document.getElementById('esm-name').value = s.name;

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

  // Persist sold counts + order update in parallel
  const skuUpdates = (s.items || []).map(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    return sku
      ? dbUpdateSkuSold(sku.id, sku.sold).catch(e => console.error('Update sold failed:', e))
      : Promise.resolve();
  });
  await Promise.all([
    ...skuUpdates,
    dbUpdateOrder(s).catch(e => console.error('Update order failed:', e))
  ]);

  closeSaleModal();
  saveLocal();
  renderDashboard();
  renderHistory();
}

// Delete from inside the edit modal
async function deleteSaleFromModal() {
  const id = parseInt(document.getElementById('esm-id').value);
  closeSaleModal();
  await deleteSale(id);
}

async function deleteSale(id) {
  const idx = state.orders.findIndex(o => o.id === id);
  if (idx === -1) return;

  // Revert sold counts + delete from Supabase in parallel
  const skuUpdates = (state.orders[idx].items || []).map(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    if (!sku) return Promise.resolve();
    sku.sold = Math.max(0, sku.sold - item.qty);
    return dbUpdateSkuSold(sku.id, sku.sold).catch(e => console.error('Update sold failed:', e));
  });

  await Promise.all([
    ...skuUpdates,
    dbDeleteOrder(id).catch(e => console.error('Delete order failed:', e))
  ]);

  state.orders.splice(idx, 1);
  saveLocal();
  renderDashboard();
  renderHistory();
}

function closeSaleModal() {
  document.getElementById('sale-modal').classList.remove('open');
}
