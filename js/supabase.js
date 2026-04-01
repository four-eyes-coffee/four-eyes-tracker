/* ============================================================
   FOUR EYES COFFEE — supabase.js
   ALL database calls live here. Nothing else touches _supa.
   Import pattern: call db* functions from any other module.
   ============================================================ */

const SUPA_URL = 'https://kqmdnrlpfbnnxxtgbrgd.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtxbWRucmxwZmJubnh4dGdicmdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4MzE5MjksImV4cCI6MjA5MDQwNzkyOX0.e6kvqx3PHLkpJJc6PiJ6TmBS9f9f0gk5-r2i_vnx5xQ';

let _supa = null;

// Call once after the Supabase CDN script is ready
function dbInit() {
  _supa = supabase.createClient(SUPA_URL, SUPA_KEY);
}

// ── SKUs ──────────────────────────────────────────────────────────

// Load all active SKUs
async function dbLoadSkus() {
  const { data, error } = await _supa
    .from('skus')
    .select('*')
    .eq('active', true)
    .order('id');
  if (error) throw error;
  return (data || []).map(s => ({
    id:    s.id,
    name:  s.name,
    stock: s.stock,
    sold:  s.sold,
    price: parseFloat(s.price)
  }));
}

// Upsert a SKU (create or update)
async function dbSaveSku(sku) {
  const { error } = await _supa.from('skus').upsert({
    id:     sku.id,
    name:   sku.name,
    stock:  sku.stock,
    sold:   sku.sold,
    price:  sku.price,
    active: true
  });
  if (error) throw error;
}

// Soft-delete: mark inactive rather than destroying
async function dbDeleteSku(id) {
  const { error } = await _supa.from('skus').update({ active: false }).eq('id', id);
  if (error) throw error;
}

// Sync sold count after a sale or edit
async function dbUpdateSkuSold(id, sold) {
  const { error } = await _supa.from('skus').update({ sold }).eq('id', id);
  if (error) throw error;
}

// ── Orders (completed sales) ──────────────────────────────────────

// Load all completed orders with their line items
async function dbLoadOrders() {
  const { data, error } = await _supa
    .from('orders')
    .select('*, order_items(*)')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(o => ({
    id:        o.id,
    name:      o.customer_name || '—',
    items:     (o.order_items || []).map(i => ({
      skuId:   i.sku_id,
      skuName: i.sku_name,
      qty:     i.qty,
      price:   parseFloat(i.price)
    })),
    pay:       o.pay_method,
    discount:  parseFloat(o.discount) || 0,
    total:     parseFloat(o.total) || 0,
    time:      new Date(o.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    createdAt: o.created_at   // preserved for correct month-key calculation
  }));
}

// Write a walk-up sale as a completed order
async function dbSaveOrder(sale) {
  // Upsert customer by name (walk-up sales don't have email)
  let customerId = null;
  const { data: existing } = await _supa
    .from('customers')
    .select('id, total_orders')
    .eq('name', sale.name)
    .maybeSingle();

  if (existing) {
    customerId = existing.id;
    await _supa.from('customers')
      .update({ total_orders: (existing.total_orders || 0) + 1 })
      .eq('id', customerId);
  } else {
    const { data: newCust } = await _supa.from('customers').insert({
      name:            sale.name,
      first_order_at:  new Date().toISOString(),
      total_orders:    1
    }).select().single();
    if (newCust) customerId = newCust.id;
  }

  // Insert order header
  const { data: orderData, error: orderError } = await _supa.from('orders').insert({
    customer_id:   customerId,
    customer_name: sale.name,
    status:        'completed',
    pay_method:    sale.pay,
    discount:      sale.discount,
    total:         sale.total,
    created_at:    new Date().toISOString()
  }).select().single();
  if (orderError) throw orderError;

  // Insert line items
  if (orderData && sale.items && sale.items.length) {
    const { error: itemsError } = await _supa.from('order_items').insert(
      sale.items.map(i => ({
        order_id: orderData.id,
        sku_id:   i.skuId,
        sku_name: i.skuName,
        qty:      i.qty,
        price:    i.price
      }))
    );
    if (itemsError) throw itemsError;
  }

  return orderData;
}

// Delete a sale and its line items, then revert SKU sold counts
async function dbDeleteOrder(id) {
  await _supa.from('order_items').delete().eq('order_id', id);
  const { error } = await _supa.from('orders').delete().eq('id', id);
  if (error) throw error;
}

// Update editable fields on a completed order
async function dbUpdateOrder(sale) {
  const { error } = await _supa.from('orders').update({
    customer_name: sale.name,
    pay_method:    sale.pay,
    discount:      sale.discount,
    total:         sale.total
  }).eq('id', sale.id);
  if (error) throw error;

  // Update each line item qty in parallel
  await Promise.all(sale.items.map(item =>
    _supa.from('order_items')
      .update({ qty: item.qty })
      .eq('order_id', sale.id)
      .eq('sku_id', item.skuId)
  ));
}

// ── Pending orders (pre-orders from order.html) ───────────────────

// Load all pending orders with line items
async function dbLoadPending() {
  const { data, error } = await _supa
    .from('orders')
    .select('*, order_items(*)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Aggregate pending quantities per SKU for the dashboard overlay
async function dbLoadPendingCounts() {
  const { data, error } = await _supa
    .from('orders')
    .select('order_items(sku_id, qty)')
    .eq('status', 'pending');
  if (error) throw error;
  const counts = {};
  (data || []).forEach(o =>
    (o.order_items || []).forEach(i => {
      counts[i.sku_id] = (counts[i.sku_id] || 0) + i.qty;
    })
  );
  return counts;
}

// Approve a pending order — mark completed with chosen payment method
async function dbConfirmPendingOrder(id, payMethod) {
  const { error } = await _supa.from('orders').update({
    status:     'completed',
    pay_method: payMethod
  }).eq('id', id);
  if (error) throw error;
}

// Decline / reject a pending order
async function dbRejectOrder(id) {
  const { error } = await _supa.from('orders').update({ status: 'rejected' }).eq('id', id);
  if (error) throw error;
}

// ── Access codes (drop codes) ─────────────────────────────────────

// Fetch the currently active drop code, or null
async function dbLoadActiveCode() {
  const { data, error } = await _supa
    .from('access_codes')
    .select('*')
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data; // null if none active
}

// Deactivate any current code, then insert the new one
async function dbSaveCode(code, expiresAt) {
  await _supa.from('access_codes').update({ active: false }).eq('active', true);
  const { error } = await _supa.from('access_codes').insert({
    code,
    active:     true,
    expires_at: expiresAt
  });
  if (error) throw error;
}

// Deactivate the active code without replacing it
async function dbDeactivateCode() {
  const { error } = await _supa.from('access_codes').update({ active: false }).eq('active', true);
  if (error) throw error;
}

// ── Bulk load (called on init + refresh) ─────────────────────────

// Returns { skus, orders } — single round-trip pair
async function dbLoad() {
  const [skus, orders] = await Promise.all([
    dbLoadSkus(),
    dbLoadOrders()
  ]);
  return { skus, orders };
}
