/* ============================================================
   FOUR EYES COFFEE — newSale.js
   Walk-up sale flow: cart, payment, bottle returns, submit.
   Also handles pending order approval from order.html.
   Email confirmations are handled by the Supabase DB trigger —
   JS only shows toast feedback after the sale is saved.
   ============================================================ */

let cart              = [];
let formPay           = null;
let formReturns       = 0;
let pendingModalOrder = null;
let pendingModalItems = []; // mutable copy of order_items for editing
let pendingModalReturns = 0;
let _pendingOrders    = []; // cache — avoids re-fetch on "View & Approve"

// ── Flavor picker + cart rendering ───────────────────────────────

function renderSaleForm() {
  renderFlavorPicker();
  renderCartItems();
  updateOrderTotal();
}

function renderFlavorPicker() {
  const picker = document.getElementById('flavor-picker');
  if (!picker) return;
  const addedIds = cart.map(c => c.skuId);
  picker.innerHTML = state.skus
    .filter(s => (s.sku_type || 'production') === 'production')
    .map(sku => {
      const rem     = sku.stock - sku.sold;
      const isAdded = addedIds.includes(sku.id);
      const isOut   = rem === 0;
      const dis     = (isOut || isAdded) ? ' disabled' : '';
      const cls     = isAdded ? ' added' : '';
      const sub     = isAdded ? 'added' : isOut ? 'sold out' : `${rem} left · $${sku.price}`;
      return `<button class="flavor-btn${cls}"${dis} onclick="addToCart(${sku.id})">
        <span class="fn">${esc(sku.name)}</span>
        <span class="fs">${sub}</span>
      </button>`;
    }).join('');
}

function renderCartItems() {
  const list = document.getElementById('items-list');
  if (!list) return;
  if (!cart.length) { list.innerHTML = ''; return; }
  list.innerHTML = cart.map(item => {
    const sku = state.skus.find(s => s.id === item.skuId);
    if (!sku) return '';
    return `<div class="item-row">
      <div class="item-row-left">
        <div class="item-row-name">${esc(sku.name)}</div>
        <div class="item-row-price">$${sku.price} &times; ${item.qty} = $${sku.price * item.qty}</div>
      </div>
      <div class="item-row-controls">
        <button class="ibtn" onclick="changeQty(${sku.id}, -1)">&#x2212;</button>
        <span class="item-qty">${item.qty}</span>
        <button class="ibtn" onclick="changeQty(${sku.id}, 1)">+</button>
        <button class="item-remove" onclick="removeFromCart(${sku.id})">&#x2715;</button>
      </div>
    </div>`;
  }).join('');
}

// ── Cart actions ──────────────────────────────────────────────────

function addToCart(skuId) {
  if (cart.find(c => c.skuId === skuId)) return;
  cart.push({ skuId, qty: 1 });
  renderFlavorPicker();
  renderCartItems();
  updateOrderTotal();
}

function changeQty(skuId, delta) {
  const item = cart.find(c => c.skuId === skuId);
  if (!item) return;
  const sku      = state.skus.find(s => s.id === skuId);
  const maxAvail = sku ? (sku.stock - sku.sold) : 99;
  const newQty   = item.qty + delta;
  if (newQty < 1)        { removeFromCart(skuId); return; }
  if (newQty > maxAvail) return;
  item.qty = newQty;
  renderCartItems();
  updateOrderTotal();
}

function removeFromCart(skuId) {
  cart = cart.filter(c => c.skuId !== skuId);
  renderFlavorPicker();
  renderCartItems();
  updateOrderTotal();
}

function selectPay(method, el) {
  formPay = method;
  document.querySelectorAll('.pay-pill').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
  updateOrderTotal();
}

function changeReturns(delta) {
  const newVal = formReturns + delta;
  if (newVal < 0) return;
  formReturns = newVal;
  const el = document.getElementById('f-returns');
  if (el) el.textContent = newVal;
  updateOrderTotal();
}

function updateOrderTotal() {
  const el = document.getElementById('order-total');
  if (!el) return;
  if (formPay === 'Gift') { el.textContent = '$0'; return; }
  const subtotal = cart.reduce((sum, item) => {
    const sku = state.skus.find(s => s.id === item.skuId);
    return sum + (sku ? sku.price * item.qty : 0);
  }, 0);
  el.textContent = fmtMoney(Math.max(0, subtotal - formReturns * 3));
}

// ── Email status (persistent — shown on success screen + pending cards) ──

function setSuccessEmailStatus(email) {
  const el = document.getElementById('success-email-status');
  if (!el) return;
  if (email) {
    el.className = 'success-email-status status-sent';
    el.innerHTML = `✉ &nbsp;EMAIL SENT`;
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

function emailStatusTag(email) {
  if (email) {
    return `<span class="status-tag sent" style="margin-bottom:12px;">✉ &nbsp;EMAIL SENT</span>`;
  }
  return '';
}

// ── Sale submission ───────────────────────────────────────────────

async function logSale() {
  const name  = document.getElementById('f-name').value.trim();
  const email = document.getElementById('f-email').value.trim();
  if (!name)        { alert('Enter a customer name.');    return; }
  if (!cart.length) { alert('Add at least one item.');    return; }
  if (!formPay)     { alert('Select a payment method.'); return; }

  const disc     = formReturns * 3;
  const subtotal = cart.reduce((sum, item) => {
    const sku = state.skus.find(s => s.id === item.skuId);
    return sum + (sku ? sku.price * item.qty : 0);
  }, 0);
  const total = formPay === 'Gift' ? 0 : Math.max(0, subtotal - disc);

  // Optimistically deduct sold counts
  cart.forEach(item => {
    const sku = state.skus.find(s => s.id === item.skuId);
    if (sku) {
      sku.sold += item.qty;
      dbUpdateSkuSold(sku.id, sku.sold).catch(e => console.error('Update sold failed:', e));
    }
  });

  const now  = new Date();
  const sale = {
    id:        Date.now(),
    name,
    email,
    items:     cart.map(c => {
      const sku = state.skus.find(s => s.id === c.skuId);
      return { skuId: c.skuId, skuName: sku ? sku.name : '?', qty: c.qty, price: sku ? sku.price : 0 };
    }),
    pay:       formPay,
    discount:  disc,
    total,
    time:      now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    createdAt: now.toISOString()
  };

  // Disable button to prevent double-submit
  const btn = document.querySelector('.submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

  try {
    state.orders.unshift(sale);
    saveLocal();

    // Await the DB save — email trigger fires after items insert
    await dbSaveOrder(sale);

    setSuccessEmailStatus(email);
    renderDashboard();
    if (typeof renderHistory === 'function') renderHistory();

    document.getElementById('sale-form-wrap').style.display = 'none';
    document.getElementById('sale-success').classList.add('show');
    document.getElementById('success-name').textContent = `${name} — ${fmtMoney(total)}`;
    const lines = sale.items.map(i => `${i.skuName} ×${i.qty}`).join(', ');
    document.getElementById('success-detail').textContent = lines +
      (formReturns > 0 ? ` · ${formReturns} bottle${formReturns > 1 ? 's' : ''} returned` : '');

  } catch (e) {
    console.error('Save order failed:', e);

    // Roll back optimistic updates
    state.orders.shift();
    saveLocal();
    cart.forEach(item => {
      const sku = state.skus.find(s => s.id === item.skuId);
      if (sku) {
        sku.sold -= item.qty;
        dbUpdateSkuSold(sku.id, sku.sold).catch(() => {});
      }
    });
    renderDashboard();

    alert('Failed to save order. Check your connection and try again.');

  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Log Sale'; }
  }
}

function logAnother() {
  cart = []; formPay = null; formReturns = 0;
  document.getElementById('f-name').value          = '';
  document.getElementById('f-email').value         = '';
  document.getElementById('f-returns').textContent = '0';
  setSuccessEmailStatus(null);
  document.querySelectorAll('.pay-pill').forEach(p => p.classList.remove('selected'));
  document.getElementById('sale-form-wrap').style.display = 'block';
  document.getElementById('sale-success').classList.remove('show');
  renderSaleForm();
}

// ── Pending orders (from order.html pre-orders) ───────────────────

async function loadPendingForNewSale() {
  const list    = document.getElementById('newsale-pending-list');
  const countEl = document.getElementById('newsale-pending-count');
  if (!list) return;

  try {
    _pendingOrders = await dbLoadPending();
    if (countEl) countEl.textContent = _pendingOrders.length;

    if (!_pendingOrders.length) {
      list.innerHTML = '<div class="no-pending-msg">No pending orders</div>';
      return;
    }

    list.innerHTML = _pendingOrders.map(o => {
      const lines       = (o.order_items || []).map(i => `${esc(i.sku_name)} ×${i.qty}`).join(', ');
      const windowLabel = o.fulfillment_type
        ? esc(o.fulfillment_type) + (o.fulfillment_window ? ' · ' + esc(o.fulfillment_window) : '')
        : '';
      const dropType  = (o.code_type === 'family') ? 'FAMILY' : 'PUBLIC';
      const dropClass = (o.code_type === 'family') ? 'drop-family' : 'drop-public';
      return `<div class="pending-card ${dropClass}">
        <div class="pending-card-top">
          <div class="pending-name">${esc(o.customer_name || '—')}</div>
          <div class="pending-window">
            <span class="drop-badge ${dropClass}">${dropType}</span>
            ${windowLabel}
          </div>
        </div>
        <div class="pending-items">${lines}</div>
        ${emailStatusTag(o.customer_email)}
        <div class="pending-actions">
          <button class="approve-btn" onclick="approveOrder(${o.id})">View &amp; Approve</button>
          <button class="reject-btn"  onclick="rejectPendingOrder(${o.id})">Decline</button>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('Load pending failed:', e);
  }
}

function approveOrder(id) {
  const order = _pendingOrders.find(o => o.id === id);
  if (order) {
    openPendingModal(order);
  } else {
    dbLoadPending().then(pending => {
      const o = pending.find(p => p.id === id);
      if (o) openPendingModal(o);
    }).catch(e => console.error('Approve order failed:', e));
  }
}

async function rejectPendingOrder(id) {
  try {
    await dbRejectOrder(id);
    loadPendingForNewSale();
    state.pendingQty = await dbLoadPendingCounts();
    renderDashboard();
  } catch(e) {
    console.error('Reject order failed:', e);
  }
}

// ── Pending modal ─────────────────────────────────────────────────

function openPendingModal(order) {
  pendingModalOrder   = order;
  pendingModalItems   = (order.order_items || []).map(i => ({ ...i }));
  pendingModalReturns = 0;

  document.getElementById('pm-id').value            = order.id;
  document.getElementById('pm-name').textContent    = order.customer_name || '—';
  document.getElementById('pm-contact').textContent =
    (order.fulfillment_type || '') +
    (order.fulfillment_window ? ' · ' + order.fulfillment_window : '');
  document.getElementById('pm-pay').value   = '';
  document.getElementById('pm-notes').value = order.notes || '';
  document.getElementById('pm-returns').textContent = '0';

  renderPendingModalItems();
  renderPendingModalFlavors();
  updatePendingTotal();

  document.getElementById('pending-modal').classList.add('open');
}

function renderPendingModalItems() {
  const el = document.getElementById('pm-items');
  if (!el) return;
  el.innerHTML = '<div class="modal-items-label">Items</div>' +
    pendingModalItems.map(i =>
      `<div class="pending-modal-item" id="pmi-${i.sku_id}">
        <span class="pk">${esc(i.sku_name)}</span>
        <div class="pmi-controls">
          <button class="ibtn" onclick="changePendingItemQty(${i.sku_id}, -1)">&#x2212;</button>
          <span class="item-qty" id="pmi-qty-${i.sku_id}">${i.qty}</span>
          <button class="ibtn" onclick="changePendingItemQty(${i.sku_id}, 1)">+</button>
          <span class="pv" id="pmi-price-${i.sku_id}">$${parseFloat(i.price) * i.qty}</span>
          <button class="item-remove" onclick="removePendingItem(${i.sku_id})">&#x2715;</button>
        </div>
      </div>`
    ).join('');
}

function renderPendingModalFlavors() {
  const wrap   = document.getElementById('pm-add-flavor-wrap');
  const picker = document.getElementById('pm-flavor-picker');
  if (!wrap || !picker) return;

  const inOrderIds = new Set(pendingModalItems.map(i => i.sku_id));
  const available  = state.skus.filter(s =>
    (s.sku_type || 'production') === 'production' && !inOrderIds.has(s.id)
  );

  wrap.style.display = available.length ? 'block' : 'none';
  if (!available.length) { picker.innerHTML = ''; return; }

  picker.innerHTML = available.map(sku => {
    const avail  = sku.stock - sku.sold;
    const isOut  = avail === 0;
    const subTxt = isOut ? 'sold out' : `${avail} left · $${sku.price}`;
    return `<button class="flavor-btn${isOut ? ' disabled' : ''}" ${isOut ? 'disabled' : ''}
              onclick="addToPendingOrder(${sku.id})">
      <span class="fn">${esc(sku.name)}</span>
      <span class="fs">${subTxt}</span>
    </button>`;
  }).join('');
}

function addToPendingOrder(skuId) {
  const sku = state.skus.find(s => s.id === skuId);
  if (!sku || pendingModalItems.find(i => i.sku_id === skuId)) return;
  pendingModalItems.push({ sku_id: skuId, sku_name: sku.name, qty: 1, price: sku.price });
  renderPendingModalItems();
  renderPendingModalFlavors();
  updatePendingTotal();
}

function changePendingItemQty(skuId, delta) {
  const item = pendingModalItems.find(i => i.sku_id === skuId);
  if (!item) return;
  const newQty = item.qty + delta;
  if (newQty < 1) { removePendingItem(skuId); return; }
  item.qty = newQty;
  const qtyEl   = document.getElementById(`pmi-qty-${skuId}`);
  const priceEl = document.getElementById(`pmi-price-${skuId}`);
  if (qtyEl)   qtyEl.textContent   = newQty;
  if (priceEl) priceEl.textContent = `$${parseFloat(item.price) * newQty}`;
  updatePendingTotal();
}

function removePendingItem(skuId) {
  pendingModalItems = pendingModalItems.filter(i => i.sku_id !== skuId);
  document.getElementById(`pmi-${skuId}`)?.remove();
  renderPendingModalFlavors();
  updatePendingTotal();
}

function changePendingReturns(delta) {
  const newVal = pendingModalReturns + delta;
  if (newVal < 0) return;
  pendingModalReturns = newVal;
  const el = document.getElementById('pm-returns');
  if (el) el.textContent = newVal;
  updatePendingTotal();
}

function updatePendingTotal() {
  const subtotal = pendingModalItems.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
  const el = document.getElementById('pm-total');
  if (el) el.textContent = fmtMoney(Math.max(0, subtotal - pendingModalReturns * 3));
}

function closePendingModal() {
  document.getElementById('pending-modal').classList.remove('open');
  pendingModalOrder   = null;
  pendingModalItems   = [];
  pendingModalReturns = 0;
}

async function confirmPendingOrder() {
  if (!pendingModalOrder) return;

  const activeItems = pendingModalItems.filter(i => i.qty > 0);
  if (!activeItems.length) { alert('No items remaining in this order.'); return; }

  const pay      = document.getElementById('pm-pay').value || 'Venmo';
  const o        = pendingModalOrder;
  const discount = pendingModalReturns * 3;
  const subtotal = activeItems.reduce((s, i) => s + parseFloat(i.price) * i.qty, 0);
  const total    = Math.max(0, subtotal - discount);

  // Deduct inventory optimistically
  activeItems.forEach(item => {
    const sku = state.skus.find(s => s.id === item.sku_id);
    if (sku) {
      sku.sold += item.qty;
      dbUpdateSkuSold(sku.id, sku.sold).catch(e => console.error('Update sold failed:', e));
    }
  });

  state.orders.unshift({
    id:        o.id,
    name:      o.customer_name || '—',
    items:     activeItems.map(i => ({
      skuId: i.sku_id, skuName: i.sku_name, qty: i.qty, price: parseFloat(i.price)
    })),
    pay, discount, total,
    time:      new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    createdAt: new Date().toISOString()
  });
  saveLocal();

  // DB trigger fires on status UPDATE → 'completed' and sends confirmation email
  dbConfirmPendingOrder(o.id, pay, pendingModalItems, total, discount)
    .catch(e => console.error('Confirm pending failed:', e));

  closePendingModal();
  loadPendingForNewSale();
  state.pendingQty = await dbLoadPendingCounts();
  renderDashboard();
  if (typeof renderHistory === 'function') renderHistory();
}

async function declinePendingOrder() {
  if (!pendingModalOrder) return;
  if (!confirm('Decline this order?')) return;
  await dbRejectOrder(pendingModalOrder.id);
  closePendingModal();
  loadPendingForNewSale();
  state.pendingQty = await dbLoadPendingCounts();
  renderDashboard();
}
