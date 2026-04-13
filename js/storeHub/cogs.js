/* ============================================================
   FOUR EYES COFFEE — storeHub/cogs.js
   COGS tracker: bean purchases, packaging, equipment, batches.
   Renders entirely into #inner-cogs. Modals created dynamically.
   ============================================================ */

let _beans        = [];
let _packaging    = [];
let _equipment    = [];
let _batches      = [];
let _batchBeanRows = [{ name: '', grams: '', unit: 'g', manual: false }];
let _batchType    = 'production';

const TODAY = () => new Date().toISOString().slice(0, 10);

// ── Weight helpers ────────────────────────────────────────────────

function toGrams(value, unit) {
  const v = parseFloat(value) || 0;
  if (unit === 'kg')  return v * 1000;
  if (unit === 'lbs') return v * 453.592;
  return v;
}

function fmtGrams(g) {
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${Math.round(g)} g`;
}

// ── Price lookups ─────────────────────────────────────────────────

// Weighted average across ALL purchases of this bean (AVCO method)
function avgBeanPriceInfo(beanType) {
  const key     = (beanType || '').trim().toLowerCase();
  if (!key) return { ppg: 0, count: 0 };
  const matches = _beans.filter(b => b.bean_type.trim().toLowerCase() === key);
  if (!matches.length) return { ppg: 0, count: 0 };
  const totalPaid  = matches.reduce((s, b) => s + parseFloat(b.amount_paid), 0);
  const totalGrams = matches.reduce((s, b) => s + parseFloat(b.weight_g),    0);
  return { ppg: totalGrams > 0 ? totalPaid / totalGrams : 0, count: matches.length };
}

function latestBeanPrice(beanType) {
  return avgBeanPriceInfo(beanType).ppg;
}

// Most recent unit cost for a packaging category
function latestPackagingUnitCost(category) {
  const match = _packaging.find(p => p.category.toLowerCase() === category.toLowerCase());
  return match ? parseFloat(match.unit_cost) : 0;
}

// ── Autocomplete datalists ────────────────────────────────────────

function _vendorDatalist() {
  const vendors = [...new Set([
    ..._beans.map(b => b.vendor),
    ..._packaging.map(p => p.vendor),
    ..._equipment.map(e => e.vendor)
  ])].filter(Boolean).sort();
  return `<datalist id="dl-vendors">${vendors.map(v => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

function _beanNameDatalist() {
  const names = [...new Set(_beans.map(b => b.bean_type))].filter(Boolean).sort();
  return `<datalist id="dl-beannames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}

// ── Init ──────────────────────────────────────────────────────────

async function initCogs() {
  renderCogsShell();
  try {
    // Check table access first — COGS tables may lack RLS policies
    if (typeof dbCheckCogsAccess === 'function') {
      const access = await dbCheckCogsAccess();
      const blocked = Object.entries(access).filter(([, v]) => !v.ok);
      if (blocked.length) {
        const names = blocked.map(([t, v]) => `${t}: ${v.error}`).join('\n');
        console.error('COGS table access issues:\n' + names);
        document.getElementById('inner-cogs').innerHTML +=
          `<div class="cogs-error" style="white-space:pre-line;">
            ⚠ Supabase access issue on COGS tables.\nAdd RLS policies (USING (true) WITH CHECK (true)) for:\n${blocked.map(([t]) => '• ' + t).join('\n')}
          </div>`;
      }
    }

    // Beans and packaging are never in shared state — always fetch fresh
    // Equipment and batches are loaded at boot into state — seed from there,
    // avoiding 2 redundant round-trips every time the COGS tab first opens
    const [beans, packaging] = await Promise.all([
      dbLoadBeanPurchases(),
      dbLoadPackagingPurchases()
    ]);
    _beans     = beans;
    _packaging = packaging;
    _equipment = state.equipment.length ? [...state.equipment] : await dbLoadEquipmentPurchases();
    _batches   = state.batches.length   ? [...state.batches]   : await dbLoadBatches();
    renderBeans();
    renderPackaging();
    renderEquipment();
    renderBatches();
  } catch(e) {
    console.error('COGS load failed:', e);
    document.getElementById('inner-cogs').innerHTML +=
      '<div class="cogs-error">Failed to load COGS data. Check Supabase RLS policies.</div>';
  }
}

// ── Shell ─────────────────────────────────────────────────────────

function renderCogsShell() {
  document.getElementById('inner-cogs').innerHTML = `
    ${cogsSection('batches',   'Batch Log',      'openCogsBatchModal()', true,  true)}
    <div class="cogs-divider"></div>
    ${cogsSection('beans',     'Bean Purchases', 'openCogsBeanModal()',  false, false)}
    <div class="cogs-divider"></div>
    ${cogsSection('packaging', 'Packaging',      'openCogsPackagingModal()')}
    <div class="cogs-divider"></div>
    ${cogsSection('equipment', 'Equipment',      'openCogsEquipmentModal()')}
  `;
}

function cogsSection(id, title, addCall, openByDefault = false, isBatch = false) {
  return `
  <div class="cogs-sec${isBatch ? ' cogs-sec--batch' : ''}">
    <div class="cogs-sec-hdr" onclick="toggleCogsSec('cogs-body-${id}', this)">
      <div class="cogs-sec-left">
        <span class="cogs-sec-name">${title}</span>
        <span class="cogs-sec-meta" id="cogs-meta-${id}">Loading…</span>
      </div>
      <div class="cogs-sec-right">
        <button class="sec-action${isBatch ? ' sec-action--batch' : ''}" onclick="event.stopPropagation(); ${addCall}">+ Add</button>
        <span class="cogs-chevron">&#x25BE;</span>
      </div>
    </div>
    <div class="cogs-sec-body" id="cogs-body-${id}"${openByDefault ? '' : ' style="display:none"'}>
      <div class="cogs-loading">Loading…</div>
    </div>
  </div>`;
}

function toggleCogsSec(bodyId, hdr) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  const chevron = hdr.querySelector('.cogs-chevron');
  if (chevron) chevron.style.transform = isOpen ? 'rotate(-90deg)' : '';
}

// ── Render: Bean Purchases ────────────────────────────────────────

function renderBeans() {
  const body = document.getElementById('cogs-body-beans');
  const meta = document.getElementById('cogs-meta-beans');
  if (!body) return;

  if (meta) {
    if (_beans.length) {
      const latest = _beans[0];
      meta.textContent = `${_beans.length} purchase${_beans.length !== 1 ? 's' : ''} · latest $${parseFloat(latest.price_per_g).toFixed(4)}/g`;
    } else {
      meta.textContent = 'No purchases yet';
    }
  }

  if (!_beans.length) { body.innerHTML = '<div class="cogs-empty">No bean purchases logged.</div>'; return; }

  body.innerHTML = _beans.map(b => `
    <div class="cogs-row">
      <div class="cogs-row-main">
        <div class="cogs-row-title">${esc(b.bean_type)}</div>
        <div class="cogs-row-sub">${esc(b.vendor)} · ${fmtGrams(b.weight_g)} · $${parseFloat(b.amount_paid).toFixed(2)}</div>
      </div>
      <div class="cogs-row-right">
        <div class="cogs-row-amount">$${parseFloat(b.price_per_g).toFixed(4)}<span class="cogs-unit">/g</span></div>
        <div class="cogs-row-date">${b.purchased_at}</div>
        <button class="cogs-edit-btn" onclick="openCogsBeanModal(${b.id})">Edit</button>
      </div>
    </div>`).join('');
}

// ── Render: Packaging ─────────────────────────────────────────────

function renderPackaging() {
  const body = document.getElementById('cogs-body-packaging');
  const meta = document.getElementById('cogs-meta-packaging');
  if (!body) return;

  if (meta) {
    const latestBottle = latestPackagingUnitCost('bottles');
    const latestLabel  = latestPackagingUnitCost('labels');
    meta.textContent = _packaging.length
      ? `${_packaging.length} purchase${_packaging.length !== 1 ? 's' : ''} · bottle $${latestBottle.toFixed(2)} · label $${latestLabel.toFixed(2)}`
      : 'No purchases yet';
  }

  if (!_packaging.length) { body.innerHTML = '<div class="cogs-empty">No packaging purchases logged.</div>'; return; }

  body.innerHTML = _packaging.map(p => `
    <div class="cogs-row">
      <div class="cogs-row-main">
        <div class="cogs-row-title">${esc(p.description)}</div>
        <div class="cogs-row-sub">${esc(p.category)} · ${esc(p.vendor)} · qty ${p.quantity} · $${parseFloat(p.amount_paid).toFixed(2)}</div>
      </div>
      <div class="cogs-row-right">
        <div class="cogs-row-amount">$${parseFloat(p.unit_cost).toFixed(4)}<span class="cogs-unit">/unit</span></div>
        <div class="cogs-row-date">${p.purchased_at}</div>
        <button class="cogs-edit-btn" onclick="openCogsPackagingModal(${p.id})">Edit</button>
      </div>
    </div>`).join('');
}

// ── Render: Equipment ─────────────────────────────────────────────

function renderEquipment() {
  const body  = document.getElementById('cogs-body-equipment');
  const meta  = document.getElementById('cogs-meta-equipment');
  if (!body) return;

  const total = _equipment.reduce((s, e) => s + parseFloat(e.amount_paid), 0);
  if (meta) {
    meta.textContent = _equipment.length
      ? `${_equipment.length} item${_equipment.length !== 1 ? 's' : ''} · $${total.toFixed(2)} total`
      : 'No equipment logged';
  }

  if (!_equipment.length) { body.innerHTML = '<div class="cogs-empty">No equipment purchases logged.</div>'; return; }

  body.innerHTML = _equipment.map(e => `
    <div class="cogs-row">
      <div class="cogs-row-main">
        <div class="cogs-row-title">${esc(e.item_name)}</div>
        <div class="cogs-row-sub">${esc(e.vendor)}${e.notes ? ' · ' + esc(e.notes) : ''}</div>
      </div>
      <div class="cogs-row-right">
        <div class="cogs-row-amount">$${parseFloat(e.amount_paid).toFixed(2)}</div>
        <div class="cogs-row-date">${e.purchased_at}</div>
        <button class="cogs-edit-btn" onclick="openCogsEquipmentModal(${e.id})">Edit</button>
      </div>
    </div>`).join('');
}

// ── Render: Batches ───────────────────────────────────────────────

function renderBatches() {
  const body = document.getElementById('cogs-body-batches');
  const meta = document.getElementById('cogs-meta-batches');
  if (!body) return;

  const forSale = _batches.filter(b => (b.batch_type || 'production') === 'production').length;
  const test    = _batches.filter(b => b.batch_type === 'test').length;
  if (meta) {
    meta.textContent = _batches.length
      ? `${forSale} for sale · ${test} test`
      : 'No batches logged';
  }

  if (!_batches.length) { body.innerHTML = '<div class="cogs-empty">No batches logged.</div>'; return; }

  body.innerHTML = _batches.map(b => {
    const beans  = (b.beans_used || []).map(r => `${esc(r.name)} ${fmtGrams(r.grams)}`).join(', ');
    const isTest = b.batch_type === 'test';
    const tag    = isTest
      ? '<span class="batch-type-tag test">Test</span>'
      : '<span class="batch-type-tag sale">For Sale</span>';
    return `
    <div class="cogs-batch-row">
      <div class="cogs-row-main">
        <div class="cogs-row-title">${esc(b.sku_name)} · ${b.bottles_produced} bottles</div>
        <div class="cogs-row-sub">${beans}</div>
        <div class="cogs-batch-tag-row">${tag}</div>
      </div>
      <div class="cogs-row-right">
        <div class="cogs-row-amount">$${parseFloat(b.cost_per_bottle).toFixed(2)}<span class="cogs-unit">/bottle</span></div>
        <div class="cogs-row-date">${b.brewed_at}</div>
        <button class="cogs-edit-btn" onclick="openCogsBatchModal(${b.id})">Edit</button>
      </div>
    </div>`;
  }).join('');
}

// ── Modal helpers ─────────────────────────────────────────────────

function _openCogsModal(title, bodyHtml) {
  closeCogsModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'cogs-modal-overlay';
  overlay.innerHTML = `
    <div class="modal" id="cogs-modal-inner">
      <div class="modal-hdr">
        <span>${title}</span>
        <button class="modal-close" onclick="closeCogsModal()">&#x2715;</button>
      </div>
      ${bodyHtml}
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeCogsModal(); });
  document.body.appendChild(overlay);
}

function closeCogsModal() {
  const el = document.getElementById('cogs-modal-overlay');
  if (el) el.remove();
}

function _setSavingState(saving) {
  const btn = document.querySelector('#cogs-modal-inner .modal-save');
  if (!btn) return;
  btn.disabled = saving;
  btn.classList.toggle('saving', saving);
}

function _fld(id) { return document.getElementById(id); }
function _val(id) { const el = _fld(id); return el ? el.value.trim() : ''; }
function _num(id) { return parseFloat(_val(id)) || 0; }

// ── Bean Purchase Modal ───────────────────────────────────────────

function openCogsBeanModal(id) {
  const rec  = id ? _beans.find(b => b.id === id) : null;
  const wt   = rec ? (rec.weight_g >= 1000 ? rec.weight_g / 1000 : rec.weight_g) : '';
  const unit = rec ? (rec.weight_g >= 1000 ? 'kg' : 'g') : 'g';

  _openCogsModal(rec ? 'Edit Bean Purchase' : 'New Bean Purchase', `
    ${_vendorDatalist()}${_beanNameDatalist()}
    <div class="field"><label>Bean Name</label>
      <input id="cb-name" type="text" list="dl-beannames" value="${esc(rec?.bean_type || '')}" placeholder="e.g. Ethiopia Yirgacheffe"></div>
    <div class="field"><label>Vendor / Roaster</label>
      <input id="cb-vendor" type="text" list="dl-vendors" value="${esc(rec?.vendor || '')}" placeholder="e.g. Onyx Coffee Lab"></div>
    <div class="field-row">
      <div class="field"><label>Amount Paid ($)</label>
        <input id="cb-amount" type="number" step="0.01" min="0" inputmode="decimal" value="${rec ? parseFloat(rec.amount_paid).toFixed(2) : ''}"></div>
      <div class="field"><label>Weight</label>
        <div class="cogs-weight-row">
          <input id="cb-weight" type="number" step="any" min="0" inputmode="decimal" value="${wt}" style="flex:1">
          <select id="cb-unit" class="cogs-unit-select">
            <option value="g"${unit==='g'?' selected':''}>g</option>
            <option value="kg"${unit==='kg'?' selected':''}>kg</option>
            <option value="lbs"${unit==='lbs'?' selected':''}>lbs</option>
          </select>
        </div>
      </div>
    </div>
    <div class="field"><label>Date Purchased</label>
      <input id="cb-date" type="date" value="${rec?.purchased_at || TODAY()}"></div>
    <div class="field"><label>Notes <span class="cogs-optional">(optional)</span></label>
      <input id="cb-notes" type="text" value="${esc(rec?.notes || '')}"></div>
    <button class="modal-save" onclick="saveCogsBeanPurchase(${id || 'null'})">Save</button>
    ${rec ? `<button class="modal-del" onclick="deleteCogsBeanPurchase(${id})">Delete</button>` : ''}
  `);
}

async function saveCogsBeanPurchase(id) {
  const name   = _val('cb-name');
  const vendor = _val('cb-vendor');
  const amount = _num('cb-amount');
  const weight = _num('cb-weight');
  const unit   = _val('cb-unit');
  const date   = _val('cb-date');
  if (!name || !vendor || !amount || !weight || !date) { alert('Fill in all required fields.'); return; }

  const weight_g   = toGrams(weight, unit);
  const price_per_g = amount / weight_g;
  const rec = { purchased_at: date, bean_type: name, vendor, amount_paid: amount, weight_g, price_per_g, notes: _val('cb-notes') };

  try {
    _setSavingState(true);
    if (id) {
      await dbUpdateBeanPurchase({ id, ...rec });
      const idx = _beans.findIndex(b => b.id === id);
      if (idx !== -1) _beans[idx] = { id, ...rec, created_at: _beans[idx].created_at };
    } else {
      const saved = await dbSaveBeanPurchase(rec);
      _beans.unshift(saved);
    }
    _beans.sort((a, b) => b.purchased_at.localeCompare(a.purchased_at));
    closeCogsModal();
    renderBeans();
  } catch(e) { _setSavingState(false); console.error('Save bean purchase failed:', e); alert('Save failed: ' + (e?.message || e)); }
}

async function deleteCogsBeanPurchase(id) {
  if (!confirm('Delete this bean purchase?')) return;
  try {
    await dbDeleteBeanPurchase(id);
    _beans = _beans.filter(b => b.id !== id);
    closeCogsModal();
    renderBeans();
  } catch(e) { console.error('Delete bean purchase failed:', e); alert('Delete failed: ' + (e?.message || e)); }
}

// ── Packaging Modal ───────────────────────────────────────────────

function openCogsPackagingModal(id) {
  const rec = id ? _packaging.find(p => p.id === id) : null;

  _openCogsModal(rec ? 'Edit Packaging Purchase' : 'New Packaging Purchase', `
    ${_vendorDatalist()}
    <div class="field"><label>Category</label>
      <select id="cp-cat" class="pay-select">
        <option value="Bottles"${rec?.category==='Bottles'?' selected':''}>Bottles</option>
        <option value="Labels"${rec?.category==='Labels'?' selected':''}>Labels</option>
        <option value="Other"${rec?.category==='Other'?' selected':''}>Other</option>
      </select></div>
    <div class="field"><label>Description</label>
      <input id="cp-desc" type="text" value="${esc(rec?.description || '')}" placeholder="e.g. Round labels 2.5in"></div>
    <div class="field"><label>Vendor</label>
      <input id="cp-vendor" type="text" list="dl-vendors" value="${esc(rec?.vendor || '')}" placeholder="e.g. Sticker Mule"></div>
    <div class="field-row">
      <div class="field"><label>Quantity</label>
        <input id="cp-qty" type="number" min="1" inputmode="numeric" value="${rec?.quantity || ''}"></div>
      <div class="field"><label>Total Paid ($)</label>
        <input id="cp-amount" type="number" step="0.01" min="0" inputmode="decimal" value="${rec ? parseFloat(rec.amount_paid).toFixed(2) : ''}"></div>
    </div>
    <div class="field"><label>Date Purchased</label>
      <input id="cp-date" type="date" value="${rec?.purchased_at || TODAY()}"></div>
    <div class="field"><label>Notes <span class="cogs-optional">(optional)</span></label>
      <input id="cp-notes" type="text" value="${esc(rec?.notes || '')}"></div>
    <button class="modal-save" onclick="saveCogsPackagingPurchase(${id || 'null'})">Save</button>
    ${rec ? `<button class="modal-del" onclick="deleteCogsPackagingPurchase(${id})">Delete</button>` : ''}
  `);
}

async function saveCogsPackagingPurchase(id) {
  const category = _val('cp-cat');
  const desc     = _val('cp-desc');
  const vendor   = _val('cp-vendor');
  const qty      = parseInt(_val('cp-qty')) || 0;
  const amount   = _num('cp-amount');
  const date     = _val('cp-date');
  if (!desc || !vendor || !qty || !amount || !date) { alert('Fill in all required fields.'); return; }

  const rec = { purchased_at: date, category, description: desc, vendor, quantity: qty, amount_paid: amount, unit_cost: amount / qty, notes: _val('cp-notes') };

  try {
    _setSavingState(true);
    if (id) {
      await dbUpdatePackagingPurchase({ id, ...rec });
      const idx = _packaging.findIndex(p => p.id === id);
      if (idx !== -1) _packaging[idx] = { id, ...rec, created_at: _packaging[idx].created_at };
    } else {
      const saved = await dbSavePackagingPurchase(rec);
      _packaging.unshift(saved);
    }
    _packaging.sort((a, b) => b.purchased_at.localeCompare(a.purchased_at));
    closeCogsModal();
    renderPackaging();
  } catch(e) { _setSavingState(false); console.error('Save packaging failed:', e); alert('Save failed: ' + (e?.message || e)); }
}

async function deleteCogsPackagingPurchase(id) {
  if (!confirm('Delete this packaging purchase?')) return;
  try {
    await dbDeletePackagingPurchase(id);
    _packaging = _packaging.filter(p => p.id !== id);
    closeCogsModal();
    renderPackaging();
  } catch(e) { console.error('Delete packaging failed:', e); alert('Delete failed: ' + (e?.message || e)); }
}

// ── Equipment Modal ───────────────────────────────────────────────

function openCogsEquipmentModal(id) {
  const rec = id ? _equipment.find(e => e.id === id) : null;

  _openCogsModal(rec ? 'Edit Equipment' : 'New Equipment Purchase', `
    ${_vendorDatalist()}
    <div class="field"><label>Item Name</label>
      <input id="ce-name" type="text" value="${esc(rec?.item_name || '')}" placeholder="e.g. Brewing vessel 5gal"></div>
    <div class="field"><label>Vendor</label>
      <input id="ce-vendor" type="text" list="dl-vendors" value="${esc(rec?.vendor || '')}" placeholder="e.g. Amazon"></div>
    <div class="field"><label>Amount Paid ($)</label>
      <input id="ce-amount" type="number" step="0.01" min="0" inputmode="decimal" value="${rec ? parseFloat(rec.amount_paid).toFixed(2) : ''}"></div>
    <div class="field"><label>Date Purchased</label>
      <input id="ce-date" type="date" value="${rec?.purchased_at || TODAY()}"></div>
    <div class="field"><label>Notes <span class="cogs-optional">(optional)</span></label>
      <input id="ce-notes" type="text" value="${esc(rec?.notes || '')}"></div>
    <button class="modal-save" onclick="saveCogsEquipmentPurchase(${id || 'null'})">Save</button>
    ${rec ? `<button class="modal-del" onclick="deleteCogsEquipmentPurchase(${id})">Delete</button>` : ''}
  `);
}

async function saveCogsEquipmentPurchase(id) {
  const name   = _val('ce-name');
  const vendor = _val('ce-vendor');
  const amount = _num('ce-amount');
  const date   = _val('ce-date');
  if (!name || !vendor || !amount || !date) { alert('Fill in all required fields.'); return; }

  const rec = { purchased_at: date, item_name: name, vendor, amount_paid: amount, notes: _val('ce-notes') };

  try {
    _setSavingState(true);
    if (id) {
      await dbUpdateEquipmentPurchase({ id, ...rec });
      const idx = _equipment.findIndex(e => e.id === id);
      if (idx !== -1) _equipment[idx] = { id, ...rec, created_at: _equipment[idx].created_at };
    } else {
      const saved = await dbSaveEquipmentPurchase(rec);
      _equipment.unshift(saved);
    }
    _equipment.sort((a, b) => b.purchased_at.localeCompare(a.purchased_at));
    closeCogsModal();
    renderEquipment();
  } catch(e) { _setSavingState(false); console.error('Save equipment failed:', e); alert('Save failed: ' + (e?.message || e)); }
}

async function deleteCogsEquipmentPurchase(id) {
  if (!confirm('Delete this equipment purchase?')) return;
  try {
    await dbDeleteEquipmentPurchase(id);
    _equipment = _equipment.filter(e => e.id !== id);
    closeCogsModal();
    renderEquipment();
  } catch(e) { console.error('Delete equipment failed:', e); alert('Delete failed: ' + (e?.message || e)); }
}

// ── Batch Modal ───────────────────────────────────────────────────

function openCogsBatchModal(id) {
  const rec = id ? _batches.find(b => b.id === id) : null;
  if (rec && rec.beans_used?.length) {
    _batchBeanRows = rec.beans_used.map(r => ({ name: r.name, grams: r.grams, unit: 'g', manual: false }));
  } else {
    _batchBeanRows = [{ name: '', grams: '', unit: 'g', manual: false }];
  }
  _batchType = rec?.batch_type || 'production';

  const skuOptions = (state.skus || []).map(s =>
    `<option value="${s.id}" data-name="${esc(s.name)}"${rec?.sku_id === s.id ? ' selected' : ''}>${esc(s.name)}</option>`
  ).join('');

  _openCogsModal(rec ? 'Edit Batch' : 'Log Batch', `
    ${_beanNameDatalist()}
    <div class="field-row">
      <div class="field"><label>Date Brewed</label>
        <input id="bat-date" type="date" value="${rec?.brewed_at || TODAY()}"></div>
      <div class="field"><label>SKU</label>
        <select id="bat-sku" class="pay-select">
          <option value="">Select SKU…</option>
          ${skuOptions}
        </select></div>
    </div>
    <div class="field"><label>Batch Type</label>
      <div class="type-pills">
        <button class="type-pill${_batchType === 'production' ? ' selected' : ''}" id="btp-production"
          onclick="selectBatchType('production')">For Sale</button>
        <button class="type-pill${_batchType === 'test' ? ' selected' : ''}" id="btp-test"
          onclick="selectBatchType('test')">Test</button>
      </div>
    </div>
    <div class="field"><label>Beans Used</label>
      <div id="bat-bean-rows"></div>
      <button class="cogs-add-bean-btn" onclick="addBatchBeanRow()">+ Add Bean</button>
    </div>
    <div class="field"><label>Bottles Produced</label>
      <input id="bat-bottles" type="number" min="0.5" step="0.5" inputmode="decimal" value="${rec?.bottles_produced || ''}" oninput="updateBatchCalc()"></div>
    <div class="field"><label>Notes <span class="cogs-optional">(optional)</span></label>
      <input id="bat-notes" type="text" value="${esc(rec?.notes || '')}"></div>
    <div class="cogs-calc-box" id="bat-calc">
      <div class="cogs-calc-row"><span>Bean Cost</span><span id="bat-bean-cost">—</span></div>
      <div class="cogs-calc-row"><span>Packaging Cost</span><span id="bat-pkg-cost">—</span></div>
      <div class="cogs-calc-row cogs-calc-total"><span>Total COGS</span><span id="bat-total-cogs">—</span></div>
      <div class="cogs-calc-row cogs-calc-total"><span>Cost / Bottle</span><span id="bat-cpb">—</span></div>
    </div>
    <button class="modal-save" onclick="saveCogsBatch(${id || 'null'})">Save Batch</button>
    ${rec ? `<button class="modal-del" onclick="deleteCogsBatch(${id})">Delete Batch</button>` : ''}
  `);

  renderBatchBeanRows();
  updateBatchCalc();
}

function selectBatchType(type) {
  _batchType = type;
  document.getElementById('btp-production')?.classList.toggle('selected', type === 'production');
  document.getElementById('btp-test')?.classList.toggle('selected', type === 'test');
}

function renderBatchBeanRows() {
  const el = document.getElementById('bat-bean-rows');
  if (!el) return;

  // Build select options from known bean names
  const knownBeans = [...new Set(_beans.map(b => b.bean_type))].filter(Boolean).sort();

  el.innerHTML = _batchBeanRows.map((row, idx) => {
    const { ppg, count } = avgBeanPriceInfo(row.name);
    const hint = row.name && row.name !== '__other__'
      ? (ppg > 0
          ? `$${ppg.toFixed(4)}/g avg · ${count} purchase${count !== 1 ? 's' : ''}`
          : 'no purchase on file — add to Bean Purchases first')
      : '';

    const selectOpts = [
      `<option value="">Select bean…</option>`,
      ...knownBeans.map(n =>
        `<option value="${esc(n)}"${row.name === n ? ' selected' : ''}>${esc(n)}</option>`
      ),
      `<option value="__other__"${row.name === '__other__' || (row.manual) ? ' selected' : ''}>— Enter manually —</option>`
    ].join('');

    const isManual = row.manual || (!knownBeans.includes(row.name) && row.name && row.name !== '__other__');

    return `
    <div class="bat-bean-row" id="bat-row-${idx}">
      <div class="bat-bean-line1">
        <select class="bat-bean-select" onchange="onBeanSelectChange(${idx}, this.value)">
          ${selectOpts}
        </select>
        ${_batchBeanRows.length > 1
          ? `<button class="item-remove" onclick="removeBatchBeanRow(${idx})">&#x2715;</button>`
          : ''}
      </div>
      ${isManual ? `
      <div class="bat-bean-manual">
        <input class="bat-bean-name-input" type="text" placeholder="Bean name" value="${esc(isManual && row.name !== '__other__' ? row.name : '')}"
          oninput="_batchBeanRows[${idx}].name=this.value; updateBatchCalc()">
      </div>` : ''}
      <div class="bat-bean-line2">
        <input class="bat-bean-grams" type="number" step="any" min="0" inputmode="decimal" placeholder="Amount"
          value="${row.grams || ''}" oninput="_batchBeanRows[${idx}].grams=this.value; updateBatchCalc()">
        <select class="cogs-unit-select" onchange="_batchBeanRows[${idx}].unit=this.value; updateBatchCalc()">
          <option value="g"${(row.unit||'g')==='g'?' selected':''}>g</option>
          <option value="kg"${row.unit==='kg'?' selected':''}>kg</option>
          <option value="lbs"${row.unit==='lbs'?' selected':''}>lbs</option>
        </select>
      </div>
      ${hint ? `<div class="bat-bean-hint">${hint}</div>` : ''}
    </div>`;
  }).join('');
}

function onBeanSelectChange(idx, value) {
  if (value === '__other__') {
    _batchBeanRows[idx].name   = '';
    _batchBeanRows[idx].manual = true;
  } else {
    _batchBeanRows[idx].name   = value;
    _batchBeanRows[idx].manual = false;
  }
  renderBatchBeanRows();
  updateBatchCalc();
}

function addBatchBeanRow() {
  _batchBeanRows.push({ name: '', grams: '', unit: 'g', manual: false });
  renderBatchBeanRows();
}

function removeBatchBeanRow(idx) {
  _batchBeanRows.splice(idx, 1);
  renderBatchBeanRows();
  updateBatchCalc();
}

function updateBatchCalc() {
  const bottles = parseFloat(_val('bat-bottles')) || 0;

  const beanCost = _batchBeanRows.reduce((sum, row) => {
    const g   = toGrams(parseFloat(row.grams) || 0, row.unit || 'g');
    const ppg = latestBeanPrice(row.name || '');
    return sum + g * ppg;
  }, 0);

  const bottleCost = latestPackagingUnitCost('bottles');
  const labelCost  = latestPackagingUnitCost('labels');
  const pkgCost    = bottles * (bottleCost + labelCost);
  const totalCogs  = beanCost + pkgCost;
  const cpb        = bottles > 0 ? totalCogs / bottles : 0;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('bat-bean-cost',   `$${beanCost.toFixed(2)}`);
  set('bat-pkg-cost',    `$${pkgCost.toFixed(2)}`);
  set('bat-total-cogs',  `$${totalCogs.toFixed(2)}`);
  set('bat-cpb',         bottles > 0 ? `$${cpb.toFixed(2)}` : '—');
}

async function saveCogsBatch(id) {
  const skuEl   = _fld('bat-sku');
  const skuId   = skuEl ? parseInt(skuEl.value) || null : null;
  const skuName = skuEl ? (skuEl.options[skuEl.selectedIndex]?.dataset?.name || skuEl.options[skuEl.selectedIndex]?.text || '') : '';
  const date    = _val('bat-date');
  const bottles = parseFloat(_val('bat-bottles')) || 0;

  if (!date || !bottles) { alert('Fill in date and bottles produced.'); return; }

  // Resolve bean names — manual entries come from the text input
  const manualInputs = document.querySelectorAll('.bat-bean-name-input');
  _batchBeanRows.forEach((row, idx) => {
    if (row.manual && manualInputs[idx]) row.name = manualInputs[idx].value.trim();
  });

  const beansUsed = _batchBeanRows
    .filter(r => r.name && r.name !== '__other__' && (parseFloat(r.grams) || 0) > 0)
    .map(r => ({ name: r.name.trim(), grams: toGrams(parseFloat(r.grams), r.unit || 'g') }));

  if (!beansUsed.length) { alert('Add at least one bean with a name and amount.'); return; }

  const beanCost = beansUsed.reduce((s, r) => s + r.grams * latestBeanPrice(r.name), 0);
  const pkgCost  = bottles * (latestPackagingUnitCost('Bottles') + latestPackagingUnitCost('Labels'));
  const total    = beanCost + pkgCost;
  const cpb      = total / bottles;

  const rec = {
    brewed_at:        date,
    sku_id:           skuId,
    sku_name:         skuName || 'Unknown',
    beans_used:       beansUsed,
    bottles_produced: bottles,
    bean_cost:        parseFloat(beanCost.toFixed(4)),
    packaging_cost:   parseFloat(pkgCost.toFixed(4)),
    total_cogs:       parseFloat(total.toFixed(4)),
    cost_per_bottle:  parseFloat(cpb.toFixed(4)),
    batch_type:       _batchType,
    notes:            _val('bat-notes')
  };

  try {
    _setSavingState(true);
    if (id) {
      await dbUpdateBatch({ id, ...rec });
      const idx = _batches.findIndex(b => b.id === id);
      if (idx !== -1) _batches[idx] = { id, ...rec };
    } else {
      const saved = await dbSaveBatch(rec);
      _batches.unshift(saved);
    }
    _batches.sort((a, b) => b.brewed_at.localeCompare(a.brewed_at));
    closeCogsModal();
    renderBatches();
  } catch(e) { _setSavingState(false); console.error('Save batch failed:', e); alert('Save failed: ' + (e?.message || e)); }
}

async function deleteCogsBatch(id) {
  if (!confirm('Delete this batch?')) return;
  try {
    await dbDeleteBatch(id);
    _batches = _batches.filter(b => b.id !== id);
    closeCogsModal();
    renderBatches();
  } catch(e) { console.error('Delete batch failed:', e); alert('Delete failed: ' + (e?.message || e)); }
}
