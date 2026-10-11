/* ============================================================
   SMARTFIX ERP — App Bootstrap (v4.1.0)
   File: js/app-init.js
   ============================================================ */

import { auth, db, PATHS, APP_VERSION, APP_NAME, APP_AUTHOR } from './firebase-config.js';
import { state, KEYS, saveProfile, saveCurrentStore, on } from './state.js';
import { toast, fmtDatePretty } from './common.js';
import { Router } from './router.js';
import * as Cloud from './cloud.js';
import * as Perms from './permissions.js';
import { ROLES, ROLE_LABELS } from './permissions.js';

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


let booted = false;
let heartbeatTimer = null;


/* ============================================================
   BOOT
   ============================================================ */
export function bootApp() {
  if (booted) return;
  console.log(`%c🚀 ${APP_NAME} v${APP_VERSION} starting...`, 'color:#0ea5e9;font-weight:bold;font-size:13px');

  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;

  wireNetworkIndicator();
  wireGlobalErrorHandlers();

  onAuthStateChanged(auth, handleAuthState);
  booted = true;
}


/* ============================================================
   AUTH STATE HANDLER
   ============================================================ */
async function handleAuthState(user) {
  if (!user) {
    console.log('%c🔒 No session — redirecting to login', 'color:#f59e0b');
    redirectToLogin();
    return;
  }

  try {
    /* Try owner flow first */
    const ownerSnap = await getDoc(doc(db, PATHS.stores, user.uid));

    if (ownerSnap.exists()) {
      /* ============ OWNER ============ */
      const storeData = ownerSnap.data();
      Perms.setRole(ROLES.OWNER, { uid: user.uid, storeId: user.uid, name: storeData.shopName });

      const store = {
        uid: user.uid,
        shopName: storeData.shopName || 'My Store',
        shopCode: storeData.shopCode || '',
        email: storeData.ownerEmail || user.email,
        phone: storeData.ownerPhone || '',
        plan: storeData.plan || 'trial',
        role: 'OWNER',
        storeId: user.uid
      };
      saveCurrentStore(store);
      updateStoreInfoUI(store);
      await loadProfile(user.uid);

    } else {
      /* ============ STAFF ============ */
      const cached = localStorage.getItem('sfp_current_store');
      let staffStoreId = null;
      let staffRole = 'PROMOTER';
      let staffName = '';

      if (cached) {
        try {
          const c = JSON.parse(cached);
          if (c.isStaff && c.storeId) {
            staffStoreId = c.storeId;
            staffRole = c.role || 'PROMOTER';
            staffName = c.staffName || '';
          }
        } catch (e) {}
      }

      if (!staffStoreId) {
        toast('Session expired. Please sign in again.', 'error', 4000);
        await signOut(auth);
        redirectToLogin();
        return;
      }

      /* Verify staff doc exists */
      const staffSnap = await getDoc(doc(db, PATHS.stores, staffStoreId, 'staffUsers', user.uid));
      if (!staffSnap.exists() || staffSnap.data().disabled === true) {
        toast('Account disabled. Contact owner.', 'error', 5000);
        await signOut(auth);
        redirectToLogin();
        return;
      }

      const staffData = staffSnap.data();
      Perms.setRole(staffData.role || staffRole, {
        uid: user.uid,
        storeId: staffStoreId,
        name: staffData.name || staffName
      });

      /* Load store info */
      const storeSnap = await getDoc(doc(db, PATHS.stores, staffStoreId));
      const storeData = storeSnap.exists() ? storeSnap.data() : {};

      const store = {
        uid: user.uid,
        storeId: staffStoreId,
        shopName: storeData.shopName || 'Store',
        shopCode: storeData.shopCode || '',
        email: staffData.email || user.email,
        phone: staffData.phone || '',
        role: staffData.role || staffRole,
        staffName: staffData.name || staffName,
        isStaff: true
      };
      saveCurrentStore(store);
      updateStoreInfoUI(store);
      await loadProfile(staffStoreId);
    }

    /* Wire everything */
    initializeRouterAndTabs();
    wireLogoutButton();
    wireQuickActions();
    startHeartbeat();
    showRoleBadge();

    const meta = Perms.getUserMeta();
    console.log(
      `%c✅ App ready — Role: ${meta.role} | Store: ${state.store?.shopName}`,
      'color:#10b981;font-weight:bold'
    );

    setTimeout(() => {
      const label = Perms.isOwner()
        ? state.store.shopName
        : (meta.name + ' • ' + Perms.getRoleLabel());
      toast('Welcome, ' + label + '!', 'success', 2500);
    }, 700);

  } catch (err) {
    console.error('Boot failed:', err);
    toast('Failed to load. Check connection.', 'error', 5000);
  }
}


/* ============================================================
   LOAD PROFILE
   ============================================================ */
async function loadProfile(storeId) {
  try {
    const snap = await getDoc(doc(db, PATHS.stores, storeId, PATHS.profile, 'main'));
    if (snap.exists()) {
      const remote = snap.data();
      delete remote.updatedAt;
      const merged = { ...state.profile, ...remote };
      saveProfile(merged);
    }
  } catch (e) {
    console.warn('Profile load failed:', e.code);
  }
}


/* ============================================================
   ROLE BADGE
   ============================================================ */
function showRoleBadge() {
  const roleEl = document.getElementById('userRoleBadge');
  if (!roleEl) return;
  const meta = Perms.getUserMeta();
  roleEl.textContent = Perms.getRoleLabel();
  roleEl.style.display = 'inline-flex';

  if (!Perms.isOwner() && meta.name) {
    const nameEl = document.getElementById('userNameBadge');
    if (nameEl) {
      nameEl.textContent = meta.name + ' • ';
      nameEl.style.display = 'inline';
    }
  }
}


/* ============================================================
   ROUTER + ROLE-AWARE TABS
   ============================================================ */
function initializeRouterAndTabs() {
  const allRoutes = Router.order;
  const allowed = allRoutes.filter((key) => Perms.canAccessRoute(key));

  console.log('%c🔐 Allowed routes:', 'color:#f59e0b;font-weight:bold', allowed);

  Router.renderTabs(allowed);
  Router.init('#moduleContainer');

  /* If current route not allowed → redirect to first allowed */
  setTimeout(() => {
    const cur = Router.current();
    if (cur && !Perms.canAccessRoute(cur)) {
      const fallback = allowed[0] || 'billing';
      console.log('⚠️ Route not allowed, redirecting to:', fallback);
      Router.go(fallback, { force: true });
    }
  }, 150);
}


/* ============================================================
   UI UPDATES
   ============================================================ */
function updateStoreInfoUI(store) {
  document.querySelectorAll('[data-store-name]').forEach((el) => {
    el.textContent = store.shopName || 'Store';
  });
  document.querySelectorAll('[data-shop-code]').forEach((el) => {
    el.textContent = store.shopCode || '';
  });
  document.querySelectorAll('[data-owner-email]').forEach((el) => {
    el.textContent = store.email || '';
  });
  document.querySelectorAll('[data-profile-name]').forEach((el) => {
    el.textContent = state.profile.name || store.shopName;
  });
  const dateEl = document.getElementById('todayDate');
  if (dateEl) dateEl.textContent = fmtDatePretty(new Date());
}

function wireNetworkIndicator() {
  const el = document.getElementById('netStatus');
  if (!el) return;
  const update = () => {
    el.innerHTML = navigator.onLine
      ? '<span style="color:#10b981">● Online</span>'
      : '<span style="color:#f59e0b">● Offline</span>';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}


/* ============================================================
   LOGOUT
   ============================================================ */
function wireLogoutButton() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!confirm('Sign out from SmartFix ERP?\n\nAll changes are synced.')) return;
    try { await Cloud.flushQueue(); } catch (e) {}
    await signOut(auth);
    localStorage.removeItem('sfp_current_store');
    redirectToLogin();
  });
}


/* ============================================================
   QUICK ACTIONS
   ============================================================ */
function wireQuickActions() {
  const backupBtn = document.getElementById('quickBackupBtn');
  if (backupBtn) {
    if (!Perms.isOwner()) {
      backupBtn.style.display = 'none';
    } else {
      backupBtn.addEventListener('click', quickBackup);
    }
  }

  const refreshBtn = document.getElementById('quickRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => window.location.reload());

  const syncBtn = document.getElementById('quickSyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      try {
        toast('Syncing...', 'info', 1500);
        await Cloud.flushQueue();
        toast('Sync complete', 'success', 1500);
      } catch (e) { toast('Sync failed', 'error'); }
    });
  }
}

async function quickBackup() {
  try {
    const data = {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      store: state.store,
      profile: state.profile,
      invoices: state.invoices,
      creditNotes: state.creditNotes,
      vouchers: state.vouchers,
      inventory: state.inventory,
      purchases: state.purchases,
      parties: state.parties,
      staff: state.staff,
      salaryPayments: state.salaryPayments,
      categories: state.categories
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SmartFix_Backup_' + fmtDatePretty(new Date()).replace(/ /g, '_') + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Backup downloaded', 'success');
  } catch (e) { toast('Backup failed', 'error'); }
}


/* ============================================================
   HEARTBEAT
   ============================================================ */
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => {
    if (!auth.currentUser) { redirectToLogin(); return; }
    if (navigator.onLine) { try { Cloud.flushQueue(); } catch (e) {} }
  }, 5 * 60 * 1000);
}


/* ============================================================
   GLOBAL ERROR HANDLERS
   ============================================================ */
function wireGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    console.error('%c❌ Runtime error', 'color:#ef4444;font-weight:bold', e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('%c❌ Unhandled promise', 'color:#ef4444;font-weight:bold', e.reason);
    const code = e.reason && (e.reason.code || '');
    if (code === 'permission-denied') {
      toast('Permission denied. Check Firestore Rules.', 'error', 6000);
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (state.activeCart && state.activeCart.length > 0) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
}


function redirectToLogin() {
  if (window.location.pathname.endsWith('index.html')) return;
  window.location.href = './index.html';
}


/* ============================================================
   BOOT
   ============================================================ */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}

window.SF = window.SF || {};
window.SF.app = {
  boot: bootApp,
  version: APP_VERSION,
  author: APP_AUTHOR,
  isBooted: () => booted,
  logout: async () => { await signOut(auth); redirectToLogin(); }
};

console.log('%c⚡ App bootstrap ready (v4.1.0)', 'color:#8b5cf6;font-weight:bold;font-size:11px');
