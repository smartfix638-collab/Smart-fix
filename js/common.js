/* ============================================================
   SMARTFIX ERP — Common Utilities
   File: js/common.js
   Version: 4.0.0
   Purpose: Shared helper functions used across all modules
   ============================================================ */

/* ============================================================
   1. DATE & FINANCIAL YEAR
   ============================================================ */

/**
 * Format a Date object as "YYYY-MM-DD"
 */
export function fmtDate(d) {
  if (!d) d = new Date();
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Format as "DD-MMM-YYYY" (e.g. 11-Oct-2026)
 */
export function fmtDatePretty(d) {
  if (!d) d = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Get Indian Financial Year (April 1 → March 31)
 */
export function getFY(dt) {
  dt = dt || new Date();
  const y = dt.getFullYear();
  const m = dt.getMonth(); // 0-11
  if (m >= 3) {
    // April–December
    return {
      label: `FY ${y}-${String(y + 1).slice(-2)}`,
      short: `${y}${String(y + 1).slice(-2)}`,
      start: new Date(y, 3, 1),
      end:   new Date(y + 1, 2, 31, 23, 59, 59)
    };
  }
  // January–March
  return {
    label: `FY ${y - 1}-${String(y).slice(-2)}`,
    short: `${y - 1}${String(y).slice(-2)}`,
    start: new Date(y - 1, 3, 1),
    end:   new Date(y, 2, 31, 23, 59, 59)
  };
}

/**
 * Today's date string "YYYY-MM-DD"
 */
export function today() {
  return fmtDate(new Date());
}


/* ============================================================
   2. CURRENCY & NUMBER
   ============================================================ */

/**
 * Format number as Indian Rupee: ₹1,23,456.78
 */
export function money(n) {
  const v = Number(n) || 0;
  return '₹' + v.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/**
 * Plain number with commas: 1,23,456
 */
export function numFmt(n, decimals = 0) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

/**
 * Round to 2 decimal places (returns number)
 */
export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Convert number to Indian words for invoice
 * Example: 125000 → "ONE LAKH TWENTY FIVE THOUSAND RUPEES ONLY"
 */
export function numberToWords(num) {
  const a = ['', 'ONE ', 'TWO ', 'THREE ', 'FOUR ', 'FIVE ', 'SIX ',
             'SEVEN ', 'EIGHT ', 'NINE ', 'TEN ', 'ELEVEN ', 'TWELVE ',
             'THIRTEEN ', 'FOURTEEN ', 'FIFTEEN ', 'SIXTEEN ',
             'SEVENTEEN ', 'EIGHTEEN ', 'NINETEEN '];
  const b = ['', '', 'TWENTY ', 'THIRTY ', 'FORTY ', 'FIFTY ',
             'SIXTY ', 'SEVENTY ', 'EIGHTY ', 'NINETY '];

  const n = ('000000000' + Math.floor(Number(num) || 0)).slice(-9);
  const match = n.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!match) return '';

  let str = '';
  str += (match[1] != 0) ? (a[Number(match[1])] || b[match[1][0]] + a[match[1][1]]) + 'CRORE '   : '';
  str += (match[2] != 0) ? (a[Number(match[2])] || b[match[2][0]] + a[match[2][1]]) + 'LAKH '    : '';
  str += (match[3] != 0) ? (a[Number(match[3])] || b[match[3][0]] + a[match[3][1]]) + 'THOUSAND ': '';
  str += (match[4] != 0) ? (a[Number(match[4])] || b[match[4][0]] + a[match[4][1]]) + 'HUNDRED ' : '';
  str += (match[5] != 0)
    ? ((str !== '') ? 'AND ' : '') + (a[Number(match[5])] || b[match[5][0]] + a[match[5][1]]) + 'RUPEES ONLY'
    : 'RUPEES ONLY';

  return str.trim();
}


/* ============================================================
   3. BARCODE / SCANNER HELPERS
   ============================================================ */

/**
 * Play a short beep (barcode scan confirmation)
 */
export function playBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 1350;
    gain.gain.value = 0.12;
    osc.start();
    setTimeout(() => {
      try { osc.stop(); ctx.close(); } catch (e) {}
    }, 70);
  } catch (e) { /* silent fail */ }
}

/**
 * Play a longer error buzz
 */
export function playErrorBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.value = 320;
    gain.gain.value = 0.15;
    osc.start();
    setTimeout(() => {
      try { osc.stop(); ctx.close(); } catch (e) {}
    }, 220);
  } catch (e) { /* silent fail */ }
}

/**
 * Normalize IMEI/Serial: uppercase + remove spaces/dashes
 */
export function normalizeIMEI(str) {
  return (str || '').toString().trim().toUpperCase().replace(/[\s\-_]/g, '');
}


/* ============================================================
   4. IMAGE HANDLING
   ============================================================ */

/**
 * Resize an uploaded image file to a data URL (JPEG)
 * @param {File} file - input file
 * @param {number} maxDim - max width/height (default 400)
 * @returns {Promise<string>} data URL
 */
export function resizeImage(file, maxDim = 400) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
        else if (h > maxDim)     { w = Math.round(w * maxDim / h); h = maxDim; }
        cv.width = w;
        cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        try {
          resolve(cv.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          resolve('');
        }
      };
      img.onerror = () => resolve('');
      img.src = e.target.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}


/* ============================================================
   5. LOCALSTORAGE WRAPPER
   ============================================================ */

/**
 * Save JSON to localStorage with quota error handling
 */
export function safeSave(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('safeSave failed for', key, e);
    toast('Storage full! Delete old records or export backup.', 'error', 5000);
    return false;
  }
}

/**
 * Load JSON from localStorage with default fallback
 */
export function safeLoad(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    console.warn('safeLoad failed for', key, e);
    return fallback;
  }
}

/**
 * Remove a key
 */
export function safeRemove(key) {
  try { localStorage.removeItem(key); return true; }
  catch (e) { return false; }
}


/* ============================================================
   6. UI — TOAST NOTIFICATIONS
   ============================================================ */

let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.id = 'sfToastContainer';
  toastContainer.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
    max-width: 360px;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
}

/**
 * Show a toast notification
 * @param {string} msg - message text
 * @param {string} type - 'info' | 'success' | 'error' | 'warning'
 * @param {number} duration - ms to show (default 3000)
 */
export function toast(msg, type = 'info', duration = 3000) {
  const container = ensureToastContainer();
  const colors = {
    info:    { bg: '#0c4a6e', border: '#0ea5e9', icon: 'ℹ️' },
    success: { bg: '#064e3b', border: '#10b981', icon: '✅' },
    error:   { bg: '#7f1d1d', border: '#ef4444', icon: '❌' },
    warning: { bg: '#78350f', border: '#f59e0b', icon: '⚠️' }
  };
  const c = colors[type] || colors.info;

  const el = document.createElement('div');
  el.style.cssText = `
    pointer-events: auto;
    background: ${c.bg};
    border: 1px solid ${c.border};
    color: #f1f5f9;
    padding: 12px 14px;
    border-radius: 10px;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    display: flex;
    align-items: flex-start;
    gap: 10px;
    opacity: 0;
    transform: translateX(20px);
    transition: all 0.25s ease;
    line-height: 1.4;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  el.innerHTML = `
    <span style="font-size:15px;line-height:1">${c.icon}</span>
    <span style="flex:1">${escapeHTML(msg)}</span>
  `;
  container.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => { try { el.remove(); } catch (e) {} }, 300);
  }, duration);
}


/* ============================================================
   7. UI — MODAL / CONFIRM
   ============================================================ */

/**
 * Beautiful confirm dialog (native confirm is ugly)
 * @returns {Promise<boolean>}
 */
export function confirmDialog(title, message, okLabel = 'Confirm', dangerous = false) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 99998;
      display: flex; align-items: center; justify-content: center;
      padding: 16px;
      opacity: 0;
      transition: opacity 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    overlay.innerHTML = `
      <div style="
        background: #0b1220;
        border: 1px solid #1e293b;
        border-radius: 16px;
        padding: 22px;
        max-width: 420px;
        width: 100%;
        color: #e2e8f0;
        box-shadow: 0 24px 80px rgba(0,0,0,0.7);
        transform: scale(0.95);
        transition: transform 0.2s;
      ">
        <div style="font-size:16px;font-weight:800;margin-bottom:8px;color:#fff">${escapeHTML(title)}</div>
        <div style="font-size:13px;color:#94a3b8;line-height:1.5;white-space:pre-line">${escapeHTML(message)}</div>
        <div style="display:flex;gap:8px;margin-top:20px;justify-content:flex-end">
          <button type="button" data-act="cancel" style="
            padding: 9px 16px; border-radius: 8px;
            border: 1px solid #334155; background: transparent;
            color: #cbd5e1; font-weight: 700; font-size: 13px; cursor: pointer;
            font-family: inherit;
          ">Cancel</button>
          <button type="button" data-act="ok" style="
            padding: 9px 16px; border-radius: 8px;
            border: none;
            background: ${dangerous ? 'linear-gradient(135deg,#ef4444,#b91c1c)' : 'linear-gradient(135deg,#0ea5e9,#0369a1)'};
            color: #fff; font-weight: 700; font-size: 13px; cursor: pointer;
            font-family: inherit;
          ">${escapeHTML(okLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => {
      overlay.style.opacity = '1';
      const card = overlay.querySelector('div > div');
      if (card) card.style.transform = 'scale(1)';
    });

    const close = (result) => {
      overlay.style.opacity = '0';
      setTimeout(() => { try { overlay.remove(); } catch (e) {} }, 200);
      resolve(result);
    };

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
      const act = e.target.dataset?.act;
      if (act === 'ok') close(true);
      if (act === 'cancel') close(false);
    });
  });
}


/* ============================================================
   8. STRING HELPERS
   ============================================================ */

/**
 * Escape HTML to prevent XSS
 */
export function escapeHTML(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Truncate a long string
 */
export function truncate(str, n = 30) {
  str = String(str || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

/**
 * Slugify (lowercase + hyphens)
 */
export function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}


/* ============================================================
   9. FUNCTION HELPERS
   ============================================================ */

/**
 * Debounce: delay function execution until input stops
 */
export function debounce(fn, wait = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

/**
 * Throttle: limit execution frequency
 */
export function throttle(fn, wait = 200) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn.apply(this, args);
    }
  };
}

/**
 * Generate a random unique ID (string)
 */
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/**
 * Deep clone a JSON-safe object
 */
export function clone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    return obj;
  }
}

/**
 * Sleep for n milliseconds
 */
export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}


/* ============================================================
   10. VALIDATION
   ============================================================ */

/**
 * Validate email
 */
export function isEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str || '');
}

/**
 * Validate Indian phone (10 digits)
 */
export function isPhone10(str) {
  return /^\d{10}$/.test((str || '').trim());
}

/**
 * Validate GSTIN (15 chars)
 */
export function isGSTIN(str) {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test((str || '').toUpperCase());
}

/**
 * Validate IMEI (15 digits)
 */
export function isIMEI15(str) {
  return /^\d{15}$/.test(normalizeIMEI(str));
}


/* ============================================================
   11. NUMBER PARSING (safe)
   ============================================================ */

/**
 * Parse any input to a safe number
 */
export function toNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse to integer
 */
export function toInt(v, fallback = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}


/* ============================================================
   12. EXPORT DEFAULT OBJECT (optional convenience)
   ============================================================ */
export default {
  fmtDate, fmtDatePretty, getFY, today,
  money, numFmt, round2, numberToWords,
  playBeep, playErrorBeep, normalizeIMEI,
  resizeImage,
  safeSave, safeLoad, safeRemove,
  toast, confirmDialog,
  escapeHTML, truncate, slugify,
  debounce, throttle, uid, clone, sleep,
  isEmail, isPhone10, isGSTIN, isIMEI15,
  toNum, toInt
};


/* ============================================================
   13. GLOBAL CONSOLE ACCESS (for debugging in dev tools)
   ============================================================ */
window.SF = window.SF || {};
window.SF.common = {
  fmtDate, getFY, money, numberToWords,
  toast, confirmDialog, safeSave, safeLoad,
  normalizeIMEI, playBeep
};


/* ============================================================
   14. BOOT LOG
   ============================================================ */
console.log(
  '%c🧰 Common utilities loaded',
  'color:#a78bfa;font-weight:bold;font-size:11px'
);
