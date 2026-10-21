// ==========================================================
// SEEMYDRIVER - GPS ENGINE + MAPS & TELEMETRY (PRODUCTION MASTER)
// v14: persistent broadcast hold, non-navigating SMS trigger, clean boot
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage;
const $ = (id) => document.getElementById(id);
const MPS_TO_MPH = 2.23694;
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Mapbox public token for house-number address search
const MAPBOX_TOKEN = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.wq8EANp8vooYz3gE2o4Krg';

const getDb = () => window.db || (typeof db !== 'undefined' ? db : null);

// Helper for formatted ETA (handles hours and minutes cleanly)
function formatEta(seconds) {
    const totalMins = Math.max(1, Math.round(seconds / 60));
    if (totalMins < 60) {
        return totalMins + ' mins';
    }
    const hrs = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return mins > 0 ? `${hrs} hr ${mins} mins` : `${hrs} hr`;
}

// The truck artwork has its FRONT (cab + headlights) at the TOP, which matches heading 0 = north.
const TRUCK_ICON_OFFSET_DEG = 0;

// ---------- Broadcast Launch Handler ----------
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
    LS.setItem('smd_started_at', String(Date.now()));

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
            const prox = (gps.last && isFinite(gps.last.lat)) ? '&proximity=' + gps.last.lng + ',' + gps.last.lat : '';
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&types=address,poi&limit=5${prox}`);
            const data = await res.json();
            suggestions.innerHTML = '';

            if (!data.features || data.features.length === 0) {
                suggestions.classList.add('hidden');
                suggestions.style.display = 'none';
                return;
            }

            data.features.forEach(f => {
                const name = f.place_name || f.text || '';
                const coords = f.center || (f.geometry && f.geometry.coordinates) || [0, 0];

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
            console.error('Mapbox geocoder lookup error:', e);
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

const STALE_PREV_MS = 30000;     
const FRESH_MS = 10000;          
const isFresh = (fix, ms) => !!fix && (Date.now() - fix.t) < (ms || FRESH_MS);

const COAST_AFTER_MS = 3000;   
const COAST_MAX_S    = 60;     
const COAST_FACTOR   = 0.85;   
const COAST_MIN_MPS  = 1.5;    

const FOLLOW_TAU  = 1.4;       
const CATCHUP_MAX = 30;        
const LATERAL_TAU = 1.0;       

function ingest(r) {
    gps.lastAlive = Date.now();
    if (!isFinite(r.lat) || !isFinite(r.lng)) return;
    const acc = isFinite(r.acc) ? r.acc : 999;

    if (acc > 100) {
        const haveRecent = gps.last && (Date.now() - gps.last.t) < 120000;
        if (haveRecent) {
            setStatus('GPS: weak signal \u00B1' + Math.round(acc) + ' m', false);
            return;
        }
        if (acc > 300) {
            setStatus('GPS: acquiring \u00B1' + Math.round(acc) + ' m', false);
            return;
        }
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
    gps.speedMps = prev ? gps.speedMps * 0.3 + v * 0.7 : v;
    if (gps.speedMps < 0.5) gps.speedMps = 0;

    let lat = r.lat, lng = r.lng;
    if (prev && gps.speedMps === 0 && d < Math.max(3, acc * 0.5)) { lat = prev.lat; lng = prev.lng; }

    let h = gps.heading;
    if (gps.speedMps >= 1.0) {
        if (isFinite(r.heading) && r.heading >= 0) {
            h = r.heading;
        } else if (prev && d >= 3) {
            h = bearingDeg(prev.lat, prev.lng, lat, lng);
        }
        gps.heading = (gps.heading + angDelta(gps.heading, h) * 0.8 + 360) % 360;
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
            <div style="transform: rotate(${bearing + TRUCK_ICON_OFFSET_DEG}deg); transform-origin: 50% 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 6px 10px rgba(0,0,0,0.7));">
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

function buildTrack(pts, dur, dist) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
    }
    return { pts: pts, cum: cum, total: cum[cum.length - 1], dur: dur, dist: dist };
}

function trackPoint(tr, s) {
    const pts = tr.pts, cum = tr.cum, n = pts.length;
    if (s <= 0) return { lat: pts[0][0], lng: pts[0][1], i: 0 };
    if (s >= tr.total) return { lat: pts[n - 1][0], lng: pts[n - 1][1], i: Math.max(0, n - 2) };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
    const L2 = cum[hi] - cum[lo], k = L2 > 0 ? (s - cum[lo]) / L2 : 0;
    return {
        lat: pts[lo][0] + (pts[hi][0] - pts[lo][0]) * k,
        lng: pts[lo][1] + (pts[hi][1] - pts[lo][1]) * k,
        i: lo
    };
}

function trackBearing(tr, s) {
    const a = trackPoint(tr, Math.max(0, s - 6)), b = trackPoint(tr, Math.min(tr.total, s + 24));
    if (distM(a.lat, a.lng, b.lat, b.lng) < 1) return null;
    return bearingDeg(a.lat, a.lng, b.lat, b.lng);
}

function trackProject(tr, lat, lng, fromS, ahead) {
    const pts = tr.pts, cum = tr.cum, n = pts.length;
    let i0 = 0;
    if (fromS !== null) {
        const lo = Math.max(0, fromS - 60);
        let a = 0, b = n - 1;
        while (a < b) { const m = (a + b) >> 1; if (cum[m + 1] >= lo) b = m; else a = m + 1; }
        i0 = a;
    }
    const cosL = Math.cos(lat * Math.PI / 180), K = 111320;
    let best = null;
    for (let i = i0; i <= n - 2; i++) {
        if (fromS !== null && cum[i] > fromS + ahead) break;
        const ax = (pts[i][1] - lng) * cosL * K, ay = (pts[i][0] - lat) * K;
        const bx = (pts[i + 1][1] - lng) * cosL * K, by = (pts[i + 1][0] - lat) * K;
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let t = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
        if (!best || d < best.d) best = { d: d, s: cum[i] + t * (cum[i + 1] - cum[i]) };
    }
    return best;
}

function coastDist(v, since) {
    const t0 = COAST_AFTER_MS / 1000;
    if (since <= t0) return v * since;
    const t = Math.min(since - t0, COAST_MAX_S);
    return v * t0 + v * COAST_FACTOR * (t - (t * t * t) / (3 * COAST_MAX_S * COAST_MAX_S));
}

function makeMover(marker, label, onFrame) {
    let cur = null, curH = 0, raf = 0, lastTick = 0, mode = 'll', tr = null;
    let S = 0, V = 0, sMeas = 0, tMeas = 0, prevS = null, prevT = 0, offLat = 0, offLng = 0;
    let mLat = 0, mLng = 0, mvE = 0, mvN = 0, hMeas = 0;

    function paint() {
        marker.setLatLng(cur);
        if (label) label.setLatLng(cur);
        const el = marker.getElement();
        if (el && el.firstElementChild) el.firstElementChild.style.transform = 'rotate(' + (curH + TRUCK_ICON_OFFSET_DEG) + 'deg)';
    }

    function steer(b, dt) {
        if (b === null || !isFinite(b)) return;
        const a = 1 - Math.exp(-dt / 0.15);
        curH = (curH + angDelta(curH, b) * a + 360) % 360;
    }

    function silentFactor(nowT) {
        const silent = (nowT - tMeas) / 1000, t0 = COAST_AFTER_MS / 1000;
        if (silent <= t0) return 1;
        const x = Math.min(1, (silent - t0) / COAST_MAX_S);
        return COAST_FACTOR * (1 - x * x);
    }

    function tick() {
        const nowT = performance.now();
        const dt = lastTick ? Math.min(0.1, (nowT - lastTick) / 1000) : 0.016;
        lastTick = nowT;
        const since = (nowT - tMeas) / 1000, sf = silentFactor(nowT);
        let busy = false;
        if (mode === 's') {
            const Vu = V * sf;
            const target = sMeas + coastDist(V, since);
            const e = target - S;
            let r = e / FOLLOW_TAU;
            r = Math.max(e < -25 ? -20 : -Vu, Math.min(CATCHUP_MAX, r));
            S = Math.min(tr.total, Math.max(0, S + (Vu + r) * dt));
            const p = trackPoint(tr, S), kd = Math.exp(-dt / LATERAL_TAU);
            offLat *= kd; offLng *= kd;
            cur = { lat: p.lat + offLat, lng: p.lng + offLng };
            steer(trackBearing(tr, S), dt);
            busy = ((Vu + Math.abs(r) > 0.05) && S < tr.total) || (Math.abs(offLat) + Math.abs(offLng) > 2e-7);
        } else {
            const mPerLng = (111320 * Math.cos(mLat * Math.PI / 180)) || 1;
            const tLat = mLat + coastDist(mvN, since) / 111320, tLng = mLng + coastDist(mvE, since) / mPerLng;
            let rN = ((tLat - cur.lat) * 111320) / FOLLOW_TAU, rE = ((tLng - cur.lng) * mPerLng) / FOLLOW_TAU;
            const rm = Math.hypot(rN, rE);
            if (rm > CATCHUP_MAX) { rN *= CATCHUP_MAX / rm; rE *= CATCHUP_MAX / rm; }
            const vN = mvN * sf + rN, vE = mvE * sf + rE;
            cur = { lat: cur.lat + (vN * dt) / 111320, lng: cur.lng + (vE * dt) / mPerLng };
            if (Math.hypot(mvE, mvN) > 1) steer(hMeas, dt);
            busy = Math.hypot(vN, vE) > 0.05;
        }
        paint();
        if (onFrame) onFrame(cur, mode === 's' ? S : null, mode === 's' ? tr : null);
        return busy;
    }

    function loop() { raf = 0; if (tick()) raf = requestAnimationFrame(loop); }

    return {
        moveTo(lat, lng, h, track, s, speedMps) {
            const now = performance.now();
            const v = (isFinite(speedMps) && speedMps >= 0) ? speedMps : 0;
            if (!cur) { cur = { lat, lng }; curH = isFinite(h) ? h : 0; }

            if (track && s !== null && s !== undefined) {
                if (tr !== track || mode !== 's') {
                    const pr = trackProject(track, cur.lat, cur.lng, Math.max(0, s - 200), 400);
                    S = pr ? pr.s : s;
                    const p0 = trackPoint(track, S);
                    offLat = cur.lat - p0.lat; offLng = cur.lng - p0.lng;
                    prevS = null; V = v;
                }
                tr = track; mode = 's';
                let vp = 0;
                if (prevS === null) { prevS = s; prevT = now; }
                else if (now - prevT > 400) { vp = Math.max(0, (s - prevS) / ((now - prevT) / 1000)); prevS = s; prevT = now; }
                let vm = v; if (vm < 0.5 && vp > 2) vm = Math.min(vp, 40);
                V = V + (vm - V) * 0.4;
                sMeas = s; tMeas = now;
            } else {
                mode = 'll'; tr = null;
                const hh = isFinite(h) ? h : curH;
                mLat = lat; mLng = lng; hMeas = hh; tMeas = now;
                mvE = v * Math.sin(hh * Math.PI / 180); mvN = v * Math.cos(hh * Math.PI / 180);
            }
            if (!raf) { lastTick = 0; if (tick()) raf = requestAnimationFrame(loop); }
        },
        coast() {
            const silent = (performance.now() - tMeas) / 1000;
            return mode === 's' && silent > COAST_AFTER_MS / 1000 && V * silentFactor(performance.now()) > COAST_MIN_MPS * 0.5;
        },
        isCoasting() { return this.coast(); },
        pos: () => cur,
        stop() { cancelAnimationFrame(raf); raf = 0; }
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
        crossOrigin: true,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' 
    }).addTo(map);
    [0, 250, 700].forEach((ms) => setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, ms));
    return map;
}

function routeManager(map, color) {
    let line = null, track = null, lastFetch = 0, busy = false;
    let offCount = 0, offAny = 0, offSince = 0, offConfirmed = false;
    let wrongCount = 0, wantReroute = false, strictFails = 0;
    let prog = null, destKey = '', lastTrim = 0, lastTrimS = -1e9, lastSnapT = 0;

    async function fetchRoute(lat, lng, dLat, dLng, heading, strict) {
        const base = 'https://router.project-osrm.org/route/v1/driving/' + lng + ',' + lat + ';' + dLng + ',' + dLat + '?overview=full&geometries=geojson';
        const useB = isFinite(heading);
        const urls = useB ? [base + '&bearings=' + Math.round(heading) + ',60;'] : [];
        if (!strict) urls.push(base);
        for (const url of urls) {
            const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
            try {
                const j = await (await fetch(url, { signal: ctl.signal })).json();
                if (j.code === 'Ok' && j.routes && j.routes[0]) {
                    const pts = j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]);
                    if (strict && pts.length > 1) {
                        const b = trackBearing(buildTrack(pts, 0, 0), 20);
                        if (b !== null && Math.abs(angDelta(heading, b)) > 100) continue;
                    }
                    return { pts: pts, dur: j.routes[0].duration, dist: j.routes[0].distance };
                }
            } catch (e) {} finally { clearTimeout(to); }
        }
        return null;
    }

    return {
        async update(lat, lng, dLat, dLng, opts) {
            opts = opts || {};
            if (track && opts.acc > 100) return null; // Block reroutes on junk fixes, but allow the first fetch
            const now = Date.now(), key = dLat + ',' + dLng;
            const need = !track || key !== destKey || offConfirmed || wantReroute || opts.force;
            if (busy || !need) return null;
            if (now - lastFetch < ((offConfirmed || wantReroute) ? 2000 : 3000)) return null;
            busy = true; lastFetch = now;
            const strict = !!(opts.moving && opts.fast) && isFinite(opts.heading) && strictFails < 3;
            const r = await fetchRoute(lat, lng, dLat, dLng, opts.moving ? opts.heading : NaN, strict);
            busy = false;
            if (r && r.pts.length > 1) {
                track = buildTrack(r.pts, r.dur, r.dist);
                destKey = key; wrongCount = 0; wantReroute = false; strictFails = 0;
                offCount = 0; offAny = 0; offSince = 0; offConfirmed = false;
                prog = null; lastSnapT = 0; lastTrimS = -1e9;
                try { if (line) line.setLatLngs(r.pts); else line = L.polyline(r.pts, { color: color, weight: 6, opacity: 0.95, lineJoin: 'round', smoothFactor: 2 }).addTo(map); } catch (e) {}
                return r;
            }
            if (strict) strictFails++;
            return null;
        },

        snap(lat, lng, acc, moving, heading, fast) {
            if (!track) return { snapped: false };
            const now = Date.now(), a = isFinite(acc) ? acc : 0;
            const limit = Math.min(150, Math.max(40, a * 2));
            const gapS = lastSnapT ? Math.min(120, (now - lastSnapT) / 1000) : 0;
            const r = prog === null ? trackProject(track, lat, lng, 0, 600)
                                    : trackProject(track, lat, lng, prog, 300 + gapS * 35);
            if (r && r.d <= limit) {
                offCount = 0; offAny = 0; offSince = 0; offConfirmed = false; lastSnapT = now;
                prog = prog === null ? r.s : Math.max(prog, r.s);
                const p = trackPoint(track, prog);
                const bearing = trackBearing(track, prog);
                if (fast && bearing !== null && isFinite(heading) && Math.abs(angDelta(heading, bearing)) > 120) {
                    if (++wrongCount >= 3) { wantReroute = true; wrongCount = 0; }
                } else wrongCount = 0;
                return {
                    snapped: true, lat: p.lat, lng: p.lng, bearing: bearing,
                    track: track, s: prog, remaining: track.total - prog,
                    etaSec: track.total > 0 ? track.dur * (track.total - prog) / track.total : 0
                };
            }
            if (!offSince) offSince = now;
            offAny++;
            if (a <= 60) offCount++;
            const el = now - offSince, far = !r || r.d > limit * 2.5;
            if ((offCount >= 3 && el >= 3000) || (far && a <= 60 && offCount >= 2 && el >= 1500) || (offAny >= 5 && el >= 6000)) offConfirmed = true;
            return { snapped: false, off: offConfirmed, hold: !offConfirmed };
        },

        trim(tr, s) {
            if (!line || tr !== track) return;
            const now = performance.now();
            if (now - lastTrim < 800 || Math.abs(s - lastTrimS) < 10) return;
            lastTrim = now; lastTrimS = s;
            const p = trackPoint(tr, s);
            try { line.setLatLngs([[p.lat, p.lng]].concat(tr.pts.slice(p.i + 1))); } catch (e) {}
        },
        getTrack: () => track
    };
}

let D = null;
function teardownDriver() {
    if (!D) return;
    try { clearInterval(D.coastTimer); } catch (e) {}
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

    D = { map: map, follow: true, mover: null, route: routeManager(map, '#1d4ed8'), viewSet: false, truck: null, label: null, lastT: 0, lastFixAt: Date.now(), lastSpeedMps: 0, coastTimer: 0 };
    const me = D;
    map.on('dragstart', () => { me.follow = false; });

    const dest = getDest();
    if (dest) {
        L.marker([dest.lat, dest.lng], { icon: pinIcon() }).addTo(map);
        map.setView([dest.lat, dest.lng], 13, { animate: false });
    }

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (p) => ingest(fromWeb(p)),
            (e) => console.error("Initial mobile GPS lock error:", e),
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }

    me.off = subscribe((fix) => {
        if (D !== me) return;
        const spd = $('driver-map-speed');
        if (spd) spd.textContent = fix.speedMph + ' mph';

        let lat = fix.lat, lng = fix.lng, heading = fix.heading, trk = null, sPos = null;
        const moving = fix.speedMph > 2;
        if (dest) {
            const fast = fix.speedMph > 8;
            me.route.update(lat, lng, dest.lat, dest.lng, { heading: fix.heading, moving: moving, fast: fast, acc: fix.acc }).then((r) => {
                if (r && D === me && !me.fitted && me.mover && me.mover.pos()) {
                    me.fitted = true;
                    if (!moving) {
                        const p = me.mover.pos();
                        map.fitBounds(L.latLngBounds([[p.lat, p.lng], [dest.lat, dest.lng]]), { padding: [60, 60], animate: false });
                        me.follow = false;
                    }
                }
            });
            const sn = me.route.snap(lat, lng, fix.acc, moving, fix.heading, fast);
            if (sn.snapped) {
                lat = sn.lat; lng = sn.lng; trk = sn.track; sPos = sn.s;
                if (sn.bearing !== null) heading = sn.bearing;
            } else if (sn.hold && me.viewSet) {
                return;
            }
        }
        me.lastFixAt = Date.now();
        const v = fix.speedMph / MPS_TO_MPH;
        me.lastSpeedMps = me.hasSpeed ? me.lastSpeedMps * 0.5 + v * 0.5 : v;
        me.hasSpeed = true;

        if (!me.viewSet) {
            map.setView([lat, lng], 17, { animate: false });
            me.viewSet = true;
            me.truck = L.marker([lat, lng], { icon: getTruckIcon(heading) }).addTo(map);
            me.label = L.marker([lat, lng], { icon: getDriverLabelIcon(LS.getItem('smd_driver_name') || 'Driver') }).addTo(map);
            me.mover = makeMover(me.truck, me.label, (p, sNow, tr) => {
                if (me.follow) map.panTo([p.lat, p.lng], { animate: false });
                if (tr) me.route.trim(tr, sNow);
            });
        }
        me.mover.moveTo(lat, lng, heading, trk, sPos, v);
        const sp = $('driver-map-speed');
        if (sp) sp.textContent = fix.speedMph + ' mph';
    });

    me.coastTimer = setInterval(() => {
        if (D !== me || !me.mover) return;
        if (Date.now() - me.lastFixAt > COAST_AFTER_MS && me.mover.coast(me.lastSpeedMps)) setStatus('GPS: no signal \u2014 gliding on route', false);
    }, 500);
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
    
    const a = document.createElement('a');
    a.href = 'sms:' + phone + '?body=' + encodeURIComponent(name + ' is on the way. Track live: ' + u);
    document.body.appendChild(a);
    a.click();
    a.remove();
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
    LS.removeItem('smd_started_at');
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
    clearInterval(C.coastTimer);
    try { C.mover && C.mover.stop(); } catch (e) {}
    try { C.map.remove(); } catch (e) {}
    C = null;
}

window.initCustomerMapLive = function () {
    const box = $('customer-map-container');
    if (!box || typeof L === 'undefined') return;
    teardownCustomer();

    const q = new URLSearchParams(window.location.search);
    const sid = q.get('session') || q.get('sid') || q.get('s');
    const head = $('cust-driver-header'), sub = $('cust-eta-sub'), pill = $('cust-status-pill'), distEl = $('cust-distance'), speedEl = $('cust-speed');
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

        const fresh = data.timestamp !== me.lastTs;
        const tsGap = (fresh && me.lastTs) ? (data.timestamp - me.lastTs) : 0;
        if (fresh) { me.lastTs = data.timestamp; me.lastChange = Date.now(); }
        if (data.ended) {
            me.ended = true; me.waiting = false;
            if (head) head.textContent = (data.driverName || 'Driver') + ' \u2014 trip ended';
            setPill('\u25CF Trip ended', false);
            return;
        }

        let lat = parseFloat(data.lat), lng = parseFloat(data.lng);
        const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
        let heading = isFinite(parseFloat(data.heading)) ? parseFloat(data.heading) : 0;
        let trk = null, sPos = null, hold = false;
        const name = data.driverName || 'Driver';
        if (head) head.textContent = name;

        const destAddrEl = $('cust-dest-address');
        if (destAddrEl && data.destAddress) destAddrEl.textContent = data.destAddress;

        const phoneDigits = data.driverPhone ? String(data.driverPhone).replace(/[^\d+]/g, '') : '';
        if (phoneDigits) {
            const callBtn = $('cust-call-btn'), msgBtn = $('cust-msg-btn');
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

        if (haveDest) {
            const moving = me.speed > 2, fast = me.speed > 8;
            me.route.update(lat, lng, dLat, dLng, { heading: heading, moving: moving, fast: fast, acc: parseFloat(data.accuracy) }).then((r) => {
                if (r && C === me) {
                    me.roadMi = r.dist / 1609.34;
                    if (sub) sub.textContent = formatEta(r.dur);
                    if (distEl) distEl.textContent = me.roadMi.toFixed(1) + ' mi';
                }
            });
            const sn = me.route.snap(lat, lng, parseFloat(data.accuracy), moving, heading, fast);
            if (sn.snapped) {
                lat = sn.lat; lng = sn.lng; trk = sn.track; sPos = sn.s;
                if (sn.bearing !== null) heading = sn.bearing;
                me.roadMi = sn.remaining / 1609.34;
                if (sub) sub.textContent = formatEta(sn.etaSec);
                if (distEl) distEl.textContent = me.roadMi.toFixed(1) + ' mi';
            } else if (sn.hold && me.truck) {
                hold = true;
            }
        }

        if (!me.truck) {
            map.setView([lat, lng], 16, { animate: false });
            me.truck = L.marker([lat, lng], { icon: getTruckIcon(heading) }).addTo(map);
            me.label = L.marker([lat, lng], { icon: getDriverLabelIcon(name) }).addTo(map);
            me.mover = makeMover(me.truck, me.label, (p, sNow, tr) => {
                if (me.follow && me.fitted) map.panTo([p.lat, p.lng], { animate: false });
                if (tr) me.route.trim(tr, sNow);
            });
        }
        if (!hold && fresh) { me.lastMove = Date.now(); me.mover.moveTo(lat, lng, heading, trk, sPos, me.speed / MPS_TO_MPH); }

        if (haveDest && !me.fitted) {
            me.fitted = true;
            map.fitBounds(L.latLngBounds([[lat, lng], [dLat, dLng]]), { padding: [60, 60], animate: false });
            me.follow = false;
        } else if (!haveDest) {
            me.fitted = true;
        }
    });

    me.staleTimer = setInterval(() => {
        if (!C || C.ended || me.waiting) return;
        if (Date.now() - me.lastChange > 20000) setPill('\u25CF Signal lost \u2014 reconnecting', false);
    }, 3000);

    me.coastTimer = setInterval(() => {
        if (C !== me || me.ended || me.waiting || !me.mover) return;
        if (Date.now() - (me.lastMove || me.lastChange) > COAST_AFTER_MS + 2000 && me.speed > 3) me.mover.coast(me.speed / MPS_TO_MPH);
    }, 500);
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

// ==========================================================
// SESSION PERSISTENCE & AUTO-RESUME ON APP BOOT
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    
    // Customer tracking links never resume a driver broadcast
    if (q.has('session') || q.has('sid') || q.has('s') || q.get('view') === 'customer') return;
    if (!broadcasting()) return;
    
    const storedSessionId = sessionId();
    if (!storedSessionId) { 
        LS.removeItem('smd_active_broadcast'); 
        return; 
    }
    
    // A broadcast only ends when the driver taps End Broadcast (or after 24 hours of total silence)
    const last = Math.max(parseInt(LS.getItem('smd_last_tx') || '0', 10), parseInt(LS.getItem('smd_started_at') || '0', 10));
    if (last && Date.now() - last > 24 * 3600 * 1000) {
        LS.removeItem('smd_active_broadcast');
        LS.removeItem('smd_session_id');
        LS.removeItem('smd_started_at');
        return;
    }
    
    window.activeSessionId = storedSessionId;
    if (typeof window.switchView === 'function') {
        window.switchView('active-broadcast');
    }
    if (typeof window.startRealTimeTracking === 'function') {
        window.startRealTimeTracking();
    }
});

})();