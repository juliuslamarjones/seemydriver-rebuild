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
        alert('To install SeeMyDriver:\n\n1. Tap the menu in your browser.\n2. Select "Install app" or "Add to Home screen".');
    }
};

function ensureInstallView() {
    // Disabled install wall for laptop debugging
}

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

function addBrowserNotice() {
    // Disabled browser install notices entirely for laptop workflow
}

// ==========================================================
// FLEET COMMAND LOCAL OVERLAY GATEWAY
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
        openLocalFleetModal();
    } else {
        showFleetPaywallModal();
    }
};

function openLocalFleetModal() {
    const existing = document.getElementById('smd-fleet-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'smd-fleet-overlay';
    overlay.className = 'fixed inset-0 bg-black z-50 flex flex-col w-full h-full';
    overlay.innerHTML = `
        <div class="bg-[#12141c] border-b border-neutral-800 px-4 py-3 flex items-center justify-between shrink-0">
            <span class="font-black text-amber-400 text-sm flex items-center gap-2">👀 Fleet Command Center</span>
            <button onclick="document.getElementById('smd-fleet-overlay').remove()" class="bg-neutral-900 border border-neutral-800 text-white px-3 py-1.5 rounded-xl text-xs font-bold hover:bg-neutral-800 cursor-pointer">✕ Close Fleet</button>
        </div>
        <iframe src="/fleet/index.html" class="w-full flex-1 border-none bg-black"></iframe>`;
    document.body.appendChild(overlay);
}

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
    return true; // Force desktop/laptop browser compatibility
};

const BROWSER_ACCOUNT_SCREENS_ALLOWED = true;

function browserMustInstall() {
    return false; // Never block browser or laptop testing
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

    window.switchView('landing-view');
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
        successCallback(); // Bypass block if offline or developing locally on laptop
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
    
    const isLoggedIn = localStorage.getItem('seemydriver_logged_in') === 'true';
    
    if (view === 'customer' || trackingSession) {
        window.switchView('customer-view-view');
    } else if (view === 'signin') {
        window.switchView('signin-view');
    } else if (view === 'register') {
        window.switchView('register-view');
    } else {
        if (isLoggedIn) {
            window.switchView('job-setup-view');
        } else {
            window.switchView('landing-view');
        }
    }
});

})();