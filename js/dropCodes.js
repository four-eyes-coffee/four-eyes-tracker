/* ============================================================
   FOUR EYES COFFEE — storeHub/dropCodes.js
   Weekly drop code generator. Ported from old Drop tab.
   ============================================================ */

// Single source of truth for all themed code words
const CODE_THEMES = {
  four_eyes:   ['FIRST-BLOOM','DRAGON-PEARL','OFFBEAT-AURA','HAZE-RISE','OBSERVER',
                 'SLOW-DRIP','COLD-SOUL','FOUR-EYES','COFFEE-WITH-SOUL','PATIENCE'],
  coffee_vibe: ['SLOW-POUR','COLD-WAVE','DARK-PULL','DEEP-BREW','STILL-STEEP',
                 'QUIET-GRIND','DARK-MATTER','SLOW-EXTRACT','COLD-PRESS','DEEP-ROAST'],
  la_soul:     ['GOLDEN-HOUR','MARINE-LAYER','ECHO-SOUL','SILVER-LAKE','CRENSHAW-WAVE',
                 'SUNSET-PULL','EAST-SIDE','HIGHLAND-DRIP','ANGELES-SLOW','PICO-FLOW'],
  soul_life:   ['QUIET-STORM','STILL-WATER','SLOW-BURN','DEEP-CUTS','INNER-PEACE',
                 'SOUL-TIED','GOOD-FEELING','WARM-LIGHT','STEADY-WAVE','ROOT-DOWN']
};

function initDropCodes() {
  const panel = document.getElementById('inner-dropcodes');
  if (!panel) return;

  panel.innerHTML = `
    <div class="sec-row" style="margin-top:8px;">
      <span class="sec-label">Weekly Drop Code</span>
    </div>

    <div class="rev-card">
      <div class="rev-title">Active Code</div>
      <div class="code-row">
        <div id="active-code-display" class="active-code-text">—</div>
        <button id="copy-code-btn" onclick="copyCode()" class="copy-code-btn" title="Copy code">
          <svg id="copy-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
               viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
          </svg>
          <svg id="check-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18"
               viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"
               stroke-linecap="round" stroke-linejoin="round" style="display:none;">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </button>
      </div>
      <div id="active-code-expiry" class="active-code-expiry">No active code</div>
    </div>

    <button class="submit-btn submit-btn--mb" onclick="generateCode()">Generate New Code</button>
    <button class="reset-btn" onclick="deactivateCode()">Deactivate Current Code</button>
  `;
}

// ── Code generation ───────────────────────────────────────────────

function generateCode() {
  const themes  = Object.keys(CODE_THEMES);
  const theme   = themes[Math.floor(Math.random() * themes.length)];
  const words   = CODE_THEMES[theme];
  const phrase  = words[Math.floor(Math.random() * words.length)];
  const num     = String(Math.floor(Math.random() * 90) + 10);
  const parts   = phrase.split('-');
  const pos     = Math.floor(Math.random() * 3); // 0=before, 1=middle, 2=after

  let code;
  if (pos === 0) {
    code = num + '-' + phrase;
  } else if (pos === 2) {
    code = phrase + '-' + num;
  } else {
    if (parts.length > 1) {
      const mid = Math.floor(parts.length / 2);
      parts.splice(mid, 0, num);
      code = parts.join('-');
    } else {
      code = phrase + '-' + num;
    }
  }

  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  showActiveCode(code, expires);
  dbSaveCode(code, expires.toISOString()).catch(e => console.error('Save code failed:', e));
}

function showActiveCode(code, expires) {
  const displayEl = document.getElementById('active-code-display');
  const expiryEl  = document.getElementById('active-code-expiry');
  if (displayEl) displayEl.textContent = code;
  if (expiryEl) {
    const expDate = new Date(expires).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    expiryEl.textContent = 'Expires ' + expDate;
  }
}

async function loadActiveCode() {
  try {
    const data      = await dbLoadActiveCode();
    const displayEl = document.getElementById('active-code-display');
    const expiryEl  = document.getElementById('active-code-expiry');
    if (data) {
      showActiveCode(data.code, data.expires_at);
    } else {
      if (displayEl) displayEl.textContent = '—';
      if (expiryEl)  expiryEl.textContent  = 'No active code';
    }
  } catch(e) {
    console.error('Load active code failed:', e);
  }
}

function copyCode() {
  const code = document.getElementById('active-code-display').textContent;
  if (!code || code === '—') return;

  const showCheck = () => {
    document.getElementById('copy-icon').style.display  = 'none';
    document.getElementById('check-icon').style.display = 'block';
    setTimeout(() => {
      document.getElementById('copy-icon').style.display  = 'block';
      document.getElementById('check-icon').style.display = 'none';
    }, 1500);
  };

  navigator.clipboard.writeText(code).then(showCheck).catch(() => {
    // Fallback for older iOS Safari
    const el = document.createElement('textarea');
    el.value = code;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showCheck();
  });
}

async function deactivateCode() {
  try {
    await dbDeactivateCode();
    const displayEl = document.getElementById('active-code-display');
    const expiryEl  = document.getElementById('active-code-expiry');
    if (displayEl) displayEl.textContent = '—';
    if (expiryEl)  expiryEl.textContent  = 'No active code';
  } catch(e) {
    console.error('Deactivate code failed:', e);
  }
}

// ── Init on script load ───────────────────────────────────────────
initDropCodes();
