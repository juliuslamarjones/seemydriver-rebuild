// ==========================================================
// SEEMYDRIVER - MAIN APP UI & ROUTING CONTROLLER
// ==========================================================
(function () {
'use strict';

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});

window.installPWA = async function() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('PWA install outcome:', outcome);
        deferredPrompt = null;
    } else {
        alert('To install SeeMyDriver on your phone:\n\n1. Tap the three dots (⋮) in the top right corner of Chrome.\n2. Tap "Install app" or "Add to Home screen".\n3. Confirm to add SeeMyDriver straight to your device!');
    }
};

window.switchView = function (viewId) {
    document.querySelectorAll('.app-view').forEach((el) => {
        el.classList.add('hidden');
        el.style.display = 'none';
    });
    
    const targetId = viewId === 'landing' ? 'landing-view' : (viewId.includes('-view') ? viewId : viewId + '-view');
    const target = document.getElementById(targetId);
    
    const headerNav = document.getElementById('header-nav-actions');
    if (headerNav) {
        if (targetId === 'active-broadcast-view' || targetId === 'customer-view-view') {
            headerNav.style.display = 'none';
        } else {
            headerNav.style.display = 'flex';
        }
    }

    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'block';
        
        if (targetId === 'active-broadcast-view' && typeof window.initDriverActiveMap === 'function') {
            setTimeout(window.initDriverActiveMap, 150);
        } else if (targetId === 'customer-view-view' && typeof window.initCustomerMapLive === 'function') {
            setTimeout(window.initCustomerMapLive, 150);
        }
    }
};

window.smdInApp = function() {
    const isLocalApp = window.location.protocol === 'capacitor:' || window.location.protocol === 'file:' || window.Capacitor?.isNativePlatform();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    return isStandalone || isLocalApp;
};

window.handleSignOut = function () {
    if (localStorage.getItem('smd_active_broadcast') === 'true') {
        alert('Please end your active broadcast before signing out.');
        return;
    }
    
    const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
    if (auth) {
        auth.signOut().catch((e) => console.error('Firebase signout error:', e));
    }

    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    localStorage.removeItem('seemydriver_logged_in');
    
    try { sessionStorage.clear(); } catch(e) {}

    if (window.smdInApp()) {
        window.switchView('signin-view');
    } else {
        window.switchView('landing-view');
    }
};

window.handleSignIn = function () {
    const email = document.getElementById('signin-email') ? document.getElementById('signin-email').value.trim() : '';
    const password = document.getElementById('signin-password') ? document.getElementById('signin-password').value.trim() : '';

    if (!email) {
        alert('Please enter your email address.');
        return;
    }

    const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
    if (auth) {
        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                localStorage.setItem('seemydriver_logged_in', 'true');
                window.switchView('job-setup-view');
            })
            .catch((error) => {
                console.error('Sign in error:', error.message);
                alert('Sign in failed: ' + error.message);
            });
    } else {
        localStorage.setItem('seemydriver_logged_in', 'true');
        window.switchView('job-setup-view');
    }
};

window.handleRegister = function () {
    const email = document.getElementById('reg-email') ? document.getElementById('reg-email').value.trim() : '';
    const password = document.getElementById('reg-password') ? document.getElementById('reg-password').value.trim() : '';
    
    if (!email || !password) {
        alert('Please enter both an email address and a password.');
        return;
    }

    const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
    if (auth) {
        auth.createUserWithEmailAndPassword(email, password)
            .then((userCredential) => {
                localStorage.setItem('seemydriver_logged_in', 'true');
                window.switchView('job-setup-view');
            })
            .catch((error) => {
                console.error('Registration error:', error.message);
                alert('Registration failed: ' + error.message);
            });
    } else {
        localStorage.setItem('seemydriver_logged_in', 'true');
        window.switchView('job-setup-view');
    }
};

window.endBroadcastAndHome = function () {
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    try { sessionStorage.removeItem('smd_tab_broadcast'); } catch (e) {}
    window.switchView('job-setup-view');
};

document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    const view = q.get('view');
    
    const trackingSession = q.get('sid') || q.get('session');
    if (trackingSession && !q.has('sid')) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('sid', trackingSession);
        window.history.replaceState({}, '', newUrl);
    }
    
    const isStandalone = window.smdInApp();
    const isLoggedIn = localStorage.getItem('seemydriver_logged_in') === 'true';
    
    if (view === 'customer' || trackingSession) {
        window.switchView('customer-view-view');
    } else if (view === 'landing') {
        window.switchView('landing-view');
    } else if (view === 'signin') {
        window.switchView('signin-view');
    } else if (view === 'register') {
        window.switchView('register-view');
    } else if (view === 'job-setup' && isLoggedIn) {
        window.switchView('job-setup-view');
    } else if (localStorage.getItem('smd_active_broadcast') === 'true' && localStorage.getItem('smd_session_id') && isStandalone) {
        window.switchView('active-broadcast-view');
    } else if (isStandalone) {
        window.switchView('signin-view');
    } else {
        window.switchView('landing-view');
    }
});

})();