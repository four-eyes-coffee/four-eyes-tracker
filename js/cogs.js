/* ============================================================
   FOUR EYES COFFEE — storeHub/cogs.js
   Bean + bottle cost inputs — Phase 4
   ============================================================ */

(function initCogs() {
  const panel = document.getElementById('inner-cogs');
  if (!panel) return;

  panel.innerHTML = `
    <div style="padding:32px 0; text-align:center;">
      <div style="font-size:28px; margin-bottom:12px;">☕</div>
      <div style="font-size:11px; font-weight:900; letter-spacing:3px; text-transform:uppercase;
                  color:var(--muted); margin-bottom:8px;">Coming in Phase 4</div>
      <div style="font-size:12px; color:var(--muted); line-height:1.7; max-width:260px; margin:0 auto;">
        Enter bean bag costs and bottle prices to auto-calculate COGS and gross margin on the dashboard.
      </div>
    </div>
  `;
})();
