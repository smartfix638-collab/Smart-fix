/* ============================================================
   SMARTFIX ERP — Authentication Engine
   File: js/auth.js
   Version: 4.0.0
   Purpose:
     • Owner registration (creates store + unique Shop Code)
     • Owner login (Firebase Auth)
     • Password reset via email
     • Customer portal lookup (phone + IMEI/Invoice)
     • Auto-redirect logged-in owners to app.html
   ============================================================ */

// ---------- Firebase Core ----------
import {
  auth, db,
  PATHS, storePath
} from './firebase-config.js';

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
   1. HELPER — UI State Management
   ============================================================ */
function setBtnLoading(btnId, busy, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (busy) {
    btn.disabled = true;
    btn.dataset.originalText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span>' + label;
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
   2. HELPER — Friendly Firebase Error Messages
   ============================================================ */
function friendlyError(code) {
  const map = {
    'auth/user-not-found':            'No account found with this email.',
    'auth/wrong-password':            'Incorrect password. Try again.',
    'auth/invalid-credential':        'Invalid email or password.',
    'auth/invalid-email':             'Please enter a valid email address.',
    'auth/email-already-in-use':      'This email is already registered. Try signing in.',
    'auth/weak-password':             'Password must be at least 6 characters.',
    'auth/network-request-failed':    'No internet connection. Please check your network.',
    'auth/too-many-requests':         'Too many failed attempts. Please wait a minute.',
    'auth/operation-not-allowed':     'Email/Password sign-in is not enabled. Contact support.',
    'permission-denied':              'Access denied. Please check your account.',
    'unavailable':                    'Firebase is temporarily unavailable. Try again.',
    'resource-exhausted':             'Daily free limit reached. Please try again tomorrow.'
  };
  return map[code] || ('Something went wrong. (' + code + ')');
}


/* ============================================================
   3. HELPER — Generate Unique Shop Code
   ============================================================ */
function slugifyShopCode(shopName) {
  /* Convert "Shree Mobile Shop" → "shreemobileshop" */
  const base = (shopName || 'shop')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 16);
  /* Add 3 random digits to ensure uniqueness */
  const rand = Math.floor(100 + Math.random() * 900);
  return base + rand;
}


/* ============================================================
   4. OWNER LOGIN
   ============================================================ */
window.ownerLogin = async function () {
  clearAllErrors();

  const email = (document.getElementById('ownerEmail')?.value || '').trim();
  const pass  = document.getElementById('ownerPass')?.value || '';

  if (!email || !pass) {
    setError('ownerError', 'Please enter both email and password.');
    return;
  }

  setBtnLoading('ownerLoginBtn', true, 'Signing in...');

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    /* onAuthStateChanged will handle the redirect */
  } catch (err) {
    console.error('Login error:', err);
    setError('ownerError', friendlyError(err.code));
    setBtnLoading('ownerLoginBtn', false, 'Sign In →');
  }
};


/* ============================================================
   5. OWNER REGISTER
   ============================================================ */
window.ownerRegister = async function () {
  clearAllErrors();

  const shop  = (document.getElementById('regShop')?.value || '').trim();
  const phone = (document.getElementById('regPhone')?.value || '').trim();
  const email = (document.getElementById('regEmail')?.value || '').trim();
  const pass  = document.getElementById('regPass')?.value || '';

  /* ---------- Validate ---------- */
  if (!shop)  { setError('regError', 'Shop name is required.'); return; }
  if (shop.length < 3) { setError('regError', 'Shop name must be at least 3 characters.'); return; }
  if (!email) { setError('regError', 'Email is required.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError('regError', 'Please enter a valid email address.'); return;
  }
  if (!pass || pass.length < 6) {
    setError('regError', 'Password must be at least 6 characters.'); return;
  }
  if (phone && !/^\d{10}$/.test(phone)) {
    setError('regError', 'Phone must be exactly 10 digits.'); return;
  }

  setBtnLoading('regBtn', true, 'Creating store...');

  try {
    /* ---- Step 1: Create Firebase Auth user ---- */
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const uid  = cred.user.uid;

    /* ---- Step 2: Update auth displayName ---- */
    await updateProfile(cred.user, { displayName: shop });

    /* ---- Step 3: Generate unique Shop Code ---- */
    let shopCode = slugifyShopCode(shop);
    /* Try up to 5 times if collision */
    for (let attempt = 0; attempt < 5; attempt++) {
      const codeRef = doc(db, PATHS.publicCodes, shopCode);
      const codeSnap = await getDoc(codeRef);
      if (!codeSnap.exists()) break;
      shopCode = slugifyShopCode(shop);
    }

    /* ---- Step 4: Create store profile document ---- */
    await setDoc(doc(db, PATHS.stores, uid), {
      uid,
      ownerEmail: email.toLowerCase(),
      ownerPhone: phone || '',
      shopName: shop,
      shopCode: shopCode,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      plan: 'trial',
      version: '4.0.0'
    });

    /* ---- Step 5: Create counters document (atomic invoice numbering) ---- */
    await setDoc(doc(db, PATHS.stores, uid, PATHS.counters, 'main'), {
      invSeq: 0,
      crnSeq: 0,
      purSeq: 0,
      updatedAt: serverTimestamp()
    });

    /* ---- Step 6: Default store profile (for settings module) ---- */
    await setDoc(doc(db, PATHS.stores, uid, PATHS.profile, 'main'), {
      name: shop,
      phone: phone ? `Ph: ${phone}` : '',
      gstin: '',
      address: '',
      logo: '',
      bankName: '',
      bankBranch: '',
      bankAcc: '',
      bankIFSC: '',
      upiId: '',
      terms: '1. Subject to Local Jurisdiction.\n2. Warranty covered by Brand Authorized Service Centers.\n3. Goods once sold will not be taken back without original invoice.',
      masterPin: '',
      updatedAt: serverTimestamp()
    });

    /* ---- Step 7: Default categories ---- */
    await setDoc(doc(db, PATHS.stores, uid, PATHS.categories, 'main'), {
      list: [
        'Mobile Phone',
        'Mobile Cover',
        'Tempered Glass',
        'Cable',
        'Charger',
        'Earphone',
        'Power Bank',
        'Memory Card',
        'Other'
      ],
      updatedAt: serverTimestamp()
    });

    /* ---- Step 8: Create public store code mapping ---- */
    /* This allows customers to search by shop code without auth */
    await setDoc(doc(db, PATHS.publicCodes, shopCode), {
      uid: uid,
      shopName: shop,
      shopCode: shopCode,
      createdAt: serverTimestamp()
    });

    /* onAuthStateChanged will redirect to app.html */

  } catch (err) {
    console.error('Register error:', err);
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
    setError('ownerError', '');
    alert(
      '✅ Password reset link sent!\n\n' +
      'Email: ' + email + '\n\n' +
      'Please check your inbox (and spam folder).'
    );
  } catch (err) {
    console.error('Reset error:', err);
    setError('ownerError', friendlyError(err.code));
  }
};


/* ============================================================
   7. OWNER LOGOUT (called from app.html)
   ============================================================ */
window.ownerLogout = async function () {
  if (!confirm('Sign out from SmartFix ERP?\n\nAll changes are synced automatically.')) {
    return;
  }
  try {
    await signOut(auth);
    location.href = './index.html';
  } catch (err) {
    console.error('Logout error:', err);
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

  /* ---------- Validate ---------- */
  if (!shopCode) {
    setError('custError', 'Please enter the Shop Code.');
    return;
  }
  if (!/^\d{10}$/.test(phone)) {
    setError('custError', 'Please enter a valid 10-digit mobile number.');
    return;
  }
  if (!code || code.length < 4) {
    setError('custError', 'Enter last 6 digits of IMEI or your invoice number.');
    return;
  }

  setBtnLoading('custBtn', true, 'Searching...');

  try {
    /* ---- Step 1: Look up shop by code ---- */
    const shopSnap = await getDoc(doc(db, PATHS.publicCodes, shopCode));
    if (!shopSnap.exists()) {
      setError('custError', 'Shop Code not found. Verify with your dealer.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }

    const shopData = shopSnap.data();
    const storeId  = shopData.uid;

    /* ---- Step 2: Query invoices by phone ---- */
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

    /* ---- Step 3: Match code against invoiceNo OR any item IMEI ---- */
    const matches = [];
    snap.forEach((docSnap) => {
      const inv = docSnap.data();
      const invNo  = (inv.invoiceNo || '').toUpperCase();
      const items  = inv.items || [];

      const invNoMatch = invNo.includes(code);
      const imeiMatch  = items.some((it) => {
        const imei = (it.imei || '').toUpperCase();
        return imei.endsWith(code) || imei.includes(code);
      });

      if (invNoMatch || imeiMatch) {
        matches.push({ id: docSnap.id, ...inv });
      }
    });

    if (matches.length === 0) {
      setError('custError', 'Phone matched, but code did not. Check IMEI last 6 digits or invoice number.');
      setBtnLoading('custBtn', false, 'Find My Bill →');
      return;
    }

    /* ---- Step 4: Save session and redirect to portal ---- */
    const session = {
      storeId:   storeId,
      shopCode:  shopCode,
      shopName:  shopData.shopName || 'Store',
      phone:     phone,
      code:      code,
      invoices:  matches,
      searchedAt: new Date().toISOString()
    };

    sessionStorage.setItem('sfp_customer_session', JSON.stringify(session));

    /* Redirect to customer portal */
    location.href = './customer.html';

  } catch (err) {
    console.error('Customer lookup error:', err);
    setError('custError', friendlyError(err.code));
    setBtnLoading('custBtn', false, 'Find My Bill →');
  }
};


/* ============================================================
   9. AUTO-REDIRECT — Logged-in owners skip login page
   ============================================================ */
onAuthStateChanged(auth, (user) => {
  /* Only auto-redirect if we're on index.html (login page) */
  const onLoginPage = window.location.pathname.endsWith('index.html')
                   || window.location.pathname === '/'
                   || window.location.pathname.endsWith('/');

  if (user && onLoginPage) {
    /* Check if user has a store document (i.e., completed registration) */
    getDoc(doc(db, PATHS.stores, user.uid))
      .then((snap) => {
        if (snap.exists()) {
          console.log('✅ Owner already signed in — redirecting to app.html');
          location.href = './app.html';
        }
      })
      .catch((err) => {
        console.warn('Store check failed:', err);
      });
  }
});


/* ============================================================
   10. GLOBAL UTILITY — Show version in console
   ============================================================ */
console.log(
  '%c🔐 Auth module ready',
  'color:#10b981;font-weight:bold;font-size:11px'
);
