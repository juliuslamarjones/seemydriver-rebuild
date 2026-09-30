// js/app.js

window.activeSessionId = null;
let activeListenerRef = null;
let map = null, driverMarker = null, destMarker = null, routeLine = null;
let driverMap = null, driverMapMarker = null, driverDestMarker = null, driverRouteLine = null;
let driverCachedRouteCoords = null, custCachedRouteCoords = null;

function switchView(viewId) {
    const views = ['job-setup-view', 'active-broadcast-view', 'customer-view-view', 'signin-view'];
    views.forEach(v => { const el = document.getElementById(v); if (el) el.classList.add('hidden'); });
    const target = document.getElementById(viewId + '-view');
    if (target) target.classList.remove('hidden');

    if (viewId === 'active-broadcast') setTimeout(() => { initDriverActiveMap(); if (driverMap) driverMap.invalidateSize(); }, 200);
    if (viewId === 'customer-view') setTimeout(() => { initCustomerMapLive(); if (map) map.invalidateSize(); }, 200);
}

async function launchLiveBroadcast() {
    const custName = document.getElementById('job-cust-name').value.trim();
    const custAddress = document.getElementById('job-cust-address').value.trim();
    const driverName = document.getElementById('job-driver-name').value.trim();
    const driverPhone = document.getElementById('job-driver-phone').value.trim();

    if (!driverName) { alert('Please enter the driver name.'); return; }
    if (!custAddress) { alert('Please enter a destination address.'); return; }

    let destLat = null, destLng = null;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(custAddress)}&limit=1`, {
            headers: { 'Accept': 'application/json' }
        });
        const data = await res.json();
        if (data && data.length > 0) {
            destLat = parseFloat(data[0].lat);
            destLng = parseFloat(data[0].lon);
        }
    } catch(e) {}

    if (!destLat || !destLng) {
        alert('Could not resolve coordinates for that address. Please check the address and try again.');
        return;
    }

    const first = await getFirstFix();
    if (!first) {
      alert('Could not get a live GPS fix. Make sure Location is on, then try again.');
      return;
    }

    window.activeSessionId = 'session_' + Math.random().toString(36).substring(2, 11);
    SafeStorage.setItem('smd_active_broadcast', 'true');
    SafeStorage.setItem('smd_active_session_id', window.activeSessionId);
    SafeStorage.setItem('smd_cust_address', custAddress);

    try {
      await db.ref('broadcasts/' + window.activeSessionId).set({
        driverName, driverPhone, custName: custName || 'Client', custAddress,
        destLat, destLng,
        lat: first.lat, lng: first.lng, speed: 0,
        timestamp: firebase.database.ServerValue.TIMESTAMP
      });
    } catch (e) {
      SafeStorage.removeItem('smd_active_broadcast');
      alert('Could not reach the server. Check your connection and try again.');
      return;
    }

    await startRealTimeTracking();
    const trackingUrl = `https://seemydriver.com/?s=${window.activeSessionId}`;
    const linkOutput = document.getElementById('tracking-link-output');
    if (linkOutput) linkOutput.value = trackingUrl;
    switchView('active-broadcast');
}

function copyTrackingLink() {
    navigator.clipboard.writeText(document.getElementById('tracking-link-output').value);
    alert('Link copied!');
}

function textTrackingLink() {
    window.location.href = `sms:${document.getElementById('job-driver-phone').value || ''}?body=${encodeURIComponent(document.getElementById('tracking-link-output').value)}`;
}

function endBroadcastAndHome() {
    stopRealTimeTracking();
    switchView('job-setup');
}

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
function smoothMoveMarker(marker, targetLat, targetLng) {
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

window.fitDriverMap = function() {
    if (driverMapMarker && driverDestMarker) {
        const group = new L.featureGroup([driverMapMarker, driverDestMarker]);
        driverMap.fitBounds(group.getBounds().pad(0.2));
    } else if (driverMapMarker) {
        driverMap.setView(driverMapMarker.getLatLng(), 15);
    }
};

window.recenterDriverMap = function() {
    if (driverMapMarker) driverMap.setView(driverMapMarker.getLatLng(), 15);
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
    if (driverMarker && destMarker && map) {
        const group = new L.featureGroup([driverMarker, destMarker]);
        map.fitBounds(group.getBounds().pad(0.2));
    } else if (driverMarker && map) {
        map.setView(driverMarker.getLatLng(), 16);
    }
};

window.recenterCustomerMap = function() {
    if (driverMarker && map) {
        map.setView(driverMarker.getLatLng(), 16);
    }
};

async function initDriverActiveMap() {
    window.activeSessionId = window.activeSessionId || SafeStorage.getItem('smd_active_session_id');
    if (!window.activeSessionId) return;

    if (activeListenerRef) { activeListenerRef.off(); }

    activeListenerRef = db.ref('broadcasts/' + window.activeSessionId);
    activeListenerRef.on('value', async (snap) => {
        const data = snap.val();
        if (!data || !data.lat || !data.lng || !data.destLat || !data.destLng) return;
        
        let lat = data.lat, lng = data.lng;
        const speed = data.speed || 0;
        const speedEl = document.getElementById('driver-map-speed');
        if (speedEl) speedEl.innerText = speed + ' mph';

        const trackingUrl = `https://seemydriver.com/?s=${window.activeSessionId}`;
        const linkInput = document.getElementById('tracking-link-output');
        if (linkInput && !linkInput.value) linkInput.value = trackingUrl;

        let destLat = data.destLat, destLng = data.destLng;

        if (!driverCachedRouteCoords) {
            try {
                const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=full&geometries=geojson`);
                const j = await r.json();
                driverCachedRouteCoords = j.routes?.[0]?.geometry?.coordinates.map(c => [c[1], c[0]]) || [[lat, lng], [destLat, destLng]];
            } catch (err) {
                driverCachedRouteCoords = [[lat, lng], [destLat, destLng]];
            }
        }
        const snapped = getClosestPointOnPolyline(lat, lng, driverCachedRouteCoords);
        lat = snapped[0]; lng = snapped[1];

        const truckIcon = L.divIcon({ className: 'custom-truck-marker', html: `<div style="font-size: 28px;">🚚</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
        const pinIcon = L.divIcon({ className: 'custom-pin-marker', html: `<div style="font-size: 30px;">📍</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });

        if (!driverMap) {
            driverMap = L.map('driver-map-container', {zoomControl: false}).setView([lat, lng], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(driverMap);
            driverMapMarker = L.marker([lat, lng], {icon: truckIcon}).addTo(driverMap);
            driverDestMarker = L.marker([destLat, destLng], {icon: pinIcon}).addTo(driverMap);
            driverRouteLine = L.polyline(driverCachedRouteCoords, {color: '#3b82f6', weight: 5}).addTo(driverMap);
            driverMap.fitBounds(L.featureGroup([driverMapMarker, driverDestMarker]).getBounds().pad(0.2));
        } else {
            smoothMoveMarker(driverMapMarker, lat, lng);
            if (driverRouteLine) driverRouteLine.setLatLngs(driverCachedRouteCoords);
            if (driverDestMarker) driverDestMarker.setLatLng([destLat, destLng]);
        }
    });
}

async function initCustomerMapLive() {
    const urlParams = new URLSearchParams(window.location.search);
    let sessionId = urlParams.get('s') || urlParams.get('session');
    if (!sessionId && window.location.search.includes('session_')) {
        sessionId = 'session_' + window.location.search.split('session_')[1].split('&')[0];
    }
    if (!sessionId) return;

    db.ref('broadcasts/' + sessionId).on('value', async (snap) => {
        const data = snap.val();
        if (!data || !data.lat) return;
        document.getElementById('cust-driver-name').innerText = data.driverName || 'Driver';
        document.getElementById('cust-destination').innerText = data.custAddress || 'Destination';
        const speed = data.speed || 0;
        document.getElementById('cust-speed').innerText = speed + ' mph';

        let lat = data.lat, lng = data.lng, destLat = data.destLat, destLng = data.destLng;
        const dist = calculateDistance(lat, lng, destLat, destLng);
        document.getElementById('cust-distance').innerText = dist.toFixed(1) + ' mi';
        document.getElementById('cust-eta').innerText = Math.round((dist / (speed > 10 ? speed : 30)) * 60) + ' mins';

        if (!custCachedRouteCoords) {
            try {
                const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${lng},${lat};${destLng},${destLat}?overview=full&geometries=geojson`);
                const j = await r.json();
                custCachedRouteCoords = j.routes?.[0]?.geometry?.coordinates.map(c => [c[1], c[0]]) || [[lat, lng], [destLat, destLng]];
            } catch (err) { custCachedRouteCoords = [[lat, lng], [destLat, destLng]]; }
        }

        const truckIcon = L.divIcon({ className: 'custom-truck-marker', html: `<div style="font-size: 28px;">🚚</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });
        const pinIcon = L.divIcon({ className: 'custom-pin-marker', html: `<div style="font-size: 30px;">📍</div>`, iconSize: [0, 0], iconAnchor: [0, 0] });

        if (!map) {
            map = L.map('customer-map-container', {zoomControl: false}).setView([lat, lng], 16);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            driverMarker = L.marker([lat, lng], {icon: truckIcon}).addTo(map);
            destMarker = L.marker([destLat, destLng], {icon: pinIcon}).addTo(map);
            routeLine = L.polyline(custCachedRouteCoords, {color: '#3b82f6', weight: 5}).addTo(map);
            map.fitBounds(L.featureGroup([driverMarker, destMarker]).getBounds().pad(0.2));
        } else {
            smoothMoveMarker(driverMarker, lat, lng);
            if (routeLine) routeLine.setLatLngs(custCachedRouteCoords);
        }
    });
}

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('s') || urlParams.has('session') || window.location.search.includes('session_')) {
        switchView('customer-view');
    } else if (SafeStorage.getItem('smd_active_broadcast') === 'true' && SafeStorage.getItem('smd_active_session_id')) {
        window.activeSessionId = SafeStorage.getItem('smd_active_session_id');
        switchView('active-broadcast');
        startRealTimeTracking();
    } else if (SafeStorage.getItem('smd_is_logged_in') === 'true') {
        switchView('job-setup');
    } else {
        switchView('signin');
    }
});