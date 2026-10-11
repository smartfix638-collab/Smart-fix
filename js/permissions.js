/* ============================================================
   SMARTFIX ERP — Permissions & Role Engine (v4.3.0)
   File: js/permissions.js
   ============================================================ */

import { toast } from './common.js';

export const ROLES = {
  OWNER:      'OWNER',
  MANAGER:    'MANAGER',
  PROMOTER:   'PROMOTER',
  TECHNICIAN: 'TECHNICIAN',
  CA:         'CA'
};

export const ROLE_LABELS = {
  OWNER:      '👑 Owner',
  MANAGER:    '👔 Manager',
  PROMOTER:   '📢 Promoter',
  TECHNICIAN: '🔧 Technician',
  CA:         '📊 CA'
};

const PERMISSIONS = {

  OWNER: ['*'],

  MANAGER: [
    'billing.view', 'billing.create', 'billing.reprint',
    'returns.view', 'returns.create',
    'purchase.view', 'purchase.create',
    'vouchers.view', 'vouchers.create',
    'parties.view', 'parties.create',
    'inventory.view', 'inventory.create', 'inventory.sell', 'inventory.price.edit',
    'staff.view',
    'accounting.view', 'books.view',
    'attendance.view', 'attendance.mark', 'attendance.report',
    /* Repair — full operational access */
    'repair.view', 'repair.create', 'repair.edit', 'repair.print'
    /* NO repair.delete */
  ],

  PROMOTER: [
    'billing.view', 'billing.create', 'billing.reprint',
    'returns.view', 'returns.create',
    'parties.view', 'parties.create',
    'inventory.view', 'inventory.sell',
    'attendance.view', 'attendance.mark',
    /* Repair — view + create only */
    'repair.view', 'repair.create'
  ],

  TECHNICIAN: [
    'service.view', 'service.create', 'service.update',
    'inventory.view',
    'attendance.view', 'attendance.mark',
    /* Repair — full access */
    'repair.view', 'repair.create', 'repair.edit', 'repair.print'
  ],

  CA: [
    'accounting.view', 'books.view',
    'billing.view', 'returns.view', 'purchase.view', 'vouchers.view',
    'parties.view', 'inventory.view', 'staff.view',
    'export.ca',
    /* Read-only repair view */
    'repair.view'
  ]
};

const PERM_STATE = {
  role: 'OWNER',
  uid: null,
  storeId: null,
  name: '',
  isStaff: false
};

export function setRole(role, meta = {}) {
  PERM_STATE.role = (ROLES[role] ? role : 'OWNER');
  PERM_STATE.uid = meta.uid || null;
  PERM_STATE.storeId = meta.storeId || null;
  PERM_STATE.name = meta.name || '';
  PERM_STATE.isStaff = role !== 'OWNER';
  console.log('%c🔐 Role set: ' + role, 'color:#f59e0b;font-weight:bold', meta.name || '');
}

export function getRole()      { return PERM_STATE.role; }
export function getRoleLabel() { return ROLE_LABELS[PERM_STATE.role] || PERM_STATE.role; }
export function getUserMeta()  { return { ...PERM_STATE }; }
export function isOwner()      { return PERM_STATE.role === 'OWNER'; }

export function can(perm) {
  if (!perm) return false;
  const perms = PERMISSIONS[PERM_STATE.role];
  if (!perms) return false;
  if (perms.includes('*')) return true;
  if (perms.includes(perm)) return true;
  const parts = perm.split('.');
  if (parts.length === 2 && perms.includes(parts[0] + '.*')) return true;
  return false;
}

export function canAccessRoute(routeKey) {
  const ROUTE_PERMS = {
    billing:               'billing.view',
    returns:               'returns.view',
    purchase:              'purchase.view',
    vouchers:              'vouchers.view',
    accounting:            'accounting.view',
    books:                 'books.view',
    parties:               'parties.view',
    inventory:             'inventory.view',
    staff:                 'staff.view',
    settings:              'settings.view',
    attendance:            'attendance.view',
    'attendance-report':   'attendance.report',
    repair:                'repair.view'
  };
  const perm = ROUTE_PERMS[routeKey];
  if (!perm) return true;
  return can(perm);
}

export function guard(perm, msg) {
  if (can(perm)) return true;
  toast('🔒 ' + (msg || 'You do not have permission for this action'), 'error', 3000);
  try { console.warn('Permission denied:', perm, 'for role', PERM_STATE.role); } catch (e) {}
  return false;
}

export function getAccessibleRoutes(allRoutes) {
  return allRoutes.filter((key) => canAccessRoute(key));
}

window.SF = window.SF || {};
window.SF.perms = {
  ROLES, ROLE_LABELS,
  setRole, getRole, getRoleLabel, getUserMeta,
  isOwner, can, guard, canAccessRoute, getAccessibleRoutes
};

console.log('%c🔐 Permissions engine ready (v4.3.0)', 'color:#f59e0b;font-weight:bold;font-size:11px');
