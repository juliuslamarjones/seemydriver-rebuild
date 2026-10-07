// ==========================================
// SEEMYDRIVER - 100% PURE SOLO PRODUCTION CORE
// ==========================================

window.activeSessionId = window.SafeStorage.getItem('smd_session_id') || ('session_' + Math.random().toString(36).substring(2, 11));
window.SafeStorage.setItem('smd_session_id', window.activeSessionId);

function getAppBaseUrl() {
    const origin = window.location.origin;
    if (!origin || origin.includes('localhost') || origin.includes('capacitor') || origin.includes('file://')) {
        return 'https://seemydriver.com';
    }
    return origin;
}

let cachedDestLat = window.SafeStorage.getItem('smd_dest_lat') ? parseFloat(window.SafeStorage.getItem('smd_dest_lat')) : null;
let cachedDestLng = window.SafeStorage.getItem('smd_dest_lng') ? parseFloat(window.SafeStorage.getItem('smd_dest_lng')) : null;

window.driverMapFitted = false;
window.driverFollowTruck = true;
window.custMapFitted = false;
window.custFollowTruck = true;
window.geoWatchId = null;

function isBroadcastLocked() {
    return window.SafeStorage.getItem('smd_active_broadcast') === 'true' && !!window.SafeStorage.getItem('smd_session_id');
}

function isCustomerLink() {
    const p = new URLSearchParams(window.location.search);
    return p.get('view') === 'customer' || p.has('s') || (p.has('session') && p.get('view') !== 'job-setup');
}

// --- VIEW CONTROLLER (STRICTLY LOCKED DURING BROADCAST & HEADER SIGN-OUT CONTROL) ---
function switchView(viewId, cleanUrl = false) {
    viewId = String(viewId).replace(/-view$/, '');

    // SECURITY LOCK: If broadcast is active, block any attempt to switch away from active broadcast or signin/setup
    if (isBroadcastLocked() && viewId !== 'active-broadcast' && viewId !== 'customer') {
        console.warn("Broadcast is active. Navigation locked until broadcast is terminated.");
        viewId = 'active-broadcast';
    }

    // SECURITY LOCK: Customers are strictly restricted to the customer view
    if (isCustomerLink() && viewId !== 'customer') {
        viewId = 'customer';
    }

    // Manage Sign-Out Button Visibility in Header (Hidden during active broadcast or customer view)
    const signoutBtn = document.getElementById('header-signout-btn');
    if (signoutBtn) {
        if (isBroadcastLocked() || isCustomerLink()) {
            signoutBtn.style.setProperty('display', 'none', 'important');
        } else {
            signoutBtn.style.setProperty('display', 'block', 'important');
        }
    }

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

    if (viewId === 'job-setup') {
        const driverNameEl = document.getElementById('job-driver-name');
        const driverPhoneEl = document.getElementById('job-driver-phone');
        if (driverNameEl) driverNameEl.value = window.SafeStorage.getItem('smd_driver_name') || '';
        if (driverPhoneEl) driverPhoneEl.value = window.SafeStorage.getItem('smd_driver_phone') || '';
    }

    if (viewId === 'active-broadcast') {
        setTimeout(() => { if (typeof initDriverActiveMap === 'function') initDriverActiveMap(); }, 150);
    }
}
window.switchView = switchView;

// --- AUTH ---
function handleSignIn() {
    const emailElem = document.getElementById('signin-email');
    const email = emailElem ? emailElem.value.trim() : '';
    if (!email) { alert('Email required.'); return; }
    window.SafeStorage.setItem('smd_is_logged_in', 'true');
    window.SafeStorage.setItem('smd_user_email', email);
    switchView('job-setup');
}
window.handleSignIn = handleSignIn;

function handleRegister() {
    const emailElem = document.getElementById('reg-email');
    const email = emailElem ? emailElem.value.trim() : '';
    if (!email) { alert('Email required.'); return; }
    window.SafeStorage.setItem('smd_is_logged_in', 'true');
    window.SafeStorage.setItem('smd_user_email', email);
    switchView('job-setup');
}
window.handleRegister = handleRegister;

function handleSignOut() {
    if (isBroadcastLocked()) {
        alert('Cannot sign out while a live broadcast is active. Please end the broadcast first.');
        return;
    }
    window.SafeStorage.clear();
    stopRealTimeTracking();
    switchView('signin');
}
window.handleSignOut = handleSignOut;

// --- NATIVE SMS / SHARE TRIGGER FOR CLIENT LINK ---
window.textTrackingLink = function() {
    const baseUrl = getAppBaseUrl() + window.location.pathname;
    const sessionId = window.activeSessionId || window.SafeStorage.getItem('smd_session_id') || 'demo';
    const trackingUrl = baseUrl + '?view=customer&session=' + sessionId;
    const custPhone = document.getElementById('job-cust-phone') ? document.getElementById('job-cust-phone').value.trim() : '';
    const custName = document.getElementById('job-cust-name') ? document.getElementById('job-cust-name').value.trim() : 'Client';
    
    const message = `Hi ${custName}, track my live arrival in real-time here: ${trackingUrl}`;

    if (navigator.share) {
        navigator.share({
            title: 'SeeMyDriver Live Tracking',
            text: message,
            url: trackingUrl,
        }).catch(() => {});
    } else if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        window.location.href = `sms:${custPhone}?body=${encodeURIComponent(message)}`;
    } else {
        const textArea = document.createElement('textarea');
        textArea.value = trackingUrl;
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            alert('Desktop mode: Customer tracking link copied to clipboard!\n\n' + trackingUrl);
        } catch (err) {
            prompt('Copy this customer link manually:', trackingUrl);
        }
        document.body.removeChild(textArea);
    }
};

window.copyTrackingLink = function() {
    const baseUrl = getAppBaseUrl() + window.location.pathname;
    const sessionId = window.activeSessionId || window.SafeStorage.getItem('smd_session_id') || 'demo';
    const trackingUrl = baseUrl + '?view=customer&session=' + sessionId;
    navigator.clipboard.writeText(trackingUrl).then(() => {
        alert('Customer tracking link copied to clipboard!');
    }).catch(() => {
        prompt('Copy tracking link:', trackingUrl);
    });
};

// --- BROADCAST LAUNCH & GPS WATCHER ---
async function launchLiveBroadcast() {
    const custNameElem = document.getElementById('job-cust-name');
    const custPhoneElem = document.getElementById('job-cust-phone');
    const custAddressElem = document.getElementById('job-cust-address');
    const driverNameElem = document.getElementById('job-driver-name');
    const driverPhoneElem = document.getElementById('job-driver-phone');

    const custName = custNameElem ? custNameElem.value.trim() || 'Client' : 'Client';
    const custPhone = custPhoneElem ? custPhoneElem.value.trim() : '';
    const custAddress = custAddressElem ? custAddressElem.value.trim() : '';
    const driverName = driverNameElem ? driverNameElem.value.trim() || 'Driver' : 'Driver';
    const driverPhone = driverPhoneElem ? driverPhoneElem.value.trim() : '';

    if (!custAddress) { alert('Please enter a destination address.'); return; }

    window.SafeStorage.setItem('smd_driver_name', driverName);
    window.SafeStorage.setItem('smd_driver_phone', driverPhone);
    window.SafeStorage.setItem('smd_cust_name', custName);
    window.SafeStorage.setItem('smd_cust_phone', custPhone);
    window.SafeStorage.setItem('smd_cust_address', custAddress);
    window.SafeStorage.setItem('smd_active_broadcast', 'true');

    if (!cachedDestLat || !cachedDestLng) {
        try {
            const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(custAddress)}&limit=1`);
            const data = await res.json();
            if (data.features && data.features.length > 0) {
                cachedDestLng = data.features[0].geometry.coordinates[0];
                cachedDestLat = data.features[0].geometry.coordinates[1];
                window.SafeStorage.setItem('smd_dest_lat', cachedDestLat);
                window.SafeStorage.setItem('smd_dest_lng', cachedDestLng);
            }
        } catch(err) {}
    }

    try {
        await db.ref('broadcasts/' + window.activeSessionId).set({
            driverName,
            driverPhone,
            custName,
            custPhone,
            custAddress,
            destLat: cachedDestLat || 29.9902,
            destLng: cachedDestLng || -95.2636,
            lat: 29.9902,
            lng: -95.2636,
            speed: 0,
            timestamp: Date.now()
        });
    } catch(e) {}

    switchView('active-broadcast');
}
window.launchLiveBroadcast = launchLiveBroadcast;

function stopRealTimeTracking() {
    if (window.geoWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(window.geoWatchId);
        window.geoWatchId = null;
    }
    SafeStorage.removeItem('smd_active_broadcast');
}

function endBroadcastAndHome() {
    stopRealTimeTracking();
    db.ref('broadcasts/' + window.activeSessionId).update({
        status: 'ended',
        timestamp: Date.now()
    }).catch(() => {});
    switchView('job-setup');
}
window.endBroadcastAndHome = endBroadcastAndHome;

// Plan selection helpers
window.setRegTier = function(tier) {
    const soloCard = document.getElementById('solo-plan-card');
    const fleetCard = document.getElementById('fleet-plan-card');
    if (tier === 'solo') {
        if (soloCard) soloCard.className = "w-full bg-[#12141c] border-2 border-amber-400 p-6 rounded-3xl text-left flex flex-col gap-3 transition shadow-xl relative group cursor-pointer";
        if (fleetCard) fleetCard.className = "w-full bg-[#12141c] border border-neutral-800 p-6 rounded-3xl text-left flex flex-col gap-3 transition shadow-xl relative group cursor-pointer";
    } else {
        if (fleetCard) fleetCard.className = "w-full bg-[#12141c] border-2 border-amber-400 p-6 rounded-3xl text-left flex flex-col gap-3 transition shadow-xl relative group cursor-pointer";
        if (soloCard) soloCard.className = "w-full bg-[#12141c] border border-neutral-800 p-6 rounded-3xl text-left flex flex-col gap-3 transition shadow-xl relative group cursor-pointer";
    }
};

window.selectAndRegister = function(tier) {
    if (tier === 'fleet') {
        switchView('fleet-dashboard');
    } else {
        switchView('register');
    }
};

window.upgradeToFleet = function() {
    switchView('fleet-dashboard');
};

window.handleAddressInput = function(val) {
    // Optional address suggestions autocomplete stub
};

// --- SMART ENVIRONMENT & ENTRY ROUTER ---
window.addEventListener('DOMContentLoaded', () => {
    const origin = window.location.origin || '';
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    
    const isNativeApp = origin.includes('localhost') || 
                        origin.includes('capacitor') || 
                        origin.includes('file://') || 
                        window.location.protocol === 'file:' ||
                        window.Capacitor;

    if (isCustomerLink()) {
        switchView('customer');
        return;
    }

    // Explicit override: if web user requests signin or register via query param
    if (viewParam === 'signin') {
        switchView('signin');
        return;
    }
    if (viewParam === 'register') {
        switchView('register');
        return;
    }

    if (isNativeApp) {
        switchView(isBroadcastLocked() ? 'active-broadcast' : (window.SafeStorage.getItem('smd_is_logged_in') === 'true' ? 'job-setup' : 'signin'));
    } else {
        // Web browser traffic hitting seemydriver.com directly loads the public landing page!
        switchView('landing');
    }
});