/* ============================================================
   FOUR EYES COFFEE — storeHub/inventory.js
   SKU inventory management. Split: For Sale / Test.
   ============================================================ */

function renderInventory() {
  const production = state.skus.filter(s => (s.sku_type || 'production') === 'production');
  const test       = state.skus.filter(s => s.sku_type === 'test');

  _renderSkuGrid('inv-grid-production', production);
  _renderSkuGrid('inv-grid-test',       test);

  const testSection = document.getElementById('inv-test-section');
  if (testSection) testSection.style.display = test.length ? 'block' : 'none';
}

function _renderSkuGrid(gridId, skus) {
  const grid = document.getElementById(gridId);
  if (!grid) return;

  if (!skus.length) {
    grid.innerHTML = '<div class="inv-loading">None yet.</div>';
    return;
  }

  grid.innerHTML = skus.map(sku => {
    const rem    = sku.stock - sku.sold;
    const pct    = sku.stock > 0 ? Math.round((rem / sku.stock) * 100) : 0;
    const isOut  = rem === 0;
    const isLow  = !isOut && rem <= Math.max(1, Math.floor(sku.stock * 0.2));
    const numCls = isOut ? ' out' : isLow ? ' low' : '';
    const barCls = isLow ? ' low' : '';
    const pending = state.pendingQty[sku.id] || 0;

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
      ${pending > 0 ? `<div class="inv-pending-tag">&#x23F3; ${pending} pending</div>` : ''}
    </div>`;
  }).join('');
}

// ── SKU modal ─────────────────────────────────────────────────────

function _populateSkuModal({ title, id = '', name = '', stock = '', price = '', sku_type = 'production', showDelete = false }) {
  document.getElementById('sku-modal-title').textContent = title;
  document.getElementById('sm-id').value                 = id;
  document.getElementById('sm-name').value               = name;
  document.getElementById('sm-stock').value              = stock;
  document.getElementById('sm-price').value              = price;
  document.getElementById('sku-del-btn').style.display   = showDelete ? 'block' : 'none';

  // Set type pills
  document.getElementById('smt-production')?.classList.toggle('selected', sku_type === 'production');
  document.getElementById('smt-test')?.classList.toggle('selected', sku_type === 'test');
  document.getElementById('sm-type').value = sku_type;

  document.getElementById('sku-modal').classList.add('open');
}

function openAddSku() {
  _populateSkuModal({ title: 'New Flavor' });
}

function openEditSku(id) {
  const sku = state.skus.find(s => s.id === id);
  if (!sku) return;
  _populateSkuModal({
    title:      'Edit Flavor',
    id:         sku.id,
    name:       sku.name,
    stock:      sku.stock,
    price:      sku.price,
    sku_type:   sku.sku_type || 'production',
    showDelete: true
  });
}

function selectSkuType(type) {
  document.getElementById('sm-type').value = type;
  document.getElementById('smt-production')?.classList.toggle('selected', type === 'production');
  document.getElementById('smt-test')?.classList.toggle('selected', type === 'test');
}

async function saveSku() {
  const id       = document.getElementById('sm-id').value;
  const name     = document.getElementById('sm-name').value.trim();
  const stock    = parseInt(document.getElementById('sm-stock').value);
  const price    = parseFloat(document.getElementById('sm-price').value);
  const sku_type = document.getElementById('sm-type').value || 'production';

  if (!name)              { alert('Enter a flavor name.'); return; }
  if (!stock || stock < 1){ alert('Enter bottle count.');  return; }
  if (!price || price <= 0){ alert('Enter a price.');      return; }

  let savedSku;
  if (id) {
    const sku = state.skus.find(s => s.id === parseInt(id));
    if (!sku) return;
    if (stock < sku.sold) { alert(`Can't set stock below already sold (${sku.sold}).`); return; }
    sku.name     = name;
    sku.stock    = stock;
    sku.price    = price;
    sku.sku_type = sku_type;
    savedSku     = sku;
  } else {
    const newSku = { id: state.nextSkuId++, name, stock, sold: 0, price, sku_type };
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

  dbDeleteSku(id).catch(e => console.error('Delete SKU failed:', e));

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
