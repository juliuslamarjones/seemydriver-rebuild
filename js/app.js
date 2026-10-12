// ==========================================================
// SEEMYDRIVER - APP CONTROLLER & VIEW SWITCHER (ITEM #1 FIXED)
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage;
const $ = (id) => document.getElementById(id);

// ---------- View Controller & Navigation ----------
window.switchView = function(viewId, cleanUrl = false) {
    const views = ['landing-view', 'plans-view', 'job-setup-view', 'active-broadcast-view', 'customer-view-view', 'signin-view', 'register-view', 'fleet-dashboard-view'];
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) {
            el.classList.add('hidden');
            el.style.setProperty('display', 'none', 'important');
        }
    });

    if (cleanUrl && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    const targetId = (viewId === 'customer') ? 'customer-view-view' : (viewId.endsWith('-view') ? viewId : (viewId + '-view'));
    let target = document.getElementById(targetId) || document.getElementById('signin-view');

    if (target) {
        target.classList.remove('hidden');
        target.style.setProperty('display', 'flex', 'important');
        target.style.setProperty('flex-direction', 'column', 'important');
    }

    const navActions = document.getElementById('header-nav-actions');
    if (navActions) {
        if (viewId === 'active-broadcast' || viewId === 'active-broadcast-view' || viewId === 'customer') {
            navActions.style.setProperty('display', 'none', 'important');
        } else {
            navActions.style.setProperty('display', 'flex', 'important');
        }
    }

    if (viewId === 'active-broadcast' || viewId === 'active-broadcast-view') {
        setTimeout(() => { if (typeof window.initDriverActiveMap === 'function') window.initDriverActiveMap(); }, 150);
    }
    if (viewId === 'customer') {
        setTimeout(() => { if (typeof window.initCustomerMapLive === 'function') window.initCustomerMapLive(); }, 150);
    }
};

// ---------- Authentication Handlers ----------
window.handleSignIn = function() {
    const emailInput = document.getElementById('signin-email');
    const passwordInput = document.getElementById('signin-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';

    if (!email || !password) {
        alert('Please enter your email and password.');
        return;
    }
    LS.setItem('smd_is_logged_in', 'true');
    LS.setItem('smd_user_email', email);
    window.switchView('job-setup');
};

window.handleRegister = function() {
    const emailInput = document.getElementById('reg-email');
    const passwordInput = document.getElementById('reg-password');
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';

    if (!email || !password) {
        alert('Please enter an email and password.');
        return;
    }
    LS.setItem('smd_is_logged_in', 'true');
    LS.setItem('smd_user_email', email);
    window.switchView('job-setup');
};

window.handleSignOut = function() {
    LS.removeItem('smd_is_logged_in');
    LS.removeItem('smd_user_tier');
    LS.removeItem('smd_active_broadcast');
    
    const sid = window.activeSessionId || LS.getItem('smd_session_id');
    const database = window.db;
    
    if (sid && database) {
        database.ref('broadcasts/' + sid).update({ ended: true, timestamp: Date.now() })
            .catch((err) => { console.error("Sign-out broadcast end error:", err); });
    }

    if (typeof window.stopRealTimeTracking === 'function') {
        window.stopRealTimeTracking();
    }
    if (typeof window.teardownDriverMap === 'function') {
        window.teardownDriverMap();
    }

    ['smd_driver_name', 'smd_driver_phone', 'smd_cust_name', 'smd_cust_phone', 'smd_cust_address',
     'smd_dest_lat', 'smd_dest_lng', 'smd_session_id', 'smd_last_tx'].forEach((k) => LS.removeItem(k));
    window.activeSessionId = undefined;

    window.switchView('signin');
};

// ---------- Strict Cold Boot Logic (Item #1) ----------
document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    
    // 1. If it's a customer tracking link via URL, show customer view
    if (q.has('session') || q.has('s') || q.get('view') === 'customer') {
        window.switchView('customer');
    } 
    // 2. Only resume job-setup if there is an active broadcast flag AND user is logged in
    else if (LS.getItem('smd_active_broadcast') === 'true' && LS.getItem('smd_is_logged_in') === 'true') {
        window.switchView('job-setup');
    } 
    // 3. COLD BOOT FIX: Absolutely force Sign In on every fresh startup and wipe old flags
    else {
        LS.removeItem('smd_active_broadcast');
        LS.removeItem('smd_is_logged_in');
        window.switchView('signin');
    }
});

})();