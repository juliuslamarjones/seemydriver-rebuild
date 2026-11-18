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

// Screen shown in a normal browser tab after sign-in: forces users to install the PWA
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
            <p class="text-sm text-neutral-400 leading-relaxed">SeeMyDriver runs as an app on your phone for background telemetry. Install it, open it from your home screen, and sign in to start broadcasting.</p>
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

    ensureInstallView();
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
    if (localStorage.getItem('smd_active_broadcast') === 'true') {
        alert('Please end your active broadcast before signing out.');
        return;
    }
    
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    localStorage.removeItem('seemydriver_logged_in');
    
    try { sessionStorage.clear(); } catch(e) {}
    try { window.firebase.auth().signOut(); } catch(e) {}

    // If running as an installed app, dropping out of signout goes to sign-in view instead of landing
    if (window.smdInApp()) {
        window.switchView('signin-view');
    } else {
        window.switchView('landing-view');
    }
};

// ==========================================================
// 30-DAY TRIAL & SUBSCRIPTION PAYWALL
// ==========================================================
const API_BASE = ''; 
const STRIPE_PAYMENT_LINK = 'https://buy.stripe.com/4gM4gz5wvd2Y01r7aNcbC03';

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
                
                checkAndEnforceSubscription(userCredential.user, () => {
                    // If running in standalone PWA mode, go to job setup. Otherwise show the install screen.
                    if (window.smdInApp()) {
                        window.switchView('job-setup-view');
                    } else {
                        window.switchView('install-view');
                    }
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

                try {
                    await fetch('/api/send-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email: user.email, name: email.split('@')[0] })
                    });
                } catch (emailErr) {
                    console.error('Welcome email trigger failed:', emailErr);
                }

                localStorage.setItem('seemydriver_logged_in', 'true');
                
                if (window.smdInApp()) {
                    window.switchView('job-setup-view');
                } else {
                    window.switchView('install-view');
                }
            })
            .catch((error) => {
                console.error('Registration error:', error.message);
                alert('Registration failed: ' + error.message);
            });
    } else {
        localStorage.setItem('seemydriver_logged_in', 'true');
        window.switchView('install-view');
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
    } else if (view === 'signin') {
        window.switchView('signin-view');
    } else if (view === 'register') {
        window.switchView('register-view');
    } else if (isStandalone) {
        // RUNNING AS AN INSTALLED PWA APP: NEVER SHOW THE WEB LANDING PAGE
        if (isLoggedIn) {
            window.switchView('job-setup-view');
        } else {
            window.switchView('signin-view'); // Drop straight to Sign In instead of landing page
        }
    } else {
        // RUNNING IN A NORMAL BROWSER TAB
        if (isLoggedIn) {
            window.switchView('install-view');
        } else {
            window.switchView('landing-view'); // Public marketing page only for browsers
        }
    }
});

})();