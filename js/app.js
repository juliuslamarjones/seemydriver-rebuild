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

function isBroadcastLocked() {
    return window.SafeStorage.getItem('smd_active_broadcast') === 'true' && !!window.SafeStorage.getItem('smd_session_id');
}

function isCustomerLink() {
    const p = new URLSearchParams(window.location.search);
    return p.get('view') === 'customer' || p.has('s') || (p.has('session') && p.get('view') !== 'job-setup');
}

// --- VIEW CONTROLLER ---
function switchView(viewId, cleanUrl = false) {
    viewId = String(viewId).replace(/-view$/, '');
    const views = ['landing-view', 'plans-view', 'job-setup-view', 'active-broadcast-view', 'customer-view-view', 'signin-view', 'register-view'];
    
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
        document.getElementById('job-driver-name').value = window.SafeStorage.getItem('smd_driver_name') || '';
        document.getElementById('job-driver-phone').value = window.SafeStorage.getItem('smd_driver_phone') || '';
    }

    if (viewId === 'active-broadcast') {
        setTimeout(() => initDriverActiveMap(), 150);
    }
}
window.switchView = switchView;

// --- AUTH (SOLO ONLY) ---
function handleSignIn() {
    const email = document.getElementById('signin-email').value.trim();
    if (!email) { alert('Email required.'); return; }
    window.SafeStorage.setItem('smd_is_logged_in', 'true');
    window.SafeStorage.setItem('smd_user_email', email);
    switchView('job-setup');
}
window.handleSignIn = handleSignIn;

function handleSignOut() {
    window.SafeStorage.clear();
    stopRealTimeTracking();
    switchView('signin');
}
window.handleSignOut = handleSignOut;

// --- BROADCAST LAUNCH ---
async function launchLiveBroadcast() {
    const custName = document.getElementById('job-cust-name').value.trim() || 'Client';
    const custPhone = document.getElementById('job-cust-phone').value.trim();
    const custAddress = document.getElementById('job-cust-address').value.trim();
    const driverName = document.getElementById('job-driver-name').value.trim() || 'Driver';
    const driverPhone = document.getElementById('job-driver-phone').value.trim();

    if (!custAddress) { alert('Please enter a destination address.'); return; }

    window.SafeStorage.setItem('smd_driver_name', driverName);
    window.SafeStorage.setItem('smd_driver_phone', driverPhone);
    window.SafeStorage.setItem('smd_cust_name', custName);
    window.SafeStorage.setItem('smd_cust_phone', custPhone);
    window.SafeStorage.setItem('smd_cust_address', custAddress);
    window.SafeStorage.setItem('smd_active_broadcast', 'true');

    let livePos = { lat: 29.9902, lng: -95.2636, speed: 15 };
    if (navigator.geolocation) {
        try {
            navigator.geolocation.getCurrentPosition(pos => {
                livePos = { lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed ? pos.coords.speed * 2.23694 : 15 };
            }, err => {}, { enableHighAccuracy: true, timeout: 5000 });
        } catch(e) {}
    }

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

    await db.ref('broadcasts/' + window.activeSessionId).set({
        driverName, driverPhone, custName, custPhone, custAddress,
        destLat: cachedDestLat, destLng: cachedDestLng,
        lat: livePos.lat, lng: livePos.lng, speed: Math.round(livePos.speed),
        timestamp: Date.now()
    });

    window.activeTrackingUrl = `${getAppBaseUrl()}/?view=customer&session=${window.activeSessionId}`;
    prompt("Broadcast live! Copy client tracking link:", window.activeTrackingUrl);
    switchView('active-broadcast');
}
window.launchLiveBroadcast = launchLiveBroadcast;

function endBroadcastAndHome() {
    stopRealTimeTracking();
    window.SafeStorage.removeItem('smd_active_broadcast');
    switchView('job-setup');
}
window.endBroadcastAndHome = endBroadcastAndHome;

window.addEventListener('DOMContentLoaded', () => {
    if (isCustomerLink()) {
        switchView('customer');
    } else if (isBroadcastLocked()) {
        switchView('active-broadcast');
    } else if (window.SafeStorage.getItem('smd_is_logged_in') === 'true') {
        switchView('job-setup');
    } else {
        switchView('signin');
    }
});