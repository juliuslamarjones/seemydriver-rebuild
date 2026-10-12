// ==========================================================
// SEEMYDRIVER - APP CONTROLLER v4.3
// - Laptop strictly defaults to Landing Page on boot
// - Mobile OS check preserves active broadcast & sign-in resume flow
// - Wrapped in an IIFE (no global name collisions)
// ==========================================================
(function () {
'use strict';

const APP_VERSION = 'app.js v4.3';
console.log('[SeeMyDriver] ' + APP_VERSION + ' loaded');

const LS = window.SafeStorage || {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k)
};
const lsSet = (k, v) => { try { LS.setItem(k, v); } catch (e) { console.warn('storage full or blocked for', k); } };
const $ = (id) => document.getElementById(id);

// Decided ONCE at load, from the URL, before anything else can interfere.
const qs = new URLSearchParams(window.location.search);
const CUSTOMER_MODE = qs.has('session') || qs.has('s') || qs.get('view') === 'customer';

const VIEWS = ['landing-view', 'plans-view', 'job-setup-view', 'active-broadcast-view', 'customer-view-view',
    'signin-view', 'register-view'];

const isLoggedIn = () => LS.getItem('smd_is_logged_in') === 'true';

// ---------- Customer lock ----------
function lockCustomerMode() {
    VIEWS.forEach((v) => {
        if (v === 'customer-view-view') return;
        const el = $(v);
        if (el) { el.classList.add('hidden'); el.style.setProperty('display', 'none', 'important'); }
    });
    const t = $('customer-view-view');
    if (t) {
        t.classList.remove('hidden');
        t.style.setProperty('display', 'flex', 'important');
        t.style.setProperty('flex-direction', 'column', 'important');
    }
    const nav = $('header-nav-actions');
    if (nav) nav.style.setProperty('display', 'none', 'important');
}

// ---------- View Controller ----------
const mapTimers = {};
window.switchView = function (viewId, cleanUrl) {
    if (viewId === 'customer-view-view') viewId = 'customer';

    // In customer mode nothing may route anywhere else, no matter who calls switchView
    if (CUSTOMER_MODE && viewId !== 'customer') viewId = 'customer';

    VIEWS.forEach((v) => {
        const el = $(v);
        if (el) { el.classList.add('hidden'); el.style.setProperty('display', 'none', 'important'); }
    });

    if (cleanUrl && !CUSTOMER_MODE && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const targetId = (viewId === 'customer') ? 'customer-view-view' : (viewId.endsWith('-view') ? viewId : (viewId + '-view'));
    const target = $(targetId) || (CUSTOMER_MODE ? $('customer-view-view') : $('signin-view'));
    if (target) {
        target.classList.remove('hidden');
        target.style.setProperty('display', 'flex', 'important');
        target.style.setProperty('flex-direction', 'column', 'important');
    }

    const navActions = $('header-nav-actions');
    if (navActions) {
        if (['active-broadcast', 'active-broadcast-view', 'customer', 'job-setup', 'job-setup-view', 'signin', 'signin-view'].includes(viewId)) {
            navActions.style.setProperty('display', 'none', 'important');
        } else {
            navActions.style.setProperty('display', 'flex', 'important');
        }
    }

    const footer = $('app-footer');
    if (footer) {
        if (['signin', 'signin-view', 'customer'].includes(viewId)) {
            footer.style.setProperty('display', 'none', 'important');
        } else {
            footer.style.setProperty('display', 'flex', 'important');
            footer.style.setProperty('flex-direction', 'column', 'important');
        }
    }

    if (viewId === 'active-broadcast' || viewId === 'active-broadcast-view') {
        clearTimeout(mapTimers.driver);
        mapTimers.driver = setTimeout(() => { if (typeof window.initDriverActiveMap === 'function') window.initDriverActiveMap(); }, 150);
    }
    if (viewId === 'customer') {
        clearTimeout(mapTimers.customer);
        mapTimers.customer = setTimeout(() => { if (typeof window.initCustomerMapLive === 'function') window.initCustomerMapLive(); }, 150);
    }
};

// ---------- Authentication Handlers ----------
window.handleSignIn = function () {
    const emailInput = $('signin-email');
    const passwordInput = $('signin-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    if (!email || !password) { alert('Please enter your email and password.'); return; }
    lsSet('smd_is_logged_in', 'true');
    lsSet('smd_user_email', email);
    window.switchView('job-setup');
};

window.handleRegister = function () {
    const emailInput = $('reg-email');
    const passwordInput = $('reg-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value : '';
    if (!email || !password) { alert('Please enter an email and password.'); return; }
    lsSet('smd_is_logged_in', 'true');
    lsSet('smd_user_email', email);
    window.switchView('job-setup');
};

window.handleSignOut = function () {
    LS.removeItem('smd_is_logged_in');
    LS.removeItem('smd_user_tier');
    LS.removeItem('smd_active_broadcast');

    const sid = window.activeSessionId || LS.getItem('smd_session_id');
    const database = window.db;
    if (sid && database) {
        database.ref('broadcasts/' + sid).update({ ended: true, timestamp: Date.now() })
            .catch((err) => { console.error('Sign-out broadcast end error:', err); });
    }
    if (typeof window.stopRealTimeTracking === 'function') window.stopRealTimeTracking();
    if (typeof window.teardownDriverMap === 'function') window.teardownDriverMap();

    ['smd_driver_name', 'smd_driver_phone', 'smd_cust_name', 'smd_cust_phone', 'smd_cust_address',
     'smd_dest_lat', 'smd_dest_lng', 'smd_session_id', 'smd_last_tx'].forEach((k) => LS.removeItem(k));
    window.activeSessionId = undefined;

    window.switchView('signin');
};

// ---------- PWA Install Handler ----------
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

window.installPWA = function() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('User accepted the install prompt');
            }
            deferredPrompt = null;
        });
    } else {
        alert('To install SeeMyDriver, tap your browser menu (three dots in Chrome or share icon in Safari) and select "Add to Home Screen".');
    }
};

// ==========================================================
// BOOT (single owner of cold-start and resume)
// ==========================================================
const boot = () => {
    if (CUSTOMER_MODE) {
        window.switchView('customer');
        lockCustomerMode();
        [400, 1500, 3500].forEach((ms) => setTimeout(lockCustomerMode, ms));
        return;
    }

    // Check if user is on a mobile device OS
    const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Laptop/Desktop: ALWAYS default to landing page on initial load
    if (!isMobileDevice) {
        window.switchView('landing');
        return;
    }

    // Mobile device behavior (keeps field resume & sign-in flow)
    const loggedIn = isLoggedIn();
    const hasActiveBroadcast = LS.getItem('smd_active_broadcast') === 'true';

    if (loggedIn && hasActiveBroadcast) {
        const last = parseInt(LS.getItem('smd_last_tx') || '0', 10);
        if (LS.getItem('smd_session_id') && (Date.now() - last < 6 * 3600 * 1000)) {
            window.switchView('active-broadcast');
            if (typeof window.startRealTimeTracking === 'function') window.startRealTimeTracking();
        } else {
            const sid = LS.getItem('smd_session_id');
            if (sid && window.db) {
                window.db.ref('broadcasts/' + sid).update({ ended: true, timestamp: Date.now() }).catch(() => {});
            }
            LS.removeItem('smd_active_broadcast');
            LS.removeItem('smd_session_id');
            window.switchView('job-setup');
        }
    } else if (loggedIn) {
        window.switchView('job-setup');
    } else {
        window.switchView('signin');
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
window.addEventListener('load', () => { if (CUSTOMER_MODE) lockCustomerMode(); });

})();