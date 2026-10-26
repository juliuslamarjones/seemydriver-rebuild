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
    
    // Hide header action buttons on active broadcast or customer views to eliminate clutter
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
        
        if (targetId === 'landing-view' && typeof window.initLandingPreviewMap === 'function') {
            setTimeout(window.initLandingPreviewMap, 150);
        } else if (targetId === 'active-broadcast-view' && typeof window.initDriverActiveMap === 'function') {
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
    // Block sign-out if a broadcast is actively running in this context
    if (localStorage.getItem('smd_active_broadcast') === 'true') {
        alert('Please end your active broadcast before signing out.');
        return;
    }
    
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    localStorage.removeItem('seemydriver_logged_in');
    
    try { sessionStorage.clear(); } catch(e) {}
    try { window.firebase.auth().signOut(); } catch(e) {}

    if (window.smdInApp()) {
        window.switchView('signin-view');
    } else {
        window.switchView('landing-view');
    }
};

// ==========================================================
// 30-DAY TRIAL & SUBSCRIPTION PAYWALL
// The real enforcement is in the Realtime Database rules
// (entitlements/{uid}/validUntil, written only by the server).
// This code just decides which screen to show.
// ==========================================================
const API_BASE = 'https://www.seemydriver.com';
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/4gM4gz5wvd2Y01r7aNcbC03'; // <-- Live Stripe Payment Link inserted

// Asks the server for this user's access-until time (ms). Returns null if it could not be reached.
async function getEntitlement(user) {
    try {
        const token = await user.getIdToken();
        const res = await fetch(API_BASE + '/api/entitlement', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return typeof data.validUntil === 'number' ? data.validUntil : null;
    } catch (err) {
        console.error('Entitlement check failed:', err);
        return null;
    }
}

async function checkAndEnforceSubscription(user, successCallback) {
    const validUntil = await getEntitlement(user);

    if (validUntil === null) {
        alert('We could not verify your account. Please check your connection and try again.');
        return;
    }

    if (validUntil > Date.now()) {
        successCallback();
        return;
    }

    // Trial over and no active subscription: send to Stripe
    alert('Your 30-day free trial has ended. Redirecting to subscription checkout...');
    localStorage.removeItem('seemydriver_logged_in');
    try { await window.firebase.auth().signOut(); } catch (e) {}
    window.location.href = STRIPE_PAYMENT_LINK
        + '?client_reference_id=' + encodeURIComponent(user.uid)
        + '&prefilled_email=' + encodeURIComponent(user.email || '');
}

window.handleSignIn = function () {
    const email = document.getElementById('signin-email') ? document.getElementById('signin-email').value.trim() : '';
    const password = document.getElementById('signin-password') ? document.getElementById('signin-password').value.trim() : '';
    
    if (!email || !password) {
        alert('Please enter both an email address and a password.');
        return;
    }

    const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
    if (auth) {
        auth.signInWithEmailAndPassword(email, password)
            .then((userCredential) => {
                console.log('Signed in successfully:', userCredential.user.email);
                localStorage.setItem('seemydriver_logged_in', 'true');
                
                // Enforce subscription check before granting app access
                checkAndEnforceSubscription(userCredential.user, () => {
                    window.switchView('job-setup-view');
                });
            })
            .catch((error) => {
                console.error('Sign-in error:', error.message);
                alert('Sign-in failed: ' + error.message);
            });
    } else {
        alert('Firebase Auth is not initialized.');
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
            .then(async (userCredential) => {
                const user = userCredential.user;
                console.log('User registered successfully:', user.email);
                
                // Initialize user document in Firestore with trial timestamp
                const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
                if (db) {
                    try {
                        await db.collection('users').doc(user.uid).set({
                            email: user.email,
                            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                            subscriptionStatus: 'trial'
                        });
                    } catch (dbErr) {
                        console.error('Error saving user trial doc:', dbErr);
                    }
                }

                // Trigger automated welcome email via Resend API endpoint
                try {
                    await fetch('/api/send-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: user.email, name: email.split('@')[0] })
                    });
                } catch (emailErr) {
                    console.error('Welcome email trigger failed:', emailErr);
                }

                // Start the server-side trial clock (the database rules need this to allow broadcasting)
                const trialUntil = await getEntitlement(user);
                if (trialUntil === null) {
                    alert('Your account was created, but we could not finish setting up your trial. Please sign out and sign back in before starting a broadcast.');
                }

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
    
    // Ensure customer tracking link captures session parameter whether it's named 'sid' or 'session'
    const trackingSession = q.get('sid') || q.get('session');
    if (trackingSession && !q.has('sid')) {
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.set('sid', trackingSession);
        window.history.replaceState({}, '', newUrl);
    }
    
    const isStandalone = window.smdInApp();
    const isLoggedIn = localStorage.getItem('seemydriver_logged_in') === 'true';
    
    // PRIORITIZE EXPLICIT QUERY VIEWS & CUSTOMER LINKS
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