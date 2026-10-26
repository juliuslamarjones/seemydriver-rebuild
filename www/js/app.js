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
    // Must have an account before installing: send people to sign-in first
    if (localStorage.getItem('seemydriver_logged_in') !== 'true') {
        alert('Please sign in (or create an account) before installing SeeMyDriver.');
        window.switchView('signin-view');
        return;
    }

    if (deferredPrompt) {
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log('PWA install outcome:', outcome);
        deferredPrompt = null;
    } else {
        alert('To install SeeMyDriver on your phone:\n\n1. Tap the three dots (⋮) in the top right corner of Chrome.\n2. Tap "Install app" or "Add to Home screen".\n3. Confirm to add SeeMyDriver straight to your device!');
    }
};

// localhost is exempt from the "app only" rule so you can keep testing on your laptop
function isDevHost() {
    return ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

// Screen shown in a normal browser tab after sign-in: drivers install the app instead of using the browser
function ensureInstallView() {
    if (document.getElementById('install-view')) return;
    const main = document.querySelector('main');
    if (!main) return;
    const v = document.createElement('div');
    v.id = 'install-view';
    v.className = 'app-view w-full max-w-md flex flex-col items-center justify-center p-6 my-auto hidden';
    v.style.display = 'none';
    v.innerHTML = `
        <div class="w-full bg-gradient-to-b from-[#161923] to-[#0f1117] border border-neutral-800 rounded-3xl p-8 sm:p-10 shadow-[0_20px_50px_rgba(0,0,0,0.8)] flex flex-col gap-6 text-center relative overflow-hidden">
            <div class="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-amber-400 to-transparent"></div>
            <div class="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs py-1.5 px-4 rounded-full w-fit mx-auto">✅ ACCOUNT READY</div>
            <h2 class="text-3xl font-black tracking-tight text-white">Install SeeMyDriver</h2>
            <p class="text-sm text-neutral-400 leading-relaxed">SeeMyDriver runs as an app on your phone. Install it, open it from your home screen, and sign in to start broadcasting.</p>
            <button onclick="window.installPWA()" class="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-sm py-4 rounded-2xl transition shadow-[0_0_25px_rgba(251,191,36,0.3)] cursor-pointer">Install App 📱</button>
            <p class="text-[11px] text-neutral-500 leading-relaxed">If nothing happens, tap the ⋮ menu in Chrome, then "Install app" or "Add to Home screen".</p>
            <button onclick="window.handleSignOut()" class="text-xs text-neutral-400 hover:text-amber-400 font-bold transition cursor-pointer">Sign Out 🚪</button>
        </div>`;
    main.appendChild(v);
}

// Adds "Create an account" under Sign In and "Sign in" under Create Account
function addAuthCrossLinks() {
    const pairs = [
        ['#signin-view button[onclick="window.handleSignIn()"]', 'smd-link-to-register', 'New here?', 'Create an account', 'register-view'],
        ['#register-view button[onclick="window.handleRegister()"]', 'smd-link-to-signin', 'Already have an account?', 'Sign in', 'signin-view']
    ];
    pairs.forEach(([selector, id, text, label, view]) => {
        const btn = document.querySelector(selector);
        if (!btn || document.getElementById(id)) return;
        const p = document.createElement('p');
        p.id = id;
        p.className = 'text-center text-xs text-neutral-400 mt-1';
        p.append(text + ' ');
        const a = document.createElement('button');
        a.type = 'button';
        a.textContent = label;
        a.className = 'text-amber-400 font-bold hover:text-amber-300 cursor-pointer';
        a.onclick = () => window.switchView(view);
        p.appendChild(a);
        btn.insertAdjacentElement('afterend', p);
    });
}

window.switchView = function (viewId) {
    document.querySelectorAll('.app-view').forEach((el) => {
        el.classList.add('hidden');
        el.style.display = 'none';
    });
    
    let targetId = viewId === 'landing' ? 'landing-view' : (viewId.includes('-view') ? viewId : viewId + '-view');

    // SeeMyDriver only runs as an installed app: in a normal browser tab, drivers get the install screen instead
    if (!window.smdInApp() && !isDevHost() && (targetId === 'job-setup-view' || targetId === 'active-broadcast-view')) {
        targetId = 'install-view';
    }
    ensureInstallView();
    const target = document.getElementById(targetId);

    // The landing page Install button only shows once someone is signed in
    const installBtn = document.getElementById('pwa-install-btn');
    if (installBtn) {
        installBtn.style.display = localStorage.getItem('seemydriver_logged_in') === 'true' ? '' : 'none';
    }
    
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
const API_BASE = ''; // Fixed: use relative path to prevent CORS errors across Vercel preview/production domains
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/YOUR_LINK_HERE'; // <-- put your real Stripe Payment Link here

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
    ensureInstallView();
    addAuthCrossLinks();

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
    } else if (isLoggedIn && !isStandalone && !isDevHost()) {
        window.switchView('install-view');
    } else {
        window.switchView('landing-view');
    }
});

})();