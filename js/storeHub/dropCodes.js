/* ============================================================
   FOUR EYES COFFEE — storeHub/dropCodes.js
   Drop code generator. Supports family (pickup + delivery)
   and public (pickup only) codes simultaneously.
   ============================================================ */

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

// ── Code generation ───────────────────────────────────────────────

function _buildCode() {
  const themes = Object.keys(CODE_THEMES);
  const theme  = themes[Math.floor(Math.random() * themes.length)];
  const words  = CODE_THEMES[theme];
  const phrase = words[Math.floor(Math.random() * words.length)];
  const num    = String(Math.floor(Math.random() * 90) + 10);
  const parts  = phrase.split('-');
  const pos    = Math.floor(Math.random() * 3); // 0=before, 1=middle, 2=after

  if (pos === 0) return num + '-' + phrase;
  if (pos === 2) return phrase + '-' + num;
  if (parts.length > 1) {
    const mid = Math.floor(parts.length / 2);
    parts.splice(mid, 0, num);
    return parts.join('-');
  }
  return phrase + '-' + num;
}

function generateCode(codeType) {
  const code    = _buildCode();
  const expires = new Date();
  expires.setDate(expires.getDate() + 7);

  _renderCodeCard(codeType, { code, expires_at: expires.toISOString() });
  dbSaveCode(code, expires.toISOString(), codeType)
    .catch(e => console.error('Save code failed:', e));
}

// ── Render helpers ────────────────────────────────────────────────

function _fmtExpiry(expiresAt) {
  if (!expiresAt) return '';
  return 'Expires ' + new Date(expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function _renderCodeCard(codeType, data) {
  const prefix  = codeType === 'family' ? 'family' : 'public';
  const display = document.getElementById(prefix + '-code-display');
  const expiry  = document.getElementById(prefix + '-code-expiry');
  if (display) display.textContent = data ? data.code : '—';
  if (expiry)  expiry.textContent  = data ? _fmtExpiry(data.expires_at) : 'No active code';
}

async function loadActiveCodes() {
  try {
    const codes  = await dbLoadActiveCodes();
    const family = codes.find(c => (c.code_type || 'public') === 'family') || null;
    const pub    = codes.find(c => (c.code_type || 'public') === 'public') || null;
    _renderCodeCard('family', family);
    _renderCodeCard('public', pub);
  } catch(e) {
    console.error('Load active codes failed:', e);
  }
}

// ── Copy ──────────────────────────────────────────────────────────

function copyCode(codeType) {
  const prefix = codeType === 'family' ? 'family' : 'public';
  const code   = document.getElementById(prefix + '-code-display')?.textContent;
  if (!code || code === '—') return;

  const showCheck = () => {
    const copyIcon  = document.getElementById(prefix + '-copy-icon');
    const checkIcon = document.getElementById(prefix + '-check-icon');
    if (copyIcon)  copyIcon.style.display  = 'none';
    if (checkIcon) checkIcon.style.display = 'block';
    setTimeout(() => {
      if (copyIcon)  copyIcon.style.display  = 'block';
      if (checkIcon) checkIcon.style.display = 'none';
    }, 1500);
  };

  navigator.clipboard.writeText(code).then(showCheck).catch(() => {
    const el = document.createElement('textarea');
    el.value = code;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showCheck();
  });
}

// ── Deactivate ────────────────────────────────────────────────────

async function deactivateCode(codeType) {
  try {
    await dbDeactivateCode(codeType);
    _renderCodeCard(codeType, null);
  } catch(e) {
    console.error('Deactivate code failed:', e);
  }
}
