// ==========================================
// SEEMYDRIVER - PURE REAL-WORLD TRACKER ENGINE
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

// --- AUTOCOMPLETE ADDRESS GEOCODER LISTENER ---
document.addEventListener('DOMContentLoaded', () => {
    const addressInput = document.getElementById('job-cust-address');
    const dropdown = document.getElementById('address-dropdown');

    if (!addressInput || !dropdown) return;

    let debounceTimer = null;

    addressInput.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (query.length < 3) {
            dropdown.classList.add('hidden');
            dropdown.innerHTML = '';
            return;
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            try {
                const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
                const data = await res.json();
                
                dropdown.innerHTML = '';
                if (data.features && data.features.length > 0) {
                    data.features.forEach(feature => {
                        const props = feature.properties;
                        const coords = feature.geometry.coordinates; // [lng, lat]
                        const name = props.name || '';
                        const street = props.street || name;
                        const city = props.city || props.county || '';
                        const state = props.state || '';
                        const displayText = [street, city, state].filter(Boolean).join(', ');

                        const item = document.createElement('div');
                        item.className = 'px-3.5 py-2.5 text-xs text-neutral-300 hover:bg-amber-400 hover:text-black cursor-pointer border-b border-neutral-800/50 transition';
                        item.innerText = displayText;

                        item.addEventListener('click', () => {
                            addressInput.value = displayText;
                            window.cachedDestLng = coords[0];
                            window.cachedDestLat = coords[1];
                            SafeStorage.setItem('smd_dest_lat', coords[1]);
                            SafeStorage.setItem('smd_dest_lng', coords[0]);
                            dropdown.classList.add('hidden');
                            dropdown.innerHTML = '';
                        });

                        dropdown.appendChild(item);
                    });
                    dropdown.classList.remove('hidden');
                } else {
                    dropdown.classList.add('hidden');
                }
            } catch (err) {
                console.warn("Geocoding lookup failed:", err);
            }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!addressInput.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
});

// --- TRUCK & LABEL ICON HELPERS ---
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

// --- ACTIVE MAP & REAL-WORLD TRACKING LOOP ---
async function initDriverActiveMap() {
    const container = document.getElementById('driver-map-container');
    if (!container) return;
    container.style.height = '288px';

    if (window.driverMap) { window.driverMap.remove(); window.driverMap = null; window.routePolyline = null; window.driverMapMarker = null; }
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
    const initialSnap = await db.ref('broadcasts/' + window.activeSessionId).once('value');
    const initData = initialSnap.val() || { lat: 29.9902, lng: -95.2636 };

    if (destLat && destLng) {
        fullRouteCoords = await fetchDynamicRoute(initData.lat, initData.lng, destLat, destLng);
        window.routePolyline = L.polyline(fullRouteCoords, {color: '#38bdf8', weight: 5, opacity: 0.8}).addTo(window.driverMap);
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

        const truckIcon = getTruckIcon(bearing);
        const labelIcon = getDriverLabelIcon(data.driverName || 'Driver');

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
    SafeStorage.removeItem('smd_active_broadcast');
}