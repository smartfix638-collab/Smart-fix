/* ============================================================
   SMARTFIX ERP — Cloud Sync Engine
   File: js/cloud.js
   Version: 4.0.0
   Purpose:
     • Two-way sync between localStorage state and Firestore
     • Real-time listeners for all collections
     • Offline queue with auto-retry
     • Atomic invoice/CRN/purchase number generation
     • Store profile sync
     • Public store code management
   ============================================================ */

import { auth, db, PATHS } from './firebase-config.js';
import { state, KEYS, emit, on, logAudit, setCollection, saveProfile } from './state.js';
import { toast } from './common.js';

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  onSnapshot, query, orderBy, where,
  serverTimestamp, runTransaction, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";


/* ============================================================
   1. RUNTIME STATE
   ============================================================ */
const CLOUD = {
  storeId:      null,
  unsubscribers: [],
  queuedWrites: [],       // offline queue
  isPushing:    false,
  lastSyncAt:   null,
  listenersReady: false
};

const COLLECTION_MAP = {
  invoices:       { cloud: PATHS.invoices,        idField: 'invoiceNo', localKey: KEYS.INVOICES },
  creditNotes:    { cloud: PATHS.creditNotes,     idField: 'crnNo',     localKey: KEYS.CREDIT_NOTES },
  purchases:      { cloud: PATHS.purchases,       idField: 'purchaseNo',localKey: KEYS.PURCHASES },
  vouchers:       { cloud: PATHS.vouchers,        idField: 'id',        localKey: KEYS.VOUCHERS },
  inventory:      { cloud: PATHS.inventory,       idField: 'id',        localKey: KEYS.INVENTORY },
  parties:        { cloud: PATHS.parties,         idField: 'id',        localKey: KEYS.PARTIES },
  staff:          { cloud: PATHS.staff,           idField: 'id',        localKey: KEYS.STAFF },
  salaryPayments: { cloud: PATHS.salaryPayments,  idField: 'id',        localKey: KEYS.SALARY_PAYMENTS },
  auditLog:       { cloud: PATHS.auditLog,        idField: 'id',        localKey: KEYS.AUDIT_LOG }
};


/* ============================================================
   2. UTILITIES
   ============================================================ */
function cloudLog(...args) {
  console.log('%c☁️  [Cloud]', 'color:#0ea5e9;font-weight:bold', ...args);
}

function cloudWarn(...args) {
  console.warn('%c☁️  [Cloud]', 'color:#f59e0b;font-weight:bold', ...args);
}

function cloudErr(...args) {
  console.error('%c☁️  [Cloud]', 'color:#ef4444;font-weight:bold', ...args);
}

function docIdFromItem(item, idField) {
  if (!item) return null;
  const v = item[idField];
  if (v === undefined || v === null || v === '') return null;
  return String(v);
}

/**
 * Strip Firestore-only fields and return clean object for local state
 */
function cleanFromCloud(data) {
  if (!data) return {};
  const out = { ...data };
  delete out._updatedAt;
  delete out._createdAt;
  return out;
}


/* ============================================================
   3. AUTH LISTENER — bootstrap cloud on login
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    /* Logged out — detach everything */
    detachAllListeners();
    CLOUD.storeId = null;
    CLOUD.listenersReady = false;
    state.cloudReady = false;
    return;
  }

  CLOUD.storeId = user.uid;
  cloudLog('Signed in. StoreId:', user.uid);

  try {
    await bootstrap();
  } catch (e) {
    cloudErr('Bootstrap failed:', e);
    toast('Cloud sync failed. Working offline.', 'warning', 4000);
  }
});


/* ============================================================
   4. BOOTSTRAP — pull profile + attach listeners
   ============================================================ */
async function bootstrap() {
  const storeId = CLOUD.storeId;
  if (!storeId) return;

  /* ---- 4.1 Load store profile ---- */
  try {
    const profileSnap = await getDoc(doc(db, PATHS.stores, storeId, PATHS.profile, 'main'));
    if (profileSnap.exists()) {
      const remote = profileSnap.data();
      const merged = { ...state.profile, ...remote };
      delete merged.updatedAt;
      saveProfile(merged);
      cloudLog('Profile synced');
      emit('profile:updated', state.profile);
    }
  } catch (e) {
    cloudWarn('Profile load failed:', e.code);
  }

  /* ---- 4.2 Load categories ---- */
  try {
    const catSnap = await getDoc(doc(db, PATHS.stores, storeId, PATHS.categories, 'main'));
    if (catSnap.exists() && Array.isArray(catSnap.data().list)) {
      const remote = catSnap.data().list;
      if (remote.length) {
        state.categories = remote;
        try { localStorage.setItem(KEYS.CATEGORIES, JSON.stringify(remote)); } catch (e) {}
        cloudLog('Categories synced:', remote.length);
        emit('categories:updated', remote);
      }
    }
  } catch (e) {
    cloudWarn('Categories load failed:', e.code);
  }

  /* ---- 4.3 Attach real-time listeners to all collections ---- */
  attachAllListeners();

  /* ---- 4.4 Flush any queued writes ---- */
  flushQueue();

  CLOUD.listenersReady = true;
  state.cloudReady = true;
  emit('cloud:ready');
  cloudLog('Bootstrap complete ✅');
}


/* ============================================================
   5. REAL-TIME LISTENERS
   ============================================================ */
function attachAllListeners() {
  const storeId = CLOUD.storeId;
  if (!storeId) return;

  Object.entries(COLLECTION_MAP).forEach(([stateKey, cfg]) => {
    const collRef = collection(db, PATHS.stores, storeId, cfg.cloud);
    /* Try ordering by _updatedAt; fallback if fails */
    let q;
    try {
      q = query(collRef, orderBy('_updatedAt', 'desc'));
    } catch (e) {
      q = collRef;
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = [];
        snap.forEach((d) => arr.push({ id: d.id, ...cleanFromCloud(d.data()) }));
        /* Update state without triggering cloud push */
        state[stateKey] = arr;
        try {
          localStorage.setItem(cfg.localKey, JSON.stringify(arr));
        } catch (e) { /* quota */ }

        emit('change:' + stateKey, arr);
        emit('cloud:pulled', { name: stateKey, count: arr.length });
      },
      (err) => {
        cloudWarn('Listener error for', stateKey, err.code);
        /* Fallback: try without orderBy */
        if (err.code === 'failed-precondition') {
          onSnapshot(collRef, (snap2) => {
            const arr = [];
            snap2.forEach((d) => arr.push({ id: d.id, ...cleanFromCloud(d.data()) }));
            state[stateKey] = arr;
            try { localStorage.setItem(cfg.localKey, JSON.stringify(arr)); } catch (e) {}
            emit('change:' + stateKey, arr);
          });
        }
      }
    );

    CLOUD.unsubscribers.push(unsub);
    cloudLog('Listener attached:', stateKey);
  });
}

function detachAllListeners() {
  CLOUD.unsubscribers.forEach((fn) => {
    try { fn(); } catch (e) {}
  });
  CLOUD.unsubscribers = [];
  CLOUD.listenersReady = false;
  cloudLog('All listeners detached');
}


/* ============================================================
   6. PUSH — send local item to Firestore
   ============================================================ */

/**
 * Push a single item to its collection
 * @param {string} stateKey - e.g. 'invoices'
 * @param {object} item - the record
 */
export async function pushOne(stateKey, item) {
  if (!state.cloudReady || !CLOUD.storeId) {
    queueWrite({ op: 'set', stateKey, item });
    return;
  }
  const cfg = COLLECTION_MAP[stateKey];
  if (!cfg) { cloudWarn('Unknown collection for push:', stateKey); return; }

  const id = docIdFromItem(item, cfg.idField);
  if (!id) { cloudErr('Cannot push — no id field', stateKey, cfg.idField); return; }

  try {
    await setDoc(
      doc(db, PATHS.stores, CLOUD.storeId, cfg.cloud, id),
      { ...item, _updatedAt: serverTimestamp() },
      { merge: true }
    );
    cloudLog('Pushed:', stateKey, id);
  } catch (e) {
    cloudErr('Push failed for', stateKey, id, e.code);
    queueWrite({ op: 'set', stateKey, item });
  }
}

/**
 * Push a batch of items (from state collection)
 */
export async function pushAll(stateKey) {
  const cfg = COLLECTION_MAP[stateKey];
  const items = state[stateKey];
  if (!cfg || !Array.isArray(items)) return;

  if (!state.cloudReady || !CLOUD.storeId) {
    cloudWarn('Not ready — caching', stateKey);
    return;
  }

  const batch = writeBatch(db);
  let count = 0;

  items.forEach((item) => {
    const id = docIdFromItem(item, cfg.idField);
    if (!id) return;
    const ref = doc(db, PATHS.stores, CLOUD.storeId, cfg.cloud, id);
    batch.set(ref, { ...item, _updatedAt: serverTimestamp() }, { merge: true });
    count++;
    if (count >= 450) return; // keep under 500 limit
  });

  if (count === 0) return;
  try {
    await batch.commit();
    cloudLog('Batch pushed:', stateKey, count);
  } catch (e) {
    cloudErr('Batch push failed:', stateKey, e.code);
  }
}

/**
 * Delete a document from cloud
 */
export async function deleteOne(stateKey, id) {
  if (!state.cloudReady || !CLOUD.storeId) {
    queueWrite({ op: 'delete', stateKey, id });
    return;
  }
  const cfg = COLLECTION_MAP[stateKey];
  if (!cfg) return;
  try {
    await deleteDoc(doc(db, PATHS.stores, CLOUD.storeId, cfg.cloud, String(id)));
    cloudLog('Deleted:', stateKey, id);
  } catch (e) {
    cloudErr('Delete failed:', stateKey, id, e.code);
    queueWrite({ op: 'delete', stateKey, id });
  }
}


/* ============================================================
   7. PROFILE SYNC
   ============================================================ */
export async function pushProfile(profile) {
  if (!CLOUD.storeId) return;
  try {
    await setDoc(
      doc(db, PATHS.stores, CLOUD.storeId, PATHS.profile, 'main'),
      { ...profile, updatedAt: serverTimestamp() },
      { merge: true }
    );
    cloudLog('Profile pushed');
  } catch (e) {
    cloudErr('Profile push failed:', e.code);
  }
}

export async function pushCategories(list) {
  if (!CLOUD.storeId) return;
  try {
    await setDoc(
      doc(db, PATHS.stores, CLOUD.storeId, PATHS.categories, 'main'),
      { list, updatedAt: serverTimestamp() },
      { merge: true }
    );
    cloudLog('Categories pushed:', list.length);
  } catch (e) {
    cloudErr('Categories push failed:', e.code);
  }
}

export async function pushStoreMeta(patch) {
  if (!CLOUD.storeId) return;
  try {
    await setDoc(
      doc(db, PATHS.stores, CLOUD.storeId),
      { ...patch, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (e) {
    cloudErr('Store meta push failed:', e.code);
  }
}


/* ============================================================
   8. ATOMIC COUNTERS (invoice / CRN / purchase numbers)
   ============================================================ */
export async function nextAtomicNumber(kind, fyShort) {
  if (!CLOUD.storeId) return null;
  const fieldMap = {
    invoice:  'invSeq',
    crn:      'crnSeq',
    purchase: 'purSeq'
  };
  const prefixMap = {
    invoice:  'SFP',
    crn:      'CRN',
    purchase: 'PUR'
  };

  const field  = fieldMap[kind] || 'invSeq';
  const prefix = prefixMap[kind] || 'SFP';
  const fy     = fyShort || '2425';

  const counterRef = doc(db, PATHS.stores, CLOUD.storeId, PATHS.counters, 'main');
  const transKey = `${field}_${fy}`;

  try {
    const next = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const data = snap.exists() ? snap.data() : {};
      const cur = Number(data[transKey]) || 0;
      const n = cur + 1;
      tx.set(counterRef, { [transKey]: n, updatedAt: serverTimestamp() }, { merge: true });
      return n;
    });
    const no = `${prefix}-${fy}-${String(next).padStart(4, '0')}`;
    cloudLog('Atomic number:', no);
    return no;
  } catch (e) {
    cloudErr('Atomic counter failed:', e.code);
    /* Fallback: local-only number */
    const ts = Date.now().toString().slice(-6);
    return `${prefix}-${fy}-TMP${ts}`;
  }
}


/* ============================================================
   9. PUBLIC STORE CODE (for customer portal lookup)
   ============================================================ */
export async function publishStoreCode(shopCode, data) {
  if (!shopCode) return;
  try {
    await setDoc(
      doc(db, PATHS.publicCodes, shopCode),
      { ...data, updatedAt: serverTimestamp() },
      { merge: true }
    );
    cloudLog('Public store code published:', shopCode);
  } catch (e) {
    cloudErr('Store code publish failed:', e.code);
  }
}

export async function unpublishStoreCode(shopCode) {
  if (!shopCode) return;
  try {
    await deleteDoc(doc(db, PATHS.publicCodes, shopCode));
    cloudLog('Store code unpublished:', shopCode);
  } catch (e) {
    cloudErr('Store code unpublish failed:', e.code);
  }
}


/* ============================================================
   10. OFFLINE QUEUE
   ============================================================ */
function queueWrite(op) {
  CLOUD.queuedWrites.push(op);
  try {
    localStorage.setItem('sfp_cloud_queue', JSON.stringify(CLOUD.queuedWrites));
  } catch (e) {}
  cloudLog('Queued write:', op.op, op.stateKey || '');
}

async function flushQueue() {
  /* Load from localStorage first */
  try {
    const saved = JSON.parse(localStorage.getItem('sfp_cloud_queue') || '[]');
    if (saved.length) CLOUD.queuedWrites = saved;
  } catch (e) {}

  if (!CLOUD.queuedWrites.length) return;
  cloudLog('Flushing queue:', CLOUD.queuedWrites.length);

  const queue = [...CLOUD.queuedWrites];
  CLOUD.queuedWrites = [];

  for (const op of queue) {
    try {
      if (op.op === 'set')    await pushOne(op.stateKey, op.item);
      if (op.op === 'delete') await deleteOne(op.stateKey, op.id);
    } catch (e) {
      /* Re-queue failed item */
      CLOUD.queuedWrites.push(op);
    }
  }

  try {
    localStorage.setItem('sfp_cloud_queue', JSON.stringify(CLOUD.queuedWrites));
  } catch (e) {}

  if (CLOUD.queuedWrites.length === 0) {
    cloudLog('Queue flushed ✅');
  } else {
    cloudWarn('Queue still has', CLOUD.queuedWrites.length, 'items');
  }
}


/* ============================================================
   11. HOOK INTO STATE EVENTS
   ============================================================ */

/* When state emits change:xxx → push to cloud (except when pulled from cloud) */
let ignorePush = false;

on('change', ({ name }) => {
  if (ignorePush) return;
  if (!state.cloudReady) return;
  /* Debounce-batch push */
  schedulePushAll(name);
});

/* When state emits audit:new → push single item */
on('audit:new', (entry) => {
  if (!state.cloudReady) return;
  pushOne('auditLog', entry);
});

/* Custom event for individual record push */
on('cloud:push', ({ collection: coll, item }) => {
  if (item) pushOne(coll, item);
});

/* Custom event for record delete */
on('cloud:delete', ({ collection: coll, id }) => {
  deleteOne(coll, id);
});

/* Custom event for profile push */
on('cloud:pushProfile', (profile) => {
  pushProfile(profile);
});

/* Custom event for categories push */
on('cloud:pushCategories', (list) => {
  pushCategories(list);
});

/* Network back online → flush queue */
window.addEventListener('online', () => {
  setTimeout(() => flushQueue(), 800);
});


/* ============================================================
   12. BATCH PUSH SCHEDULER (debounced)
   ============================================================ */
const pushTimers = {};

function schedulePushAll(stateKey) {
  if (pushTimers[stateKey]) clearTimeout(pushTimers[stateKey]);
  pushTimers[stateKey] = setTimeout(() => {
    pushAll(stateKey);
    pushTimers[stateKey] = null;
  }, 900);
}


/* ============================================================
   13. RECONNECT CHECK
   ============================================================ */
setInterval(() => {
  if (!state.cloudReady && auth.currentUser) {
    cloudWarn('Retrying bootstrap...');
    bootstrap().catch(() => {});
  }
  if (state.netOnline && CLOUD.queuedWrites.length > 0) {
    flushQueue();
  }
}, 30000); /* every 30 seconds */


/* ============================================================
   14. PUBLIC API
   ============================================================ */
export const Cloud = {
  isReady:      () => state.cloudReady,
  getStoreId:   () => CLOUD.storeId,
  getLastSync:  () => CLOUD.lastSyncAt,
  getQueueSize: () => CLOUD.queuedWrites.length,

  pushOne,
  pushAll,
  deleteOne,
  pushProfile,
  pushCategories,
  pushStoreMeta,

  nextAtomicNumber,
  publishStoreCode,
  unpublishStoreCode,

  flushQueue,

  /* Manual re-attach (in case of errors) */
  rebootstrap: bootstrap
};


/* ============================================================
   15. GLOBAL CONSOLE ACCESS
   ============================================================ */
window.SF = window.SF || {};
window.SF.cloud = Cloud;


/* ============================================================
   16. BOOT LOG
   ============================================================ */
console.log(
  '%c☁️  Cloud sync engine ready',
  'color:#0ea5e9;font-weight:bold;font-size:11px'
);
