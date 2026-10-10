/* ============================================================
   SMARTFIX ERP — Firebase Configuration Module
   File: js/firebase-config.js
   Version: 4.0.0
   Purpose: Single source of truth for Firebase SDK initialization
   ============================================================ */

// ---------- Firebase SDK Imports (v10 modular) ----------
import { initializeApp }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }           from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import { getAnalytics }      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js";

// ---------- Your Firebase Project Credentials ----------
const firebaseConfig = {
  apiKey:            "AIzaSyDbAlfyb040xKffRx20SGBvwuitsA1zTSE",
  authDomain:        "smartfix-a6733.firebaseapp.com",
  projectId:         "smartfix-a6733",
  storageBucket:     "smartfix-a6733.firebasestorage.app",
  messagingSenderId: "346183509613",
  appId:             "1:346183509613:web:d710eb153e1aef89cb8164",
  measurementId:     "G-WT1FKF5ZQT"
};

// ---------- Initialize Firebase Services ----------
const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const storage   = getStorage(app);
const analytics = getAnalytics(app);

// ---------- App-wide Constants ----------
export const APP_NAME     = "SmartFix ERP";
export const APP_VERSION  = "4.0.0";
export const APP_BUILD    = "cloud-edition";
export const APP_AUTHOR   = "Debapriya Sarkar";
export const APP_YEAR     = "2026";

// ---------- Firestore Collection Paths ----------
/* Every store's data lives under: /stores/{storeId}/...
   storeId === owner's Firebase Auth UID (1 store per owner) */
export const PATHS = {
  stores:          "stores",
  profile:         "profile",
  invoices:        "invoices",
  creditNotes:     "creditNotes",
  purchases:       "purchases",
  vouchers:        "vouchers",
  inventory:       "inventory",
  parties:         "parties",
  staff:           "staff",
  salaryPayments:  "salaryPayments",
  auditLog:        "auditLog",
  categories:      "categories",
  counters:        "counters",
  publicCodes:     "publicStoreCodes"
};

// ---------- Helper: Build full path to a store subcollection ----------
export function storePath(storeId, ...segments) {
  return [PATHS.stores, storeId, ...segments].join("/");
}

// ---------- Export Firebase Instances ----------
export { app, auth, db, storage, analytics };

// ---------- Console confirmation (dev only) ----------
console.log(
  `%c🔧 ${APP_NAME} v${APP_VERSION} • Firebase connected`,
  "color:#38bdf8;font-weight:bold;font-size:11px"
);
console.log(
  `%c📦 Project: ${firebaseConfig.projectId}`,
  "color:#94a3b8;font-size:10px"
);
