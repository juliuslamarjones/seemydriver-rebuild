// ==========================================================
// SEEMYDRIVER - MAPBOX GL JS GPS ENGINE & TELEMETRY (PRODUCTION)
// - Mapbox Light Style (`light-v11`) Active
// ==========================================================
(function () {
'use strict';

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.wq8EANp8vooYz3gE2o4Krg';
if (typeof mapboxgl !== 'undefined') {
    mapboxgl.accessToken = MAPBOX_TOKEN;
}

const LS = window.SafeStorage || {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k)
};
const $ = (id) => document.getElementById(id);
const MPS_TO_MPH = 2.23694;

const getDb = () => window.db || (typeof db !== 'undefined' ? db : null);

async function resolveAddressToCoords(addrQuery) {
    try {
        const res = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(addrQuery) + '&limit=1');
        const data = await res.json();
        if (data.features && data.features.length > 0) {
            const coords = data.features[0].geometry.coordinates; // [lng, lat]
            return { lat: coords[1], lng: coords[0] };
        }
    } catch (e) {
        console.error('Smart geocode fallback error:', e);
    }
    return null;
}

window.launchLiveBroadcast = async function () {
    const driverName = $('job-driver-name').value.trim();
    const driverPhone = $('job-driver-phone').value.trim();
    const custName = $('job-cust-name').value.trim();
    const custPhone = $('job-cust-phone').value.trim();
    const address = $('job-cust-address').value.trim();

    if (!driverName || !address) {
        alert('Please enter a driver name and destination address.');
        return;
    }

    const suggestions = $('address-suggestions');
    if (suggestions) { suggestions.classList.add('hidden'); suggestions.style.display = 'none'; }

    let destLat = 29.9902; 
    let destLng = -95.2636;

    const resolved = await resolveAddressToCoords(address);
    if (resolved) {
        destLat = resolved.lat;
        destLng = resolved.lng;
    }

    LS.setItem('smd_dest_lat', destLat);
    LS.setItem('smd_dest_lng', destLng);
    LS.setItem('smd_driver_name', driverName);
    LS.setItem('smd_driver_phone', driverPhone);
    LS.setItem('smd_cust_name', custName);
    LS.setItem('smd_cust_phone', custPhone);
    LS.setItem('smd_cust_address', address);
    LS.setItem('smd_active_broadcast', 'true');
    LS.setItem('smd_last_tx', String(Date.now()));

    const buffer = new Uint8Array(8);
    window.crypto.getRandomValues(buffer);
    window.activeSessionId = 'smd_' + Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
    LS.setItem('smd_session_id', window.activeSessionId);

    const sid = window.activeSessionId;
    const database = getDb();

    if (database) {
        database.ref('broadcasts/' + sid).set({
            driverName: driverName,
            driverPhone: driverPhone,
            lat: null,
            lng: null,
            destLat: destLat,
            destLng: destLng,
            destAddress: address,
            brandKey: LS.getItem('smd_brand_key') || '',
            speed: 0,
            heading: 0,
            timestamp: Date.now()
        }).catch((err) => {
            console.error('Firebase broadcast initialization failed:', err);
        });
    }

    window.switchView('active-broadcast');
    if (typeof window.startRealTimeTracking === 'function') {
        window.startRealTimeTracking();
    }
};

window.handleAddressInput = function (value) {
    const suggestions = $('address-suggestions');
    if (suggestions) {
        suggestions.classList.add('hidden');
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
    }
};

function distM(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180, R = 6371000;
    const dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function bearingDeg(lat1, lng1, lat2, lng2) {
    const r = Math.PI / 180;
    const y = Math.sin((lng2 - lng1) * r) * Math.cos(lat2 * r);
    const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
}
const angDelta = (from, to) => ((to - from + 540) % 360) - 180;
const broadcasting = () => LS.getItem('smd_active_broadcast') === 'true';
const sessionId = () => window.activeSessionId || LS.getItem('smd_session_id');

function getDest() {
    const lat = parseFloat(LS.getItem('smd_dest_lat')), lng = parseFloat(LS.getItem('smd_dest_lng'));
    return (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) ? null : { lat: lat, lng: lng };
}

function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#fbbf24;color:#000;font:700 12px sans-serif;padding:10px 16px;border-radius:12px;z-index:99999';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
}

const gps = {
    running: false, kind: null, handle: null, gen: 0,
    last: null, lastAlive: 0, speedMps: 0, heading: 0,
    subs: new Set(), sent: { t: 0, lat: 0, lng: 0 }, stopTimer: null, denied: false, restarts: 0
};
window.__smdGps = gps;

function plugin(name) {
    try {
        const C = window.Capacitor;
        if (C && C.isNativePlatform && C.isNativePlatform() && C.isPluginAvailable && C.isPluginAvailable(name)) {
            return C.registerPlugin(name);
        }
    } catch (e) {}
    return null;
}

function setStatus(text, ok) {
    document.querySelectorAll('.smd-gps-badge').forEach((el) => { el.textContent = text; el.style.color = ok ? '#fbbf24' : '#f87171'; });
}

const fromWeb = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, t: p.timestamp || Date.now() });
const fromBg = (l) => ({ lat: l.latitude, lng: l.longitude, acc: l.accuracy, speed: l.speed, heading: l.bearing, t: l.time || Date.now() });

const STALE_PREV_MS = 30000;
const FRESH_MS = 10000;
const isFresh = (fix, ms) => !!fix && (Date.now() - fix.t) < (ms || FRESH_MS);

function ingest(r) {
    gps.lastAlive = Date.now();
    gps.restarts = 0;
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return;
    const acc = Number.isFinite(r.acc) ? r.acc : 999;

    let prev = gps.last;
    if (prev && r.t - prev.t > STALE_PREV_MS) { prev = null; }
    let d = 0, dt = 1;

    if (prev) {
        if (r.t <= prev.t) return;
        dt = Math.max((r.t - prev.t) / 1000, 0.001);
        d = distM(prev.lat, prev.lng, r.lat, r.lng);
    }

    const hasSpeed = Number.isFinite(r.speed) && r.speed >= 0;
    let v = hasSpeed ? r.speed : (prev ? d / dt : 0);
    gps.speedMps = prev ? gps.speedMps * 0.3 + v * 0.7 : v;
    if (gps.speedMps < 0.5) gps.speedMps = 0;

    let lat = r.lat, lng = r.lng;
    let h = gps.heading;
    if (gps.speedMps >= 1.0) {
        if (Number.isFinite(r.heading) && r.heading >= 0) {
            h = r.heading;
        } else if (prev && d >= 3) {
            h = bearingDeg(prev.lat, prev.lng, lat, lng);
        }
        gps.heading = (gps.heading + angDelta(gps.heading, h) * 0.8 + 360) % 360;
    }

    const fix = { lat: lat, lng: lng, acc: acc, speedMph: Math.round(gps.speedMps * MPS_TO_MPH), heading: gps.heading, t: r.t };
    gps.last = fix;
    window.lastLat = lat; window.lastLng = lng; window.lastHeading = fix.heading;

    setStatus('GPS ±' + Math.round(acc) + ' m', true);
    gps.subs.forEach((fn) => { try { fn(fix); } catch (e) {} });
    send(fix, false);
}

function send(fix, force) {
    const database = getDb();
    if (!fix || !broadcasting() || !database) return;
    const sid = sessionId();
    if (!sid) return;
    const now = Date.now(), s = gps.sent;
    const moved = distM(s.lat, s.lng, fix.lat, fix.lng);
    if (!force && !(now - s.t >= 2000 || (now - s.t >= 1000 && moved >= 10))) return;
    gps.sent = { t: now, lat: fix.lat, lng: fix.lng };
    LS.setItem('smd_last_tx', String(now));

    database.ref('broadcasts/' + sid).update({
        lat: fix.lat,
        lng: fix.lng,
        speed: fix.speedMph,
        heading: Math.round(fix.heading),
        accuracy: Math.round(fix.acc),
        timestamp: now
    }).catch(() => {});
}

function startGps() {
    if (gps.running) return;
    gps.running = true; gps.denied = false; gps.lastAlive = Date.now();
    const gen = ++gps.gen;
    const BG = plugin('BackgroundGeolocation');
    const NG = plugin('Geolocation');

    if (BG) {
        gps.kind = 'bg';
        BG.addWatcher({ requestPermissions: true, stale: false, distanceFilter: 0 }, (loc, err) => {
            if (err) return;
            if (loc) ingest(fromBg(loc));
        }).then((id) => { if (gen === gps.gen) gps.handle = id; });
    } else if (NG) {
        gps.kind = 'native';
        NG.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (pos, err) => {
            if (err) return;
            if (pos) ingest(fromWeb(pos));
        }).then((id) => { if (gen === gps.gen) gps.handle = id; });
    } else if (navigator.geolocation) {
        gps.kind = 'web';
        gps.handle = navigator.geolocation.watchPosition(
            (p) => ingest(fromWeb(p)),
            (e) => setStatus('GPS: searching…', false),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    }
}

function stopGps() {
    const kind = gps.kind, h = gps.handle;
    gps.running = false; gps.gen++; gps.handle = null; gps.kind = null;
    try {
        if (h === null || h === undefined) return;
        if (kind === 'web') navigator.geolocation.clearWatch(h);
        else if (kind === 'native') plugin('Geolocation').clearWatch({ id: h });
        else if (kind === 'bg') plugin('BackgroundGeolocation').removeWatcher({ id: h });
    } catch (e) {}
}

let wl = null;
async function requestWake() {
    try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wl) {
            wl = await navigator.wakeLock.request('screen');
            wl.addEventListener('release', () => { wl = null; });
        }
    } catch (e) {}
}
function releaseWake() { try { if (wl) wl.release(); } catch (e) {} wl = null; }

window.startRealTimeTracking = async function () {
    requestWake();
    startGps();
    if (isFresh(gps.last)) send(gps.last, true);
};

window.stopRealTimeTracking = async function () {
    LS.removeItem('smd_active_broadcast');
    releaseWake();
    if (!gps.subs.size) stopGps();
};

window.teardownDriverMap = function () {
    teardownDriver();
    stopGps();
};

function subscribe(fn, replay) {
    clearTimeout(gps.stopTimer);
    gps.subs.add(fn);
    startGps();
    if (replay !== false && isFresh(gps.last)) fn(gps.last);
    return () => {
        gps.subs.delete(fn);
        if (!gps.subs.size && !broadcasting()) {
            gps.stopTimer = setTimeout(() => { if (!gps.subs.size && !broadcasting()) stopGps(); }, 10000);
        }
    };
}

// Helper for Custom SVG Truck Marker
function getTruckElement(bearing) {
    bearing = bearing || 0;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'transform: rotate(' + bearing + 'deg); transform-origin: 50% 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 6px 10px rgba(0,0,0,0.7));';
    wrap.innerHTML = '<svg viewBox="0 0 24 36" width="30" height="45" fill="none" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="1.5" y="9" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>' +
        '<rect x="19" y="9" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>' +
        '<rect x="1.5" y="25" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>' +
        '<rect x="19" y="25" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/>' +
        '<rect x="4" y="12" width="16" height="21" rx="2.5" fill="#0b0f19" stroke="#374151" stroke-width="1.5"/>' +
        '<rect x="4" y="21" width="16" height="3.5" fill="#f59e0b"/>' +
        '<line x1="4" y1="22.75" x2="20" y2="22.75" stroke="#ffffff" stroke-width="0.75" opacity="0.8"/>' +
        '<path d="M6 12H18V5.5C18 3.84315 16.6569 2.5 15 2.5H9C7.34315 2.5 6 3.84315 6 5.5V12Z" fill="#111827" stroke="#4b5563" stroke-width="1.5"/>' +
        '<path d="M7.5 8H16.5L15.5 4.5H8.5L7.5 8Z" fill="#38bdf8" fill-opacity="0.9" stroke="#bae6fd" stroke-width="0.5"/>' +
        '<line x1="9" y1="6" x2="15" y2="6" stroke="#ffffff" stroke-width="0.75" opacity="0.6"/>' +
        '<circle cx="7" cy="3.5" r="1.1" fill="#fbbf24"/>' +
        '<circle cx="17" cy="3.5" r="1.1" fill="#fbbf24"/>' +
        '<circle cx="7" cy="3.5" r="0.5" fill="#ffffff"/>' +
        '<circle cx="17" cy="3.5" r="0.5" fill="#ffffff"/>' +
        '</svg>';
    return wrap;
}

// OSRM Route Manager for Mapbox
function mapboxRouteManager(map, lineColor) {
    let currentRouteId = null;

    async function fetchRoute(lat, lng, dLat, dLng) {
        const base = 'https://router.project-osrm.org/route/v1/driving/' + lng + ',' + lat + ';' + dLng + ',' + dLat + '?overview=full&geometries=geojson';
        try {
            const res = await fetch(base);
            const data = await res.json();
            if (data.code === 'Ok' && data.routes && data.routes[0]) {
                return data.routes[0].geometry.coordinates; // [[lng, lat], ...]
            }
        } catch (e) {}
        return null;
    }

    return {
        async update(lat, lng, dLat, dLng) {
            const coords = await fetchRoute(lat, lng, dLat, dLng);
            if (!coords || coords.length < 2) return;

            const sourceId = 'route-source-' + Math.random();
            const layerId = 'route-layer-' + Math.random();

            if (currentRouteId && map.getLayer(currentRouteId + '-layer')) {
                map.removeLayer(currentRouteId + '-layer');
                map.removeSource(currentRouteId);
            }
            currentRouteId = sourceId;

            try {
                map.addSource(sourceId, {
                    type: 'geojson',
                    data: {
                        type: 'Feature',
                        properties: {},
                        geometry: { type: 'LineString', coordinates: coords }
                    }
                });
                map.addLayer({
                    id: layerId,
                    type: 'line',
                    source: sourceId,
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': lineColor || '#2563eb', 'line-width': 6, 'line-opacity': 0.9 }
                });
            } catch (e) {}
        }
    };
}

// ==========================================================
// MAPBOX MAP CONTROLLER (DRIVER & CUSTOMER) - LIGHT STYLE
// ==========================================================
let D = null;
function teardownDriver() {
    if (!D) return;
    try { D.off(); } catch (e) {}
    try { D.map.remove(); } catch (e) {}
    document.querySelectorAll('.smd-gps-badge').forEach((b) => b.remove());
    D = null;
}

window.initDriverActiveMap = function () {
    const box = $('driver-map-container');
    if (!box || typeof mapboxgl === 'undefined') return;
    teardownDriver();

    const map = new mapboxgl.Map({
        container: 'driver-map-container',
        style: 'mapbox://styles/mapbox/light-v11', // Light Map Background
        center: [-95.2636, 29.9902],
        zoom: 15
    });

    const host = box.parentElement;
    const badge = document.createElement('div');
    badge.className = 'smd-gps-badge';
    badge.style.cssText = 'position:absolute;top:12px;left:12px;z-index:20;background:rgba(255,255,255,.9);border:1px solid #d1d5db;border-radius:10px;padding:4px 10px;font:700 11px ui-monospace,monospace;color:#b45309;pointer-events:none;box-shadow:0 2px 4px rgba(0,0,0,0.1)';
    badge.textContent = 'GPS: acquiring…';
    host.appendChild(badge);

    D = { map: map, follow: true, marker: null, destMarker: null, viewSet: false, route: mapboxRouteManager(map, '#2563eb') };
    const me = D;

    map.on('dragstart', () => { me.follow = false; });

    const dest = getDest();
    if (dest) {
        const el = document.createElement('div');
        el.innerHTML = '<div style="font-size:28px;">📍</div>';
        me.destMarker = new mapboxgl.Marker(el).setLngLat([dest.lng, dest.lat]).addTo(map);
    }

    me.off = subscribe((fix) => {
        if (D !== me) return;
        const lat = fix.lat, lng = fix.lng, heading = fix.heading;

        if (dest) {
            me.route.update(lat, lng, dest.lat, dest.lng);
        }

        if (!me.marker) {
            const truckEl = getTruckElement(heading);
            me.marker = new mapboxgl.Marker(truckEl).setLngLat([lng, lat]).addTo(map);
            map.setCenter([lng, lat]);
            map.setZoom(17);
            me.viewSet = true;
        } else {
            me.marker.setLngLat([lng, lat]);
            const el = me.marker.getElement();
            if (el && el.firstElementChild) {
                el.firstElementChild.style.transform = 'rotate(' + (heading || 0) + 'deg)';
            }
            if (me.follow) {
                map.panTo([lng, lat], { animate: false });
            }
        }

        const sp = $('driver-map-speed');
        if (sp) sp.textContent = fix.speedMph + ' mph';
    });
};

window.recenterDriverMap = function () {
    if (!D || !D.marker) return;
    D.follow = true;
    const pos = D.marker.getLngLat();
    D.map.flyTo({ center: [pos.lng, pos.lat], zoom: 17 });
};

window.fitDriverMap = function () {
    if (!D || !D.marker || !D.destMarker) return window.recenterDriverMap();
    D.follow = false;
    const p1 = D.marker.getLngLat(), p2 = D.destMarker.getLngLat();
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([p1.lng, p1.lat]);
    bounds.extend([p2.lng, p2.lat]);
    D.map.fitBounds(bounds, { padding: 60 });
};

window.openDriverDirections = function () {
    const dest = getDest(), addr = LS.getItem('smd_cust_address') || '';
    if (dest) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + dest.lat + ',' + dest.lng, '_blank');
    else if (addr) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(addr), '_blank');
    else alert('No destination address set for directions.');
};

function trackingUrl() {
    const base = 'https://www.seemydriver.com';
    const bk = LS.getItem('smd_brand_key');
    let u = window.activeTrackingUrl || (base + '/?view=customer&session=' + sessionId());
    if (bk && u.indexOf('brand=') === -1) u += (u.indexOf('?') === -1 ? '?' : '&') + 'brand=' + encodeURIComponent(bk);
    return u;
}

window.copyTrackingLink = async function () {
    const u = trackingUrl();
    try { await navigator.clipboard.writeText(u); } catch (e) {}
    toast('Tracking link copied');
};

window.textTrackingLink = function () {
    const u = trackingUrl();
    const phone = (LS.getItem('smd_cust_phone') || '').replace(/[^\d+]/g, '');
    const name = LS.getItem('smd_driver_name') || 'Your driver';
    window.location.href = 'sms:' + phone + '?body=' + encodeURIComponent(name + ' is on the way. Track live: ' + u);
};

window.endBroadcastAndHome = async function () {
    if (!confirm('End this broadcast? Your customer will stop seeing your location.')) return;
    const sid = sessionId();
    const database = getDb();
    try {
        if (sid && database) {
            await database.ref('broadcasts/' + sid).update({ ended: true, timestamp: Date.now() });
        }
    } catch (e) {}
    await window.stopRealTimeTracking();
    teardownDriver();
    LS.removeItem('smd_dest_lat');
    LS.removeItem('smd_dest_lng');
    LS.removeItem('smd_session_id');
    window.activeSessionId = undefined;
    window.switchView('job-setup-view');
};

// ==========================================================
// CUSTOMER MAP (MAPBOX LIVE TRACKING) - LIGHT STYLE
// ==========================================================
let C = null;
function teardownCustomer() {
    if (!C) return;
    try { C.ref.off('value', C.cb); } catch (e) {}
    try { C.map.remove(); } catch (e) {}
    C = null;
}

window.initCustomerMapLive = function () {
    const box = $('customer-map-container');
    if (!box || typeof mapboxgl === 'undefined') return;
    teardownCustomer();

    const q = new URLSearchParams(window.location.search);
    const sid = q.get('session') || q.get('s');
    const head = $('cust-driver-header'), sub = $('cust-eta-sub'), pill =$('cust-status-pill'), distEl = $('cust-distance'), speedEl =$('cust-speed');
    if (!sid) { if (head) head.textContent = 'Invalid tracking link'; return; }

    const database = getDb();
    if (!database) return;

    const map = new mapboxgl.Map({
        container: 'customer-map-container',
        style: 'mapbox://styles/mapbox/light-v11', // Light Map Background
        center: [-95.2636, 29.9902],
        zoom: 15
    });

    const me = C = { map: map, follow: true, marker: null, destMarker: null, fitted: false, route: mapboxRouteManager(map, '#1e3a8a') };

    const setPill = (txt, good) => {
        if (!pill) return;
        pill.textContent = txt;
        pill.className = good
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-3 py-1 rounded-full'
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold px-3 py-1 rounded-full';
    };

    me.ref = database.ref('broadcasts/' + sid);
    me.cb = me.ref.on('value', (snap) => {
        if (C !== me) return;
        const data = snap.val();
        if (!data) {
            if (head) head.textContent = 'Waiting for driver…';
            setPill('● Waiting', false);
            return;
        }

        if (data.ended) {
            if (head) head.textContent = (data.driverName || 'Driver') + ' — trip ended';
            setPill('● Trip ended', false);
            return;
        }

        let lat = parseFloat(data.lat), lng = parseFloat(data.lng);
        const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
        const heading = parseFloat(data.heading) || 0;
        const name = data.driverName || 'Driver';
        if (head) head.textContent = name;

        const destAddrEl = $('cust-dest-address');
        if (destAddrEl && data.destAddress) destAddrEl.textContent = data.destAddress;

        const phoneDigits = data.driverPhone ? String(data.driverPhone).replace(/[^\d+]/g, '') : '';
        if (phoneDigits) {
            const callBtn = $('cust-call-btn'), msgBtn =$('cust-msg-btn');
            if (callBtn) callBtn.href = 'tel:' + phoneDigits;
            if (msgBtn) msgBtn.href = 'sms:' + phoneDigits;
        }

        const haveDest = !isNaN(dLat) && !isNaN(dLng) && (dLat !== 0 || dLng !== 0);
        if (haveDest && !me.destMarker) {
            const el = document.createElement('div');
            el.innerHTML = '<div style="font-size:28px;">📍</div>';
            me.destMarker = new mapboxgl.Marker(el).setLngLat([dLng, dLat]).addTo(map);
        }

        const havePos = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
        if (!havePos) {
            setPill('● Waiting for driver GPS…', false);
            return;
        }

        setPill('● Connected', true);
        const speedMph = Math.round(data.speed || 0);
        if (speedEl) speedEl.textContent = speedMph + ' mph';

        if (haveDest) {
            me.route.update(lat, lng, dLat, dLng);
        }

        if (!me.marker) {
            const truckEl = getTruckElement(heading);
            me.marker = new mapboxgl.Marker(truckEl).setLngLat([lng, lat]).addTo(map);
            map.setCenter([lng, lat]);
            map.setZoom(16);
        } else {
            me.marker.setLngLat([lng, lat]);
            const el = me.marker.getElement();
            if (el && el.firstElementChild) {
                el.firstElementChild.style.transform = 'rotate(' + heading + 'deg)';
            }
            if (me.follow && me.fitted) {
                map.panTo([lng, lat], { animate: false });
            }
        }

        if (haveDest && !me.fitted) {
            me.fitted = true;
            const bounds = new mapboxgl.LngLatBounds();
            bounds.extend([lng, lat]);
            bounds.extend([dLng, dLat]);
            map.fitBounds(bounds, { padding: 60 });
            me.follow = false;
        }
    });
};

window.recenterCustomerMap = function () {
    if (!C || !C.marker) return;
    C.follow = true; C.fitted = true;
    const pos = C.marker.getLngLat();
    C.map.flyTo({ center: [pos.lng, pos.lat], zoom: 16 });
};

window.fitCustomerMap = function () {
    if (!C || !C.marker || !C.destMarker) return window.recenterCustomerMap();
    C.follow = false;
    const p1 = C.marker.getLngLat(), p2 = C.destMarker.getLngLat();
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([p1.lng, p1.lat]);
    bounds.extend([p2.lng, p2.lat]);
    C.map.fitBounds(bounds, { padding: 60 });
};

})();