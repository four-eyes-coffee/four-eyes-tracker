/* ============================================================
   FOUR EYES COFFEE — storeHub/inventory.js
   SKU inventory management. Moved here from the old dashboard.
   ============================================================ */

function initInventory() {
  const panel = document.getElementById('inner-inventory');
  if (!panel) return;

  panel.innerHTML = `
    <div class="sec-row" style="margin-top:8px;">
      <span class="sec-label">Flavors &amp; Stock</span>
      <button class="sec-action" onclick="openAddSku()">+ New Flavor</button>
    </div>
    <div class="inv-grid" id="inv-grid">
      <div class="inv-loading">Loading...</div>
    </div>
  `;
}

function renderInventory() {
  const grid = document.getElementById('inv-grid');
  if (!grid) return;

  if (!state.skus.length) {
    grid.innerHTML = '<div class="inv-loading">No flavors yet — add one above.</div>';
    return;
  }

  grid.innerHTML = state.skus.map(sku => {
    const rem     = sku.stock - sku.sold;
    const pct     = sku.stock > 0 ? Math.round((rem / sku.stock) * 100) : 0;
    const isLow   = rem > 0 && rem <= Math.max(1, Math.floor(sku.stock * 0.2));
    const isOut   = rem === 0;
    const numCls  = isOut ? ' out' : isLow ? ' low' : '';
    const barCls  = isLow ? ' low' : '';
    const pending = state.pendingQty[sku.id] || 0;
    const pendingLine = pending > 0
      ? `<div class="inv-pending-tag">⏳ ${pending} pending</div>`
      : '';

    return `<div class="inv-card">
      <button class="inv-edit" onclick="openEditSku(${sku.id})">&#x270E;</button>
      <div class="inv-name">${esc(sku.name)}</div>
      <div class="inv-price">$${sku.price} / bottle</div>
      <div class="inv-nums">
        <div>
          <div class="inv-big${numCls}">${rem}</div>
          <div class="inv-lbl">left</div>
        </div>
        <div class="inv-right">
          $${(sku.sold * sku.price).toFixed(2)}<br>
          <b>${sku.sold}</b> sold
        </div>
      </div>
      <div class="inv-bar">
        <div class="inv-bar-fill${barCls}" style="width:${pct}%"></div>
      </div>
      ${pendingLine}
    </div>`;
  }).join('');
}

// ── SKU modal ─────────────────────────────────────────────────────

function openAddSku() {
  document.getElementById('sku-modal-title').textContent   = 'New Flavor';
  document.getElementById('sm-id').value                   = '';
  document.getElementById('sm-name').value                 = '';
  document.getElementById('sm-stock').value                = '';
  document.getElementById('sm-price').value                = '';
  document.getElementById('sku-del-btn').style.display     = 'none';
  document.getElementById('sku-modal').classList.add('open');
}

function openEditSku(id) {
  const sku = state.skus.find(s => s.id === id);
  if (!sku) return;
  document.getElementById('sku-modal-title').textContent   = 'Edit Flavor';
  document.getElementById('sm-id').value                   = id;
  document.getElementById('sm-name').value                 = sku.name;
  document.getElementById('sm-stock').value                = sku.stock;
  document.getElementById('sm-price').value                = sku.price;
  document.getElementById('sku-del-btn').style.display     = 'block';
  document.getElementById('sku-modal').classList.add('open');
}

async function saveSku() {
  const id    = document.getElementById('sm-id').value;
  const name  = document.getElementById('sm-name').value.trim();
  const stock = parseInt(document.getElementById('sm-stock').value);
  const price = parseFloat(document.getElementById('sm-price').value);

  if (!name)              { alert('Enter a flavor name.'); return; }
  if (!stock || stock < 1) { alert('Enter bottle count.'); return; }
  if (!price || price <= 0) { alert('Enter a price.'); return; }

  let savedSku;
  if (id) {
    const sku = state.skus.find(s => s.id === parseInt(id));
    if (!sku) return;
    if (stock < sku.sold) {
      alert(`Can't set stock below already sold (${sku.sold}).`);
      return;
    }
    sku.name  = name;
    sku.stock = stock;
    sku.price = price;
    savedSku  = sku;
  } else {
    const newSku = { id: state.nextSkuId++, name, stock, sold: 0, price };
    state.skus.push(newSku);
    savedSku = newSku;
  }

  closeSkuModal();
  saveLocal();
  renderInventory();
  renderDashboard();
  if (typeof renderSaleForm === 'function') renderSaleForm();

  dbSaveSku(savedSku).catch(e => console.error('Save SKU failed:', e));
}

async function deleteSku() {
  const id  = parseInt(document.getElementById('sm-id').value);
  const sku = state.skus.find(s => s.id === id);
  if (!sku || !confirm(`Remove "${sku.name}"?`)) return;

  // Soft-delete in Supabase
  dbDeleteSku(id).catch(e => console.error('Delete SKU failed:', e));

  // Remove from local state
  state.skus   = state.skus.filter(s => s.id !== id);
  state.orders = state.orders.filter(o =>
    !(o.items || []).some(i => i.skuId === id)
  );

  closeSkuModal();
  saveLocal();
  renderInventory();
  renderDashboard();
  if (typeof renderHistory  === 'function') renderHistory();
  if (typeof renderSaleForm === 'function') renderSaleForm();
}

function closeSkuModal() {
  document.getElementById('sku-modal').classList.remove('open');
}

// Backdrop click to close
const _skuModal = document.getElementById('sku-modal');
if (_skuModal) {
  _skuModal.addEventListener('click', function(e) {
    if (e.target === this) closeSkuModal();
  });
}

// initInventory() called from index.html after all scripts load
