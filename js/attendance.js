/* ============================================================
   SMARTFIX ERP — Attendance Module (v4.3.0)
   File: js/attendance.js
   Purpose:
     • Selfie capture + compress to 1-2 KB
     • Location + timestamp overlay
     • Store selfie as base64 INSIDE Firestore
     • Check-in / Check-out
     • Auto-cleanup 60+ days old
     • Dispatch event to unlock attendance gate
   ============================================================ */

import { db, auth, PATHS } from './firebase-config.js';
import { toast, fmtDate, fmtDatePretty, escapeHTML } from './common.js';

import {
  collection, doc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


const SELFIE_SIZE = 200;
const INFO_STRIP_H = 24;
const TARGET_KB = 2;
const MIN_QUALITY = 0.20;
const CLEANUP_AGE_DAYS = 60;
const CLEANUP_KEY = 'sfp_attendance_last_cleanup';
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const ATT = { stream: null, videoEl: null };


/* ============================================================
   CAMERA
   ============================================================ */
export async function startCamera(videoEl) {
  if (!videoEl) throw new Error('Video element required');
  ATT.videoEl = videoEl;

  if (ATT.stream) {
    try { ATT.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    ATT.stream = null;
  }

  const constraints = {
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  };

  try {
    ATT.stream = await navigator.mediaDevices.getUserMedia(constraints);
    videoEl.srcObject = ATT.stream;
    await videoEl.play();
    return true;
  } catch (e) {
    console.warn('Camera error:', e);
    throw new Error(e.name === 'NotAllowedError' ? 'Camera permission denied' : 'Camera not available');
  }
}

export function stopCamera() {
  if (ATT.stream) {
    try { ATT.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
    ATT.stream = null;
  }
  if (ATT.videoEl) {
    try { ATT.videoEl.srcObject = null; } catch (e) {}
  }
}

export function isCameraActive() { return !!ATT.stream; }


/* ============================================================
   CAPTURE + COMPRESS
   ============================================================ */
export async function captureAndCompress(videoEl, meta) {
  if (!videoEl || !videoEl.videoWidth) throw new Error('Video not ready');

  const W = SELFIE_SIZE;
  const H = SELFIE_SIZE + INFO_STRIP_H;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  const sq = Math.min(vw, vh);
  const sx = (vw - sq) / 2;
  const sy = (vh - sq) / 2;

  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, sx, sy, sq, sq, -W, 0, W, SELFIE_SIZE);
  ctx.restore();

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, SELFIE_SIZE, W, INFO_STRIP_H);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 9px monospace';
  ctx.textBaseline = 'top';
  const dtStr = (meta.dateStr || '') + '  ' + (meta.timeStr || '');
  ctx.fillText(dtStr, 4, SELFIE_SIZE + 3);

  ctx.fillStyle = '#e2e8f0';
  ctx.font = '8px monospace';
  const locTxt = (meta.location || 'Location unavailable').substring(0, 30);
  ctx.fillText(locTxt, 4, SELFIE_SIZE + 13);

  let quality = 0.55;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  let sizeKB = base64SizeKB(dataUrl);

  while (sizeKB > TARGET_KB && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.06);
    dataUrl = canvas.toDataURL('image/jpeg', quality);
    sizeKB = base64SizeKB(dataUrl);
  }

  return { dataUrl, sizeKB, quality };
}

function base64SizeKB(dataUrl) {
  const b64 = dataUrl.split(',')[1] || '';
  const bytes = (b64.length * 3) / 4;
  return bytes / 1024;
}


/* ============================================================
   LOCATION
   ============================================================ */
export async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ available: false, error: 'Geolocation not supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        available: true,
        lat: +pos.coords.latitude.toFixed(4),
        lng: +pos.coords.longitude.toFixed(4),
        accuracy: Math.round(pos.coords.accuracy || 0)
      }),
      (err) => resolve({ available: false, error: err.message || 'Location denied' }),
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 120000 }
    );
  });
}

export async function getCityName(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const a = data.address || {};
    const city = a.city || a.town || a.village || a.suburb || a.county || '';
    const state = a.state || a.state_district || '';
    if (city && state) return city + ', ' + state;
    if (city) return city;
    if (a.display_name) return a.display_name.split(',')[0];
    return lat.toFixed(2) + ', ' + lng.toFixed(2);
  } catch (e) {
    return lat.toFixed(2) + ', ' + lng.toFixed(2);
  }
}


/* ============================================================
   CHECK-IN
   ============================================================ */
export async function checkIn(storeId, staffId, staffName, options = {}) {
  if (!storeId || !staffId) throw new Error('Missing storeId or staffId');

  const now = new Date();
  const dateStr = fmtDate(now);
  const timeStr = formatTime(now);
  const recordId = `${dateStr}_${staffId}`;

  const existing = await getDoc(doc(db, PATHS.stores, storeId, 'attendance', recordId));
  if (existing.exists() && existing.data().checkInTs) {
    throw new Error('Already checked in today');
  }

  const selfieDataUrl = options.selfie?.dataUrl || '';
  const selfieKB = options.selfie?.sizeKB ? +options.selfie.sizeKB.toFixed(2) : 0;

  const record = {
    id: recordId,
    storeId,
    staffId,
    staffName: staffName || '',
    date: dateStr,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    checkInTime: timeStr,
    checkInTs: serverTimestamp(),
    checkInLocation: options.location || '',
    checkInLat: options.lat || null,
    checkInLng: options.lng || null,
    selfie: selfieDataUrl,
    selfieSizeKB: selfieKB,
    status: 'present',
    createdAt: serverTimestamp()
  };

  await setDoc(
    doc(db, PATHS.stores, storeId, 'attendance', recordId),
    record,
    { merge: true }
  );

  try { window.SF?.state?.logAudit?.('ATTENDANCE_CHECKIN', `${staffName} | ${dateStr} ${timeStr}`); } catch (e) {}

  /* ⭐ Dispatch event — unlock attendance gate */
  try {
    window.SF = window.SF || {};
    window.SF.attendanceGate = false;
    window.dispatchEvent(new CustomEvent('attendance:checkedin', { detail: record }));
  } catch (e) {}

  return record;
}


/* ============================================================
   CHECK-OUT
   ============================================================ */
export async function checkOut(storeId, staffId) {
  if (!storeId || !staffId) throw new Error('Missing storeId or staffId');

  const now = new Date();
  const dateStr = fmtDate(now);
  const timeStr = formatTime(now);
  const recordId = `${dateStr}_${staffId}`;

  const recRef = doc(db, PATHS.stores, storeId, 'attendance', recordId);
  const recSnap = await getDoc(recRef);

  if (!recSnap.exists()) throw new Error('No check-in found for today');
  const data = recSnap.data();
  if (!data.checkInTs) throw new Error('No check-in found for today');
  if (data.checkOutTs) throw new Error('Already checked out');

  const checkInTime = data.checkInTime || '00:00';
  const hours = computeHours(checkInTime, timeStr);

  await setDoc(recRef, {
    checkOutTime: timeStr,
    checkOutTs: serverTimestamp(),
    hoursWorked: +hours.toFixed(2)
  }, { merge: true });

  try { window.SF?.state?.logAudit?.('ATTENDANCE_CHECKOUT', `${data.staffName} | ${dateStr} ${timeStr} | ${hours.toFixed(2)}h`); } catch (e) {}

  return { ...data, checkOutTime: timeStr, hoursWorked: +hours.toFixed(2) };
}


/* ============================================================
   GET TODAY
   ============================================================ */
export async function getTodayRecord(storeId, staffId) {
  const dateStr = fmtDate(new Date());
  const recordId = `${dateStr}_${staffId}`;
  const snap = await getDoc(doc(db, PATHS.stores, storeId, 'attendance', recordId));
  return snap.exists() ? snap.data() : null;
}


/* ============================================================
   MONTHLY QUERIES
   ============================================================ */
export async function getMonthlyAttendance(storeId, month, year, staffId) {
  const collRef = collection(db, PATHS.stores, storeId, 'attendance');
  const constraints = [
    where('year', '==', year),
    where('month', '==', month)
  ];
  if (staffId) constraints.push(where('staffId', '==', staffId));
  const q = query(collRef, ...constraints);
  const snap = await getDocs(q);
  const rows = [];
  snap.forEach((d) => rows.push(d.data()));
  rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return rows;
}

export async function getMonthlyReport(storeId, month, year) {
  const rows = await getMonthlyAttendance(storeId, month, year);
  const byStaff = {};
  rows.forEach((r) => {
    const sid = r.staffId;
    if (!byStaff[sid]) {
      byStaff[sid] = {
        staffId: sid, staffName: r.staffName || '',
        days: [], present: 0, totalHours: 0,
        avgIn: '', avgOut: ''
      };
    }
    byStaff[sid].days.push(r);
    if (r.checkInTs) byStaff[sid].present++;
    if (r.hoursWorked) byStaff[sid].totalHours += r.hoursWorked;
  });
  Object.values(byStaff).forEach((s) => {
    const ins = s.days.map((d) => d.checkInTime).filter(Boolean);
    const outs = s.days.map((d) => d.checkOutTime).filter(Boolean);
    s.avgIn = averageTime(ins);
    s.avgOut = averageTime(outs);
  });
  return Object.values(byStaff);
}


/* ============================================================
   CLEANUP
   ============================================================ */
export async function cleanupOldAttendance(storeId, force = false) {
  if (!storeId) return 0;
  if (!force) {
    try {
      const last = parseInt(localStorage.getItem(CLEANUP_KEY) || '0', 10);
      if (Date.now() - last < CLEANUP_INTERVAL_MS) return 0;
    } catch (e) {}
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - CLEANUP_AGE_DAYS);
  const cutoffStr = fmtDate(cutoff);

  let deleted = 0;
  try {
    const collRef = collection(db, PATHS.stores, storeId, 'attendance');
    const q = query(collRef, where('date', '<', cutoffStr));
    const snap = await getDocs(q);
    if (snap.empty) {
      try { localStorage.setItem(CLEANUP_KEY, String(Date.now())); } catch (e) {}
      return 0;
    }
    const batch = writeBatch(db);
    snap.forEach((d) => { batch.delete(d.ref); deleted++; });
    await batch.commit();
    try { localStorage.setItem(CLEANUP_KEY, String(Date.now())); } catch (e) {}
    console.log(`%c🗑️ Attendance cleanup: ${deleted} records removed`, 'color:#f59e0b;font-weight:bold');
    if (deleted > 0) {
      try { window.SF?.state?.logAudit?.('ATTENDANCE_CLEANUP', `${deleted} old records removed`); } catch (e) {}
    }
    return deleted;
  } catch (e) {
    console.error('Cleanup failed:', e);
    return 0;
  }
}


/* ============================================================
   HELPERS
   ============================================================ */
function formatTime(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function computeHours(inTime, outTime) {
  try {
    const [ih, im] = inTime.split(':').map(Number);
    const [oh, om] = outTime.split(':').map(Number);
    let mins = (oh * 60 + om) - (ih * 60 + im);
    if (mins < 0) mins += 24 * 60;
    return mins / 60;
  } catch (e) { return 0; }
}

function averageTime(times) {
  if (!times || times.length === 0) return '';
  let total = 0, count = 0;
  times.forEach((t) => {
    try {
      const [h, m] = t.split(':').map(Number);
      total += h * 60 + m;
      count++;
    } catch (e) {}
  });
  if (!count) return '';
  const avg = Math.round(total / count);
  return String(Math.floor(avg / 60)).padStart(2, '0') + ':' + String(avg % 60).padStart(2, '0');
}

function monthName(m) {
  return ['', 'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December'][m] || '';
}

export function formatDayOfWeek(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  } catch (e) { return ''; }
}

export function formatDateTimePretty(d) {
  if (!d) return '';
  return fmtDatePretty(d);
}


/* ============================================================
   EXPORT
   ============================================================ */
window.SF = window.SF || {};
window.SF.attendance = {
  startCamera, stopCamera, isCameraActive,
  captureAndCompress,
  getLocation, getCityName,
  checkIn, checkOut, getTodayRecord,
  getMonthlyAttendance, getMonthlyReport,
  cleanupOldAttendance,
  formatDayOfWeek, monthName
};

console.log('%c📸 Attendance module ready (v4.3.0)', 'color:#10b981;font-weight:bold;font-size:11px');
