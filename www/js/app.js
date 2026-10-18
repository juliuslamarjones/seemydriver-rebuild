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
    
    // Hide header action buttons (Sign In / Get Started) on active broadcast or customer views to eliminate clutter
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

window.handleSignOut = function () {
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    localStorage.removeItem('seemydriver_logged_in');
    const isLocalApp = window.location.protocol === 'capacitor:' || window.location.protocol === 'file:' || window.Capacitor?.isNativePlatform();
    if (isLocalApp) {
        window.switchView('signin-view');
    } else {
        window.switchView('landing-view');
    }
};

window.handleSignIn = function () {
    const email = document.getElementById('signin-email') ? document.getElementById('signin-email').value.trim() : '';
    if (!email) {
        alert('Please enter your email address.');
        return;
    }
    localStorage.setItem('seemydriver_logged_in', 'true');
    window.switchView('job-setup-view');
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
                console.log('User registered successfully:', userCredential.user.email);
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
    window.switchView('job-setup-view');
};

document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    const view = q.get('view');
    
    // Detect if running locally inside the mobile app container or file system
    const isLocalApp = window.location.protocol === 'capacitor:' || window.location.protocol === 'file:' || window.Capacitor?.isNativePlatform();
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
    const isLoggedIn = localStorage.getItem('seemydriver_logged_in') === 'true';
    
    if (view === 'customer') {
        window.switchView('customer-view-view');
    } else if (localStorage.getItem('smd_active_broadcast') === 'true' && localStorage.getItem('smd_session_id')) {
        window.switchView('active-broadcast-view');
    } else if (isLoggedIn || isStandalone) {
        // If already signed in or launched from the installed PWA shortcut, bypass landing page
        if (isLoggedIn) {
            window.switchView('job-setup-view');
        } else {
            window.switchView('signin-view');
        }
    } else {
        localStorage.removeItem('smd_active_broadcast');
        
        if (isLocalApp) {
            // MOBILE APP: Boots straight to sign-in / welcome back screen
            window.switchView('signin-view');
        } else {
            // WEB BROWSERS: Shows the landing page for unauthenticated visitors
            window.switchView('landing-view');
        }
    }
});

})();