// ==========================================
// SEEMYDRIVER - 100% PURE SOLO PRODUCTION CORE
// ==========================================

window.activeSessionId = SafeStorage.getItem('smd_session_id') || ('session_' + Math.random().toString(36).substring(2, 11));
SafeStorage.setItem('smd_session_id', window.activeSessionId);

function getAppBaseUrl() {
    const origin = window.location.origin;
    if (!origin || origin.includes('localhost') || origin.includes('capacitor') || origin.includes('file://')) {
        return 'https://seemydriver.com';
    }
    return origin;
}

let driverMap = null;
let driverMapMarker = null;
let driverDestMarker = null;
let driverMapLabelMarker = null;

let cachedDestLat = SafeStorage.getItem('smd_dest_lat') ? parseFloat(SafeStorage.getItem('smd_dest_lat')) : null;
let cachedDestLng = SafeStorage.getItem('smd_dest_lng') ? parseFloat(SafeStorage.getItem('smd_dest_lng')) : null;
let activeFirebaseListener = null;

window.driverMapFitted = false;
window.driverFollowTruck = true;
window.custMapFitted = false;
window.custFollowTruck = true;
let simulationInterval = null;

function isBroadcastLocked() {
    return SafeStorage.getItem('smd_active_broadcast') === 'true' && !!SafeStorage.getItem('smd_session_id');
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
        document.getElementById('job-driver-name').value = SafeStorage.getItem('smd_driver_name') || '';
        document.getElementById('job-driver-phone').value = SafeStorage.getItem('smd_driver_phone') || '';
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
    SafeStorage.setItem('smd_is_logged_in', 'true');
    SafeStorage.setItem('smd_user_email', email);
    switchView('job-setup');
}
window.handleSignIn = handleSignIn;

function handleSignOut() {
    SafeStorage.clear();
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

    SafeStorage.setItem('smd_driver_name', driverName);
    SafeStorage.setItem('smd_driver_phone', driverPhone);
    SafeStorage.setItem('smd_cust_name', custName);
    SafeStorage.setItem('smd_cust_phone', custPhone);
    SafeStorage.setItem('smd_cust_address', custAddress);
    SafeStorage.setItem('smd_active_broadcast', 'true');

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
                SafeStorage.setItem('smd_dest_lat', cachedDestLat);
                SafeStorage.setItem('smd_dest_lng', cachedDestLng);
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
    SafeStorage.removeItem('smd_active_broadcast');
    switchView('job-setup');
}
window.endBroadcastAndHome = endBroadcastAndHome;

// --- GEOMETRY & MAP MARKERS ---
function getTruckIcon(bearing = 0) {
    return L.divIcon({
        className: 'custom-truck-svg-marker',
        html: `<div style="transform: translate(-50%, -50%) rotate(${bearing}deg); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 6px 10px rgba(0,0,0,0.7);">
            <svg viewBox="0 0 24 36" width="30" height="45" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="4" y="12" width="16" height="21" rx="2.5" fill="#0b0f19" stroke="#374151" stroke-width="1.5"/>
                <rect x="4" y="21" width="16" height="3.5" fill="#f59e0b"/>
                <path d="M6 12H18V5.5C18 3.84315 16.6569 2.5 15 2.5H9C7.34315 2.5 6 3.84315 6 5.5V12Z" fill="#111827" stroke="#4b5563" stroke-width="1.5"/>
                <path d="M7.5 8H16.5L15.5 4.5H8.5L7.5 8Z" fill="#38bdf8" fill-opacity="0.9" stroke="#bae6fd" stroke-width="0.5"/>
            </svg>
        </div>`,
        iconSize: [36, 36], iconAnchor: [18, 18]
    });
}

function getDriverLabelIcon(name = 'Driver') {
    return L.divIcon({
        className: 'custom-driver-label-marker',
        html: `<div style="transform: translate(-50%, -100%); font-size: 11px; font-weight: 900; color: #000; text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff; white-space: nowrap;">${name}</div>`,
        iconSize: [0, 0], iconAnchor: [0, -25]
    });
}

// --- DESKTOP BROWSER SIMULATOR ---
window.simulateTestDrive = async function() {
    if (!cachedDestLat || !cachedDestLng) {
        alert('Please set a valid destination address in job setup first.');
        return;
    }
    alert('Simulation started! Watch your map move along the route from your desk.');
    
    let currentLat = 29.9902, currentLng = -95.2636;
    try {
        const snap = await db.ref('broadcasts/' + window.activeSessionId).once('value');
        if (snap.val()) {
            currentLat = snap.val().lat;
            currentLng = snap.val().lng;
        }
    } catch(e){}

    let coords = [[currentLat, currentLng], [cachedDestLat, cachedDestLng]];
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${currentLng},${currentLat};${cachedDestLng},${cachedDestLat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
            coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        }
    } catch(e){}

    let index = 0;
    if (simulationInterval) clearInterval(simulationInterval);

    simulationInterval = setInterval(() => {
        if (index >= coords.length) {
            clearInterval(simulationInterval);
            return;
        }
        const pt = coords[index];
        db.ref('broadcasts/' + window.activeSessionId).update({
            lat: pt[0],
            lng: pt[1],
            speed: 28,
            timestamp: Date.now()
        });
        index += 2;
    }, 1000);
};

// --- ACTIVE MAP & TRACKING LOOP ---
async function initDriverActiveMap() {
    const container = document.getElementById('driver-map-container');
    if (!container) return;
    container.style.height = '288px';

    if (driverMap) { driverMap.remove(); driverMap = null; }
    driverMap = L.map('driver-map-container', {zoomControl: false}).setView([29.9902, -95.2636], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(driverMap);

    const pinIcon = L.divIcon({className: 'custom-pin-marker', html: `<div style="font-size:28px;">📍</div>`, iconSize: [32,32], iconAnchor: [16,32]});
    if (cachedDestLat && cachedDestLng) {
        driverDestMarker = L.marker([cachedDestLat, cachedDestLng], {icon: pinIcon}).addTo(driverMap);
    }

    if (activeFirebaseListener) db.ref('broadcasts/' + window.activeSessionId).off('value', activeFirebaseListener);

    activeFirebaseListener = db.ref('broadcasts/' + window.activeSessionId).on('value', async (snap) => {
        const data = snap.val();
        if (!data) return;
        const lat = data.lat, lng = data.lng, speed = data.speed || 0;

        let speedEl = document.getElementById('driver-map-speed');
        if (speedEl) speedEl.innerText = speed + ' mph';

        let bearing = window.lastHeading || 0;
        if (window.lastLat && window.lastLng && (lat !== window.lastLat || lng !== window.lastLng)) {
            const dLng = (lng - window.lastLng) * Math.PI / 180;
            const y = Math.sin(dLng) * Math.cos(lat * Math.PI / 180);
            const x = Math.cos(window.lastLat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) - Math.sin(window.lastLat * Math.PI / 180) * Math.cos(window.lastLat * Math.PI / 180) * Math.cos(dLng);
            let rad = Math.atan2(y, x);
            bearing = (rad * 180 / Math.PI + 360) % 360;
            window.lastHeading = bearing;
        }
        window.lastLat = lat; window.lastLng = lng;

        const truckIcon = getTruckIcon(bearing);
        const labelIcon = getDriverLabelIcon(data.driverName || 'Driver');

        if (driverMap && window.driverFollowTruck) {
            driverMap.panTo([lat, lng], { animate: true });
        }

        if (!driverMapMarker) {
            driverMapMarker = L.marker([lat, lng], {icon: truckIcon}).addTo(driverMap);
            driverMapLabelMarker = L.marker([lat, lng], {icon: labelIcon}).addTo(driverMap);
        } else {
            driverMapMarker.setLatLng([lat, lng]);
            driverMapMarker.setIcon(truckIcon);
            driverMapLabelMarker.setLatLng([lat, lng]);
        }
    });
}

function stopRealTimeTracking() {
    if (simulationInterval) clearInterval(simulationInterval);
    SafeStorage.removeItem('smd_active_broadcast');
}

window.addEventListener('DOMContentLoaded', () => {
    if (isCustomerLink()) {
        switchView('customer');
    } else if (isBroadcastLocked()) {
        switchView('active-broadcast');
    } else if (SafeStorage.getItem('smd_is_logged_in') === 'true') {
        switchView('job-setup');
    } else {
        switchView('signin');
    }
});