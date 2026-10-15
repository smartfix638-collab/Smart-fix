/* ============================================================
   SMARTFIX ERP — SPA Router (v4.7.0)
   File: js/router.js
   Added: GST Returns module
   ============================================================ */

import { emit, on } from './state.js';
import { toast } from './common.js';


export const ROUTES = {
  dashboard:            { id: 'dashboardTab',        label: 'Dashboard',   icon: '📊', file: './modules/dashboard.html',          shortcut: 'F1',  description: 'Business Overview & Analytics' },
  billing:              { id: 'billingTab',          label: 'Sales',       icon: '🧾', file: './modules/billing.html',            shortcut: 'F2',  description: 'POS Sales Invoice' },
  returns:              { id: 'returnsTab',          label: 'Returns',     icon: '↩️', file: './modules/returns.html',            shortcut: 'F3',  description: 'Credit Notes & Refunds' },
  repair:               { id: 'repairTab',           label: 'Repair',      icon: '🔧', file: './modules/repair.html',             shortcut: 'F4',  description: 'Mobile Repair Job Cards' },
  mobileDoctor:         { id: 'mobileDoctorTab',     label: 'Doctor',      icon: '🩺', file: './modules/mobile-doctor.html',      shortcut: 'F5',  description: 'Mobile Diagnostic Tool' },
  purchase:             { id: 'purchaseTab',         label: 'Purchase',    icon: '🛒', file: './modules/purchase.html',           shortcut: 'F6',  description: 'Supplier Bills & Stock In' },
  vouchers:             { id: 'vouchersTab',         label: 'Vouchers',    icon: '📒', file: './modules/vouchers.html',           shortcut: 'F7',  description: 'Payment / Receipt / Journal' },
  accounting:           { id: 'accountingTab',       label: 'P&L',         icon: '📈', file: './modules/accounting.html',         shortcut: 'F8',  description: 'Profit & Loss, GST, Audit' },
  gstReturns:           { id: 'gstReturnsTab',       label: 'GST',         icon: '📋', file: './modules/gst-returns.html',        shortcut: 'F9',  description: 'GSTR-1, GSTR-3B, HSN Summary' },
  books:                { id: 'booksTab',            label: 'Books',       icon: '📚', file: './modules/books.html',              shortcut: 'F10', description: 'Cash Book, Bank Book, Trial Balance' },
  parties:              { id: 'partiesTab',          label: 'Parties',     icon: '👥', file: './modules/parties.html',            shortcut: 'F11', description: 'Customers & Suppliers' },
  inventory:            { id: 'inventoryTab',        label: 'Stock',       icon: '📦', file: './modules/inventory.html',          shortcut: 'F12', description: 'Inventory Management' },
  staff:                { id: 'staffTab',            label: 'Staff',       icon: '👨‍💼', file: './modules/staff.html',            shortcut: 'F13', description: 'Staff & Salary' },
  attendance:           { id: 'attendanceTab',       label: 'Attendance',  icon: '📸', file: './modules/attendance.html',         shortcut: 'F14', description: 'Selfie Check-In / Check-Out' },
  'attendance-report':  { id: 'attendanceReportTab', label: 'Att. Report', icon: '👥', file: './modules/attendance-report.html',  shortcut: 'F15', description: 'Team Attendance Summary' },
  manual:               { id: 'manualTab',           label: 'Manual',      icon: '📖', file: './modules/manual.html',             shortcut: 'F16', description: 'User Manual & Help Center' },
  settings:             { id: 'settingsTab',         label: 'Settings',    icon: '⚙️', file: './modules/settings.html',           shortcut: 'F17', description: 'Store Settings & Backup' }
};

export const ROUTE_ORDER = [
  'dashboard', 'billing', 'returns', 'repair', 'mobileDoctor',
  'purchase', 'vouchers', 'accounting', 'gstReturns', 'books',
  'parties', 'inventory', 'staff', 'attendance', 'attendance-report',
  'manual', 'settings'
];


const ROUTER = {
  container:      null,
  currentRoute:   null,
  currentModule:  null,
  moduleCache:    {},
  loading:        false,
  history:        []
};


export function initRouter(containerSelector = '#moduleContainer') {
  ROUTER.container = document.querySelector(containerSelector);
  if (!ROUTER.container) {
    console.error('❌ Router container not found:', containerSelector);
    return;
  }
  console.log('%c🧭 Router initialized', 'color:#06b6d4;font-weight:bold');

  const initialHash = window.location.hash.replace('#', '').trim();
  const route = ROUTES[initialHash] ? initialHash : 'dashboard';

  window.addEventListener('hashchange', onHashChange);
  navigateTo(route, { replace: true });
  window.addEventListener('keydown', onGlobalKeydown);
}


export async function navigateTo(routeKey, opts = {}) {
  if (window.SF?.attendanceGate && routeKey !== 'attendance') {
    console.warn('🚫 Blocked by attendance gate:', routeKey);
    toast('📸 Check in first to unlock all features', 'error', 3000);
    if (ROUTER.currentRoute !== 'attendance') {
      history.replaceState(null, '', '#attendance');
      return navigateTo('attendance', { replace: true, force: true });
    }
    return;
  }

  try {
    const perms = window.SF?.perms;
    if (perms && typeof perms.canAccessRoute === 'function') {
      if (!perms.canAccessRoute(routeKey)) {
        console.warn('🚫 Route blocked by role:', routeKey);
        const allowed = perms.getAccessibleRoutes(ROUTE_ORDER);
        const fallback = allowed[0] || 'dashboard';
        if (fallback !== routeKey) {
          try { perms.guard('route.' + routeKey, 'Access denied to ' + routeKey); } catch (e) {}
          return navigateTo(fallback, { replace: true });
        }
        return;
      }
    }
  } catch (e) {}

  if (ROUTER.loading) { console.warn('⏳ Navigation in progress'); return; }

  const route = ROUTES[routeKey];
  if (!route) { console.warn('Unknown route:', routeKey); toast('Module not found: ' + routeKey, 'error'); return; }

  if (ROUTER.currentRoute === routeKey && !opts.force) return;

  ROUTER.loading = true;

  try {
    if (ROUTER.currentModule && typeof ROUTER.currentModule.onUnload === 'function') {
      try { await ROUTER.currentModule.onUnload(); } catch (e) { console.error(e); }
    }

    showModuleLoading();

    if (!opts.skipHistory) {
      const newHash = '#' + routeKey;
      if (opts.replace) history.replaceState(null, '', newHash);
      else { history.pushState(null, '', newHash); ROUTER.history.push(routeKey); }
    }

    const html = await loadModuleHTML(routeKey);
    ROUTER.container.innerHTML = html;

    reExecuteScripts(ROUTER.container);

    updateTabBar(routeKey);
    ROUTER.currentRoute = routeKey;
    emit('route:changed', { route: routeKey, config: route });

    const initFnName = 'init_' + routeKey.replace(/-/g, '_') + 'Module';
    if (typeof window[initFnName] === 'function') {
      try {
        ROUTER.currentModule = await window[initFnName]() || null;
      } catch (e) {
        console.error('Module init failed:', initFnName, e);
        toast('Module failed to initialize: ' + route.label, 'error', 4000);
      }
    }

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

    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (err) {
    console.error('Navigation error:', err);
    showModuleError(route.label, err);
    toast('Failed to load ' + route.label, 'error', 4000);
  } finally {
    ROUTER.loading = false;
  }
}


function reExecuteScripts(container) {
  if (!container) return;
  const oldScripts = Array.from(container.querySelectorAll('script'));
  if (oldScripts.length === 0) return;
  console.log('%c🔧 Re-executing ' + oldScripts.length + ' script(s)', 'color:#8b5cf6');
  oldScripts.forEach((oldScript) => {
    const newScript = document.createElement('script');
    Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
    if (!oldScript.src) newScript.textContent = oldScript.textContent;
    try { oldScript.parentNode.replaceChild(newScript, oldScript); }
    catch (e) { console.error('Failed to re-execute script:', e); }
  });
}


function onHashChange() {
  const hash = window.location.hash.replace('#', '').trim();
  if (!hash || !ROUTES[hash]) {
    if (ROUTER.currentRoute !== 'dashboard') navigateTo('dashboard', { replace: true });
    return;
  }
  if (hash !== ROUTER.currentRoute) navigateTo(hash, { skipHistory: true });
}


function onGlobalKeydown(e) {
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;

  const match = e.key.match(/^F(\d{1,2})$/);
  if (!match) return;

  const num = parseInt(match[1], 10);
  if (num < 1 || num > ROUTE_ORDER.length) return;

  e.preventDefault();
  const routeKey = ROUTE_ORDER[num - 1];

  if (window.SF?.attendanceGate && routeKey !== 'attendance') {
    toast('📸 Check in first', 'error', 2500);
    return;
  }

  if (window.SF?.perms && !window.SF.perms.canAccessRoute(routeKey)) return;

  navigateTo(routeKey);
}


async function loadModuleHTML(routeKey) {
  if (ROUTER.moduleCache[routeKey]) return ROUTER.moduleCache[routeKey];
  const route = ROUTES[routeKey];
  const url = route.file + '?v=' + Date.now();
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const html = await res.text();
    ROUTER.moduleCache[routeKey] = html;
    console.log('%c📄 Module loaded: ' + routeKey, 'color:#06b6d4');
    return html;
  } catch (e) {
    console.error('Failed to load module:', routeKey, e);
    throw e;
  }
}

export function clearModuleCache(routeKey) {
  if (routeKey) delete ROUTER.moduleCache[routeKey];
  else ROUTER.moduleCache = {};
}


function showModuleLoading() {
  if (!ROUTER.container) return;
  ROUTER.container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:80px 20px;flex-direction:column;gap:16px">
      <div style="width:48px;height:48px;border:3px solid rgba(14,165,233,0.2);border-top-color:#0ea5e9;border-radius:50%;animation:sfSpin 0.8s linear infinite;"></div>
      <div style="color:#64748b;font-size:13px;font-weight:600">Loading module...</div>
      <style>@keyframes sfSpin { to { transform: rotate(360deg); } }</style>
    </div>
  `;
}

function showModuleError(label, err) {
  if (!ROUTER.container) return;
  ROUTER.container.innerHTML = `
    <div style="max-width:520px;margin:60px auto;padding:28px;background:#1e1b2e;border:1px solid #7f1d1d;border-radius:16px;text-align:center;">
      <div style="font-size:42px;margin-bottom:12px">⚠️</div>
      <div style="font-size:16px;font-weight:800;color:#fca5a5;margin-bottom:6px">${label} module failed to load</div>
      <div style="font-size:12px;color:#94a3b8;line-height:1.6;margin-bottom:16px">${err && err.message ? err.message : 'Unknown error'}</div>
      <button type="button" onclick="location.reload()" style="padding:10px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#0ea5e9,#0369a1);color:white;font-weight:700;cursor:pointer;font-size:13px;">Reload App</button>
    </div>
  `;
}


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
  document.title = `${route.label} — SmartFix ERP`;
}

export function renderTabBar(allowedRoutes) {
  const nav = document.getElementById('sfTabBar');
  if (!nav) return;
  const routes = Array.isArray(allowedRoutes) && allowedRoutes.length ? allowedRoutes : ROUTE_ORDER;
  nav.innerHTML = routes.map((key) => {
    const r = ROUTES[key];
    if (!r) return '';
    return `
      <button type="button" id="nav-${key}" onclick="SF.router.go('${key}')"
              class="sf-tab-btn" data-route="${key}" title="${r.description} (${r.shortcut})">
        <span class="sf-tab-icon">${r.icon}</span>
        <span class="sf-tab-label">${r.label}</span>
      </button>
    `;
  }).join('');
  if (ROUTER.currentRoute) updateTabBar(ROUTER.currentRoute);
}


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

window.SF = window.SF || {};
window.SF.router = Router;
window.SF.go = navigateTo;


window.addEventListener('popstate', () => {
  const hash = window.location.hash.replace('#', '').trim();
  if (hash && ROUTES[hash] && hash !== ROUTER.currentRoute) {
    navigateTo(hash, { skipHistory: true });
  }
});

console.log('%c🧭 Router ready (v4.7.0)', 'color:#06b6d4;font-weight:bold;font-size:11px', `| ${ROUTE_ORDER.length} routes`);
