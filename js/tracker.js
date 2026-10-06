// ==========================================
// SEEMYDRIVER - DYNAMIC ROUTING & TRACKER ENGINE
// ==========================================

if (typeof window.driverMap === 'undefined') window.driverMap = null;
if (typeof window.driverMapMarker === 'undefined') window.driverMapMarker = null;
if (typeof window.driverDestMarker === 'undefined') window.driverDestMarker = null;
if (typeof window.driverMapLabelMarker === 'undefined') window.driverMapLabelMarker = null;
if (typeof window.routePolyline === 'undefined') window.routePolyline = null;

if (typeof window.cachedDestLat === 'undefined') {
    window.cachedDestLat = SafeStorage.getItem('smd_dest_lat') ? parseFloat(SafeStorage.getItem('smd_dest_lat')) : null;
}
if (typeof window.cachedDestLng === 'undefined') {
    window.cachedDestLng = SafeStorage.getItem('smd_dest_lng') ? parseFloat(SafeStorage.getItem('smd_dest_lng')) : null;
}

if (typeof window.activeFirebaseListener === 'undefined') window.activeFirebaseListener = null;
if (typeof window.simulationInterval === 'undefined') window.simulationInterval = null;

// --- DYNAMIC OSRM ROUTE FETCHING ---
async function fetchDynamicRoute(startLat, startLng, destLat, destLng) {
    try {
        const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${destLng},${destLat}?overview=full&geometries=geojson`);
        const data = await res.json();
        if (data.routes && data.routes.length > 0) {
            return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        }
    } catch (e) {
        console.warn("OSRM routing failed, falling back to direct line:", e);
    }
    return [[startLat, startLng], [destLat, destLng]];
}

// --- DESKTOP BROWSER SIMULATOR WITH DYNAMIC SNAPPING ---
window.simulateTestDrive = async function() {
    const destLat = window.cachedDestLat || (SafeStorage.getItem('smd_dest_lat') ? parseFloat(SafeStorage.getItem('smd_dest_lat')) : null);
    const destLng = window.cachedDestLng || (SafeStorage.getItem('smd_dest_lng') ? parseFloat(SafeStorage.getItem('smd_dest_lng')) : null);

    if (!destLat || !destLng) {
        alert('Please set a valid destination address in job setup first.');
        return;
    }
    alert('Simulation started! Driving along dynamic route from your desk.');
    
    let currentLat = 29.9902, currentLng = -95.2636;
    try {
        const snap = await db.ref('broadcasts/' + window.activeSessionId).once('value');
        if (snap.val()) {
            currentLat = snap.val().lat;
            currentLng = snap.val().lng;
        }
    } catch(e){}

    let coords = await fetchDynamicRoute(currentLat, currentLng, destLat, destLng);
    let index = 0;

    if (window.simulationInterval) clearInterval(window.simulationInterval);

    window.simulationInterval = setInterval(async () => {
        if (index >= coords.length) {
            clearInterval(window.simulationInterval);
            return;
        }

        const pt = coords[index];
        
        db.ref('broadcasts/' + window.activeSessionId).update({
            lat: pt[0],
            lng: pt[1],
            speed: 32,
            timestamp: Date.now()
        });

        index++;

        if (index % 15 === 0 && index < coords.length - 10) {
            coords = await fetchDynamicRoute(pt[0], pt[1], destLat, destLng);
            index = 0;
        }
    }, 1000);
};

// --- ACTIVE MAP & TRACKING LOOP WITH TRAIL CLEANUP ---
async function initDriverActiveMap() {
    const container = document.getElementById('driver-map-container');
    if (!container) return;
    container.style.height = '288px';

    if (window.driverMap) { window.driverMap.remove(); window.driverMap = null; window.routePolyline = null; }
    window.driverMap = L.map('driver-map-container', {zoomControl: false}).setView([29.9902, -95.2636], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(window.driverMap);

    const pinIcon = L.divIcon({className: 'custom-pin-marker', html: `<div style="font-size:28px;">📍</div>`, iconSize: [32,32], iconAnchor: [16,32]});
    
    const destLat = window.cachedDestLat || (SafeStorage.getItem('smd_dest_lat') ? parseFloat(SafeStorage.getItem('smd_dest_lat')) : null);
    const destLng = window.cachedDestLng || (SafeStorage.getItem('smd_dest_lng') ? parseFloat(SafeStorage.getItem('smd_dest_lng')) : null);

    if (destLat && destLng) {
        window.driverDestMarker = L.marker([destLat, destLng], {icon: pinIcon}).addTo(window.driverMap);
    }

    if (window.activeFirebaseListener) db.ref('broadcasts/' + window.activeSessionId).off('value', window.activeFirebaseListener);

    let fullRouteCoords = [];
    if (destLat && destLng) {
        const initialSnap = await db.ref('broadcasts/' + window.activeSessionId).once('value');
        if (initialSnap.val()) {
            fullRouteCoords = await fetchDynamicRoute(initialSnap.val().lat, initialSnap.val().lng, destLat, destLng);
            window.routePolyline = L.polyline(fullRouteCoords, {color: '#38bdf8', weight: 5, opacity: 0.8}).addTo(window.driverMap);
        }
    }

    window.activeFirebaseListener = db.ref('broadcasts/' + window.activeSessionId).on('value', async (snap) => {
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

        const truckIcon = typeof getTruckIcon === 'function' ? getTruckIcon(bearing) : L.divIcon({className: 'truck', html: '🚚'});
        const labelIcon = typeof getDriverLabelIcon === 'function' ? getDriverLabelIcon(data.driverName || 'Driver') : L.divIcon({className: 'label', html: data.driverName});

        if (window.driverMap && window.driverFollowTruck) {
            window.driverMap.panTo([lat, lng], { animate: true });
        }

        if (!window.driverMapMarker) {
            window.driverMapMarker = L.marker([lat, lng], {icon: truckIcon}).addTo(window.driverMap);
            window.driverMapLabelMarker = L.marker([lat, lng], {icon: labelIcon}).addTo(window.driverMap);
        } else {
            window.driverMapMarker.setLatLng([lat, lng]);
            window.driverMapMarker.setIcon(truckIcon);
            window.driverMapLabelMarker.setLatLng([lat, lng]);
        }

        if (window.routePolyline && fullRouteCoords.length > 0) {
            let closestIndex = 0;
            let minDistance = Infinity;
            
            for (let i = 0; i < fullRouteCoords.length; i++) {
                const pt = fullRouteCoords[i];
                const dist = Math.pow(pt[0] - lat, 2) + Math.pow(pt[1] - lng, 2);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestIndex = i;
                }
            }

            if (closestIndex > 0) {
                fullRouteCoords = fullRouteCoords.slice(closestIndex);
                window.routePolyline.setLatLngs(fullRouteCoords);
            }
        }
    });
}

function stopRealTimeTracking() {
    if (window.simulationInterval) clearInterval(window.simulationInterval);
    SafeStorage.removeItem('smd_active_broadcast');
}