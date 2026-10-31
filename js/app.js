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
            <div class="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xs py-1.5 px-4 rounded-full w-fit mx-auto">🚀 APP REQUIRED</div>
            <h2 class="text-3xl font-black tracking-tight text-white">Use the app to broadcast</h2>
            <p class="text-sm text-neutral-400 leading-relaxed"><b class="text-white">You can't broadcast from this web page.</b> SeeMyDriver only works as an installed app on your phone. Install it, open it from your home screen, then create your account or sign in there.</p>
            <button onclick="window.installPWA()" class="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-sm py-4 rounded-2xl transition shadow-[0_0_25px_rgba(251,191,36,0.3)] cursor-pointer">Install App 📱</button>
            <p class="text-[11px] text-neutral-500 leading-relaxed">If nothing happens, tap the ⋮ menu in Chrome, then "Install app" or "Add to Home screen".</p>
            <button id="install-signout-btn" onclick="window.handleSignOut()" class="text-xs text-neutral-400 hover:text-amber-400 font-bold transition cursor-pointer">Sign Out 🚪</button>
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

// Warns people on the live site's Sign In / Create Account screens that broadcasting only works in the installed app
function addBrowserNotice() {
    if (!browserMustInstall()) return;
    ['signin-view', 'register-view'].forEach((viewId) => {
        const card = document.querySelector('#' + viewId + ' > div');
        const noticeId = 'smd-browser-notice-' + viewId;
        if (!card || document.getElementById(noticeId)) return;
        const box = document.createElement('div');
        box.id = noticeId;
        box.className = 'flex flex-col gap-3 bg-amber-400/10 border border-amber-400/30 text-amber-200 text-xs sm:text-sm rounded-2xl p-4 leading-relaxed';
        box.innerHTML = '<div><b>⚠️ SeeMyDriver runs as an installed app, not in the browser.</b> Install the app first, then sign in from the app on your phone. You can sign in here, but you will not be able to broadcast from this page.</div>' +
            '<button type="button" onclick="window.installPWA()" class="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-xs py-2.5 rounded-xl cursor-pointer">Install the App 📱</button>';
        card.insertBefore(box, card.lastElementChild);
    });
}

// ==========================================================
// FLEET COMMAND UPGRADE & SWITCH GATEWAY
// ==========================================================
window.checkFleetAccessAndSwitch = async function(event) {
    if (event) event.preventDefault();
    console.log("🚀 Switch to Fleet clicked!");

    const auth = window.firebase && window.firebase.auth ? window.firebase.auth() : null;
    const user = auth ? auth.currentUser : null;
    let hasFleetAccess = false;

    if (user) {
        try {
            const db = window.firebase.database();
            const snapshot = await db.ref(`users/${user.uid}/tier`).once('value');
            const tier = snapshot.val();
            if (tier === 'fleet' || tier === 'admin') {
                hasFleetAccess = true;
            }
        } catch (e) {
            console.error("Tier check error:", e);
        }
    }

    const DEV_BYPASS_MODE = true; 
    if (DEV_BYPASS_MODE) hasFleetAccess = true;

    if (hasFleetAccess) {
        const token = user ? await user.getIdToken() : '';
        const fleetUrl = `https://seemydriverfleet.vercel.app/?auth_token=${token}`;
        window.location.assign(fleetUrl);
    } else {
        showFleetPaywallModal();
    }
};

function showFleetPaywallModal() {
    if (document.getElementById('solo-fleet-paywall')) return;
    const modal = document.createElement('div');
    modal.id = 'solo-fleet-paywall';
    modal.className = 'fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    modal.innerHTML = `
        <div class="bg-[#12141c] border border-neutral-800 w-full max-w-sm rounded-3xl p-6 shadow-2xl flex flex-col gap-4 font-mono">
            <div class="flex items-center justify-between border-b border-neutral-800 pb-3">
                <span class="font-black text-white text-sm flex items-center gap-2">🔒 Fleet Command Upgrade</span>
                <button onclick="document.getElementById('solo-fleet-paywall').remove()" class="text-neutral-400 hover:text-white p-1 cursor-pointer">✕</button>
            </div>
            <div class="space-y-3 text-xs text-neutral-300">
                <p>You are on the Solo plan. Unlock multi-vehicle live map tracking, Mapbox geocoding, and automated SMS dispatching.</p>
                <div class="bg-neutral-900 border border-neutral-800 p-3 rounded-xl flex items-center justify-between">
                    <div>
                        <span class="text-white font-bold block">Fleet Tier</span>
                        <span class="text-[10px] text-neutral-400">Includes Solo + Command Center</span>
                    </div>
                    <span class="text-amber-400 font-black text-sm">$49/mo</span>
                </div>
            </div>
            <div class="flex items-center gap-2 pt-2">
                <button onclick="document.getElementById('solo-fleet-paywall').remove()" class="flex-1 bg-neutral-900 text-neutral-300 text-xs font-bold py-2.5 rounded-xl border border-neutral-800 cursor-pointer">Cancel</button>
                <button onclick="window.location.href='https://www.seemydriver.com/upgrade'" class="flex-1 bg-amber-400 hover:bg-amber-500 text-black text-xs font-black py-2.5 rounded-xl transition-all cursor-pointer">Upgrade Now</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
}

window.switchView = function (viewId) {
    document.querySelectorAll('.app-view').forEach((el) => {
        el.classList.add('hidden');
        el.style.display = 'none';
    });
    
    let targetId = viewId === 'landing' ? 'landing-view' : (viewId.includes('-view') ? viewId : viewId + '-view');

    if (!BROWSER_ACCOUNT_SCREENS_ALLOWED && browserMustInstall() && (targetId === 'signin-view' || targetId === 'register-view')) {
        targetId = 'install-view';
    }

    ensureInstallView();
    const target = document.getElementById(targetId);

    const signOutBtn = document.getElementById('install-signout-btn');
    if (signOutBtn) {
        signOutBtn.style.display = localStorage.getItem('seemydriver_logged_in') === 'true' ? '' : 'none';
    }
    
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

const BROWSER_ACCOUNT_SCREENS_ALLOWED = true;

function browserMustInstall() {
    const host = window.location.hostname;
    const isLiveSite = host === 'seemydriver.com' || host === 'www.seemydriver.com';
    return isLiveSite && !window.smdInApp();
}

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

    if (window.smdInApp()) {
        window.switchView('signin-view');
    } else {
        window.switchView('landing-view');
    }
};

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
                    if (browserMustInstall()) {
                        window.switchView('install-view');
                    } else {
                        window.switchView('job-setup-view');
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
                
                if (browserMustInstall()) {
                    window.switchView('install-view');
                } else {
                    window.switchView('job-setup-view');
                }
            })
            .catch((error) => {
                console.error('Registration error:', error.message);
                alert('Registration failed: ' + error.message);
            });
    } else {
        localStorage.setItem('seemydriver_logged_in', 'true');
        window.switchView(browserMustInstall() ? 'install-view' : 'job-setup-view');
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
    addBrowserNotice();

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
        if (isLoggedIn) {
            window.switchView('job-setup-view');
        } else {
            window.switchView('signin-view');
        }
    } else {
        if (isLoggedIn) {
            window.switchView(browserMustInstall() ? 'install-view' : 'job-setup-view');
        } else {
            window.switchView('landing-view');
        }
    }
});

})();