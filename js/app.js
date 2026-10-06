// ==========================================
// SEEMYDRIVER - COMPLETE UI CONTROLLER & FLEET ENGINE (PRODUCTION FINAL)
// ==========================================

const _rm = SafeStorage.removeItem.bind(SafeStorage);
SafeStorage.removeItem = k => {
    if (k === 'smd_active_broadcast' || k === 'smd_session_id') console.trace('[LOCK CLEARED]', k);
    return _rm(k);
};

window.activeSessionId = SafeStorage.getItem('smd_active_broadcast') === 'true' ? SafeStorage.getItem('smd_session_id') : null;

function getAppBaseUrl() {
    const origin = window.location.origin;
    if (!origin || origin.includes('localhost') || origin.includes('capacitor') || origin.includes('file://')) {
        return 'https://seemydriver.com';
    }
    return origin;
}

let map = null;
let driverMarker = null;
let destMarker = null;
let routeLine = null;
let driverMap = null;
let driverMapMarker = null;
let driverDestMarker = null;
let driverRouteLine = null;
let driverMapLabelMarker = null;
let custMapLabelMarker = null;
window.fleetMasterMap = null;

let driverRouteIndex = 0;
let custRouteIndex = 0;

window.driverCachedRouteCoords = null;
window.custCachedRouteCoords = null;
window.activeTrackingUrl = null;

let cachedDestLat = null;
let cachedDestLng = null;
let connectionMonitorInitialized = false;
let activeFirebaseListener = null;
let activeCustomerListener = null;

window.driverMapFitted = false;
window.driverFollowTruck = true;
window.custMapFitted = false;
window.custFollowTruck = true;

function isBroadcastLocked() {
    return SafeStorage.getItem('smd_active_broadcast') === 'true' &&
           !!SafeStorage.getItem('smd_session_id');
}

function isCustomerLink() {
    const p = new URLSearchParams(window.location.search);
    return p.get('view') === 'customer' || p.has('s') ||
           (p.has('session') && p.get('view') !== 'job-setup');
}

function initConnectionMonitor() {
    if (connectionMonitorInitialized) return;
    connectionMonitorInitialized = true;
    db.ref('.info/connected').on('value', (snapshot) => {
        const isConnected = snapshot.val();
        const dot = document.getElementById('connection-indicator-dot');
        const text = document.getElementById('connection-status-text');
        if (dot && text) {
            if (isConnected) {
                dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping";
                text.innerText = "LIVE SYNC";
            } else {
                dot.className = "w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse";
                text.innerText = "RECONNECTING...";
                try { db.goOnline(); } catch(e){}
            }
        }
    });
}

function getLivePosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            position => resolve({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                speed: position.coords.speed !== null && !isNaN(position.coords.speed) && position.coords.speed >= 0 ? position.coords.speed * 2.23694 : 0
            }),
            err => reject(err),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}
window.getLivePosition = getLivePosition;

window.fleetMarkers = {};

window.initFleetMasterMap = function() {
    setTimeout(() => {
        const container = document.getElementById('fleet-master-map-container');
        if (!container) return;

        if (window.fleetMasterMap) {
            window.fleetMasterMap.invalidateSize();
            window.loadFleetTelemetryData();
            return;
        }

        container.style.width = '100%';
        container.style.height = '100%';

        try {
            window.fleetMasterMap = L.map('fleet-master-map-container', { zoomControl: false }).setView([29.9902, -95.2636], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.fleetMasterMap);
            window.loadFleetTelemetryData();
        } catch (e) {
            console.error('Fleet Map init error:', e);
        }
    }, 200);
};

window.fitAllFleetUnits = function() {
    if (!window.fleetMasterMap) return;
    const markers = [];
    Object.keys(window.fleetMarkers).forEach(sessionId => {
        const markerObj = window.fleetMarkers[sessionId];
        if (markerObj && markerObj.truck) {
            markers.push(markerObj.truck);
        }
    });

    if (markers.length > 0) {
        const group = new L.featureGroup(markers);
        window.fleetMasterMap.fitBounds(group.getBounds().pad(0.3));
    } else {
        alert('No active units on the radar to fit.');
    }
};

window.centerDispatcherLocation = function() {
    if (!window.fleetMasterMap) return;
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => {
                window.fleetMasterMap.setView([pos.coords.latitude, pos.coords.longitude], 15);
            },
            err => {
                alert('Unable to retrieve your GPS location. Please check browser permissions.');
                window.fitAllFleetUnits();
            },
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
    } else {
        alert('Geolocation is not supported by your browser.');
    }
};

let activeDriverIndex = 0;
window.cycleNextDriver = function() {
    if (!window.fleetMasterMap) return;
    const sessionIds = Object.keys(window.fleetMarkers);
    if (sessionIds.length === 0) {
        alert('No active drivers broadcasting right now.');
        return;
    }

    activeDriverIndex = (activeDriverIndex + 1) % sessionIds.length;
    const targetSessionId = sessionIds[activeDriverIndex];
    const markerObj = window.fleetMarkers[targetSessionId];

    if (markerObj && markerObj.truck) {
        window.fleetMasterMap.setView(markerObj.truck.getLatLng(), 17);
    }
};

window.dispatchDriverSMS = function() {
    const driverName = document.getElementById('fleet-driver-name').value.trim();
    const driverPhone = document.getElementById('fleet-driver-phone').value.trim();
    const destAddress = document.getElementById('fleet-dest-address').value.trim();

    if (!driverName || !driverPhone || !destAddress) {
        alert('Please fill out the Driver Name, Mobile Number, and Destination Address.');
        return;
    }

    const driverSessionId = 'driver_' + Math.random().toString(36).substring(2, 11);
    const baseUrl = getAppBaseUrl();
    const driverUrl = `${baseUrl}/?view=job-setup&driver=${encodeURIComponent(driverName)}&session=${driverSessionId}`;

    db.ref('broadcasts/' + driverSessionId).set({
        driverName: driverName,
        driverPhone: driverPhone,
        custName: 'Client',
        custAddress: destAddress,
        lat: 29.9902,
        lng: -95.2636,
        speed: 0,
        status: 'Dispatched',
        timestamp: Date.now()
    });

    const smsBody = `Hi ${driverName}, you have a new job dispatch!\n\nDestination: ${destAddress}\n\nTap to launch your navigation broadcast: ${driverUrl}`;
    window.location.href = `sms:${driverPhone}?body=${encodeURIComponent(smsBody)}`;
    
    document.getElementById('fleet-driver-name').value = '';
    document.getElementById('fleet-driver-phone').value = '';
    document.getElementById('fleet-dest-address').value = '';
};

window.clearAllFleetBroadcasts = function() {
    if (confirm('Are you sure you want to clear all active and stale fleet units from the network?')) {
        db.ref('broadcasts').once('value', (snapshot) => {
            const data = snapshot.val() || {};
            const keys = Object.keys(data);
            if (keys.length === 0) {
                alert('No units to clear.');
                return;
            }

            let index = 0;
            function deleteNextChunk() {
                const chunk = keys.slice(index, index + 15);
                if (chunk.length === 0) {
                    if (window.fleetMarkers) {
                        Object.keys(window.fleetMarkers).forEach(sessionId => {
                            const markerObj = window.fleetMarkers[sessionId];
                            if (markerObj) {
                                if (markerObj.truck && window.fleetMasterMap) window.fleetMasterMap.removeLayer(markerObj.truck);
                                if (markerObj.label && window.fleetMasterMap) window.fleetMasterMap.removeLayer(markerObj.label);
                            }
                        });
                        window.fleetMarkers = {};
                    }
                    const rosterList = document.getElementById('fleet-roster-list');
                    if (rosterList) rosterList.innerHTML = `<div class="text-xs text-neutral-500 text-center py-4">No active units broadcasting.</div>`;
                    const activeCountEl = document.getElementById('fleet-active-count');
                    if (activeCountEl) activeCountEl.innerText = '0';
                    alert('All fleet telemetry data wiped clean.');
                    return;
                }

                const promises = chunk.map(sessionId => db.ref('broadcasts/' + sessionId).remove());
                Promise.all(promises).then(() => {
                    index += 15;
                    setTimeout(deleteNextChunk, 50);
                }).catch(err => {
                    alert('Error clearing chunk: ' + err.message);
                });
            }

            deleteNextChunk();
        });
    }
};

window.loadFleetTelemetryData = function() {
    db.ref('broadcasts').on('value', (snapshot) => {
        const data = snapshot.val() || {};
        const rosterList = document.getElementById('fleet-roster-list');
        const activeCountEl = document.getElementById('fleet-active-count');
        
        if (!rosterList) return;
        rosterList.innerHTML = '';

        let activeCount = 0;
        const keys = Object.keys(data);

        Object.keys(window.fleetMarkers).forEach(sessionId => {
            if (!data[sessionId]) {
                const markerObj = window.fleetMarkers[sessionId];
                if (markerObj) {
                    if (markerObj.truck && window.fleetMasterMap) window.fleetMasterMap.removeLayer(markerObj.truck);
                    if (markerObj.label && window.fleetMasterMap) window.fleetMasterMap.removeLayer(markerObj.label);
                }
                delete window.fleetMarkers[sessionId];
            }
        });

        keys.forEach(sessionId => {
            const unit = data[sessionId];
            if (!unit || !unit.lat || !unit.lng) return;

            activeCount++;
            const driverName = unit.driverName || 'Unnamed Driver';
            const speed = unit.speed || 0;
            const custAddress = unit.custAddress || 'No destination set';

            let statusText = 'Waiting';
            let statusBadgeClass = 'text-amber-400 bg-amber-950/60 border-amber-500/30';

            if (speed > 3) {
                statusText = 'Arriving / En Route';
                statusBadgeClass = 'text-emerald-400 bg-emerald-950/60 border-emerald-500/30';
            } else if (unit.custAddress && unit.custAddress !== 'Waiting for Job...') {
                statusText = 'Active / Dispatched';
                statusBadgeClass = 'text-sky-400 bg-sky-950/60 border-sky-500/30';
            }

            const rosterItem = document.createElement('div');
            rosterItem.className = "bg-neutral-950/60 border border-neutral-800/80 p-3.5 rounded-2xl flex items-center justify-between transition hover:border-amber-400/40";
            rosterItem.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 rounded-xl bg-amber-400/10 border border-amber-400/30 flex items-center justify-center text-amber-400 font-black text-sm">🚚</div>
                    <div>
                        <div class="text-xs font-black text-white">${driverName}</div>
                        <div class="text-[10px] text-neutral-400 truncate max-w-[180px]">Dest: ${custAddress} • ${speed} mph</div>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-[9px] font-black px-2.5 py-1 rounded-full uppercase border ${statusBadgeClass}">${statusText}</span>
                </div>
            `;
            rosterList.appendChild(rosterItem);

            if (window.fleetMasterMap) {
                const truckIcon = getTruckIcon(0);
                const labelIcon = getDriverLabelIcon(driverName);

                if (window.fleetMarkers[sessionId]) {
                    const markerObj = window.fleetMarkers[sessionId];
                    markerObj.truck.setLatLng([unit.lat, unit.lng]);
                    markerObj.label.setLatLng([unit.lat, unit.lng]);
                } else {
                    const truckMarker = L.marker([unit.lat, unit.lng], { icon: truckIcon }).addTo(window.fleetMasterMap);
                    const labelMarker = L.marker([unit.lat, unit.lng], { icon: labelIcon }).addTo(window.fleetMasterMap);
                    window.fleetMarkers[sessionId] = { truck: truckMarker, label: labelMarker };
                }
            }
        });

        if (activeCountEl) {
            activeCountEl.innerText = activeCount;
        }

        if (activeCount === 0) {
            rosterList.innerHTML = `<div class="text-xs text-neutral-500 text-center py-4">No active units broadcasting. Dispatch a driver above to start tracking.</div>`;
        }
    });
};

function switchView(viewId, cleanUrl = false) {
    viewId = String(viewId).replace(/-view$/, '');
    
    // Gate fleet access by tier
    if (viewId === 'fleet-dashboard' && SafeStorage.getItem('smd_user_tier') !== 'fleet') {
        viewId = 'job-setup';
    }

    if (isBroadcastLocked() && viewId !== 'active-broadcast' && viewId !== 'customer' && viewId !== 'fleet-dashboard') {
        viewId = 'active-broadcast';
        window.activeSessionId = SafeStorage.getItem('smd_session_id');
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
    let target = document.getElementById(targetId);

    if (!target) {
        target = document.getElementById('signin-view');
    }

    if (target) {
        target.classList.remove('hidden');
        target.style.setProperty('display', 'flex', 'important');
        target.style.setProperty('flex-direction', 'column', 'important');
    }

    try {
        updateHeaderNav();
    } catch (e) {
        console.error(e);
    }
    
    try {
        if (typeof checkActiveBroadcastBanner === 'function') {
            checkActiveBroadcastBanner();
        }
    } catch (e) {}

    let banner = document.getElementById('live-broadcast-banner');
    const activeView = document.getElementById('active-broadcast-view');
    
    if (viewId === 'active-broadcast' && activeView) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'live-broadcast-banner';
            banner.className = 'w-xl py-3 px-4 text-center flex items-center justify-center gap-3 z-50 mx-auto';
            banner.innerHTML = `
                <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping shadow-[0_0_10px_#34d399]"></span>
                <span class="text-amber-400 font-black tracking-[0.25em] uppercase text-xs md:text-sm animate-pulse drop-shadow-[0_0_12px_rgba(251,191,36,0.6)]">Broadcasting Live — Dispatch Active</span>
            `;
            activeView.insertBefore(banner, activeView.firstChild);
        }
        banner.style.display = 'flex';
    } else {
        if (banner) banner.style.display = 'none';
    }

    if (viewId === 'customer') {
        const custViewEl = document.getElementById('customer-view-view');
        if (custViewEl) {
            const appreciationP = custViewEl.querySelector('p');
            if (appreciationP) {
                appreciationP.className = "text-sm text-amber-400 font-semibold tracking-wider uppercase";
            }
        }
    }

    if (viewId === 'job-setup') {
        const driverNameEl = document.getElementById('job-driver-name');
        const driverPhoneEl = document.getElementById('job-driver-phone');
        if (driverNameEl) driverNameEl.value = SafeStorage.getItem('smd_driver_name') || '';
        if (driverPhoneEl) driverPhoneEl.value = SafeStorage.getItem('smd_driver_phone') || '';
    }

    if (viewId === 'active-broadcast') {
        window.driverMapFitted = false;
        window.driverFollowTruck = true;
        setTimeout(() => { 
            initDriverActiveMap(); 
            if (driverMap) {
                driverMap.invalidateSize();
                setTimeout(() => driverMap.invalidateSize(), 250);
            }
        }, 150);
    }
    if (viewId === 'customer') {
        window.custMapFitted = false;
        window.custFollowTruck = true;
        setTimeout(() => { 
            initCustomerMapLive(); 
            if (map) {
                map.invalidateSize();
                setTimeout(() => map.invalidateSize(), 250);
            }
        }, 150);
    }
    if (viewId === 'fleet-dashboard' || targetId === 'fleet-dashboard-view') {
        setTimeout(() => {
            if (typeof window.initFleetMasterMap === 'function') {
                window.initFleetMasterMap();
            }
        }, 150);
    }
}
window.switchView = switchView;

function updateHeaderNav() {
    const nav = document.getElementById('header-nav-actions');
    if (!nav) return;
    
    const isShown = id => {
        const el = document.getElementById(id);
        return !!el && !el.classList.contains('hidden') && el.style.display !== 'none';
    };

    if (isCustomerLink() || isShown('signin-view') || isShown('register-view')) {
        nav.innerHTML = '';
        return;
    }

    if (SafeStorage.getItem('smd_is_logged_in') === 'true') {
        const isFleetActive = isShown('fleet-dashboard-view');

        nav.innerHTML = `
            <button onclick="window.toggleAppMode()" class="bg-amber-400/10 hover:bg-amber-400/20 border border-amber-400/40 text-amber-400 text-xs px-3 py-2 rounded-xl font-bold cursor-pointer transition-all flex items-center gap-1.5 shadow">
                <span>${isFleetActive ? '👤 Switch to Solo' : '🛡️ Switch to Fleet'}</span>
            </button>
            <button onclick="handleSignOut()" class="bg-[#161923] hover:bg-[#1e2230] border border-neutral-800 text-neutral-300 text-xs px-3 py-2 rounded-xl font-bold cursor-pointer transition-all">Sign Out</button>
        `;
    } else {
        nav.innerHTML = `
            <button onclick="switchView('signin')" class="text-xs text-neutral-300 hover:text-white font-bold px-3 py-1.5 cursor-pointer">Sign In</button>
            <button onclick="switchView('register')" class="bg-amber-400 hover:bg-amber-300 text-black text-xs px-4 py-2 rounded-xl font-black cursor-pointer shadow-lg transition-all">Get Started</button>
        `;
    }
}

window.toggleAppMode = function() {
    const fleetView = document.getElementById('fleet-dashboard-view');
    const isFleetVisible = fleetView && (!fleetView.classList.contains('hidden') || fleetView.style.display === 'flex');
    
    if (isFleetVisible) {
        const activeBroadcast = SafeStorage.getItem('smd_active_broadcast') === 'true';
        const sessionId = SafeStorage.getItem('smd_session_id');

        if (activeBroadcast && sessionId) {
            window.activeSessionId = sessionId;
            switchView('active-broadcast');
        } else {
            switchView('job-setup');
        }
    } else {
        if (isBroadcastLocked()) {
            window.activeSessionId = SafeStorage.getItem('smd_session_id');
        }
        switchView('fleet-dashboard');
        if (typeof window.initFleetMasterMap === 'function') {
            window.initFleetMasterMap();
        }
    }
    updateHeaderNav();
};

window.upgradeToFleet = function() {
    SafeStorage.setItem('smd_user_tier', 'fleet');
    alert('Enterprise subscription active! Welcome to Fleet Command Center.');
    switchView('fleet-dashboard');
    if (typeof window.initFleetMasterMap === 'function') {
        window.initFleetMasterMap();
    }
};

function handleRegister() {
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('password-input').value.trim();
    if (!email || !password) { alert('Email and password required.'); return; }
    SafeStorage.setItem('smd_is_logged_in', 'true');
    SafeStorage.setItem('smd_user_email', email);
    switchView('job-setup');
}
window.handleRegister = handleRegister;

function handleSignIn() {
    const email = document.getElementById('signin-email').value.trim().toLowerCase();
    const password = document.getElementById('signin-password').value.trim();
    if (!email || !password) { alert('Email and password required.'); return; }
    
    SafeStorage.setItem('smd_is_logged_in', 'true');
    SafeStorage.setItem('smd_user_email', email);

    switchView('job-setup');
}
window.handleSignIn = handleSignIn;

function handleSignOut() {
    SafeStorage.removeItem('smd_is_logged_in');
    SafeStorage.removeItem('smd_user_tier');
    SafeStorage.removeItem('smd_active_broadcast');
    SafeStorage.removeItem('smd_session_id');
    if (typeof stopRealTimeTracking === 'function') {
        stopRealTimeTracking();
    }
    switchView('signin');
}
window.handleSignOut = handleSignOut;

function endBroadcastAndHome() {
    try {
        if (typeof stopRealTimeTracking === 'function') {
            stopRealTimeTracking();
        }
    } catch(e) {}

    if (window.activeSessionId) {
        try {
            db.ref('broadcasts/' + window.activeSessionId).off();
        } catch(e) {}
    }

    driverRouteIndex = 0;
    custRouteIndex = 0;
    window.driverCachedRouteCoords = null;
    window.custCachedRouteCoords = null;
    window.activeTrackingUrl = null;
    cachedDestLat = null;
    cachedDestLng = null;
    SafeStorage.removeItem('smd_dest_lat');
    SafeStorage.removeItem('smd_dest_lng');
    SafeStorage.removeItem('smd_active_broadcast');
    SafeStorage.removeItem('smd_session_id');

    let banner = document.getElementById('live-broadcast-banner');
    if (banner) banner.style.display = 'none';

    try {
        if (driverMap) {
            if (driverRouteLine) { driverMap.removeLayer(driverRouteLine); driverRouteLine = null; }
            if (driverDestMarker) { driverMap.removeLayer(driverDestMarker); driverDestMarker = null; }
            if (driverMapMarker) { driverMap.removeLayer(driverMapMarker); driverMapMarker = null; }
            if (driverMapLabelMarker) { driverMap.removeLayer(driverMapLabelMarker); driverMapLabelMarker = null; }
        }
        if (map) {
            if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
            if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
            if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
            if (custMapLabelMarker) { map.removeLayer(custMapLabelMarker); custMapLabelMarker = null; }
        }
    } catch(e) {}

    driverMapMarker = null;
    driverMapLabelMarker = null;
    driverMarker = null;
    custMapLabelMarker = null;
    window.activeSessionId = null;

    switchView('job-setup', true);
}
window.endBroadcastAndHome = endBroadcastAndHome;

async function launchLiveBroadcast() {
    try {
        const custName = document.getElementById('job-cust-name').value.trim() || 'Client';
        const custPhone = document.getElementById('job-cust-phone').value.trim();
        const custAddress = document.getElementById('job-cust-address').value.trim();
        const driverName = document.getElementById('job-driver-name').value.trim() || 'Driver';
        const driverPhone = document.getElementById('job-driver-phone').value.trim();

        if (!custAddress) { 
            alert('Please enter a destination address.'); 
            return; 
        }
        
        window.activeSessionId = 'session_' + Math.random().toString(36).substring(2, 11);
        SafeStorage.setItem('smd_driver_name', driverName);
        SafeStorage.setItem('smd_driver_phone', driverPhone);
        SafeStorage.setItem('smd_cust_name', custName);
        SafeStorage.setItem('smd_cust_phone', custPhone);
        SafeStorage.setItem('smd_cust_address', custAddress);
        SafeStorage.setItem('smd_session_id', window.activeSessionId);
        SafeStorage.setItem('smd_active_broadcast', 'true');

        let livePos;
        try {
            livePos = await getLivePosition();
        } catch (err) {
            alert('Could not retrieve current GPS position. Ensure location services are enabled.');
            SafeStorage.removeItem('smd_active_broadcast');
            SafeStorage.removeItem('smd_session_id');
            return;
        }

        let resolvedLat = cachedDestLat;
        let resolvedLng = cachedDestLng;

        if (!resolvedLat || !resolvedLng) {
            try {
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(custAddress)}&limit=1`);
                const data = await res.json();
                if (data.features && data.features.length > 0) {
                    resolvedLng = data.features[0].geometry.coordinates[0];
                    resolvedLat = data.features[0].geometry.coordinates[1];
                } else {
                    const fallbackRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(custAddress)}&limit=1`);
                    const fallbackData = await fallbackRes.json();
                    if (fallbackData && fallbackData.length > 0) {
                        resolvedLng = parseFloat(fallbackData[0].lon);
                        resolvedLat = parseFloat(fallbackData[0].lat);
                    }
                }
            } catch (fetchErr) {
                console.error('Geocoding network error:', fetchErr);
            }
        }

        if (!resolvedLat || !resolvedLng) {
            SafeStorage.removeItem('smd_active_broadcast');
            SafeStorage.removeItem('smd_session_id');
            alert('Could not find valid coordinates for that address. Please select a valid address from the dropdown suggestions.');
            return;
        }

        cachedDestLat = resolvedLat;
        cachedDestLng = resolvedLng;
        SafeStorage.setItem('smd_dest_lat', cachedDestLat);
        SafeStorage.setItem('smd_dest_lng', cachedDestLng);

        driverRouteIndex = 0;
        window.driverCachedRouteCoords = null;

        if (driverMap) {
            driverMap.remove();
            driverMap = null;
        }
        driverMapMarker = null;
        driverMapLabelMarker = null;
        driverDestMarker = null;
        driverRouteLine = null;

        await db.ref('broadcasts/' + window.activeSessionId).set({
            driverName: driverName,
            driverPhone: driverPhone,
            custName: custName,
            custPhone: custPhone,
            custAddress: custAddress,
            destLat: cachedDestLat,
            destLng: cachedDestLng,
            lat: livePos.lat,
            lng: livePos.lng,
            speed: Math.round(livePos.speed),
            timestamp: Date.now()
        });

        if (typeof startRealTimeTracking === 'function') {
            startRealTimeTracking();
        }

        const baseUrl = getAppBaseUrl();
        window.activeTrackingUrl = `${baseUrl}/?view=customer&session=${window.activeSessionId}`;
        
        prompt("Broadcast live! Copy your tracking link to test directly on your laptop browser:", window.activeTrackingUrl);

        switchView('active-broadcast');
    } catch (err) {
        alert("Launch failed: " + err.message);
        SafeStorage.removeItem('smd_active_broadcast');
        SafeStorage.removeItem('smd_session_id');
    }
}
window.launchLiveBroadcast = launchLiveBroadcast;

function copyTrackingLink() {
    const baseUrl = getAppBaseUrl();
    const urlToCopy = window.activeTrackingUrl || `${baseUrl}/?view=customer&session=${window.activeSessionId}`;
    navigator.clipboard.writeText(urlToCopy);
    alert('Client tracking link copied to clipboard: ' + urlToCopy);
}
window.copyTrackingLink = copyTrackingLink;

function textTrackingLink() {
    const custPhone = SafeStorage.getItem('smd_cust_phone') || '';
    const baseUrl = getAppBaseUrl();
    const urlToText = window.activeTrackingUrl || `${baseUrl}/?view=customer&session=${window.activeSessionId}`;
    const smsBody = `Track my live arrival in real time here: ${urlToText}`;
    if (custPhone) {
        window.location.href = `sms:${custPhone}?body=${encodeURIComponent(smsBody)}`;
    } else {
        window.location.href = `sms:?body=${encodeURIComponent(smsBody)}`;
    }
}
window.textTrackingLink = textTrackingLink;

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 3958.8, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2)**2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function getClosestPointOnPolyline(lat, lng, coords) {
    if (!coords || !coords.length) return [lat, lng];
    let minDist = Infinity, bestPoint = [lat, lng];
    for (let i = 0; i < coords.length - 1; i++) {
        const proj = getClosestPointOnSegment([lat, lng], coords[i], coords[i+1]);
        const dist = calculateDistance(lat, lng, proj[0], proj[1]);
        if (dist < minDist) { minDist = dist; bestPoint = proj; }
    }
    return bestPoint;
}

function getClosestPointOnSegment(p, a, b) {
    const AB = { x: b[1] - a[1], y: b[0] - a[0] }, AP = { x: p[1] - a[1], y: p[0] - a[0] };
    const abLenSq = AB.x**2 + AB.y**2;
    if (abLenSq === 0) return a;
    let t = Math.max(0, Math.min(1, (AP.x * AB.x + AP.y * AB.y) / abLenSq));
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}

const markerAnimIds = new WeakMap();
function smoothMoveMarker(marker, targetLat, targetLng, speedMph = 15) {
    if (!marker) return;
    const prev = markerAnimIds.get(marker);
    if (prev) cancelAnimationFrame(prev);
    const start = marker.getLatLng(), startTime = performance.now(), duration = 1500;
    function animate(now) {
        const p = Math.min((now - startTime) / duration, 1);
        marker.setLatLng([start.lat + (targetLat - start.lat) * p, start.lng + (targetLng - start.lng) * p]);
        if (p < 1) markerAnimIds.set(marker, requestAnimationFrame(animate));
    }
    markerAnimIds.set(marker, requestAnimationFrame(animate));
}

function getTruckIcon(bearing = 0) {
    return L.divIcon({
        className: 'custom-truck-svg-marker',
        html: `
            <div style="transform: translate(-50%, -50%) rotate(${bearing}deg); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 6px 10px rgba(0,0,0,0.7));">
                <svg viewBox="0 0 24 36" width="30" height="45" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1.5" y="9" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>
                    <rect x="19" y="9" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>
                    <rect x="1.5" y="25" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>
                    <rect x="19" y="25" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>
                    
                    <rect x="4" y="12" width="16" height="21" rx="2.5" fill="#0b0f19" stroke="#374151" stroke-width="1.5"/>
                    <rect x="4" y="21" width="16" height="3.5" fill="#f59e0b"/>
                    <line x1="4" y1="22.75" x2="20" y2="22.75" stroke="#ffffff" stroke-width="0.75" opacity="0.8"/>
                    
                    <path d="M6 12H18V5.5C18 3.84315 16.6569 2.5 15 2.5H9C7.34315 2.5 6 3.84315 6 5.5V12Z" fill="#111827" stroke="#4b5563" stroke-width="1.5"/>
                    
                    <path d="M7.5 8H16.5L15.5 4.5H8.5L7.5 8Z" fill="#38bdf8" fill-opacity="0.9" stroke="#bae6fd" stroke-width="0.5"/>
                    <line x1="9" y1="6" x2="15" y2="6" stroke="#ffffff" stroke-width="0.75" opacity="0.6"/>
                    
                    <circle cx="7" cy="3.5" r="1.1" fill="#fbbf24"/>
                    <circle cx="17" cy="3.5" r="1.1" fill="#fbbf24"/>
                    <circle cx="7" cy="3.5" r="0.5" fill="#ffffff"/>
                    <circle cx="17" cy="3.5" r="0.5" fill="#ffffff"/>
                </svg>
            </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
}

function getDriverLabelIcon(driverName = 'Driver') {
    return L.divIcon({
        className: 'custom-driver-label-marker',
        html: `
            <div style="transform: translate(-50%, -100%); font-size: 11px; font-weight: 900; color: #000000; text-shadow: -1px -1px 0 #ffffff, 1px -1px 0 #ffffff, -1px 1px 0 #ffffff, 1px 1px 0 #ffffff; white-space: nowrap; letter-spacing: 0.08em; text-transform: uppercase;">
                ${driverName}
            </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, -25]
    });
}

window.fitDriverMap = function() {
    window.driverFollowTruck = false;
    if (driverMapMarker && driverDestMarker && driverMap) {
        const group = new L.featureGroup([driverMapMarker, driverDestMarker]);
        driverMap.fitBounds(group.getBounds().pad(0.3), { animate: true });
    } else if (driverMapMarker && driverMap) {
        driverMap.setView(driverMapMarker.getLatLng(), 16, { animate: true });
    }
};

window.recenterDriverMap = function() {
    window.driverFollowTruck = true;
    if (driverMapMarker && driverMap) {
        driverMap.setView(driverMapMarker.getLatLng(), 16, { animate: true });
    }
};

window.openDriverDirections = function() {
    const destAddr = SafeStorage.getItem('smd_cust_address');
    if (destAddr) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destAddr)}`, '_blank');
    } else {
        alert('No destination address found for directions.');
    }
};

window.fitCustomerMap = function() {
    window.custFollowTruck = false;
    if (driverMarker && destMarker && map) {
        const group = new L.featureGroup([driverMarker, destMarker]);
        map.fitBounds(group.getBounds().pad(0.3), { animate: true });
    } else if (driverMarker && map) {
        map.setView(driverMarker.getLatLng(), 16, { animate: true });
    }
};

window.recenterCustomerMap = function() {
    window.custFollowTruck = true;
    if (driverMarker && map) {
        map.setView(driverMarker.getLatLng(), 16, { animate: true });
    }
};

async function handleAddressInput(value) {
    cachedDestLat = null;
    cachedDestLng = null;
    const suggestions = document.getElementById('address-suggestions');
    if (!suggestions) return;
    if (value.trim().length < 3) { suggestions.classList.add('hidden'); suggestions.style.display = 'none'; return; }
    try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(value)}&limit=5`);
        const data = await res.json();
        suggestions.innerHTML = '';
        data.features.forEach(f => {
            const name = `${f.properties.name || ''}, ${f.properties.city || ''}, ${f.properties.state || ''}`.replace(/^, /, '');
            const div = document.createElement('div');
            div.className = "px-3.5 py-2.5 text-xs text-neutral-200 hover:bg-neutral-800 cursor-pointer border-b border-neutral-800 backdrop-blur-md";
            div.innerText = name;
            div.onpointerdown = (e) => {
                e.preventDefault();
                document.getElementById('job-cust-address').value = name;
                cachedDestLat = f.geometry.coordinates[1];
                cachedDestLng = f.geometry.coordinates[0];
                SafeStorage.setItem('smd_dest_lat', cachedDestLat);
                SafeStorage.setItem('smd_dest_lng', cachedDestLng);
                suggestions.classList.add('hidden');
                suggestions.style.display = 'none';
            };
            suggestions.appendChild(div);
        });
        suggestions.classList.remove('hidden');
        suggestions.style.display = 'block';
    } catch(e){}
}
window.handleAddressInput = handleAddressInput;

async function initDriverActiveMap() {
    const container = document.getElementById('driver-map-container');
    if (container) {
        container.style.height = '240px';
        if (container.parentElement) container.parentElement.style.height = '240px';
    }

    let startLat = 29.9902, startLng = -95.2636;
    try {
        const pos = await getLivePosition();
        startLat = pos.lat;
        startLng = pos.lng;
    } catch(e) {}

    if (driverMap) {
        driverMap.remove();
        driverMap = null;
        driverMapMarker = null;
        driverDestMarker = null;
        driverRouteLine = null;
        driverMapLabelMarker = null;
    }

    if (container) {
        driverMap = L.map('driver-map-container', {zoomControl: false}).setView([startLat, startLng], 16);
        window.driverMap = driverMap;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(driverMap);
        setTimeout(() => driverMap.invalidateSize(), 150);
    }

    const driverName = SafeStorage.getItem('smd_driver_name') || 'Driver';

    const pinIcon = L.divIcon({
        className: 'custom-pin-marker',
        html: `<div style="font-size: 28px; line-height: 1;">📍</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32]
    });

    const dLat = cachedDestLat;
    const dLng = cachedDestLng;
    if (dLat && dLng && !isNaN(dLat) && !isNaN(dLng) && driverMap) {
        driverDestMarker = L.marker([dLat, dLng], {icon: pinIcon}).addTo(driverMap);
        driverRouteLine = L.polyline([[startLat, startLng], [dLat, dLng]], {color: '#f59e0b', weight: 5, dashArray: '6, 6'}).addTo(driverMap);
        driverMap.fitBounds([[startLat, startLng], [dLat, dLng]], {padding: [50, 50]});
        window.driverMapFitted = true;
        window.driverFollowTruck = false;
    }

    if (activeFirebaseListener && window.activeSessionId) {
        db.ref('broadcasts/' + window.activeSessionId).off('value', activeFirebaseListener);
    }

    activeFirebaseListener = db.ref('broadcasts/' + window.activeSessionId).on('value', async (snap) => {
        const data = snap.val() || { lat: startLat, lng: startLng, speed: 0, driverName: driverName };
        let lat = data.lat || startLat, lng = data.lng || startLng;
        
        const currentDestLat = data.destLat || dLat;
        const currentDestLng = data.destLng || dLng;
        
        if (!currentDestLat || !currentDestLng) return;

        const speed = data.speed || 0;
        const currentDriverName = data.driverName || driverName;
        
        const speedEl = document.getElementById('driver-map-speed');
        if (speedEl) speedEl.innerText = speed + ' mph';

        let fullRoute = [[lat, lng]];
        try {
            if (!window.driverCachedRouteCoords) {
                const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${currentDestLng},${currentDestLat}?overview=full&geometries=geojson`);
                const j = await r.json();
                if (j.routes && j.routes.length > 0) {
                    window.driverCachedRouteCoords = j.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    driverRouteIndex = 0;
                }
            }
            if (!window.driverCachedRouteCoords || window.driverCachedRouteCoords.length === 0) {
                window.driverCachedRouteCoords = [[lat, lng], [currentDestLat, currentDestLng]];
            }
            fullRoute = window.driverCachedRouteCoords;
            const snapped = getClosestPointOnPolyline(lat, lng, fullRoute);
            lat = snapped[0]; lng = snapped[1];
        } catch(e) {
            fullRoute = [[lat, lng], [currentDestLat, currentDestLng]];
        }

        let bearing = window.lastValidHeading || 0;
        if (fullRoute.length > 1) {
            let minDist = Infinity;
            let bestIdx = driverRouteIndex;
            let searchLimit = Math.min(fullRoute.length, driverRouteIndex + 40);
            for (let i = driverRouteIndex; i < searchLimit; i++) {
                let pt = fullRoute[i];
                let d = Math.hypot(pt[0] - lat, pt[1] - lng);
                if (d < minDist) {
                    minDist = d;
                    bestIdx = i;
                }
            }
            driverRouteIndex = Math.max(driverRouteIndex, bestIdx);

            let idx1 = driverRouteIndex;
            let idx2 = Math.min(driverRouteIndex + 1, fullRoute.length - 1);
            if (idx1 === idx2 && idx1 > 0) {
                idx1 = idx1 - 1;
            }

            const p1 = fullRoute[idx1];
            const p2 = fullRoute[idx2];
            const dLatVal = -(p2[0] - p1[0]); 
            const dLngVal = (p2[1] - p1[1]) * Math.cos(p1[0] * Math.PI / 180);

            if (dLatVal !== 0 || dLngVal !== 0) {
                bearing = Math.atan2(dLngVal, dLatVal) * (180 / Math.PI);
                window.lastValidHeading = bearing;
            }
        }

        let activeForwardPath = fullRoute.length > 1 ? fullRoute.slice(driverRouteIndex) : fullRoute;

        const truckIcon = getTruckIcon(bearing);
        const labelIcon = getDriverLabelIcon(currentDriverName);

        if (driverMap) {
            driverMap.invalidateSize();
            if (window.driverFollowTruck) {
                driverMap.panTo([lat, lng], { animate: true });
            }
        }

        if (!driverMapMarker) {
            driverMapMarker = L.marker([lat, lng], {icon: truckIcon}).addTo(driverMap);
        } else {
            smoothMoveMarker(driverMapMarker, lat, lng, speed);
            driverMapMarker.setIcon(truckIcon);
        }

        if (!driverMapLabelMarker) {
            driverMapLabelMarker = L.marker([lat, lng], {icon: labelIcon}).addTo(driverMap);
        } else {
            smoothMoveMarker(driverMapLabelMarker, lat, lng, speed);
            driverMapLabelMarker.setIcon(labelIcon);
        }

        if (!driverRouteLine) {
            driverRouteLine = L.polyline(activeForwardPath, {color: '#f59e0b', weight: 5, dashArray: '6, 6'}).addTo(driverMap);
        } else {
            driverRouteLine.setLatLngs(activeForwardPath);
        }
    });
}

async function initCustomerMapLive() {
    initConnectionMonitor();
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session') || urlParams.get('s') || window.activeSessionId;
    
    const container = document.getElementById('customer-map-container');
    if (container) {
        container.style.height = '288px';
        if (container.parentElement) container.parentElement.style.height = '288px';
    }

    let startLat = 29.9902, startLng = -95.2636;
    if (map) {
        map.remove();
        map = null;
        driverMarker = null;
        destMarker = null;
        routeLine = null;
        custMapLabelMarker = null;
    }

    if (container) {
        map = L.map('customer-map-container', {zoomControl: false}).setView([startLat, startLng], 16);
        window.map = map;
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
        setTimeout(() => map.invalidateSize(), 150);
    }

    if (activeCustomerListener && sessionId) {
        db.ref('broadcasts/' + sessionId).off('value', activeCustomerListener);
    }

    window.custMapFitted = false;
    window.custFollowTruck = true;

    activeCustomerListener = db.ref('broadcasts/' + sessionId).on('value', async (snap) => {
        const data = snap.val() || { lat: startLat, lng: startLng, speed: 0, driverName: 'Driver' };
        
        const driverNameEl = document.getElementById('cust-driver-name');
        const custDestEl = document.getElementById('cust-destination');
        const custSpeedEl = document.getElementById('cust-speed');
        const custDistEl = document.getElementById('cust-distance');
        const custEtaEl = document.getElementById('cust-eta');

        const currentDriverName = data.driverName || 'Driver';
        if (driverNameEl) driverNameEl.innerText = currentDriverName;
        if (custDestEl) custDestEl.innerText = data.custAddress || 'Destination';
        const speed = data.speed || 0;
        if (custSpeedEl) custSpeedEl.innerText = speed + ' mph';

        if (data.driverPhone) {
            const callBtn = document.getElementById('cust-call-btn');
            const msgBtn = document.getElementById('cust-msg-btn');
            if (callBtn) callBtn.href = `tel:${data.driverPhone}`;
            if (msgBtn) msgBtn.href = `sms:${data.driverPhone}?body=Hi%20${encodeURIComponent(currentDriverName)},%20tracking%20your%20arrival!`;
        }

        let lat = data.lat || startLat, lng = data.lng || startLng;
        let destLat = data.destLat || cachedDestLat;
        let destLng = data.destLng || cachedDestLng;
        let addressFound = !!destLat;

        let fullRoute = [[lat, lng]];
        if (addressFound && destLat && destLng) {
            const dist = calculateDistance(lat, lng, destLat, destLng);
            if (custDistEl) custDistEl.innerText = dist.toFixed(1) + ' mi';
            if (custEtaEl) custEtaEl.innerText = Math.round((dist / (speed > 10 ? speed : 30)) * 60) + ' mins';

            if (!window.custCachedRouteCoords) {
                try {
                    const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=full&geometries=geojson`);
                    const j = await r.json();
                    window.custCachedRouteCoords = j.routes?.[0]?.geometry?.coordinates.map(c => [c[1], c[0]]) || [[lat, lng], [destLat, destLng]];
                } catch(e) {
                    window.custCachedRouteCoords = [[lat, lng], [destLat, destLng]];
                }
            }
            fullRoute = window.custCachedRouteCoords;
            const snapped = getClosestPointOnPolyline(lat, lng, fullRoute);
            lat = snapped[0]; lng = snapped[1];
        }

        let bearing = window.lastValidHeading || 0;
        if (fullRoute.length > 1) {
            let minDist = Infinity;
            let bestIdx = custRouteIndex;
            let searchLimit = Math.min(fullRoute.length, custRouteIndex + 40);
            for (let i = custRouteIndex; i < searchLimit; i++) {
                let pt = fullRoute[i];
                let d = Math.hypot(pt[0] - lat, pt[1] - lng);
                if (d < minDist) {
                    minDist = d;
                    bestIdx = i;
                }
            }
            custRouteIndex = Math.max(custRouteIndex, bestIdx);

            let idx1 = custRouteIndex;
            let idx2 = Math.min(custRouteIndex + 1, fullRoute.length - 1);
            if (idx1 === idx2 && idx1 > 0) {
                idx1 = idx1 - 1;
            }

            const p1 = fullRoute[idx1];
            const p2 = fullRoute[idx2];
            const dLatVal = -(p2[0] - p1[0]); 
            const dLngVal = (p2[1] - p1[1]) * Math.cos(p1[0] * Math.PI / 180);

            if (dLatVal !== 0 || dLngVal !== 0) {
                bearing = Math.atan2(dLngVal, dLatVal) * (180 / Math.PI);
                window.lastValidHeading = bearing;
            }
        }

        let activeForwardPath = fullRoute.length > 1 ? fullRoute.slice(custRouteIndex) : fullRoute;

        const truckIcon = getTruckIcon(bearing);
        const labelIcon = getDriverLabelIcon(currentDriverName);
        const pinIcon = L.divIcon({
            className: 'custom-pin-marker',
            html: `<div style="font-size: 28px; line-height: 1;">📍</div>`,
            iconSize: [32, 32], iconAnchor: [16, 32]
        });

        if (addressFound && destLat && destLng && !destMarker) {
            destMarker = L.marker([destLat, destLng], {icon: pinIcon}).addTo(map);
        }

        if (map) {
            map.invalidateSize();
            if (!window.custMapFitted && destMarker) {
                map.fitBounds(L.featureGroup([driverMarker || L.marker([lat, lng]), destMarker]).getBounds().pad(0.3), { padding: [50, 50], animate: true });
                window.custMapFitted = true;
                window.custFollowTruck = false;
            } else if (window.custFollowTruck) {
                map.panTo([lat, lng], { animate: true });
            }
        }

        if (!driverMarker) {
            driverMarker = L.marker([lat, lng], {icon: truckIcon}).addTo(map);
        } else {
            smoothMoveMarker(driverMarker, lat, lng, speed);
            driverMarker.setIcon(truckIcon);
        }

        if (!custMapLabelMarker) {
            custMapLabelMarker = L.marker([lat, lng], {icon: labelIcon}).addTo(map);
        } else {
            smoothMoveMarker(custMapLabelMarker, lat, lng, speed);
            custMapLabelMarker.setIcon(labelIcon);
        }

        if (addressFound && destLat && destLng) {
            if (routeLine) {
                routeLine.setLatLngs(activeForwardPath);
            } else {
                routeLine = L.polyline(activeForwardPath, {color: '#f59e0b', weight: 5, dashArray: '6, 6'}).addTo(map);
            }
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    try {
        ['fleet-dashboard-view','landing-view','plans-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { el.classList.add('hidden'); el.style.setProperty('display','none','important'); }
        });

        if (isCustomerLink()) {
            switchView('customer');
        } else if (isBroadcastLocked()) {
            window.activeSessionId = SafeStorage.getItem('smd_session_id');
            switchView('active-broadcast');
        } else if (SafeStorage.getItem('smd_is_logged_in') === 'true') {
            switchView('job-setup');
        } else {
            switchView('signin');
        }
    } catch (e) {
        switchView('signin');
    }
});