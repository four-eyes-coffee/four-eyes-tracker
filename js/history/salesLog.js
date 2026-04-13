/* ============================================================
   FOUR EYES COFFEE — history/salesLog.js
   Sales history: month filter, accordion groups, edit, delete.
   Edit Sale modal mirrors the New Sale UX — full cart editing.
   ============================================================ */

// ── Edit modal state ─────────────────────────────────────────────

let _editSaleId      = null;
let _editCart        = [];      // [{ skuId, skuName, qty, price }]
let _editPay         = null;
let _editReturns     = 0;
let _editName        = '';
let _editOriginal    = null;    // snapshot for inventory rollback

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

// ── Edit Sale — open modal (mirrors New Sale UX) ─────────────────

function openEditSale(id) {
  const s = state.orders.find(x => x.id === id);
  if (!s) return;

  _editSaleId   = id;
  _editName     = s.name;
  _editPay      = s.pay;
  _editReturns  = s.discount > 0 ? Math.round(s.discount / 3) : 0;
  _editCart     = (s.items || []).map(i => ({
    skuId:   i.skuId,
    skuName: i.skuName,
    qty:     i.qty,
    price:   i.price
  }));

  // Snapshot original for inventory rollback
  _editOriginal = {
    items:    (s.items || []).map(i => ({ ...i })),
    pay:      s.pay,
    discount: s.discount,
    total:    s.total,
    name:     s.name
  };

  _renderEditSaleModal();
  document.getElementById('sale-modal').classList.add('open');
}

function _renderEditSaleModal() {
  const modal = document.getElementById('sale-modal-inner');
  if (!modal) return;

  const payMethods = ['Cash', 'Venmo', 'Zelle', 'Card', 'Gift'];

  modal.innerHTML = `
    <div class="modal-hdr">
      <span>Edit Sale</span>
      <button class="modal-close" onclick="closeSaleModal()">&#x2715;</button>
    </div>

    <div class="field">
      <label>Customer Name</label>
      <input type="text" id="esm-name" value="${esc(_editName)}" autocomplete="off">
    </div>

    <div class="fsec" style="margin-top:16px;">Items</div>
    <div id="esm-cart-items"></div>
    <div class="fsec" style="margin-top:12px; font-size:11px; opacity:.6;">Add Flavor</div>
    <div id="esm-flavor-picker" class="flavor-picker"></div>

    <div class="fsec" style="margin-top:16px;">Payment</div>
    <div class="pay-pills" id="esm-pay-pills">
      ${payMethods.map(m =>
        `<button class="pay-pill${_editPay === m ? ' selected' : ''}" onclick="editSelectPay('${m}', this)">${m}</button>`
      ).join('')}
    </div>

    <div class="fsec" style="margin-top:16px;">Bottles Returned</div>
    <div class="discount-row">
      <button class="ibtn" onclick="editChangeReturns(-1)" type="button">&#x2212;</button>
      <span class="item-qty f-returns" id="esm-returns">${_editReturns}</span>
      <button class="ibtn" onclick="editChangeReturns(1)" type="button">+</button>
      <span class="returns-hint">&#x2212;$3 each</span>
    </div>

    <div class="order-summary" style="margin-top:16px;">
      <span class="ol">Total</span>
      <span class="ov" id="esm-total">$0</span>
    </div>

    <button class="modal-save" onclick="saveSaleEdit()">Save Changes</button>
    <button class="modal-del"  onclick="deleteSaleFromModal()">Delete Sale</button>
  `;

  _renderEditCartItems();
  _renderEditFlavorPicker();
  _updateEditTotal();
}

// ── Edit Sale — cart items rendering ─────────────────────────────

function _renderEditCartItems() {
  const list = document.getElementById('esm-cart-items');
  if (!list) return;
  if (!_editCart.length) {
    list.innerHTML = '<div style="padding:8px 0;opacity:.4;font-size:12px;">No items — add a flavor below</div>';
    return;
  }
  list.innerHTML = _editCart.map(item => {
    const sku = state.skus.find(s => s.id === item.skuId);
    const displayName = sku ? sku.name : item.skuName;
    const displayPrice = item.price;
    return `<div class="item-row">
      <div class="item-row-left">
        <div class="item-row-name">${esc(displayName)}</div>
        <div class="item-row-price">$${displayPrice} &times; ${item.qty} = $${displayPrice * item.qty}</div>
      </div>
      <div class="item-row-controls">
        <button class="ibtn" onclick="editChangeQty(${item.skuId}, -1)">&#x2212;</button>
        <span class="item-qty">${item.qty}</span>
        <button class="ibtn" onclick="editChangeQty(${item.skuId}, 1)">+</button>
        <button class="item-remove" onclick="editRemoveFromCart(${item.skuId})">&#x2715;</button>
      </div>
    </div>`;
  }).join('');
}

// ── Edit Sale — flavor picker ────────────────────────────────────

function _renderEditFlavorPicker() {
  const picker = document.getElementById('esm-flavor-picker');
  if (!picker) return;
  const addedIds = _editCart.map(c => c.skuId);
  picker.innerHTML = state.skus
    .filter(s => (s.sku_type || 'production') === 'production')
    .map(sku => {
      // Available stock = total stock minus sold, but add back the original qty
      // for this sale (since editing — those bottles aren't "gone" yet)
      const origItem = (_editOriginal?.items || []).find(i => i.skuId === sku.id);
      const origQty  = origItem ? origItem.qty : 0;
      const rem      = (sku.stock - sku.sold) + origQty;
      const isAdded  = addedIds.includes(sku.id);
      const isOut    = rem === 0;
      const dis      = (isOut || isAdded) ? ' disabled' : '';
      const cls      = isAdded ? ' added' : '';
      const sub      = isAdded ? 'added' : isOut ? 'sold out' : `${rem} left · $${sku.price}`;
      return `<button class="flavor-btn${cls}"${dis} onclick="editAddToCart(${sku.id})">
        <span class="fn">${esc(sku.name)}</span>
        <span class="fs">${sub}</span>
      </button>`;
    }).join('');
}

// ── Edit Sale — cart actions ─────────────────────────────────────

function editAddToCart(skuId) {
  if (_editCart.find(c => c.skuId === skuId)) return;
  const sku = state.skus.find(s => s.id === skuId);
  if (!sku) return;
  _editCart.push({ skuId: sku.id, skuName: sku.name, qty: 1, price: sku.price });
  _renderEditCartItems();
  _renderEditFlavorPicker();
  _updateEditTotal();
}

function editChangeQty(skuId, delta) {
  const item = _editCart.find(c => c.skuId === skuId);
  if (!item) return;
  const sku      = state.skus.find(s => s.id === skuId);
  // Max available = (stock - sold) + original qty from this sale
  const origItem = (_editOriginal?.items || []).find(i => i.skuId === skuId);
  const origQty  = origItem ? origItem.qty : 0;
  const maxAvail = sku ? (sku.stock - sku.sold) + origQty : 99;
  const newQty   = item.qty + delta;
  if (newQty < 1)        { editRemoveFromCart(skuId); return; }
  if (newQty > maxAvail) return;
  item.qty = newQty;
  _renderEditCartItems();
  _updateEditTotal();
}

function editRemoveFromCart(skuId) {
  _editCart = _editCart.filter(c => c.skuId !== skuId);
  _renderEditCartItems();
  _renderEditFlavorPicker();
  _updateEditTotal();
}

function editSelectPay(method, el) {
  _editPay = method;
  document.querySelectorAll('#esm-pay-pills .pay-pill').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
  _updateEditTotal();
}

function editChangeReturns(delta) {
  const newVal = _editReturns + delta;
  if (newVal < 0) return;
  _editReturns = newVal;
  const el = document.getElementById('esm-returns');
  if (el) el.textContent = newVal;
  _updateEditTotal();
}

function _updateEditTotal() {
  const el = document.getElementById('esm-total');
  if (!el) return;
  if (_editPay === 'Gift') { el.textContent = '$0'; return; }
  const subtotal = _editCart.reduce((sum, item) => sum + item.price * item.qty, 0);
  el.textContent = fmtMoney(Math.max(0, subtotal - _editReturns * 3));
}

// ── Edit Sale — save ─────────────────────────────────────────────

async function saveSaleEdit() {
  const name = document.getElementById('esm-name').value.trim();
  if (!name)           { alert('Enter a customer name.');    return; }
  if (!_editCart.length){ alert('Add at least one item.');   return; }
  if (!_editPay)       { alert('Select a payment method.'); return; }

  const s = state.orders.find(x => x.id === _editSaleId);
  if (!s) return;

  // Revert old inventory counts
  (_editOriginal.items || []).forEach(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    if (sku) sku.sold = Math.max(0, sku.sold - item.qty);
  });

  // Validate and apply new inventory counts
  let valid = true;
  _editCart.forEach(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    if (sku && sku.sold + item.qty > sku.stock) {
      alert(`Not enough stock for ${item.skuName}`);
      valid = false;
    }
  });

  if (!valid) {
    // Re-apply original sold counts (undo revert)
    (_editOriginal.items || []).forEach(item => {
      const sku = state.skus.find(sk => sk.id === item.skuId);
      if (sku) sku.sold += item.qty;
    });
    return;
  }

  // Apply new sold counts
  _editCart.forEach(item => {
    const sku = state.skus.find(sk => sk.id === item.skuId);
    if (sku) sku.sold += item.qty;
  });

  const disc     = _editReturns * 3;
  const subtotal = _editCart.reduce((sum, i) => sum + i.price * i.qty, 0);
  const total    = _editPay === 'Gift' ? 0 : Math.max(0, subtotal - disc);

  // Update the order object
  s.name     = name;
  s.pay      = _editPay;
  s.discount = disc;
  s.total    = total;
  s.items    = _editCart.map(c => ({
    skuId:   c.skuId,
    skuName: c.skuName,
    qty:     c.qty,
    price:   c.price
  }));

  // Persist to Supabase
  try {
    // Update sold counts for all affected SKUs
    const affectedSkuIds = new Set([
      ...(_editOriginal.items || []).map(i => i.skuId),
      ..._editCart.map(c => c.skuId)
    ]);
    const skuUpdates = [...affectedSkuIds].map(skuId => {
      const sku = state.skus.find(sk => sk.id === skuId);
      return sku
        ? dbUpdateSkuSold(sku.id, sku.sold).catch(e => console.error('Update sold failed:', e))
        : Promise.resolve();
    });

    // Delete old order_items and insert new ones (handles adds/removes)
    await Promise.all([
      ...skuUpdates,
      dbUpdateOrderFull(s).catch(e => console.error('Update order failed:', e))
    ]);
  } catch(e) {
    console.error('Save edit failed:', e);
  }

  closeSaleModal();
  saveLocal();
  renderDashboard();
  renderHistory();
}

// Delete from inside the edit modal
async function deleteSaleFromModal() {
  const id = _editSaleId;
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
  _editSaleId   = null;
  _editCart      = [];
  _editPay       = null;
  _editReturns   = 0;
  _editName      = '';
  _editOriginal  = null;
}
