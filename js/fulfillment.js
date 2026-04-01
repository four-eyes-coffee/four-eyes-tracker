/* ============================================================
   FOUR EYES COFFEE — storeHub/fulfillment.js
   Pickup + delivery window management — future phase
   ============================================================ */

(function initFulfillment() {
  const panel = document.getElementById('inner-fulfillment');
  if (!panel) return;

  panel.innerHTML = `
    <div style="padding:32px 0; text-align:center;">
      <div style="font-size:28px; margin-bottom:12px;">🚚</div>
      <div style="font-size:11px; font-weight:900; letter-spacing:3px; text-transform:uppercase;
                  color:var(--muted); margin-bottom:8px;">Coming Soon</div>
      <div style="font-size:12px; color:var(--muted); line-height:1.7; max-width:260px; margin:0 auto;">
        Manage pickup windows, delivery windows, and best-day preferences for your drops.
      </div>
    </div>
  `;
})();
