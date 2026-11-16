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

function ensureInstallView() {}
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
function addBrowserNotice() {}

// ==========================================================
// FLEET COMMAND LOCAL OVERLAY GATEWAY (NATIVE EMBEDDED MAP)
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
        <div class="bg-[#12141c] border-b border-neutral-800 px-6 py-4 flex items-center justify-between shrink-0">
            <span class="font-black text-amber-400 text-sm flex items-center gap-2">👀 Fleet Command Center</span>
            <button onclick="document.getElementById('smd-fleet-overlay').remove()" class="bg-neutral-900 border border-neutral-800 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-neutral-800 cursor-pointer transition">✕ Close Fleet</button>
        </div>
        <div class="flex-1 flex flex-col md:flex-row w-full h-full overflow-hidden bg-black">
            <div class="w-full md:w-80 bg-[#0d0f17] border-r border-neutral-800/80 p-4 flex flex-col gap-4 overflow-y-auto shrink-0">
                <h3 class="text-xs font-bold uppercase tracking-wider text-neutral-400">Active Fleet Units</h3>
                <div id="fleet-units-list" class="flex flex-col gap-2.5">
                    <div class="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl text-xs text-neutral-400 text-center py-8">Scanning active broadcasts...</div>
                </div>
            </div>
            <div id="fleet-native-map" class="flex-1 w-full h-full bg-neutral-900 relative"></div>
        </div>`;
    document.body.appendChild(overlay);

    setTimeout(() => {
        const mapContainer = document.getElementById('fleet-native-map');
        if (!mapContainer || typeof mapboxgl === 'undefined') return;

        const OSM_STYLE = {
            version: 8,
            sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap' } },
            layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }]
        };

        const fleetMap = new mapboxgl.Map({
            container: mapContainer,
            style: OSM_STYLE,
            center: [-95.3698, 29.7604],
            zoom: 13
        });
        fleetMap.addControl(new mapboxgl.NavigationControl(), 'top-right');

        const db = window.firebase && window.firebase.database ? window.firebase.database() : null;
        if (db) {
            const activeMarkers = {};
            const listEl = document.getElementById('fleet-units-list');

            const handleBroadcastData = (allBroadcasts) => {
                listEl.innerHTML = '';
                const keys = Object.keys(allBroadcasts || {});

                if (keys.length === 0) {
                    listEl.innerHTML = '<div class="p-3 bg-neutral-900/90 border border-neutral-800 rounded-2xl text-xs text-neutral-400 text-center py-8">No active drivers broadcasting right now.</div>';
                    return;
                }

                keys.forEach((sid) => {
                    const b = allBroadcasts[sid];
                    if (!b || b.ended || !b.lat || !b.lng) return;

                    const card = document.createElement('div');
                    card.className = 'p-3.5 bg-neutral-900/90 hover:bg-neutral-800/80 border border-neutral-800 rounded-2xl flex flex-col gap-1.5 cursor-pointer transition';
                    card.innerHTML = `
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-white text-xs">${b.driverName || 'Driver'}</span>
                            <span class="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono font-bold">● LIVE</span>
                        </div>
                        <span class="text-[11px] text-neutral-400 truncate">Dest: ${b.destAddress || 'Active Route'}</span>
                        <div class="flex items-center justify-between text-[10px] text-amber-400 font-mono pt-1">
                            <span>Speed: ${b.speed || 0} mph</span>
                            <span>${b.companyName || 'Solo Operator'}</span>
                        </div>`;
                    card.onclick = () => {
                        fleetMap.flyTo({ center: [b.lng, b.lat], zoom: 16, duration: 1000 });
                    };
                    listEl.appendChild(card);

                    if (activeMarkers[sid]) {
                        activeMarkers[sid].setLngLat([b.lng, b.lat]);
                    } else {
                        const el = document.createElement('div');
                        el.innerHTML = '🚚';
                        el.style.cssText = 'font-size:26px;filter:drop-shadow(0px 4px 8px rgba(0,0,0,0.8));';
                        const marker = new mapboxgl.Marker({ element: el }).setLngLat([b.lng, b.lat]).addTo(fleetMap);
                        activeMarkers[sid] = marker;
                    }
                });
            };

            db.ref('broadcasts').on('value', (snap) => {
                let data = snap.val() || {};
                db.ref('companies').once('value').then((compSnap) => {
                    const comps = compSnap.val() || {};
                    Object.keys(comps).forEach((compId) => {
                        if (comps[compId] && comps[compId].broadcasts) {
                            Object.assign(data, comps[compId].broadcasts);
                        }
                    });
                    handleBroadcastData(data);
                });
            });
        }
    }, 200);
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

window.smdInApp = function() { return true; };
function browserMustInstall() { return false; }

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
    } catch (err) { return null; }
}

async function checkAndEnforceSubscription(user, successCallback) {
    const validUntil = await getEntitlement(user);
    if (validUntil === null || validUntil > Date.now()) {
        successCallback();
        return;
    }
    alert('Your 30-day free trial has ended. Redirecting to subscription checkout...');
    localStorage.removeItem('seemydriver_logged_in');
    try { await window.firebase.auth().signOut(); } catch (e) {}
    window.location.href = STRIPE_PAYMENT_LINK + '?client_reference_id=' + encodeURIComponent(user.uid);
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
                localStorage.setItem('seemydriver_logged_in', 'true');
                checkAndEnforceSubscription(userCredential.user, () => {
                    window.switchView('job-setup-view');
                });
            })
            .catch((error) => { alert('Sign-in failed: ' + error.message); });
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
                const db = window.firebase && window.firebase.firestore ? window.firebase.firestore() : null;
                if (db) {
                    try {
                        await db.collection('users').doc(user.uid).set({
                            email: user.email,
                            createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
                            subscriptionStatus: 'trial'
                        });
                    } catch (dbErr) {}
                }
                localStorage.setItem('seemydriver_logged_in', 'true');
                window.switchView('job-setup-view');
            })
            .catch((error) => { alert('Registration failed: ' + error.message); });
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