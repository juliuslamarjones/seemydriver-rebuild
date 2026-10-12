// ==========================================================
// SEEMYDRIVER - GPS ENGINE + MAPS & TELEMETRY (TESTING MODE)
// ⚠️ REMINDER FOR GEORGE & JULIUS: 
// Before final production APK / release rollout, remember to:
//   1. Flip STRICT_PRODUCTION_GPS to true (sets accuracy gate to 100m).
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage;
const $ = (id) => document.getElementById(id);
const MPS_TO_MPH = 2.23694;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const getDb = () => window.db || (typeof db !== 'undefined' ? db : null);

// ---------- Broadcast Launch Handler (Zero Fallbacks) ----------
window.launchLiveBroadcast = function() {
    const driverName = document.getElementById('job-driver-name').value.trim();
    const driverPhone = document.getElementById('job-driver-phone').value.trim();
    const custName = document.getElementById('job-cust-name').value.trim();
    const custPhone = document.getElementById('job-cust-phone').value.trim();
    const address = document.getElementById('job-cust-address').value.trim();

    const destLat = parseFloat(LS.getItem('smd_dest_lat'));
    const destLng = parseFloat(LS.getItem('smd_dest_lng'));

    if (!driverName || !address) {
        alert('Please enter a driver name and destination address.');
        return;
    }

    if (isNaN(destLat) || isNaN(destLng) || (destLat === 0 && destLng === 0)) {
        alert('Please select a valid destination address from the autocomplete suggestions dropdown.');
        return;
    }

    LS.setItem('smd_driver_name', driverName);
    LS.setItem('smd_driver_phone', driverPhone);
    LS.setItem('smd_cust_name', custName);
    LS.setItem('smd_cust_phone', custPhone);
    LS.setItem('smd_cust_address', address);
    LS.setItem('smd_active_broadcast', 'true');

    const buffer = new Uint8Array(8);
    window.crypto.getRandomValues(buffer);
    window.activeSessionId = 'smd_' + Array.from(buffer, b => b.toString(16).padStart(2, '0')).join('');
    LS.setItem('smd_session_id', window.activeSessionId);

    const sid = sessionId();
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
            speed: 0,
            heading: 0,
            timestamp: Date.now()
        }).catch((err) => {
            console.error("Firebase broadcast initialization failed:", err);
        });
    }

    window.switchView('active-broadcast');
    if (typeof window.startRealTimeTracking === 'function') {
        window.startRealTimeTracking();
    }
};

let geocodeTimer = null;
window.handleAddressInput = async function(value) {
    window.cachedDestLat = null;
    window.cachedDestLng = null;
    LS.removeItem('smd_dest_lat');
    LS.removeItem('smd_dest_lng');
    
    const suggestions = document.getElementById('address-suggestions');
    if (!suggestions) return;

    clearTimeout(geocodeTimer);
    const query = value.trim();
    
    if (query.length < 3) {
        suggestions.classList.add('hidden');
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
        return;
    }

    geocodeTimer = setTimeout(async () => {
        try {
            const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
            const data = await res.json();
            suggestions.innerHTML = '';

            if (!data.features || data.features.length === 0) {
                suggestions.classList.add('hidden');
                suggestions.style.display = 'none';
                return;
            }

            data.features.forEach(f => {
                const props = f.properties || {};
                const nameParts = [props.name, props.street, props.housenumber, props.city, props.state, props.country].filter(Boolean);
                const name = Array.from(new Set(nameParts)).join(', ');
                const coords = f.geometry?.coordinates || [0, 0];

                const div = document.createElement('div');
                div.className = "px-4 py-3 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-amber-400 cursor-pointer border-b border-neutral-800/80 transition font-medium";
                div.innerText = name;
                div.onpointerdown = (e) => {
                    e.preventDefault();
                    document.getElementById('job-cust-address').value = name;
                    window.cachedDestLat = coords[1];
                    window.cachedDestLng = coords[0];
                    LS.setItem('smd_dest_lat', window.cachedDestLat);
                    LS.setItem('smd_dest_lng', window.cachedDestLng);
                    suggestions.classList.add('hidden');
                    suggestions.style.display = 'none';
                };
                suggestions.appendChild(div);
            });

            suggestions.classList.remove('hidden');
            suggestions.style.display = 'block';
        } catch (e) {
            console.error('Geocoder lookup error:', e);
        }
    }, 300);
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
    return (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) ? null : { lat, lng };
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
    last: null, lastAlive: 0, lastMoved: null, speedMps: 0, heading: 0,
    subs: new Set(), sent: { t: 0, lat: 0, lng: 0 }, stopTimer: null, denied: false, badSince: 0
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

const BAD_ACC_M = 500;          // Set to 500m for desktop/Wi-Fi testing (Will be tightened to 100m on production lock)
const BAD_ACC_GRACE_MS = 5000;  
const STALE_PREV_MS = 30000;    
const FRESH_MS = 10000;         
const isFresh = (fix, ms) => !!fix && (Date.now() - fix.t) < (ms || FRESH_MS);

function ingest(r) {
    gps.lastAlive = Date.now();
    if (!isFinite(r.lat) || !isFinite(r.lng)) return;
    const acc = isFinite(r.acc) ? r.acc : 999;

    if (acc > BAD_ACC_M) {
        if (!gps.badSince) gps.badSince = Date.now();
        if (Date.now() - gps.badSince < BAD_ACC_GRACE_MS) {
            setStatus('GPS: acquiring \u00B1' + Math.round(acc) + ' m', false);
            return;
        }
    } else {
        gps.badSince = 0;
    }

    let prev = gps.last;
    if (prev && r.t - prev.t > STALE_PREV_MS) { prev = null; gps.lastMoved = null; }
    let d = 0, dt = 1;

    if (prev) {
        if (r.t <= prev.t) return;
        dt = Math.max((r.t - prev.t) / 1000, 0.001);
        d = distM(prev.lat, prev.lng, r.lat, r.lng);
    }

    let v = (isFinite(r.speed) && r.speed >= 0) ? r.speed : (prev ? d / dt : 0);
    gps.speedMps = prev ? gps.speedMps * 0.5 + v * 0.5 : v;
    if (gps.speedMps < 0.8) gps.speedMps = 0;

    let lat = r.lat, lng = r.lng;
    if (prev && gps.speedMps === 0 && d < Math.max(4, acc * 0.6)) { lat = prev.lat; lng = prev.lng; }

    if (gps.speedMps >= 1.5) {
        let h = null;
        if (isFinite(r.heading)) { h = r.heading; gps.lastMoved = { lat, lng }; }
        else if (!gps.lastMoved) { gps.lastMoved = { lat, lng }; }
        else if (distM(gps.lastMoved.lat, gps.lastMoved.lng, lat, lng) >= 8) {
            h = bearingDeg(gps.lastMoved.lat, gps.lastMoved.lng, lat, lng);
            gps.lastMoved = { lat, lng };
        }
        if (h !== null) gps.heading = (gps.heading + angDelta(gps.heading, h) * 0.6 + 360) % 360;
    }

    const fix = { lat, lng, acc, speedMph: Math.round(gps.speedMps * MPS_TO_MPH), heading: gps.heading, t: r.t };
    gps.last = fix;
    window.lastLat = lat; window.lastLng = lng; window.lastHeading = fix.heading;

    setStatus('GPS \u00B1' + Math.round(acc) + ' m', true);
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
    if (!force && !(now - s.t >= 2000 || (now - s.t >= 1000 && moved >= 15))) return;
    gps.sent = { t: now, lat: fix.lat, lng: fix.lng };
    LS.setItem('smd_last_tx', String(now));
    
    database.ref('broadcasts/' + sid).update({
        lat: fix.lat,
        lng: fix.lng,
        speed: fix.speedMph,
        heading: Math.round(fix.heading),
        accuracy: Math.round(fix.acc),
        timestamp: now
    }).catch((err) => {
        console.error("Firebase telemetry update error:", err);
    });
}

function permissionDenied() {
    gps.denied = true;
    setStatus('GPS: permission denied', false);
    alert('Location permission is OFF for SeeMyDriver. Enable it in device settings.');
}

function startGps() {
    if (gps.running) return;
    gps.running = true; gps.denied = false; gps.lastAlive = Date.now(); gps.badSince = 0;
    const gen = ++gps.gen;
    const BG = plugin('BackgroundGeolocation');
    const NG = plugin('Geolocation');

    if (BG) {
        gps.kind = 'bg';
        BG.addWatcher({
            backgroundTitle: 'SeeMyDriver is live',
            backgroundMessage: 'Sharing your location with your customer.',
            requestPermissions: true, stale: false, distanceFilter: 0
        }, (loc, err) => {
            if (err) { console.error("BackgroundGeolocation error:", err); if (err.code === 'NOT_AUTHORIZED') permissionDenied(); return; }
            if (loc) ingest(fromBg(loc));
        }).then((id) => { if (gen === gps.gen) gps.handle = id; else BG.removeWatcher({ id }); }).catch((err) => { console.error("BG watcher failed:", err); });
    } else if (NG) {
        gps.kind = 'native';
        NG.watchPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, (pos, err) => {
            if (err) { console.error("Native Geolocation error:", err); if (err.code === 1 || /denied/i.test(err.message || '')) permissionDenied(); return; }
            if (pos) ingest(fromWeb(pos));
        }).then((id) => { if (gen === gps.gen) gps.handle = id; else NG.clearWatch({ id }); }).catch((err) => { console.error("Native watch failed:", err); });
    } else if (navigator.geolocation) {
        gps.kind = 'web';
        gps.handle = navigator.geolocation.watchPosition(
            (p) => ingest(fromWeb(p)),
            (e) => { console.error("Web Geolocation error:", e); if (e.code === 1) permissionDenied(); else setStatus('GPS: searching\u2026', false); },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
    } else {
        gps.running = false;
        setStatus('GPS: not supported', false);
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
function restartGps() { stopGps(); startGps(); }

setInterval(() => {
    if (gps.running && !gps.denied && Date.now() - gps.lastAlive > 15000) {
        setStatus('GPS: reconnecting\u2026', false);
        restartGps();
    }
}, 4000);

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

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (gps.running || broadcasting())) {
        if (broadcasting()) requestWake();
        if (gps.running) restartGps(); else if (broadcasting()) startGps();
    }
});
window.addEventListener('online', () => { if (isFresh(gps.last)) send(gps.last, true); });

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

window.getLivePosition = function () {
    const live = (f) => ({ lat: f.lat, lng: f.lng, speed: f.speedMph });
    return new Promise((resolve, reject) => {
        if (isFresh(gps.last, 5000)) return resolve(live(gps.last));
        let off = null;
        const timer = setTimeout(() => { if (off) off(); reject(new Error('GPS Hardware Lock Failed: no fix in 20s.')); }, 20000);
        off = subscribe((f) => { clearTimeout(timer); setTimeout(() => off && off(), 0); resolve(live(f)); }, false);
    });
};

window.startRealTimeTracking = async function () {
    requestWake();
    try { if (typeof startSilentAudio === 'function') startSilentAudio(); } catch (e) {}
    clearTimeout(gps.stopTimer);
    startGps();
    if (isFresh(gps.last)) send(gps.last, true);
};

window.stopRealTimeTracking = async function () {
    LS.removeItem('smd_active_broadcast');
    releaseWake();
    try { if (typeof stopSilentAudio === 'function') stopSilentAudio(); } catch (e) {}
    if (!gps.subs.size) stopGps();
};

function resetGpsState() {
    gps.last = null; gps.lastMoved = null; gps.speedMps = 0; gps.badSince = 0;
    gps.sent = { t: 0, lat: 0, lng: 0 };
}
window.teardownDriverMap = function() {
    teardownDriver();
    stopGps();
    resetGpsState();
};

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

function getDriverLabelIcon(name = 'Driver') {
    const safeName = String(name || 'Driver').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    return L.divIcon({
        className: 'custom-driver-label-marker',
        html: `<div style="transform: translate(-50%, -100%); font-size: 11px; font-weight: 900; color: #000; text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff; white-space: nowrap; letter-spacing: 0.08em; text-transform: uppercase;">${safeName}</div>`,
        iconSize: [0, 0], iconAnchor: [0, -25]
    });
}

function makeMover(marker, label, onFrame) {
    let cur = null, curH = 0, from, to, hFrom, hTo, t0 = 0, dur = 1, raf = 0, lastCall = 0;
    function frame() {
        const k = Math.max(0, Math.min(1, (performance.now() - t0) / dur));
        cur = { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
        curH = (hFrom + angDelta(hFrom, hTo) * k + 360) % 360;
        marker.setLatLng(cur);
        if (label) label.setLatLng(cur);
        const el = marker.getElement();
        if (el && el.firstElementChild) el.firstElementChild.style.transform = 'translate(-50%, -50%) rotate(' + curH + 'deg)';
        if (onFrame) onFrame(cur);
        raf = k < 1 ? requestAnimationFrame(frame) : 0;
    }
    return {
        moveTo(lat, lng, h) {
            const now = performance.now();
            cancelAnimationFrame(raf);
            if (!cur) { cur = { lat, lng }; curH = h; }
            from = cur; hFrom = curH; to = { lat, lng }; hTo = h; t0 = now;
            dur = lastCall ? Math.max(400, Math.min(1500, now - lastCall)) : 1;
            lastCall = now;
            frame();
        },
        pos: () => cur,
        stop() { cancelAnimationFrame(raf); }
    };
}

function pinIcon() {
    return L.divIcon({ className: 'custom-pin-marker', html: '<div style="font-size:28px;">\uD83D\uDCCD</div>', iconSize: [32, 32], iconAnchor: [16, 32] });
}

function makeMap(box, zoomControl) {
    const map = L.map(box, { zoomControl: zoomControl, zoomAnimation: true });
    L.tileLayer(TILE_URL, { 
        maxZoom: 19, 
        keepBuffer: 4, 
        updateWhenIdle: false, 
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' 
    }).addTo(map);
    [0, 250, 700].forEach((ms) => setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, ms));
    return map;
}

function routeManager(map, color) {
    let line = null, coords = [], lastFetch = 0, busy = false;
    async function fetchRoute(lat, lng, dLat, dLng) {
        const url = 'https://router.project-osrm.org/route/v1/driving/' + lng + ',' + lat + ';' + dLng + ',' + dLat + '?overview=full&geometries=geojson';
        const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
        try {
            const j = await (await fetch(url, { signal: ctl.signal })).json();
            if (j.code === 'Ok' && j.routes && j.routes[0]) {
                return { pts: j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]), dur: j.routes[0].duration, dist: j.routes[0].distance };
            }
        } catch (e) {} finally { clearTimeout(to); }
        return null;
    }
    function offRoute(lat, lng) {
        let best = Infinity;
        for (let i = 0; i < coords.length; i++) { const d = distM(lat, lng, coords[i][0], coords[i][1]); if (d < best) best = d; }
        return best > 80;
    }
    return {
        async update(lat, lng, dLat, dLng, force) {
            const now = Date.now();
            if (busy || now - lastFetch < (coords.length ? 8000 : 5000)) return null;
            if (coords.length && !force && now - lastFetch < 30000 && !offRoute(lat, lng)) return null;
            busy = true; lastFetch = now;
            const r = await fetchRoute(lat, lng, dLat, dLng);
            busy = false;
            if (r && r.pts.length > 1) {
                coords = r.pts;
                try { if (line) line.setLatLngs(r.pts); else line = L.polyline(r.pts, { color: color, weight: 6, opacity: 0.95, lineJoin: 'round' }).addTo(map); } catch (e) {}
                return r;
            }
            return null;
        }
    };
}

let D = null;
function teardownDriver() {
    if (!D) return;
    try { D.off(); } catch (e) {}
    try { D.mover && D.mover.stop(); } catch (e) {}
    try { D.map.remove(); } catch (e) {}
    document.querySelectorAll('.smd-gps-badge').forEach((b) => b.remove());
    D = null;
}

window.initDriverActiveMap = function () {
    const box = $('driver-map-container');
    if (!box || typeof L === 'undefined') return;
    teardownDriver();

    const map = makeMap(box, false);
    const host = box.parentElement;
    const badge = document.createElement('div');
    badge.className = 'smd-gps-badge';
    badge.style.cssText = 'position:absolute;top:12px;left:12px;z-index:20;background:rgba(0,0,0,.8);border:1px solid #262626;border-radius:10px;padding:4px 10px;font:700 11px ui-monospace,monospace;color:#fbbf24;pointer-events:none';
    badge.textContent = 'GPS: acquiring\u2026';
    host.appendChild(badge);

    D = { map: map, follow: true, mover: null, route: routeManager(map, '#1d4ed8'), viewSet: false, truck: null, label: null };
    const me = D;
    map.on('dragstart', () => { me.follow = false; });

    const dest = getDest();
    if (dest) {
        L.marker([dest.lat, dest.lng], { icon: pinIcon() }).addTo(map);
        map.setView([dest.lat, dest.lng], 13, { animate: false });
    }

    me.off = subscribe((fix) => {
        if (D !== me) return;
        if (!me.viewSet) {
            map.setView([fix.lat, fix.lng], 17, { animate: false });
            me.viewSet = true;
            me.truck = L.marker([fix.lat, fix.lng], { icon: getTruckIcon(fix.heading) }).addTo(map);
            me.label = L.marker([fix.lat, fix.lng], { icon: getDriverLabelIcon(LS.getItem('smd_driver_name') || 'Driver') }).addTo(map);
            me.mover = makeMover(me.truck, me.label, (p) => { if (me.follow) map.panTo([p.lat, p.lng], { animate: false }); });
        }
        me.mover.moveTo(fix.lat, fix.lng, fix.heading);
        const sp = $('driver-map-speed');
        if (sp) sp.textContent = fix.speedMph + ' mph';
        if (dest) me.route.update(fix.lat, fix.lng, dest.lat, dest.lng, false);
    });
};

window.recenterDriverMap = function () {
    if (!D || !D.mover || !D.mover.pos()) return;
    D.follow = true;
    const p = D.mover.pos();
    D.map.setView([p.lat, p.lng], Math.max(D.map.getZoom(), 16), { animate: false });
};
window.fitDriverMap = function () {
    if (!D || !D.mover || !D.mover.pos()) return;
    const p = D.mover.pos(), dest = getDest();
    D.follow = false;
    if (dest) D.map.fitBounds(L.latLngBounds([[p.lat, p.lng], [dest.lat, dest.lng]]), { padding: [60, 60], animate: false });
    else window.recenterDriverMap();
};
window.openDriverDirections = function () {
    const dest = getDest(), addr = LS.getItem('smd_cust_address') || '';
    if (dest) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + dest.lat + ',' + dest.lng, '_blank');
    else if (addr) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(addr), '_blank');
    else alert('No destination address set for directions.');
};

window.copyTrackingLink = async function () {
    const base = 'https://www.seemydriver.com';
    const u = window.activeTrackingUrl || (base + '/?view=customer&session=' + sessionId());
    try { await navigator.clipboard.writeText(u); }
    catch (e) {
        const t = document.createElement('textarea');
        t.value = u; t.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } catch (_) {}
        t.remove();
    }
    toast('Tracking link copied');
};
window.textTrackingLink = function () {
    const base = 'https://www.seemydriver.com';
    const u = window.activeTrackingUrl || (base + '/?view=customer&session=' + sessionId());
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
    } catch (e) {
        console.error("End broadcast error:", e);
    }
    await window.stopRealTimeTracking();
    teardownDriver();
    resetGpsState();
    LS.removeItem('smd_dest_lat'); 
    LS.removeItem('smd_dest_lng');
    LS.removeItem('smd_session_id');
    window.activeSessionId = undefined;
    window.cachedDestLat = undefined; 
    window.cachedDestLng = undefined;
    window.switchView('job-setup-view');
};

let C = null;
function teardownCustomer() {
    if (!C) return;
    try { C.ref.off('value', C.cb); } catch (e) {}
    clearInterval(C.staleTimer);
    try { C.mover && C.mover.stop(); } catch (e) {}
    try { C.map.remove(); } catch (e) {}
    C = null;
}

window.initCustomerMapLive = function () {
    const box = $('customer-map-container');
    if (!box || typeof L === 'undefined') return;
    teardownCustomer();

    const q = new URLSearchParams(window.location.search);
    const sid = q.get('session') || q.get('s');
    const head = $('cust-driver-header'), sub = $('cust-eta-sub'), pill =$('cust-status-pill'), distEl = $('cust-distance'), speedEl =$('cust-speed');
    if (!sid) { if (head) head.textContent = 'Invalid tracking link'; return; }

    const database = getDb();
    if (!database) return;

    const map = makeMap(box, true);
    const me = C = { map: map, follow: true, mover: null, truck: null, label: null, destMarker: null, destKey: '', fitted: false,
        route: routeManager(map, '#1e3a8a'), lastChange: Date.now(), lastTs: 0, etaMin: null, roadMi: null, speed: 0, ended: false, waiting: true };
    map.on('dragstart', () => { me.follow = false; });

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
            me.waiting = true;
            if (head) head.textContent = 'Waiting for driver\u2026';
            setPill('\u25CF Waiting', false);
            return;
        }

        if (data.timestamp !== me.lastTs) { me.lastTs = data.timestamp; me.lastChange = Date.now(); }
        if (data.ended) {
            me.ended = true; me.waiting = false;
            if (head) head.textContent = (data.driverName || 'Driver') + ' \u2014 trip ended';
            setPill('\u25CF Trip ended', false);
            return;
        }

        const lat = parseFloat(data.lat), lng = parseFloat(data.lng);
        const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
        const heading = isFinite(parseFloat(data.heading)) ? parseFloat(data.heading) : 0;
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
        if (haveDest) {
            const key = dLat + ',' + dLng;
            if (key !== me.destKey) {
                me.destKey = key;
                if (me.destMarker) me.destMarker.setLatLng([dLat, dLng]);
                else {
                    me.destMarker = L.marker([dLat, dLng], { icon: pinIcon() }).addTo(map);
                    if (!me.truck) map.setView([dLat, dLng], 13, { animate: false });
                }
            }
        }

        const havePos = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
        if (!havePos) {
            me.waiting = true;
            setPill('\u25CF Waiting for driver GPS\u2026', false);
            if (sub) sub.textContent = '-- mins';
            if (distEl) distEl.textContent = '-- mi';
            return;
        }
        me.waiting = false;

        me.speed = Math.round(data.speed || 0);
        setPill('\u25CF Connected', true);
        if (speedEl) speedEl.textContent = me.speed + ' mph';

        if (!me.truck) {
            map.setView([lat, lng], 16, { animate: false });
            me.truck = L.marker([lat, lng], { icon: getTruckIcon(heading) }).addTo(map);
            me.label = L.marker([lat, lng], { icon: getDriverLabelIcon(name) }).addTo(map);
            me.mover = makeMover(me.truck, me.label, (p) => { if (me.follow && me.fitted) map.panTo([p.lat, p.lng], { animate: false }); });
        }
        me.mover.moveTo(lat, lng, heading);

        if (haveDest) {
            if (!me.fitted) { me.fitted = true; map.fitBounds(L.latLngBounds([[lat, lng], [dLat, dLng]]), { padding: [60, 60], animate: false }); me.follow = false; }
            me.route.update(lat, lng, dLat, dLng, false).then((r) => {
                if (r && C === me) {
                    me.etaMin = Math.max(1, Math.round(r.dur / 60));
                    me.roadMi = r.dist / 1609.34;
                    if (sub) sub.textContent = me.etaMin + ' mins';
                    if (distEl) distEl.textContent = me.roadMi.toFixed(1) + ' mi';
                }
            });
        } else {
            me.fitted = true;
        }
    });

    me.staleTimer = setInterval(() => {
        if (!C || C.ended || me.waiting) return;
        if (Date.now() - me.lastChange > 20000) setPill('\u25CF Signal lost \u2014 reconnecting', false);
    }, 3000);
};

window.recenterCustomerMap = function () {
    if (!C || !C.mover || !C.mover.pos()) return;
    C.follow = true; C.fitted = true;
    const p = C.mover.pos();
    C.map.setView([p.lat, p.lng], Math.max(C.map.getZoom(), 16), { animate: false });
};
window.fitCustomerMap = function () {
    if (!C || !C.mover || !C.mover.pos() || !C.destMarker) return window.recenterCustomerMap();
    const p = C.mover.pos(), d = C.destMarker.getLatLng();
    C.follow = false;
    C.map.fitBounds(L.latLngBounds([[p.lat, p.lng], [d.lat, d.lng]]), { padding: [60, 60], animate: false });
};

document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    if (!q.has('session') && !q.has('s') && q.get('view') !== 'customer' && broadcasting()) {
        const last = parseInt(LS.getItem('smd_last_tx') || '0', 10);
        if (sessionId() && Date.now() - last < 6 * 3600 * 1000) {
            window.switchView('active-broadcast');
            window.startRealTimeTracking();
        } else {
            LS.removeItem('smd_active_broadcast');
        }
    }
});

})();