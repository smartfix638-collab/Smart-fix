/* ============================================================
   SMARTFIX ERP — Global State Manager
   File: js/state.js
   Version: 4.0.0
   Purpose:
     • Single source of truth for all app data
     • Loads from localStorage (instant offline boot)
     • Broadcasts change events for UI refresh
     • Holds current store metadata
   ============================================================ */

import { safeLoad, safeSave, safeRemove } from './common.js';

/* ============================================================
   1. STORAGE KEYS
   ============================================================ */
export const KEYS = {
  STORE_PROFILE:     'sfp_store_profile',
  CURRENT_STORE:     'sfp_current_store',
  INVOICES:          'sfp_invoices',
  CREDIT_NOTES:      'sfp_credit_notes',
  VOUCHERS:          'sfp_vouchers',
  INVENTORY:         'sfp_stock',
  PURCHASES:         'sfp_purchases',
  PARTIES:           'sfp_parties',
  STAFF:             'sfp_staff',
  SALARY_PAYMENTS:   'sfp_salary_payments',
  AUDIT_LOG:         'sfp_audit',
  CATEGORIES:        'sfp_categories',
  ACTIVE_CART:       'sfp_active_cart'
};

/* ============================================================
   2. DEFAULT VALUES
   ============================================================ */
const DEFAULT_CATEGORIES = [
  'Mobile Phone',
  'Mobile Cover',
  'Tempered Glass',
  'Cable',
  'Charger',
  'Earphone',
  'Power Bank',
  'Memory Card',
  'Other'
];

const DEFAULT_PROFILE = {
  name:       'My Store',
  phone:      '',
  gstin:      '',
  address:    '',
  logo:       '',
  bankName:   '',
  bankBranch: '',
  bankAcc:    '',
  bankIFSC:   '',
  upiId:      '',
  terms:      '1. Subject to Local Jurisdiction.\n2. Warranty covered by Brand Authorized Service Centers.\n3. Goods once sold will not be taken back without original invoice.',
  masterPin:  '',
  isLocked:   false
};

/* ============================================================
   3. STATE OBJECT
   ============================================================ */
export const state = {
  /* Session */
  store:      null,   // { uid, shopName, shopCode, email }
  profile:    { ...DEFAULT_PROFILE },

  /* Collections */
  invoices:       [],
  creditNotes:    [],
  vouchers:       [],
  inventory:      [],
  purchases:      [],
  parties:        [],
  staff:          [],
  salaryPayments: [],
  auditLog:       [],
  categories:     [...DEFAULT_CATEGORIES],

  /* UI / Runtime */
  activeCart:        [],   // items in current bill
  activePurchaseLines: [],
  activeReturnInvoice: null,
  purScannedBatch:   [],
  stkScannedBatch:   [],

  /* Meta */
  loaded:      false,
  cloudReady:  false,
  netOnline:   navigator.onLine,
  lastSyncAt:  null
};

/* ============================================================
   4. LOAD FROM LOCALSTORAGE (instant boot)
   ============================================================ */
export function loadLocalState() {
  state.profile    = safeLoad(KEYS.STORE_PROFILE, { ...DEFAULT_PROFILE }) || { ...DEFAULT_PROFILE };
  state.store      = safeLoad(KEYS.CURRENT_STORE, null);
  state.invoices        = safeLoad(KEYS.INVOICES, []) || [];
  state.creditNotes     = safeLoad(KEYS.CREDIT_NOTES, []) || [];
  state.vouchers        = safeLoad(KEYS.VOUCHERS, []) || [];
  state.inventory       = safeLoad(KEYS.INVENTORY, []) || [];
  state.purchases       = safeLoad(KEYS.PURCHASES, []) || [];
  state.parties         = safeLoad(KEYS.PARTIES, []) || [];
  state.staff           = safeLoad(KEYS.STAFF, []) || [];
  state.salaryPayments  = safeLoad(KEYS.SALARY_PAYMENTS, []) || [];
  state.auditLog        = safeLoad(KEYS.AUDIT_LOG, []) || [];
  state.categories      = safeLoad(KEYS.CATEGORIES, [...DEFAULT_CATEGORIES]) || [...DEFAULT_CATEGORIES];

  /* Ensure arrays */
  ['invoices','creditNotes','vouchers','inventory','purchases',
   'parties','staff','salaryPayments','auditLog','categories'].forEach((k) => {
    if (!Array.isArray(state[k])) state[k] = [];
  });

  /* Ensure profile has all keys */
  state.profile = { ...DEFAULT_PROFILE, ...state.profile };

  state.loaded = true;
  console.log('%c📦 Local state loaded', 'color:#f59e0b;font-weight:bold',
    `| invoices: ${state.invoices.length}`,
    `| stock: ${state.inventory.length}`,
    `| parties: ${state.parties.length}`);
}

/* ============================================================
   5. SAVE HELPERS (writes to localStorage; cloud layer hooks in)
   ============================================================ */
export function saveCollection(key, data) {
  return safeSave(key, data);
}

export function saveProfile(profile) {
  state.profile = { ...DEFAULT_PROFILE, ...profile };
  return safeSave(KEYS.STORE_PROFILE, state.profile);
}

export function saveCurrentStore(store) {
  state.store = store;
  if (store) {
    return safeSave(KEYS.CURRENT_STORE, store);
  }
  return safeRemove(KEYS.CURRENT_STORE);
}

export function clearAllLocalData() {
  Object.values(KEYS).forEach((k) => safeRemove(k));
}

/* ============================================================
   6. EVENT SYSTEM (data change → UI refresh)
   ============================================================ */
const _listeners = {};

export function on(event, callback) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(callback);
  return () => off(event, callback);
}

export function off(event, callback) {
  if (!_listeners[event]) return;
  _listeners[event] = _listeners[event].filter((cb) => cb !== callback);
}

export function emit(event, payload) {
  const callbacks = _listeners[event] || [];
  callbacks.forEach((cb) => {
    try { cb(payload); } catch (e) { console.error('Listener error on', event, e); }
  });
  /* Also fire '*' listeners for catch-all */
  (_listeners['*'] || []).forEach((cb) => {
    try { cb({ event, payload }); } catch (e) { }
  });
}

/* ============================================================
   7. DATA MUTATION HELPERS (trigger events + save + sync)
   ============================================================ */

/**
 * Update a collection and broadcast change
 */
export function setCollection(name, data) {
  state[name] = Array.isArray(data) ? data : [];
  emit('change:' + name, state[name]);
  emit('change', { name, data: state[name] });
}

/**
 * Add item(s) to a collection
 */
export function addToCollection(name, item) {
  if (!Array.isArray(state[name])) state[name] = [];
  if (Array.isArray(item)) {
    state[name] = [...item, ...state[name]];
  } else {
    state[name] = [item, ...state[name]];
  }
  emit('change:' + name, state[name]);
  emit('change', { name, data: state[name] });
  return state[name];
}

/**
 * Remove item from collection by id field
 */
export function removeFromCollection(name, id, idField = 'id') {
  state[name] = (state[name] || []).filter((x) => x[idField] !== id);
  emit('change:' + name, state[name]);
  emit('change', { name, data: state[name] });
  return state[name];
}

/**
 * Update a single item in a collection
 */
export function updateInCollection(name, id, patch, idField = 'id') {
  state[name] = (state[name] || []).map((x) =>
    x[idField] === id ? { ...x, ...patch } : x
  );
  emit('change:' + name, state[name]);
  emit('change', { name, data: state[name] });
  return state[name];
}

/* ============================================================
   8. AUDIT LOG
   ============================================================ */
export function logAudit(action, details, syncToCloud = false) {
  const entry = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    action,
    details
  };
  state.auditLog.unshift(entry);
  if (state.auditLog.length > 500) state.auditLog.length = 500;
  safeSave(KEYS.AUDIT_LOG, state.auditLog);
  emit('audit:new', entry);
  if (syncToCloud) {
    emit('cloud:push', { collection: 'auditLog', item: entry });
  }
  return entry;
}

/* ============================================================
   9. CART HELPERS
   ============================================================ */
export function cartAdd(item) {
  state.activeCart.push(item);
  safeSave(KEYS.ACTIVE_CART, state.activeCart);
  emit('cart:change', state.activeCart);
  return state.activeCart;
}

export function cartRemove(index) {
  state.activeCart.splice(index, 1);
  safeSave(KEYS.ACTIVE_CART, state.activeCart);
  emit('cart:change', state.activeCart);
  return state.activeCart;
}

export function cartClear() {
  state.activeCart = [];
  safeRemove(KEYS.ACTIVE_CART);
  emit('cart:change', state.activeCart);
  return state.activeCart;
}

/* ============================================================
   10. NETWORK STATUS
   ============================================================ */
window.addEventListener('online', () => {
  state.netOnline = true;
  emit('net:online');
  console.log('%c🌐 Back online', 'color:#10b981;font-weight:bold');
});

window.addEventListener('offline', () => {
  state.netOnline = false;
  emit('net:offline');
  console.log('%c📴 Offline', 'color:#f59e0b;font-weight:bold');
});

/* ============================================================
   11. AUTO-BOOT ON MODULE LOAD
   ============================================================ */
loadLocalState();

/* ============================================================
   12. GLOBAL CONSOLE ACCESS
   ============================================================ */
window.SF = window.SF || {};
window.SF.state = {
  state,
  KEYS,
  get:   () => state,
  set:   (name, data) => setCollection(name, data),
  add:   (name, item) => addToCollection(name, item),
  remove:(name, id) => removeFromCollection(name, id),
  update:(name, id, patch) => updateInCollection(name, id, patch),
  on, off, emit,
  logAudit,
  loadLocalState,
  clearAllLocalData
};

/* ============================================================
   13. BOOT LOG
   ============================================================ */
console.log(
  '%c🗃️  State manager ready',
  'color:#8b5cf6;font-weight:bold;font-size:11px'
);
