/* ============================================================
   SMARTFIX ERP — Authentication Engine (v4.0.1)
   File: js/auth.js
   Purpose:
     • Owner registration (creates store + unique Shop Code)
     • Owner login (Firebase Auth + Firestore verification)
     • Password reset via email
     • Customer portal lookup (phone + IMEI/Invoice)
     • Auto-redirect logged-in owners to app.html
   ============================================================ */

// ---------- Firebase Core ----------
import { auth, db, PATHS } from './firebase-config.js';

// ---------- Firebase Auth ----------
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ---------- Firestore ----------
import {
  doc, setDoc, getDoc, getDocs,
  collection, query, where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


/* ============================================================
   1. UI HELPERS
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
  ['ownerError', 'regError', 'custError'].forEach(id => setError(id, ''));
}


/* ============================================================
   2. FRIENDLY ERROR MESSAGES
   ============================================================ */
function friendlyError(code) {
  const map = {
    'auth/user-not-found':          'No account found with this email.',
    'auth/wrong-password':          'Incorrect password. Try again.',
    'auth/invalid-credential':      'Invalid email or password.',
    'auth/invalid-email':           'Please enter a valid email address.',
    'auth/email-already-in-use':    'This email is already registered. Try signing in.',
    'auth/weak-password':           'Password must be at least 6 characters.',
    'auth/network-request-failed':  'No internet connection.',
    'auth/too-many-requests':       'Too many failed attempts. Wait a minute.',
    'auth/operation-not-allowed':   'Email/Password sign-in not enabled in Firebase Console.',
    'auth/api-key-not-valid':       'Firebase API key invalid. Check config file.',
    'permission-denied':            'Access denied. Firestore Rules not published.',
    'unavailable':                  'Firebase is temporarily unavailable. Try again.',
    'resource-exhausted':           'Daily free limit reached. Try again tomorrow.'
  };
  return map[code] || ('Something went wrong. (' + code + ')');
}


/* ============================================================
   3. SHOP CODE GENERATOR
   ============================================================ */
function slugifyShopCode(shopName) {
  const base = (shopName || 'shop')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16) || 'shop';
  const rand = Math.floor(100 + Math.random() * 900);
  return base + rand;
}


/* ============================================================
   4. OWNER LOGIN (bullet-proof version)
   ============================================================ */
window.ownerLogin = async function () {
  clearAllErrors();

  const emailEl = document.getElementById('ownerEmail');
  const passEl  = document.getElementById('ownerPass');
  const email   = (emailEl?.value || '').trim();
  const pass    = passEl?.value || '';

  if (!email || !pass) {
    setError('ownerError', 'Please enter both email and password.');
    return;
  }

  setBtnLoading('ownerLoginBtn', true, 'Signing in...');

  try {
    console.log('%c🔐 Login attempt: ' + email, 'color:#38bdf8');

    /* --- Step 1: Firebase Auth sign-in --- */
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;
    console.log('%c✅ Auth OK. UID: ' + uid, 'color:#10b981');

    /* --- Step 2: Verify store exists (with timeout) --- */
    let storeData = null;
    try {
      const storeRef  = doc(db, PATHS.stores, uid);
      const timeout   = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
      const storeSnap = await Promise.race([getDoc(storeRef), timeout]);

      if (!storeSnap.exists()) {
        setError('ownerError', 'Store setup incomplete. Please register again.');
        setBtnLoading('ownerLoginBtn', false, 'Sign In →');
        await signOut(auth);
        return;
      }

      storeData = storeSnap.data();
      console.log('%c🏪 Store: ' + storeData.shopName + ' | Code: ' + storeData.shopCode, 'color:#38bdf8');

      /* Cache for app.html */
      try {
        localStorage.setItem('sfp_current_store', JSON.stringify({
          uid:      uid,
          shopName: storeData.shopName,
          shopCode: storeData.shopCode,
          email:    storeData.ownerEmail
        }));
      } catch (e) { /* quota ignored */ }

    } catch (storeErr) {
      console.error('❌ Firestore read failed:', storeErr);

      /* Still allow login — user is authenticated, just store profile missing */
      setError('ownerError', '');
      setBtnLoading('ownerLoginBtn', false, 'Sign In →');

      const msg = (storeErr.message === 'timeout')
        ? 'Firestore is slow. Check internet.'
        : 'Cannot read store data.\n\n⚠ Most likely cause: Firestore Rules not published.\n\nPlease check Firebase Console → Firestore → Rules.';

      alert('✅ You are signed in!\n\nBut: ' + msg);
      return;
    }

    /* --- Step 3: Success → try to go to app.html --- */
    setError('ownerError', '');
    setBtnLoading('ownerLoginBtn', false, 'Sign In →');

    console.log('%c➡️ Checking for app.html...', 'color:#38bdf8');

    /* Check if app.html exists */
    let appExists = false;
    try {
      const res = await fetch('./app.html', { method: 'HEAD' });
      appExists = res.ok;
    } catch (e) {
      appExists = false;
    }

    if (!appExists) {
      alert(
        '✅ LOGIN SUCCESSFUL!\n\n' +
        'Store: ' + (storeData.shopName || '') + '\n' +
        'Shop Code: ' + (storeData.shopCode || '') + '\n\n' +
        '⚠ app.html does not exist yet.\n' +
        'Please create it and try again.\n\n' +
        'You are signed in — session active.'
      );
      return;
    }

    console.log('%c🚀 Redirecting to app.html...', 'color:#10b981');
    location.href = './app.html';

  } catch (err) {
    console.error('❌ Login error:', err);
    setError('ownerError', friendlyError(err.code));
    setBtnLoading('ownerLoginBtn', false, 'Sign In →');
  }
};


/* ============================================================
   5. OWNER REGISTER (bullet-proof version)
   ============================================================ */
window.ownerRegister = async function () {
  clearAllErrors();

  const shop  = (document.getElementById('regShop')?.value || '').trim();
  const phone = (document.getElementById('regPhone')?.value || '').trim();
  const email = (document.getElementById('regEmail')?.value || '').trim();
  const pass  = document.getElementById('regPass')?.value || '';

  /* Validate */
  if (!shop || shop.length < 3)  { setError('regError', 'Shop name must be at least 3 characters.'); return; }
  if (!email)                    { setError('regError', 'Email is required.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('regError', 'Invalid email format.'); return; }
  if (!pass || pass.length < 6)  { setError('regError', 'Password must be at least 6 characters.'); return; }
  if (phone && !/^\d{10}$/.test(phone)) { setError('regError', 'Phone must be 10 digits.'); return; }

  setBtnLoading('regBtn', true, 'Creating store...');

  try {
    console.log('%c📝 Registration start: ' + shop, 'color:#38bdf8');

    /* --- Step 1: Create Auth user --- */
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;
    console.log('%c✅ Auth user created. UID: ' + uid, 'color:#10b981');

    await updateProfile(cred.user, { displayName: shop });

    /* --- Step 2: Unique Shop Code --- */
    let shopCode = slugifyShopCode(shop);
    for (let i = 0; i < 5; i++) {
      const codeSnap = await getDoc(doc(db, PATHS.publicCodes, shopCode));
      if (!codeSnap.exists()) break;
      shopCode = slugifyShopCode(shop);
    }
    console.log('%c🏷️  Shop Code: ' + shopCode, 'color:#38bdf8');

    /* --- Step 3: Store profile --- */
    await setDoc(doc(db, PATHS.stores, uid), {
      uid,
      ownerEmail: email.toLowerCase(),
      ownerPhone: phone || '',
      shopName:   shop,
      shopCode:   shopCode,
      createdAt:  serverTimestamp(),
      updatedAt:  serverTimestamp(),
      plan:       'trial',
      version:    '4.0.1'
    });

    /* --- Step 4: Counters --- */
    await setDoc(doc(db, PATHS.stores, uid, PATHS.counters, 'main'), {
      invSeq: 0, crnSeq: 0, purSeq: 0,
      updatedAt: serverTimestamp()
    });

    /* --- Step 5: Default profile --- */
    await setDoc(doc(db, PATHS.stores, uid, PATHS.profile, 'main'), {
      name:       shop,
      phone:      phone ? `Ph: ${phone}` : '',
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
      updatedAt:  serverTimestamp()
    });

    /* --- Step 6: Default categories --- */
    await setDoc(doc(db, PATHS.stores, uid, PATHS.categories, 'main'), {
      list: [
        'Mobile Phone', 'Mobile Cover', 'Tempered Glass', 'Cable',
        'Charger', 'Earphone', 'Power Bank', 'Memory Card', 'Other'
      ],
      updatedAt: serverTimestamp()
    });

    /* --- Step 7: Public shop code mapping --- */
    await setDoc(doc(db, PATHS.publicCodes, shopCode), {
      uid, shopName: shop, shopCode,
      createdAt: serverTimestamp()
    });

    /* Cache */
    try {
      localStorage.setItem('sfp_current_store', JSON.stringify({
        uid, shopName: shop, shopCode, email: email.toLowerCase()
      }));
    } catch (e) {}

    console.log('%c✅ Registration complete!', 'color:#10b981');

    setBtnLoading('regBtn', false, 'Create Store →');

    alert(
      '🎉 STORE CREATED SUCCESSFULLY!\n\n' +
      'Shop Name: ' + shop + '\n' +
      'Shop Code: ' + shopCode + '\n' +
      'Email: ' + email + '\n\n' +
      '⚠ IMPORTANT — Save your Shop Code!\n' +
      'Customers will use it to look up their bills.\n\n' +
      'You are now signed in.'
    );

    /* Try to redirect to app.html if it exists */
    let appExists = false;
    try {
      const res = await fetch('./app.html', { method: 'HEAD' });
      appExists = res.ok;
    } catch (e) {}
    if (appExists) {
      location.href = './app.html';
    }

  } catch (err) {
    console.error('❌ Register error:', err);
    setError('regError', friendlyError(err.code));
    setBtnLoading('regBtn', false, 'Create Store →');
  }
};


/* ============================================================
   6. PASSWORD RESET
   ============================================================ */
window.ownerForgotPassword = async function () {
  clearAllErrors();

  const email = (document.getElementById('ownerEmail')?.value || '').trim();
  if (!email) {
    setError('ownerError', 'Enter your email first, then click Forgot Password.');
    document.getElementById('ownerEmail')?.focus();
    return;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    alert('✅ Password reset link sent to:\n\n' + email + '\n\nCheck inbox + spam folder.');
  } catch (err) {
    setError('ownerError', friendlyError(err.code));
  }
};


/* ============================================================
   7. LOGOUT (used in app.html)
   ============================================================ */
window.ownerLogout = async function () {
  if (!confirm('Sign out from SmartFix ERP?')) return;
  try {
    await signOut(auth);
    localStorage.removeItem('sfp_current_store');
    location.href = './index.html';
  } catch (err) {
    alert('Logout failed. Try again.');
  }
};


/* ============================================================
   8. CUSTOMER PORTAL LOOKUP
   ============================================================ */
window.customerLookup = async function () {
  clearAllErrors();

  const shopCode = (document.getElementById('custShop')?.value || '').trim().toLowerCase();
  const phone    = (document.getElementById('custPhone')?.value || '').trim();
  const code     = (document.getElementById('custCode')?.value || '').trim().toUpperCase();

  if (!shopCode)                     { setError('custError', 'Enter Shop Code.'); return; }
  if (!/^\d{10}$/.test(phone))       { setError('custError', 'Enter valid 10-digit mobile number.'); return; }
  if (!code || code.length < 4)      { setError('custError', 'Enter last 6 IMEI digits or invoice no.'); return; }

  setBtnLoading('custBtn', true, 'Searching...');

  try {
    /* --- Shop lookup --- */
    const shopSnap = await getDoc(doc(db, PATHS.publicCodes, shopCode));
    if (!shopSnap.exists()) {
      setError('custError', 'Shop Code not found. Ask your dealer for the correct code.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }

    const storeId = shopSnap.data().uid;

    /* --- Invoice query --- */
    const invQ = query(
      collection(db, PATHS.stores, storeId, PATHS.invoices),
      where('customerPhone', '==', phone)
    );
    const snap = await getDocs(invQ);

    if (snap.empty) {
      setError('custError', 'No bills found for this phone number at this shop.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }

    /* --- Match by code --- */
    const matches = [];
    snap.forEach((d) => {
      const inv  = d.data();
      const invNo = (inv.invoiceNo || '').toUpperCase();
      const items = inv.items || [];

      const invNoMatch = invNo.includes(code);
      const imeiMatch  = items.some(it => {
        const imei = (it.imei || '').toUpperCase();
        return imei.endsWith(code) || imei.includes(code);
      });

      if (invNoMatch || imeiMatch) matches.push({ id: d.id, ...inv });
    });

    if (matches.length === 0) {
      setError('custError', 'Phone matched, but code did not. Check IMEI last 6 or invoice no.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }

    sessionStorage.setItem('sfp_customer_session', JSON.stringify({
      storeId, shopCode,
      shopName: shopSnap.data().shopName || 'Store',
      phone, code, invoices: matches,
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
   9. AUTO-REDIRECT — Logged-in owners skip index.html
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  const path = window.location.pathname;
  const isLoginPage = path.endsWith('index.html')
                   || path === '/'
                   || path.endsWith('/');

  if (!user || !isLoginPage) return;

  try {
    const snap = await getDoc(doc(db, PATHS.stores, user.uid));
    if (!snap.exists()) return;

    /* Check app.html exists first */
    let appExists = false;
    try {
      const res = await fetch('./app.html', { method: 'HEAD' });
      appExists = res.ok;
    } catch (e) {}

    if (appExists) {
      console.log('%c✅ Session active — redirecting to app.html', 'color:#10b981');
      location.href = './app.html';
    } else {
      console.log('%c✅ Session active (app.html not found)', 'color:#f59e0b');
    }
  } catch (e) {
    console.warn('Auto-redirect check failed:', e);
  }
});


/* ============================================================
   10. BOOT LOG
   ============================================================ */
console.log('%c🔐 Auth module ready (v4.0.1)', 'color:#10b981;font-weight:bold');
