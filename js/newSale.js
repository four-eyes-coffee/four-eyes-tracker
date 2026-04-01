/* ============================================================
   FOUR EYES COFFEE — newSale.js
   Walk-up sale flow: cart, payment, bottle returns, submit.
   Also handles pending order approval from order.html.
   ============================================================ */

// Module-level cart state
let cart             = [];
let formPay          = null;
let formReturns      = 0;
let pendingModalOrder = null;

function initNewSale() {
  const panel = document.getElementById('panel-newsale');
  if (!panel) return;

  panel.innerHTML = `
    <!-- Sale entry form -->
    <div id="sale-form-wrap">
      <div class="sale-form">
        <div class="fsec">Customer</div>
        <div class="field">
          <input type="text" id="f-name" placeholder="First name or handle" autocomplete="off">
        </div>

        <div class="fsec">Items</div>
        <div class="items-list"  id="items-list"></div>
        <div class="flavor-picker" id="flavor-picker"></div>

        <div class="fsec">Payment</div>
        <div class="pay-pills">
          <button class="pay-pill" onclick="selectPay('Cash',this)">Cash</button>
          <button class="pay-pill" onclick="selectPay('Venmo',this)">Venmo</button>
          <button class="pay-pill" onclick="selectPay('Zelle',this)">Zelle</button>
          <button class="pay-pill" onclick="selectPay('Card',this)">Card</button>
          <button class="pay-pill" onclick="selectPay('Gift',this)">Gift</button>
        </div>

        <div class="fsec">Bottles Returned</div>
        <div class="discount-row">
          <button class="ibtn" onclick="changeReturns(-1)" type="button">&#x2212;</button>
          <span class="item-qty f-returns" id="f-returns">0</span>
          <button class="ibtn" onclick="changeReturns(1)"  type="button">+</button>
          <span class="returns-hint">&#x2212;$3 each</span>
        </div>

        <div class="order-summary">
          <span class="ol">Total</span>
          <span class="ov" id="order-total">$0</span>
        </div>
        <button class="submit-btn" onclick="logSale()">Log Sale</button>
      </div>
    </div>

    <!-- Sale confirmed state -->
    <div class="sale-success" id="sale-success">
      <div class="si">&#x2713;</div>
      <div class="sm" id="success-name"></div>
      <div class="ss" id="success-detail"></div>
      <button class="log-again-btn"   onclick="logAnother()">+ Log Another Sale</button>
      <button class="see-history-btn" onclick="switchTab('history')">View History</button>
    </div>

    <!-- Pending pre-orders (always shown at bottom) -->
    <div class="section-divider"></div>
    <div class="pending-header-row">
      <span class="sec-label">Pending Orders</span>
      <span class="hist-count" id="newsale-pending-count">0</span>
    </div>
    <div id="newsale-pending-list">
      <div class="no-pending-msg">No pending orders</div>
    </div>
  `;
}

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
  picker.innerHTML = state.skus.map(sku => {
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
  const item     = cart.find(c => c.skuId === skuId);
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

// ── Sale submission ───────────────────────────────────────────────

async function logSale() {
  const name = document.getElementById('f-name').value.trim();
  if (!name)        { alert('Enter a customer name.'); return; }
  if (!cart.length) { alert('Add at least one item.');  return; }
  if (!formPay)     { alert('Select a payment method.'); return; }

  const disc     = formReturns * 3;
  const subtotal = cart.reduce((sum, item) => {
    const sku = state.skus.find(s => s.id === item.skuId);
    return sum + (sku ? sku.price * item.qty : 0);
  }, 0);
  const total = formPay === 'Gift' ? 0 : Math.max(0, subtotal - disc);

  // Deduct sold counts immediately (optimistic)
  cart.forEach(item => {
    const sku = state.skus.find(s => s.id === item.skuId);
    if (sku) sku.sold += item.qty;
  });

  const now  = new Date();
  const sale = {
    id:        Date.now(),
    name,
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

  state.orders.unshift(sale);
  saveLocal();

  // Non-blocking Supabase write — show success immediately
  dbSaveOrder(sale).catch(e => console.error('Save order failed:', e));

  renderDashboard();
  if (typeof renderHistory === 'function') renderHistory();

  // Show success state
  document.getElementById('sale-form-wrap').style.display = 'none';
  document.getElementById('sale-success').classList.add('show');
  document.getElementById('success-name').textContent = `${name} — ${fmtMoney(total)}`;
  const lines = sale.items.map(i => `${i.skuName} ×${i.qty}`).join(', ');
  document.getElementById('success-detail').textContent = lines +
    (formReturns > 0 ? ` · ${formReturns} bottle${formReturns > 1 ? 's' : ''} returned` : '');
}

function logAnother() {
  cart = []; formPay = null; formReturns = 0;
  document.getElementById('f-name').value      = '';
  document.getElementById('f-returns').textContent = '0';
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
    const pending = await dbLoadPending();
    if (countEl) countEl.textContent = pending.length;

    if (!pending.length) {
      list.innerHTML = '<div class="no-pending-msg">No pending orders</div>';
      return;
    }

    list.innerHTML = pending.map(o => {
      const lines = (o.order_items || []).map(i => `${esc(i.sku_name)} ×${i.qty}`).join(', ');
      const windowLabel = o.fulfillment_type
        ? esc(o.fulfillment_type) + (o.fulfillment_window ? ' · ' + esc(o.fulfillment_window) : '')
        : '';
      return `<div class="pending-card">
        <div class="pending-card-top">
          <div class="pending-name">${esc(o.customer_name || '—')}</div>
          <div class="pending-window">${windowLabel}</div>
        </div>
        <div class="pending-items">${lines}</div>
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

async function approveOrder(id) {
  try {
    const pending = await dbLoadPending();
    const order   = pending.find(o => o.id === id);
    if (order) openPendingModal(order);
  } catch(e) {
    console.error('Approve order failed:', e);
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
  pendingModalOrder = order;
  document.getElementById('pm-id').value            = order.id;
  document.getElementById('pm-name').textContent    = order.customer_name || '—';
  document.getElementById('pm-contact').textContent =
    (order.fulfillment_type || '') +
    (order.fulfillment_window ? ' · ' + order.fulfillment_window : '');
  document.getElementById('pm-pay').value   = '';
  document.getElementById('pm-notes').value = order.notes || '';
  document.getElementById('pm-total').textContent = fmtMoney(parseFloat(order.total) || 0);

  const items = order.order_items || [];
  document.getElementById('pm-items').innerHTML =
    '<div class="modal-items-label">Items</div>' +
    items.map(i => `
      <div class="pending-modal-item">
        <span class="pk">${esc(i.sku_name)}</span>
        <span class="pv">×${i.qty} — $${i.price * i.qty}</span>
      </div>`
    ).join('');

  document.getElementById('pending-modal').classList.add('open');
}

function closePendingModal() {
  document.getElementById('pending-modal').classList.remove('open');
  pendingModalOrder = null;
}

async function confirmPendingOrder() {
  if (!pendingModalOrder) return;
  const pay = document.getElementById('pm-pay').value || 'Venmo';
  const o   = pendingModalOrder;
  const items = o.order_items || [];

  // Deduct inventory (optimistic)
  for (const item of items) {
    const sku = state.skus.find(s => s.id === item.sku_id);
    if (sku) {
      sku.sold += item.qty;
      dbUpdateSkuSold(sku.id, sku.sold).catch(e => console.error(e));
    }
  }

  // Add to local state as a completed order
  const sale = {
    id:        o.id,
    name:      o.customer_name || '—',
    items:     items.map(i => ({
      skuId:   i.sku_id,
      skuName: i.sku_name,
      qty:     i.qty,
      price:   parseFloat(i.price)
    })),
    pay,
    discount:  0,
    total:     parseFloat(o.total) || 0,
    time:      new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    createdAt: new Date().toISOString()
  };
  state.orders.unshift(sale);
  saveLocal();

  dbConfirmPendingOrder(o.id, pay).catch(e => console.error(e));

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

// Backdrop click to close pending modal
const _pendingModal = document.getElementById('pending-modal');
if (_pendingModal) {
  _pendingModal.addEventListener('click', function(e) {
    if (e.target === this) closePendingModal();
  });
}

// initNewSale() called from index.html after all scripts load
