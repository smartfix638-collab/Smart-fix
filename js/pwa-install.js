/* ============================================================
   SMARTFIX ERP — PWA Install Helper
   File: js/pwa-install.js
   Version: 4.3.0
   Purpose: Captures beforeinstallprompt, shows custom install button
   ============================================================ */

(function () {
  'use strict';

  let deferredPrompt = null;
  let installBtn = null;

  /* ============================================================
     CREATE INSTALL BUTTON
     ============================================================ */
  function createInstallButton() {
    if (installBtn) return installBtn;

    const header = document.querySelector('header .flex.items-center.gap-1\\.5');
    if (!header) return null;

    installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.id = 'pwaInstallBtn';
    installBtn.title = 'Install SmartFix App';
    installBtn.innerHTML = '📲';
    installBtn.className = 'icon-btn';
    installBtn.style.cssText = 'display:none;color:#34d399;';
    installBtn.addEventListener('click', triggerInstall);

    header.insertBefore(installBtn, header.firstChild);
    return installBtn;
  }

  /* ============================================================
     TRIGGER INSTALL
     ============================================================ */
  async function triggerInstall() {
    if (!deferredPrompt) {
      /* Fallback: show manual instructions */
      showManualInstructions();
      return;
    }

    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('PWA install outcome:', outcome);

      if (outcome === 'accepted') {
        showToast('✅ App installing...');
      } else {
        showToast('Install cancelled');
      }

      deferredPrompt = null;
      hideInstallButton();
    } catch (e) {
      console.error('Install prompt failed:', e);
      showManualInstructions();
    }
  }

  /* ============================================================
     MANUAL INSTRUCTIONS (fallback)
     ============================================================ */
  function showManualInstructions() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);
    const isDesktop = !isIOS && !isAndroid;

    let msg = '';

    if (isIOS) {
      msg = '📱 iPhone/iPad Install:\n\n' +
            '1. Open this page in Safari\n' +
            '2. Tap the Share button (□↑)\n' +
            '3. Scroll down → "Add to Home Screen"\n' +
            '4. Tap "Add"';
    } else if (isAndroid) {
      msg = '📱 Android Install:\n\n' +
            '1. Tap the ⋮ menu (top right)\n' +
            '2. Tap "Install app" or "Add to Home screen"\n' +
            '3. Confirm';
    } else {
      msg = '💻 Desktop Install:\n\n' +
            '1. Look for ⊕ icon in address bar\n' +
            '2. Click it → "Install"\n' +
            '   (or Menu → "Install SmartFix ERP")';
    }

    alert(msg);
  }

  /* ============================================================
     TOAST HELPER
     ============================================================ */
  function showToast(msg) {
    if (window.SF?.common?.toast) {
      window.SF.common.toast(msg, 'success', 3000);
    }
  }

  /* ============================================================
     SHOW / HIDE
     ============================================================ */
  function showInstallButton() {
    const btn = createInstallButton();
    if (btn) btn.style.display = 'inline-flex';
  }

  function hideInstallButton() {
    if (installBtn) installBtn.style.display = 'none';
  }


  /* ============================================================
     LISTENERS
     ============================================================ */
  window.addEventListener('beforeinstallprompt', (e) => {
    console.log('📲 PWA: beforeinstallprompt fired');
    e.preventDefault();
    deferredPrompt = e;
    setTimeout(showInstallButton, 1000);
  });

  window.addEventListener('appinstalled', () => {
    console.log('✅ PWA installed');
    deferredPrompt = null;
    hideInstallButton();
    showToast('✅ SmartFix ERP installed!');
  });

  /* Detect if already running as PWA */
  function isPWA() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.startsWith('android-app://');
  }

  if (isPWA()) {
    console.log('📲 Running as installed PWA');
  }


  /* ============================================================
     INIT
     ============================================================ */
  window.addEventListener('load', () => {
    setTimeout(() => {
      createInstallButton();

      /* iOS: always show button since beforeinstallprompt doesn't fire */
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (isIOS && !isPWA()) {
        showInstallButton();
      }
    }, 1500);
  });


  /* Expose for manual trigger */
  window.SF = window.SF || {};
  window.SF.pwa = {
    install: triggerInstall,
    isInstalled: isPWA,
    showInstructions: showManualInstructions
  };

  console.log('%c📲 PWA Install helper ready (v4.3.0)', 'color:#10b981;font-weight:bold;font-size:11px');
})();
