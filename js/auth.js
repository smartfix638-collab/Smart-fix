/* ============================================================
   SMARTFIX ERP — Authentication Engine (v4.4.0)
   File: js/auth.js
   Purpose:
     • Owner registration + login
     • STAFF login (phone + password)
     • Customer portal lookup (invoice + repairs)
     • Role detection
   ============================================================ */

import { auth, db, PATHS } from './firebase-config.js';
import { setRole, ROLES } from './permissions.js';

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  doc, setDoc, getDoc, getDocs,
  collection, query, where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ============================================================
   HELPERS
   ============================================================ */
function setBtnLoading(btnId, busy, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (busy) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>' + (label || 'Please wait...');
  } else {
    btn.disabled = false;
    btn.textContent = label || btn.dataset.originalText || 'Submit';
  }
}

function setError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) el.textContent = msg || '';
}

function clearAllErrors() {
  ['ownerError', 'regError', 'custError', 'staffError'].forEach(id => setError(id, ''));
}

function friendlyError(code) {
  const map = {
    'auth/user-not-found':          'No account found.',
    'auth/wrong-password':          'Incorrect password.',
    'auth/invalid-credential':      'Invalid credentials.',
    'auth/invalid-email':           'Invalid email.',
    'auth/email-already-in-use':    'Email already registered.',
    'auth/weak-password':           'Password min 6 characters.',
    'auth/network-request-failed':  'No internet connection.',
    'auth/too-many-requests':       'Too many attempts. Wait a minute.',
    'auth/operation-not-allowed':   'Email sign-in not enabled.',
    'permission-denied':            'Access denied. Check Firestore Rules.',
    'unavailable':                  'Firebase unavailable. Try again.'
  };
  return map[code] || ('Error: ' + code);
}

function slugifyShopCode(shopName) {
  const base = (shopName || 'shop').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'shop';
  const rand = Math.floor(100 + Math.random() * 900);
  return base + rand;
}


/* ============================================================
   OWNER LOGIN
   ============================================================ */
window.ownerLogin = async function () {
  clearAllErrors();
  const email = (document.getElementById('ownerEmail')?.value || '').trim();
  const pass  = document.getElementById('ownerPass')?.value || '';
  if (!email || !pass) { setError('ownerError', 'Enter email and password.'); return; }

  setBtnLoading('ownerLoginBtn', true, 'Signing in...');

  try {
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;
    console.log('🔐 Owner login UID:', uid);

    const storeSnap = await Promise.race([
      getDoc(doc(db, PATHS.stores, uid)),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
    ]);

    if (!storeSnap.exists()) {
      setError('ownerError', 'Store not found. Register again.');
      setBtnLoading('ownerLoginBtn', false, 'Sign In →');
      await signOut(auth);
      return;
    }

    const storeData = storeSnap.data();
    setRole(ROLES.OWNER, { uid, storeId: uid, name: storeData.shopName });

    try {
      localStorage.setItem('sfp_current_store', JSON.stringify({
        uid, shopName: storeData.shopName, shopCode: storeData.shopCode,
        email: storeData.ownerEmail, role: 'OWNER'
      }));
    } catch (e) {}

    let appExists = false;
    try { appExists = (await fetch('./app.html', { method: 'HEAD' })).ok; } catch (e) {}

    if (!appExists) {
      alert('✅ Login successful!\n\napp.html not created yet.');
      setBtnLoading('ownerLoginBtn', false, 'Sign In →');
      return;
    }

    location.href = './app.html';

  } catch (err) {
    console.error('Login error:', err);
    setError('ownerError', friendlyError(err.code));
    setBtnLoading('ownerLoginBtn', false, 'Sign In →');
  }
};


/* ============================================================
   OWNER REGISTER
   ============================================================ */
window.ownerRegister = async function () {
  clearAllErrors();
  const shop  = (document.getElementById('regShop')?.value || '').trim();
  const phone = (document.getElementById('regPhone')?.value || '').trim();
  const email = (document.getElementById('regEmail')?.value || '').trim();
  const pass  = document.getElementById('regPass')?.value || '';

  if (!shop || shop.length < 3)  { setError('regError', 'Shop name min 3 chars.'); return; }
  if (!email)                    { setError('regError', 'Email required.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('regError', 'Invalid email.'); return; }
  if (!pass || pass.length < 6)  { setError('regError', 'Password min 6 chars.'); return; }
  if (phone && !/^\d{10}$/.test(phone)) { setError('regError', 'Phone must be 10 digits.'); return; }

  setBtnLoading('regBtn', true, 'Creating store...');

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;
    await updateProfile(cred.user, { displayName: shop });

    let shopCode = slugifyShopCode(shop);
    for (let i = 0; i < 5; i++) {
      const snap = await getDoc(doc(db, PATHS.publicCodes, shopCode));
      if (!snap.exists()) break;
      shopCode = slugifyShopCode(shop);
    }

    await setDoc(doc(db, PATHS.stores, uid), {
      uid, ownerEmail: email.toLowerCase(),
      ownerPhone: phone || '', shopName: shop, shopCode,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      plan: 'trial', version: '4.4.0'
    });

    await setDoc(doc(db, PATHS.stores, uid, PATHS.counters, 'main'), {
      invSeq: 0, crnSeq: 0, purSeq: 0, updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, PATHS.stores, uid, PATHS.profile, 'main'), {
      name: shop, phone: phone ? `Ph: ${phone}` : '',
      gstin: '', address: '', logo: '',
      bankName: '', bankBranch: '', bankAcc: '', bankIFSC: '', upiId: '',
      terms: '1. Subject to Local Jurisdiction.\n2. Warranty covered by Brand Authorized Service Centers.\n3. Goods once sold will not be taken back without original invoice.',
      masterPin: '', updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, PATHS.stores, uid, PATHS.categories, 'main'), {
      list: ['Mobile Phone','Mobile Cover','Tempered Glass','Cable','Charger','Earphone','Power Bank','Memory Card','Other'],
      updatedAt: serverTimestamp()
    });

    await setDoc(doc(db, PATHS.publicCodes, shopCode), {
      uid, shopName: shop, shopCode, createdAt: serverTimestamp()
    });

    setRole(ROLES.OWNER, { uid, storeId: uid, name: shop });

    try {
      localStorage.setItem('sfp_current_store', JSON.stringify({
        uid, shopName: shop, shopCode, email: email.toLowerCase(), role: 'OWNER'
      }));
    } catch (e) {}

    alert(
      '🎉 STORE CREATED!\n\n' +
      'Shop: ' + shop + '\n' +
      'Shop Code: ' + shopCode + '\n' +
      'Email: ' + email + '\n\n' +
      '⚠ Save your Shop Code!'
    );

    let appExists = false;
    try { appExists = (await fetch('./app.html', { method: 'HEAD' })).ok; } catch (e) {}
    if (appExists) location.href = './app.html';

  } catch (err) {
    console.error('Register error:', err);
    setError('regError', friendlyError(err.code));
    setBtnLoading('regBtn', false, 'Create Store →');
  }
};


/* ============================================================
   STAFF LOGIN
   ============================================================ */
window.staffLogin = async function () {
  clearAllErrors();
  const phone = (document.getElementById('staffPhoneLogin')?.value || '').trim();
  const pass  = document.getElementById('staffPassLogin')?.value || '';

  if (!/^\d{10}$/.test(phone)) { setError('staffError', 'Enter valid 10-digit phone.'); return; }
  if (!pass || pass.length < 6) { setError('staffError', 'Password min 6 chars.'); return; }

  setBtnLoading('staffLoginBtn', true, 'Signing in...');

  try {
    const phoneSnap = await getDoc(doc(db, 'publicPhoneIndex', phone));
    if (!phoneSnap.exists()) {
      setError('staffError', 'No account with this phone. Contact owner.');
      setBtnLoading('staffLoginBtn', false, 'Sign In →');
      return;
    }

    const { email, storeId, role, name } = phoneSnap.data();
    if (!email) {
      setError('staffError', 'Account incomplete. Contact owner.');
      setBtnLoading('staffLoginBtn', false, 'Sign In →');
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, email, pass);
    console.log('🔐 Staff login:', cred.user.uid, '| Role:', role);

    const staffUserSnap = await getDoc(
      doc(db, PATHS.stores, storeId, 'staffUsers', cred.user.uid)
    );

    if (!staffUserSnap.exists()) {
      setError('staffError', 'Account disabled. Contact owner.');
      setBtnLoading('staffLoginBtn', false, 'Sign In →');
      await signOut(auth);
      return;
    }

    const staffData = staffUserSnap.data();
    const finalRole = staffData.role || role;

    if (staffData.disabled === true) {
      setError('staffError', 'Your account is disabled.');
      setBtnLoading('staffLoginBtn', false, 'Sign In →');
      await signOut(auth);
      return;
    }

    setRole(finalRole, {
      uid: cred.user.uid,
      storeId: storeId,
      name: staffData.name || name
    });

    try {
      localStorage.setItem('sfp_current_store', JSON.stringify({
        uid: cred.user.uid,
        storeId: storeId,
        staffName: staffData.name || name,
        role: finalRole,
        isStaff: true
      }));
    } catch (e) {}

    let appExists = false;
    try { appExists = (await fetch('./app.html', { method: 'HEAD' })).ok; } catch (e) {}
    if (!appExists) {
      alert('✅ Login successful!\n\napp.html not created yet.');
      setBtnLoading('staffLoginBtn', false, 'Sign In →');
      return;
    }

    location.href = './app.html';

  } catch (err) {
    console.error('Staff login error:', err);
    setError('staffError', friendlyError(err.code));
    setBtnLoading('staffLoginBtn', false, 'Sign In →');
  }
};


/* ============================================================
   PASSWORD RESET
   ============================================================ */
window.ownerForgotPassword = async function () {
  clearAllErrors();
  const email = (document.getElementById('ownerEmail')?.value || '').trim();
  if (!email) {
    setError('ownerError', 'Enter email first.');
    document.getElementById('ownerEmail')?.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    alert('✅ Reset link sent to:\n\n' + email);
  } catch (err) {
    setError('ownerError', friendlyError(err.code));
  }
};

window.staffForgotPassword = async function () {
  clearAllErrors();
  const phone = (document.getElementById('staffPhoneLogin')?.value || '').trim();
  if (!/^\d{10}$/.test(phone)) {
    setError('staffError', 'Enter your phone first.');
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'publicPhoneIndex', phone));
    if (!snap.exists() || !snap.data().email) {
      setError('staffError', 'No account with this phone.');
      return;
    }
    await sendPasswordResetEmail(auth, snap.data().email);
    alert('✅ Reset link sent to email on file.');
  } catch (err) {
    setError('staffError', friendlyError(err.code));
  }
};


/* ============================================================
   LOGOUT
   ============================================================ */
window.ownerLogout = async function () {
  if (!confirm('Sign out?')) return;
  try {
    await signOut(auth);
    localStorage.removeItem('sfp_current_store');
    location.href = './index.html';
  } catch (err) { alert('Logout failed.'); }
};


/* ============================================================
   CUSTOMER PORTAL LOOKUP — Invoices + Repairs
   ============================================================ */
window.customerLookup = async function () {
  clearAllErrors();
  const shopCode = (document.getElementById('custShop')?.value || '').trim().toLowerCase();
  const phone    = (document.getElementById('custPhone')?.value || '').trim();
  const code     = (document.getElementById('custCode')?.value || '').trim().toUpperCase();

  if (!shopCode)                 { setError('custError', 'Enter Shop Code.'); return; }
  if (!/^\d{10}$/.test(phone))   { setError('custError', 'Enter valid 10-digit phone.'); return; }
  if (!code || code.length < 3)  { setError('custError', 'Enter IMEI / Invoice No / Job No.'); return; }

  setBtnLoading('custBtn', true, 'Searching...');

  try {
    /* ---- Shop lookup ---- */
    const shopSnap = await getDoc(doc(db, PATHS.publicCodes, shopCode));
    if (!shopSnap.exists()) {
      setError('custError', 'Shop Code not found. Ask your dealer.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }
    const storeId = shopSnap.data().uid;

    /* ---- Fetch invoices by phone ---- */
    let invoiceMatches = [];
    try {
      const invQ = query(
        collection(db, PATHS.stores, storeId, PATHS.invoices),
        where('customerPhone', '==', phone)
      );
      const invSnap = await getDocs(invQ);
      invSnap.forEach((d) => {
        const inv = d.data();
        const invNo = (inv.invoiceNo || '').toUpperCase();
        const items = inv.items || [];
        const invNoMatch = invNo.includes(code);
        const imeiMatch = items.some((it) => {
          const imei = (it.imei || '').toUpperCase();
          return imei.endsWith(code) || imei.includes(code);
        });
        if (invNoMatch || imeiMatch) invoiceMatches.push({ id: d.id, ...inv });
      });
    } catch (e) {
      console.warn('Invoice lookup failed:', e.code);
    }

    /* ---- Fetch repairs by phone ---- */
    let repairMatches = [];
    try {
      const repQ = query(
        collection(db, PATHS.stores, storeId, 'repairs'),
        where('customerPhone', '==', phone)
      );
      const repSnap = await getDocs(repQ);
      repSnap.forEach((d) => {
        const rep = d.data();
        const jobNo = (rep.jobNo || '').toUpperCase();
        const imei = (rep.deviceIMEI || '').toUpperCase();
        const jobMatch = jobNo.includes(code);
        const imeiMatch = imei && (imei.endsWith(code) || imei.includes(code));
        if (jobMatch || imeiMatch) repairMatches.push({ id: d.id, ...rep });
      });
    } catch (e) {
      console.warn('Repair lookup failed:', e.code);
    }

    /* ---- Nothing found ---- */
    if (invoiceMatches.length === 0 && repairMatches.length === 0) {
      setError('custError', 'No bills or repairs found. Check phone and code.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }

    /* ---- Save session ---- */
    sessionStorage.setItem('sfp_customer_session', JSON.stringify({
      storeId, shopCode,
      shopName: shopSnap.data().shopName || 'Store',
      phone, code,
      invoices: invoiceMatches,
      repairs: repairMatches,
      searchedAt: new Date().toISOString()
    }));

    location.href = './customer.html';

  } catch (err) {
    console.error('Customer lookup error:', err);
    setError('custError', friendlyError(err.code));
    setBtnLoading('custBtn', false, 'Find My Bill →');
  }
};


/* ============================================================
   AUTO-REDIRECT IF LOGGED IN
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  const path = window.location.pathname;
  const isLoginPage = path.endsWith('index.html') || path === '/' || path.endsWith('/');
  if (!user || !isLoginPage) return;

  try {
    const storeSnap = await getDoc(doc(db, PATHS.stores, user.uid));
    if (storeSnap.exists()) {
      setRole(ROLES.OWNER, { uid: user.uid, storeId: user.uid });
    } else {
      const cached = localStorage.getItem('sfp_current_store');
      if (cached) {
        try {
          const c = JSON.parse(cached);
          if (c.isStaff && c.role) setRole(c.role, { uid: user.uid, storeId: c.storeId });
        } catch (e) {}
      }
    }

    let appExists = false;
    try { appExists = (await fetch('./app.html', { method: 'HEAD' })).ok; } catch (e) {}
    if (appExists) {
      console.log('✅ Already signed in — redirecting to app.html');
      location.href = './app.html';
    }
  } catch (e) { console.warn(e); }
});

console.log('%c🔐 Auth module ready (v4.4.0)', 'color:#10b981;font-weight:bold');
