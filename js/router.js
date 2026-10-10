/* ============================================================
   SMARTFIX ERP — SPA Router
   File: js/router.js
   Version: 4.0.0
   Purpose:
     • Hash-based routing (#billing, #inventory, etc.)
     • Dynamically loads module HTML into shell container
     • Manages active tab state
     • Supports module lifecycle hooks (onLoad/onUnload)
     • Browser back/forward navigation
     • Error handling with friendly UI
   ============================================================ */

import { emit, on } from './state.js';
import { toast } from './common.js';


/* ============================================================
   1. ROUTE DEFINITIONS
   ============================================================ */
export const ROUTES = {
  billing: {
    id:        'billingTab',
    label:     'Sales',
    icon:      '🧾',
    file:      './modules/billing.html',
    shortcut:  'F1',
    description: 'POS Sales Invoice'
  },
  returns: {
    id:        'returnsTab',
    label:     'Returns',
    icon:      '↩️',
    file:      './modules/returns.html',
    shortcut:  'F2',
    description: 'Credit Notes & Refunds'
  },
  purchase: {
    id:        'purchaseTab',
    label:     'Purchase',
    icon:      '🛒',
    file:      './modules/purchase.html',
    shortcut:  'F3',
    description: 'Supplier Bills & Stock In'
  },
  vouchers: {
    id:        'vouchersTab',
    label:     'Vouchers',
    icon:      '📒',
    file:      './modules/vouchers.html',
    shortcut:  'F4',
    description: 'Payment / Receipt / Journal'
  },
  accounting: {
    id:        'accountingTab',
    label:     'P&L',
    icon:      '📊',
    file:      './modules/accounting.html',
    shortcut:  'F5',
    description: 'Profit & Loss, GST, Audit'
  },
  books: {
    id:        'booksTab',
    label:     'Books',
    icon:      '📚',
    file:      './modules/books.html',
    shortcut:  'F6',
    description: 'Cash Book, Bank Book, Trial Balance'
  },
  parties: {
    id:        'partiesTab',
    label:     'Parties',
    icon:      '👥',
    file:      './modules/parties.html',
    shortcut:  'F7',
    description: 'Customers & Suppliers'
  },
  inventory: {
    id:        'inventoryTab',
    label:     'Stock',
    icon:      '📦',
    file:      './modules/inventory.html',
    shortcut:  'F8',
    description: 'Inventory Management'
  },
  staff: {
    id:        'staffTab',
    label:     'Staff',
    icon:      '👨‍💼',
    file:      './modules/staff.html',
    shortcut:  'F9',
    description: 'Staff & Salary'
  },
  settings: {
    id:        'settingsTab',
    label:     'Settings',
    icon:      '⚙️',
    file:      './modules/settings.html',
    shortcut:  'F10',
    description: 'Store Settings & Backup'
  }
};

/* Route order for navigation bar */
export const ROUTE_ORDER = [
  'billing', 'returns', 'purchase', 'vouchers', 'accounting',
  'books', 'parties', 'inventory', 'staff', 'settings'
];


/* ============================================================
   2. RUNTIME STATE
   ============================================================ */
const ROUTER = {
  container:      null,       // DOM element where modules render
  currentRoute:   null,       // e.g. 'billing'
  currentModule:  null,       // module object with lifecycle hooks
  moduleCache:    {},         // { route: htmlString }
  loading:        false,
  history:        []          // internal history for back button
};


/* ============================================================
   3. INITIALIZE ROUTER
   ============================================================ */
export function initRouter(containerSelector = '#moduleContainer') {
  ROUTER.container = document.querySelector(containerSelector);

  if (!ROUTER.container) {
    console.error('❌ Router container not found:', containerSelector);
    return;
  }

  console.log('%c🧭 Router initialized', 'color:#06b6d4;font-weight:bold');

  /* Handle hash on load */
  const initialHash = window.location.hash.replace('#', '').trim();
  const route = ROUTES[initialHash] ? initialHash : 'billing';

  /* Listen for hash changes */
  window.addEventListener('hashchange', onHashChange);

  /* Navigate to initial route */
  navigateTo(route, { replace: true });

  /* Keyboard shortcuts (F1–F10) */
  window.addEventListener('keydown', onGlobalKeydown);
}


/* ============================================================
   4. NAVIGATION
   ============================================================ */

/**
 * Navigate to a route
 * @param {string} routeKey - e.g. 'billing'
 * @param {object} opts - { replace, skipHistory }
 */
export async function navigateTo(routeKey, opts = {}) {
  if (ROUTER.loading) {
    console.warn('⏳ Navigation already in progress');
    return;
  }

  const route = ROUTES[routeKey];
  if (!route) {
    console.warn('Unknown route:', routeKey);
    toast('Module not found: ' + routeKey, 'error');
    return;
  }

  /* If same route, do nothing */
  if (ROUTER.currentRoute === routeKey && !opts.force) {
    return;
  }

  ROUTER.loading = true;

  try {
    /* Lifecycle: notify previous module */
    if (ROUTER.currentModule && typeof ROUTER.currentModule.onUnload === 'function') {
      try {
        await ROUTER.currentModule.onUnload();
      } catch (e) {
        console.error('Module onUnload failed:', e);
      }
    }

    /* Show loading spinner */
    showModuleLoading();

    /* Update URL hash (skip if initial load with replace) */
    if (!opts.skipHistory) {
      const newHash = '#' + routeKey;
      if (opts.replace) {
        history.replaceState(null, '', newHash);
      } else {
        history.pushState(null, '', newHash);
        ROUTER.history.push(routeKey);
      }
    }

    /* Load module HTML */
    const html = await loadModuleHTML(routeKey);

    /* Inject into container */
    ROUTER.container.innerHTML = html;

    /* Update tab bar active state */
    updateTabBar(routeKey);

    /* Lifecycle: notify new module */
    ROUTER.currentRoute = routeKey;
    emit('route:changed', { route: routeKey, config: route });

    /* Try to call module's init function if it exists (global) */
    const initFnName = 'init_' + routeKey + 'Module';
    if (typeof window[initFnName] === 'function') {
      try {
        ROUTER.currentModule = await window[initFnName]() || null;
      } catch (e) {
        console.error('Module init failed:', initFnName, e);
        toast('Module failed to initialize: ' + route.label, 'error', 4000);
      }
    }

    /* Refresh UI to catch latest state */
    setTimeout(() => {
      const refreshFns = [
        'renderLiveInvoicePreview', 'renderStockTable', 'renderCreditNotesTable',
        'renderVouchersTable', 'renderPurchaseTable', 'renderPartiesList',
        'renderAuditLog', 'renderStaffList', 'renderSalaryHistory',
        'renderCategoryChips', 'refreshPartyDatalists', 'applyTallyFilter',
        'renderAllBooks'
      ];
      refreshFns.forEach((fn) => {
        try { typeof window[fn] === 'function' && window[fn](); } catch (e) {}
      });
    }, 100);

    /* Scroll to top */
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error('Navigation error:', err);
    showModuleError(route.label, err);
    toast('Failed to load ' + route.label, 'error', 4000);
  } finally {
    ROUTER.loading = false;
  }
}


/* ============================================================
   5. HASH CHANGE HANDLER
   ============================================================ */
function onHashChange() {
  const hash = window.location.hash.replace('#', '').trim();
  if (!hash || !ROUTES[hash]) {
    /* Empty hash → go to billing */
    if (ROUTER.currentRoute !== 'billing') {
      navigateTo('billing', { replace: true });
    }
    return;
  }
  if (hash !== ROUTER.currentRoute) {
    navigateTo(hash, { skipHistory: true });
  }
}


/* ============================================================
   6. KEYBOARD SHORTCUTS (F1–F10)
   ============================================================ */
function onGlobalKeydown(e) {
  /* Skip if user is typing in an input */
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  /* Skip if modifier pressed */
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const match = e.key.match(/^F(\d{1,2})$/);
  if (!match) return;

  const num = parseInt(match[1], 10);
  if (num < 1 || num > ROUTE_ORDER.length) return;

  e.preventDefault();
  const routeKey = ROUTE_ORDER[num - 1];
  navigateTo(routeKey);
}


/* ============================================================
   7. MODULE HTML LOADER
   ============================================================ */
async function loadModuleHTML(routeKey) {
  /* Check cache first */
  if (ROUTER.moduleCache[routeKey]) {
    return ROUTER.moduleCache[routeKey];
  }

  const route = ROUTES[routeKey];
  const url = route.file + '?v=' + Date.now(); // cache-bust

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const html = await res.text();
    ROUTER.moduleCache[routeKey] = html;
    console.log('%c📄 Module loaded: ' + routeKey, 'color:#06b6d4');
    return html;
  } catch (e) {
    console.error('Failed to load module:', routeKey, e);
    throw e;
  }
}

/**
 * Clear cache for a specific module (forces reload)
 */
export function clearModuleCache(routeKey) {
  if (routeKey) {
    delete ROUTER.moduleCache[routeKey];
  } else {
    ROUTER.moduleCache = {};
  }
}


/* ============================================================
   8. UI — LOADING / ERROR STATES
   ============================================================ */
function showModuleLoading() {
  if (!ROUTER.container) return;
  ROUTER.container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:80px 20px;flex-direction:column;gap:16px">
      <div style="
        width:48px;height:48px;
        border:3px solid rgba(14,165,233,0.2);
        border-top-color:#0ea5e9;
        border-radius:50%;
        animation:sfSpin 0.8s linear infinite;
      "></div>
      <div style="color:#64748b;font-size:13px;font-weight:600">Loading module...</div>
      <style>
        @keyframes sfSpin { to { transform: rotate(360deg); } }
      </style>
    </div>
  `;
}

function showModuleError(label, err) {
  if (!ROUTER.container) return;
  ROUTER.container.innerHTML = `
    <div style="
      max-width:520px;margin:60px auto;padding:28px;
      background:#1e1b2e;border:1px solid #7f1d1d;
      border-radius:16px;text-align:center;
    ">
      <div style="font-size:42px;margin-bottom:12px">⚠️</div>
      <div style="font-size:16px;font-weight:800;color:#fca5a5;margin-bottom:6px">
        ${label} module failed to load
      </div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-bottom:16px">
        ${err && err.message ? err.message : 'Unknown error'}
      </div>
      <button type="button" onclick="location.reload()" style="
        padding:10px 20px;border-radius:8px;border:none;
        background:linear-gradient(135deg,#0ea5e9,#0369a1);
        color:white;font-weight:700;cursor:pointer;font-size:13px;
      ">Reload App</button>
    </div>
  `;
}


/* ============================================================
   9. TAB BAR — active state management
   ============================================================ */
function updateTabBar(routeKey) {
  const route = ROUTES[routeKey];
  if (!route) return;

  ROUTE_ORDER.forEach((key) => {
    const r = ROUTES[key];
    if (!r) return;
    const btn = document.getElementById('nav-' + key);
    if (!btn) return;

    if (key === routeKey) {
      btn.classList.add('sf-tab-active');
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.classList.remove('sf-tab-active');
      btn.removeAttribute('aria-current');
    }
  });

  /* Update page title */
  document.title = `${route.label} — SmartFix ERP`;
}

/**
 * Programmatically set the tab bar (used by app.html shell)
 */
export function renderTabBar() {
  const nav = document.getElementById('sfTabBar');
  if (!nav) return;

  nav.innerHTML = ROUTE_ORDER.map((key) => {
    const r = ROUTES[key];
    return `
      <button
        type="button"
        id="nav-${key}"
        onclick="SF.router.go('${key}')"
        class="sf-tab-btn"
        data-route="${key}"
        title="${r.description} (${r.shortcut})"
      >
        <span class="sf-tab-icon">${r.icon}</span>
        <span class="sf-tab-label">${r.label}</span>
      </button>
    `;
  }).join('');

  /* Highlight current */
  if (ROUTER.currentRoute) {
    updateTabBar(ROUTER.currentRoute);
  }
}


/* ============================================================
   10. PUBLIC API
   ============================================================ */
export const Router = {
  go:          navigateTo,
  current:     () => ROUTER.currentRoute,
  routes:      ROUTES,
  order:       ROUTE_ORDER,
  clearCache:  clearModuleCache,
  renderTabs:  renderTabBar,
  init:        initRouter,
  isReady:     () => !!ROUTER.container
};


/* ============================================================
   11. GLOBAL CONSOLE ACCESS
   ============================================================ */
window.SF = window.SF || {};
window.SF.router = Router;

/* Convenience: SF.go('inventory') from anywhere */
window.SF.go = navigateTo;


/* ============================================================
   12. HANDLE BROWSER BACK / FORWARD
   ============================================================ */
window.addEventListener('popstate', () => {
  const hash = window.location.hash.replace('#', '').trim();
  if (hash && ROUTES[hash] && hash !== ROUTER.currentRoute) {
    navigateTo(hash, { skipHistory: true });
  }
});


/* ============================================================
   13. BOOT LOG
   ============================================================ */
console.log(
  '%c🧭 Router ready',
  'color:#06b6d4;font-weight:bold;font-size:11px',
  `| ${ROUTE_ORDER.length} routes registered`
);
