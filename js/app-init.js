/* ============================================================
   SMARTFIX ERP — App Bootstrap
   File: js/app-init.js
   Version: 4.0.0
   Purpose:
     • Runs when app.html loads
     • Verifies session (redirects to index.html if logged out)
     • Loads store data + profile
     • Starts router + tab bar
     • Wires global UI (logout, store name, online status)
     • Global error handler
     • Session heartbeat
   ============================================================ */

import { auth, db, PATHS, APP_VERSION, APP_NAME, APP_AUTHOR } from './firebase-config.js';
import { state, KEYS, saveProfile, saveCurrentStore, on } from './state.js';
import { toast, fmtDatePretty } from './common.js';
import { Router } from './router.js';
import * as Cloud from './cloud.js';

import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ============================================================
   1. BOOT FLAGS
   ============================================================ */
let booted = false;
let heartbeatTimer = null;


/* ============================================================
   2. MAIN BOOT FUNCTION
   ============================================================ */
export function bootApp() {
  if (booted) {
    console.log('%c⚡ App already booted', 'color:#64748b');
    return;
  }

  console.log(
    `%c🚀 ${APP_NAME} v${APP_VERSION} starting...`,
    'color:#0ea5e9;font-weight:bold;font-size:13px'
  );

  /* Set app version in UI */
  const verEl = document.getElementById('appVersion');
  if (verEl) verEl.textContent = 'v' + APP_VERSION;

  /* Network status indicator */
  wireNetworkIndicator();

  /* Global error handlers */
  wireGlobalErrorHandlers();

  /* Auth check */
  onAuthStateChanged(auth, handleAuthState);

  booted = true;
}


/* ============================================================
   3. AUTH STATE HANDLER
   ============================================================ */
async function handleAuthState(user) {
  if (!user) {
    console.log('%c🔒 No session — redirecting to login', 'color:#f59e0b');
    redirectToLogin();
    return;
  }

  try {
    /* Verify store exists */
    const storeSnap = await getDoc(doc(db, PATHS.stores, user.uid));
    if (!storeSnap.exists()) {
      console.warn('Store document missing — sending back to register');
      toast('Store setup incomplete. Please register again.', 'error', 5000);
      await signOut(auth);
      redirectToLogin();
      return;
    }

    const storeData = storeSnap.data();

    /* Save to state */
    const store = {
      uid:      user.uid,
      shopName: storeData.shopName || 'My Store',
      shopCode: storeData.shopCode || '',
      email:    storeData.ownerEmail || user.email,
      phone:    storeData.ownerPhone || '',
      plan:     storeData.plan || 'trial'
    };
    saveCurrentStore(store);

    /* Update UI */
    updateStoreInfoUI(store);

    /* Load profile (fallback if cloud hasn't synced yet) */
    try {
      const profileSnap = await getDoc(doc(db, PATHS.stores, user.uid, PATHS.profile, 'main'));
      if (profileSnap.exists()) {
        const remote = profileSnap.data();
        delete remote.updatedAt;
        const merged = { ...state.profile, ...remote };
        saveProfile(merged);
        console.log('%c🏪 Store profile loaded', 'color:#38bdf8');
      }
    } catch (e) {
      console.warn('Profile load failed:', e.code);
    }

    /* Initialize router + tab bar */
    initializeRouterAndTabs();

    /* Wire logout button */
    wireLogoutButton();

    /* Wire quick actions */
    wireQuickActions();

    /* Subscribe to profile updates for UI */
    on('profile:updated', (p) => {
      updateStoreInfoUI(store);
    });

    /* Start session heartbeat */
    startHeartbeat();

    /* Welcome toast */
    setTimeout(() => {
      toast('Welcome, ' + store.shopName + '!', 'success', 2500);
    }, 700);

    console.log(
      `%c✅ App ready — ${store.shopName} (${store.shopCode})`,
      'color:#10b981;font-weight:bold;font-size:12px'
    );

  } catch (err) {
    console.error('Boot failed:', err);
    toast('Failed to load store data. Check connection.', 'error', 5000);
  }
}


/* ============================================================
   4. ROUTER INITIALIZATION
   ============================================================ */
function initializeRouterAndTabs() {
  /* Render tab bar HTML */
  Router.renderTabs();

  /* Initialize router with container */
  Router.init('#moduleContainer');

  console.log('%c🧭 Router + tabs wired', 'color:#06b6d4');
}


/* ============================================================
   5. UI UPDATES
   ============================================================ */
function updateStoreInfoUI(store) {
  /* Store name in header */
  const nameEls = document.querySelectorAll('[data-store-name]');
  nameEls.forEach((el) => { el.textContent = store.shopName; });

  /* Shop code */
  const codeEls = document.querySelectorAll('[data-shop-code]');
  codeEls.forEach((el) => { el.textContent = store.shopCode; });

  /* Owner email */
  const emailEls = document.querySelectorAll('[data-owner-email]');
  emailEls.forEach((el) => { el.textContent = store.email || ''; });

  /* Profile name in header */
  const profileNameEls = document.querySelectorAll('[data-profile-name]');
  profileNameEls.forEach((el) => {
    el.textContent = state.profile.name || store.shopName;
  });

  /* Live date */
  const dateEl = document.getElementById('todayDate');
  if (dateEl) dateEl.textContent = fmtDatePretty(new Date());
}

function wireNetworkIndicator() {
  const el = document.getElementById('netStatus');
  if (!el) return;

  const update = () => {
    if (navigator.onLine) {
      el.innerHTML = '<span style="color:#10b981">● Online</span>';
    } else {
      el.innerHTML = '<span style="color:#f59e0b">● Offline</span>';
    }
  };

  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}


/* ============================================================
   6. LOGOUT
   ============================================================ */
function wireLogoutButton() {
  const btn = document.getElementById('logoutBtn');
  if (!btn) return;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const ok = confirm('Sign out from SmartFix ERP?\n\nAll changes are synced to cloud.');
    if (!ok) return;

    try {
      /* Flush any pending cloud writes */
      try { await Cloud.flushQueue(); } catch (e) {}

      await signOut(auth);
      redirectToLogin();
    } catch (err) {
      console.error('Logout failed:', err);
      toast('Logout failed. Try again.', 'error');
    }
  });
}


/* ============================================================
   7. QUICK ACTIONS (header buttons)
   ============================================================ */
function wireQuickActions() {
  /* Backup button */
  const backupBtn = document.getElementById('quickBackupBtn');
  if (backupBtn) {
    backupBtn.addEventListener('click', quickBackup);
  }

  /* Refresh button */
  const refreshBtn = document.getElementById('quickRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      window.location.reload();
    });
  }

  /* Sync now button (if exists) */
  const syncBtn = document.getElementById('quickSyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      try {
        toast('Syncing...', 'info', 1500);
        await Cloud.flushQueue();
        toast('Sync complete', 'success', 1500);
      } catch (e) {
        toast('Sync failed', 'error');
      }
    });
  }
}

async function quickBackup() {
  try {
    const data = {
      version:    APP_VERSION,
      exportedAt: new Date().toISOString(),
      store:      state.store,
      profile:    state.profile,
      invoices:   state.invoices,
      creditNotes:state.creditNotes,
      vouchers:   state.vouchers,
      inventory:  state.inventory,
      purchases:  state.purchases,
      parties:    state.parties,
      staff:      state.staff,
      salaryPayments: state.salaryPayments,
      categories: state.categories
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'SmartFix_Backup_' + fmtDatePretty(new Date()).replace(/ /g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);

    toast('Backup downloaded', 'success');
  } catch (e) {
    console.error('Backup failed:', e);
    toast('Backup failed', 'error');
  }
}


/* ============================================================
   8. HEARTBEAT — session check every 5 min
   ============================================================ */
function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);

  heartbeatTimer = setInterval(() => {
    if (!auth.currentUser) {
      console.warn('Heartbeat: session lost');
      redirectToLogin();
      return;
    }
    /* Check network */
    if (navigator.onLine) {
      /* Trigger cloud flush */
      try { Cloud.flushQueue(); } catch (e) {}
    }
  }, 5 * 60 * 1000); /* 5 minutes */
}


/* ============================================================
   9. GLOBAL ERROR HANDLERS
   ============================================================ */
function wireGlobalErrorHandlers() {
  /* Catch runtime errors */
  window.addEventListener('error', (e) => {
    console.error('%c❌ Runtime error', 'color:#ef4444;font-weight:bold', e.error || e.message);
  });

  /* Catch unhandled promise rejections */
  window.addEventListener('unhandledrejection', (e) => {
    console.error('%c❌ Unhandled promise', 'color:#ef4444;font-weight:bold', e.reason);

    /* Special case: Firestore permission errors → show helpful message */
    const code = e.reason && (e.reason.code || '');
    if (code === 'permission-denied') {
      toast('Permission denied. Check Firestore Rules.', 'error', 6000);
    }
  });

  /* Warn before leaving with unsaved cart */
  window.addEventListener('beforeunload', (e) => {
    if (state.activeCart && state.activeCart.length > 0) {
      e.preventDefault();
      e.returnValue = '';
      return '';
    }
  });
}


/* ============================================================
   10. REDIRECT HELPER
   ============================================================ */
function redirectToLogin() {
  /* Don't loop if already on login */
  if (window.location.pathname.endsWith('index.html')) return;
  window.location.href = './index.html';
}


/* ============================================================
   11. AUTO-BOOT ON DOM READY
   ============================================================ */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}


/* ============================================================
   12. EXPOSE FOR DEBUGGING
   ============================================================ */
window.SF = window.SF || {};
window.SF.app = {
  boot:      bootApp,
  version:   APP_VERSION,
  author:    APP_AUTHOR,
  isBooted:  () => booted,
  logout:    async () => {
    await signOut(auth);
    redirectToLogin();
  }
};


/* ============================================================
   13. BOOT LOG
   ============================================================ */
console.log(
  '%c⚡ App bootstrap module ready',
  'color:#8b5cf6;font-weight:bold;font-size:11px'
);
