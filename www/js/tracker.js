// ==========================================================
// SEEMYDRIVER - GPS ENGINE + MAPS & TELEMETRY (PRODUCTION MASTER)
// v11: smooth acceleration (no pulls), reliable dead-zone glide, speed fallback, Mapbox search, live ETA, customer auto-resync
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage || window.localStorage;
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
// If you ever swap the artwork and it faces another way, set this: 90 = art faces right, 180 = down, 270 = left.
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
            // Mapbox forward geocoding: exact house numbers; results biased toward where the driver is
            const prox = (typeof gps !== 'undefined' && gps.last && isFinite(gps.last.lat)) ? '&proximity=' + gps.last.lng + ',' + gps.last.lat : '&proximity=-95.3698,29.7604';
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
                const coords = f.center || (f.geometry && f.geometry.coordinates) || [0, 0];   // [lng, lat]

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
    subs: new Set(), sent: { t: 0, lat: 0, lng: 0 }, stopTimer: null, denied: false, badSince: 0, hist: []
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
    document.querySelectorAll('.smd-gps-badge, #active-broadcast-view div').forEach((el) => {
        if (!el.classList.contains('smd-gps-badge')) {
            const raw = (el.textContent || '').trim();
            if (!/^GPS[:\s\u00B1]/i.test(raw) || el.children.length > 0) return;
        }
        el.textContent = text;
        el.style.color = ok ? '#fbbf24' : '#f87171';
    });
}

const fromWeb = (p) => ({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed, heading: p.coords.heading, t: p.timestamp || Date.now() });
const fromBg = (l) => ({ lat: l.latitude, lng: l.longitude, acc: l.accuracy, speed: l.speed, heading: l.bearing, t: l.time || Date.now() });

const STALE_PREV_MS = 30000;     
const FRESH_MS = 10000;          
const isFresh = (fix, ms) => !!fix && (Date.now() - fix.t) < (ms || FRESH_MS);

// Dead-zone glide: when good GPS stops coming in, the truck keeps rolling along the route
const COAST_AFTER_MS = 2500;   // no good fix for this long => start gliding
const COAST_MAX_S    = 90;     // glide eases down to a stop over this many seconds
const COAST_FACTOR   = 0.95;   // glide continues at 95% of the recent speed, then eases off
const COAST_MIN_MPS  = 1.5;    // if we were basically stopped, don't glide

// Truck motion model: the truck ALWAYS keeps moving at its current speed and is only
// nudged toward each real GPS fix, so it never freezes and never teleports.
const FOLLOW_TAU  = 1.4;        // seconds to close the gap to the real position
const CATCHUP_MAX = 20;         // m/s: fastest the truck may slide to catch up after a dead zone
const LATERAL_TAU = 1.0;        // seconds for a sideways gap to fade onto the polyline
const ACCEL_UP    = 6;          // m/s^2: the truck speeds up this gently at most (no sudden pulls)
const ACCEL_DN    = 8;          // m/s^2: and slows down this gently at most

function ingest(r) {
    gps.lastAlive = Date.now();
    if (!isFinite(r.lat) || !isFinite(r.lng)) return;
    const acc = isFinite(r.acc) ? r.acc : 999;

    // Junk-fix filter: a fix with +/-100 m or worse is the phone guessing from cell/Wi-Fi.
    // Ignore it while we have a recent usable fix. With no fix at all, wait for +/-300 m or better.
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

    // Some phones report 0 / no speed while clearly moving. Cross-check against real distance over a few seconds.
    gps.hist.push({ t: r.t, lat: r.lat, lng: r.lng });
    while (gps.hist.length && r.t - gps.hist[0].t > 6000) gps.hist.shift();
    if (!(v >= 1) && gps.hist.length > 1) {
        const old = gps.hist[0], dtw = (r.t - old.t) / 1000;
        if (dtw >= 2) {
            const dw = distM(old.lat, old.lng, r.lat, r.lng);
            if (dw > Math.max(12, acc * 1.5)) v = dw / dtw;
        }
    }
    gps.speedMps = prev ? gps.speedMps * 0.3 + v * 0.7 : v; // Faster response on speed changes
    if (gps.speedMps < 0.5) gps.speedMps = 0;

    let lat = r.lat, lng = r.lng;
    if (prev && gps.speedMps === 0 && d < Math.max(3, acc * 0.5)) { lat = prev.lat; lng = prev.lng; }

    let h = gps.heading;
    if (gps.speedMps >= 1.0) {
        if (isFinite(r.heading) && r.heading >= 0) {
            h = r.heading;
            // if the phone's bearing is wildly different from the way we actually moved, trust the movement
            if (prev && d >= 6) { const mb = bearingDeg(prev.lat, prev.lng, lat, lng); if (Math.abs(angDelta(h, mb)) > 60) h = mb; }
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
    gps.last = null; gps.lastMoved = null; gps.speedMps = 0; gps.badSince = 0; gps.hist = [];
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
    let S = 0, V = 0, vCur = 0, sMeas = 0, tMeas = 0, prevS = null, prevT = 0, offLat = 0, offLng = 0;
    let mLat = 0, mLng = 0, mvE = 0, mvN = 0, hMeas = 0, fvN = 0, fvE = 0;

    function paint() {
        if (!cur) return;
        marker.setLatLng(cur);
        if (label) label.setLatLng(cur);
        const el = marker.getElement();
        if (el && el.firstElementChild) el.firstElementChild.style.transform = 'rotate(' + (curH + TRUCK_ICON_OFFSET_DEG).toFixed(2) + 'deg)';
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
            const cm = Math.min(CATCHUP_MAX, Math.max(5, 0.5 * V + 3 + Math.max(0, e) / 30));
            const corr = Math.max(e < -60 ? -8 : -Vu, Math.min(cm, e / FOLLOW_TAU));
            const vDes = Vu + corr;
            const dv = vDes - vCur, aLim = (dv > 0 ? ACCEL_UP : ACCEL_DN) * dt;
            vCur += Math.max(-aLim, Math.min(aLim, dv));
            S = Math.min(tr.total, Math.max(0, S + vCur * dt));
            const p = trackPoint(tr, S), kd = Math.exp(-dt / LATERAL_TAU);
            offLat *= kd; offLng *= kd;
            cur = { lat: p.lat + offLat, lng: p.lng + offLng };
            steer(trackBearing(tr, S), dt);
            busy = ((Math.abs(vCur) > 0.05 || Math.abs(vDes) > 0.05) && S < tr.total) || (Math.abs(offLat) + Math.abs(offLng) > 2e-7);
        } else {
            const mPerLng = (111320 * Math.cos(mLat * Math.PI / 180)) || 1;
            const tLat = mLat + coastDist(mvN, since) / 111320, tLng = mLng + coastDist(mvE, since) / mPerLng;
            const eN = (tLat - cur.lat) * 111320, eE = (tLng - cur.lng) * mPerLng;
            const em = Math.hypot(eN, eE), vm0 = Math.hypot(mvN, mvE);
            const cm = Math.min(CATCHUP_MAX, Math.max(5, 0.5 * vm0 + 3 + em / 30));
            let rN = eN / FOLLOW_TAU, rE = eE / FOLLOW_TAU;
            const rm = Math.hypot(rN, rE);
            if (rm > cm) { rN *= cm / rm; rE *= cm / rm; }
            const dN = mvN * sf + rN - fvN, dE = mvE * sf + rE - fvE, dm = Math.hypot(dN, dE), lim = ACCEL_UP * dt;
            if (dm > lim) { fvN += dN * lim / dm; fvE += dE * lim / dm; } else { fvN += dN; fvE += dE; }
            cur = { lat: cur.lat + (fvN * dt) / 111320, lng: cur.lng + (fvE * dt) / mPerLng };
            if (vm0 > 1) steer(hMeas, dt);
            busy = Math.hypot(fvN, fvE) > 0.05 || dm > 0.05;
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
            const first = !cur;
            if (first) { cur = { lat, lng }; curH = isFinite(h) ? h : 0; }

            if (track && s !== null && s !== undefined) {
                if (tr !== track || mode !== 's') {
                    const pr = trackProject(track, cur.lat, cur.lng, Math.max(0, s - 200), 400);
                    S = pr ? pr.s : s;
                    const p0 = trackPoint(track, S);
                    offLat = cur.lat - p0.lat; offLng = cur.lng - p0.lng;
                    prevS = null; V = v;
                    vCur = first ? v : (mode === 'll' ? Math.hypot(fvN, fvE) : vCur);
                }
                tr = track; mode = 's';
                let vp = 0;
                if (prevS === null) { prevS = s; prevT = now; }
                else if (now - prevT > 400) { vp = Math.max(0, (s - prevS) / ((now - prevT) / 1000)); prevS = s; prevT = now; }
                let vm = v; if (vm < 0.5 && vp > 2) vm = Math.min(vp, 40);
                V = V + (vm - V) * 0.4;
                sMeas = s; tMeas = now;
            } else {
                if (mode === 's') { fvN = vCur * Math.cos(curH * Math.PI / 180); fvE = vCur * Math.sin(curH * Math.PI / 180); }
                mode = 'll'; tr = null;
                const hh = isFinite(h) ? h : curH;
                mLat = lat; mLng = lng; hMeas = hh; tMeas = now;
                mvE = v * Math.sin(hh * Math.PI / 180); mvN = v * Math.cos(hh * Math.PI / 180);
            }
            if (!raf) { lastTick = performance.now(); raf = requestAnimationFrame(loop); }
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
            if (opts.acc > 100) return null;                 
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
    const container = document.getElementById('driver-map-container');
    if (!container) return;

    const updateBadge = (text, ok) => {
        if (typeof setStatus === 'function') {
            try { setStatus(text, ok); } catch (e) {}
        }
        document.querySelectorAll('.smd-gps-badge, #active-broadcast-view div').forEach((el) => {
            if (!el.classList.contains('smd-gps-badge')) {
                const raw = (el.textContent || '').trim();
                if (!/^GPS[:\s\u00B1]/i.test(raw) || el.children.length > 0) return;
            }
            el.textContent = text;
            el.style.color = ok ? '#fbbf24' : '#f87171';
        });
    };

    if (typeof mapboxgl === 'undefined') {
        updateBadge('GPS: Mapbox missing', false);
        return;
    }

    mapboxgl.accessToken = window.MAPBOX_TOKEN || MAPBOX_TOKEN || '';
    if (!mapboxgl.accessToken) {
        updateBadge('GPS: token missing', false);
        return;
    }

    if (window.__smdDrvMapState) {
        try {
            if (window.__smdDrvMapState.watchId != null && navigator.geolocation) {
                navigator.geolocation.clearWatch(window.__smdDrvMapState.watchId);
            }
            if (window.__smdDrvMapState.map) {
                window.__smdDrvMapState.map.remove();
            }
        } catch (e) {}
        window.__smdDrvMapState = null;
    }

    const dest = (typeof getDest === 'function' && getDest()) || (() => {
        const lat = parseFloat((window.SafeStorage && window.SafeStorage.getItem('smd_dest_lat')) || localStorage.getItem('smd_dest_lat'));
        const lng = parseFloat((window.SafeStorage && window.SafeStorage.getItem('smd_dest_lng')) || localStorage.getItem('smd_dest_lng'));
        return (isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0)) ? { lat, lng } : null;
    })();

    const cached = (window.__smdGps && window.__smdGps.last && isFinite(window.__smdGps.last.lat) && isFinite(window.__smdGps.last.lng))
        ? window.__smdGps.last : null;

    const startCenter = cached ? [cached.lng, cached.lat] : (dest ? [dest.lng, dest.lat] : [-95.3698, 29.7604]);
    const startZoom = cached ? 15 : (dest ? 12 : 11);

    let map;
    try {
        map = new mapboxgl.Map({
            container: container,
            style: 'mapbox://styles/mapbox/streets-v12',
            center: startCenter,
            zoom: startZoom,
            pitch: 52
        });
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');
    } catch (err) {
        console.error('Mapbox init error:', err);
        updateBadge('GPS: map init error', false);
        return;
    }

    if (dest) {
        const pin = document.createElement('div');
        pin.textContent = '\uD83D\uDCCD';
        pin.style.fontSize = '26px';
        new mapboxgl.Marker({ element: pin }).setLngLat([dest.lng, dest.lat]).addTo(map);
    }

    const driverName = ((window.SafeStorage && window.SafeStorage.getItem('smd_driver_name')) || localStorage.getItem('smd_driver_name')) || 'Driver';
    let truckMarker = null;
    let truckRot = null;
    let lastRouteFetch = 0;

    const placeFix = (lat, lng, acc, heading, speedMph, ts) => {
        if (!isFinite(lat) || !isFinite(lng)) return;
        const a = (typeof acc === 'number' && isFinite(acc) && acc > 0) ? Math.round(acc) : 50;
        const h = (typeof heading === 'number' && isFinite(heading)) ? heading : 0;
        const mph = (typeof speedMph === 'number' && isFinite(speedMph) && speedMph >= 0) ? Math.round(speedMph) : 0;

        updateBadge('GPS \u00B1' + a + ' m' + (a > 300 ? ' (weak)' : ''), a <= 300);

        if (!truckMarker) {
            const el = document.createElement('div');
            el.className = 'pro-vehicle-marker';
            el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;';
            const tag = document.createElement('div');
            tag.textContent = String(driverName).toUpperCase();
            tag.style.cssText = 'font-size:10px;font-weight:900;color:#fff;background:rgba(0,0,0,.78);padding:2px 6px;border-radius:6px;margin-bottom:2px;white-space:nowrap;border:1px solid rgba(251,191,36,.45);';
            el.appendChild(tag);
            truckRot = document.createElement('div');
            truckRot.style.cssText = 'transform:rotate(' + h.toFixed(1) + 'deg);width:32px;height:32px;border-radius:9999px;background:#fbbf24;border:3px solid #000;box-shadow:0 4px 12px rgba(0,0,0,.7);';
            el.appendChild(truckRot);
            truckMarker = new mapboxgl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
            map.easeTo({ center: [lng, lat], zoom: 15, duration: 500 });
        } else {
            truckMarker.setLngLat([lng, lat]);
            if (truckRot) truckRot.style.transform = 'rotate(' + h.toFixed(1) + 'deg)';
            map.panTo([lng, lat], { duration: 400 });
        }

        const sid = (typeof sessionId === 'function' && sessionId()) || ((window.SafeStorage && window.SafeStorage.getItem('smd_session_id')) || localStorage.getItem('smd_session_id'));
        const dbRef = (typeof getDb === 'function' && getDb()) || window.db;
        if (sid && dbRef) {
            try {
                dbRef.ref('broadcasts/' + sid).update({
                    lat: lat,
                    lng: lng,
                    accuracy: a,
                    speed: mph,
                    heading: h,
                    timestamp: ts || Date.now()
                });
            } catch (e) {}
        }

        if (dest && Date.now() - lastRouteFetch > 4000) {
            lastRouteFetch = Date.now();
            const url = 'https://router.project-osrm.org/route/v1/driving/' + lng + ',' + lat + ';' + dest.lng + ',' + dest.lat + '?overview=full&geometries=geojson';
            fetch(url).then((r) => r.json()).then((d) => {
                const coords = d && d.routes && d.routes[0] && d.routes[0].geometry && d.routes[0].geometry.coordinates;
                if (!coords || !coords.length) return;
                const applyLine = () => {
                    const fc = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
                    if (map.getSource('smd-route-src')) {
                        map.getSource('smd-route-src').setData(fc);
                    } else {
                        map.addSource('smd-route-src', { type: 'geojson', data: fc });
                        map.addLayer({
                            id: 'smd-route-line',
                            type: 'line',
                            source: 'smd-route-src',
                            layout: { 'line-join': 'round', 'line-cap': 'round' },
                            paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.92 }
                        });
                    }
                };
                if (map.isStyleLoaded()) applyLine();
                else map.once('load', applyLine);
            }).catch(() => {});
        }
    };

    const onPos = (pos) => {
        if (!pos || !pos.coords) return;
        const mph = (typeof pos.coords.speed === 'number' && isFinite(pos.coords.speed) && pos.coords.speed >= 0)
            ? pos.coords.speed * 2.23694 : 0;
        placeFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading, mph, pos.timestamp || Date.now());
    };

    const onErr = (err) => {
        if (err && err.code === 1) {
            updateBadge('GPS: permission denied', false);
        } else {
            updateBadge('GPS: searching\u2026', false);
        }
    };

    let watchId = null;
    if (navigator.geolocation) {
        try {
            navigator.geolocation.getCurrentPosition(onPos, (err) => {
                onErr(err);
                try {
                    navigator.geolocation.getCurrentPosition(onPos, onErr, { enableHighAccuracy: false, maximumAge: 15000, timeout: 10000 });
                } catch (e2) {}
            }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 });
            watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
        } catch (e) {
            updateBadge('GPS: error', false);
        }
    } else {
        updateBadge('GPS: unavailable', false);
    }

    if (cached) {
        placeFix(cached.lat, cached.lng, cached.acc, cached.heading, cached.speedMph, cached.t);
    }

    window.__smdDrvMapState = { map: map, watchId: watchId };
    [150, 500, 1200].forEach((ms) => setTimeout(() => { try { map.resize(); } catch (e) {} }, ms));
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
    if (typeof window.switchView === 'function') { window.switchView('job-setup-view', true); }
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
    const sid = q.get('session') || q.get('s');
    const head = $('cust-driver-header'), sub = $('cust-eta-sub'), pill =$('cust-status-pill'), distEl = $('cust-distance'), speedEl =$('cust-speed');
    if (!sid) { if (head) head.textContent = 'Invalid tracking link'; return; }

    const database = getDb();
    if (!database) return;

    const map = makeMap(box, true);
    const me = C = { map: map, follow: true, mover: null, truck: null, label: null, destMarker: null, destKey: '', fitted: false,
        route: routeManager(map, '#1e3a8a'), lastChange: Date.now(), lastTs: 0, roadMi: null, speed: 0, ended: false, waiting: true };
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
        if (Date.now() - (me.lastMove || me.lastChange) > COAST_AFTER_MS + 2000 && me.mover.coast(me.lastSpeedMps)) {
            setPill('\u25CF Gliding \u2014 weak GPS', false);
        }
    }, 500);
};
/* --- Clean Single Mapbox GL JS Controller, GPS Badge & Broadcast Guard --- */

(function () {
    const origAlert = window.alert ? window.alert.bind(window) : null;
    window.alert = function (msg) {
        const text = String(msg || '');
        if (/please sign in to start a broadcast/i.test(text)) {
            console.warn('Suppressed premature sign-in broadcast alert:', text);
            return;
        }
        if (origAlert) return origAlert(msg);
    };

    const STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
    let drvState = null;
    let custState = null;
    let hasLiveLock = false;
    let lastAccMeters = null;

    function getSavedDest() {
        try {
            const getVal = (k) => (window.SafeStorage && window.SafeStorage.getItem(k)) || localStorage.getItem(k);
            const lat = parseFloat(getVal('smd_dest_lat'));
            const lng = parseFloat(getVal('smd_dest_lng'));
            if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
            return { lat: lat, lng: lng };
        } catch (e) {
            return null;
        }
    }

    function setGpsBadge(msg, ok) {
        const targets = new Set();
        document.querySelectorAll('.smd-gps-badge').forEach((el) => targets.add(el));
        document.querySelectorAll('#active-broadcast-view div').forEach((el) => {
            const raw = (el.textContent || '').trim();
            if (/^GPS[:\s\u00B1]/i.test(raw) && el.children.length === 0) {
                targets.add(el);
            }
        });
        targets.forEach((el) => {
            el.textContent = msg;
            el.style.color = ok ? '#fbbf24' : '#f87171';
        });
    }

    function makeTruckElement(headingDeg, nameLabel) {
        const deg = Number(headingDeg) || 0;
        const container = document.createElement('div');
        container.className = 'pro-vehicle-marker';
        container.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;';
        if (nameLabel) {
            const tag = document.createElement('div');
            tag.textContent = String(nameLabel).toUpperCase();
            tag.style.cssText = 'font-size:10px;font-weight:900;color:#fff;background:rgba(0,0,0,.78);padding:2px 6px;border-radius:6px;margin-bottom:2px;white-space:nowrap;letter-spacing:.06em;border:1px solid rgba(251,191,36,.45);';
            container.appendChild(tag);
        }
        const rotator = document.createElement('div');
        rotator.style.cssText = 'transform: rotate(' + deg.toFixed(1) + 'deg); transform-origin: 50% 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 6px 10px rgba(0,0,0,0.75));';
        rotator.innerHTML = '<svg viewBox="0 0 24 36" width="30" height="45" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1.5" y="9" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/><rect x="19" y="9" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/><rect x="1.5" y="25" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/><rect x="19" y="25" width="3.5" height="7" rx="1" fill="#090d16" stroke="#1f2937" stroke-width="0.5"/><rect x="4" y="12" width="16" height="21" rx="2.5" fill="#0b0f19" stroke="#374151" stroke-width="1.5"/><rect x="4" y="21" width="16" height="3.5" fill="#f59e0b"/><line x1="4" y1="22.75" x2="20" y2="22.75" stroke="#ffffff" stroke-width="0.75" opacity="0.8"/><path d="M6 12H18V5.5C18 3.84315 16.6569 2.5 15 2.5H9C7.34315 2.5 6 3.84315 6 5.5V12Z" fill="#111827" stroke="#4b5563" stroke-width="1.5"/><path d="M7.5 8H16.5L15.5 4.5H8.5L7.5 8Z" fill="#38bdf8" fill-opacity="0.9" stroke="#bae6fd" stroke-width="0.5"/><line x1="9" y1="6" x2="15" y2="6" stroke="#ffffff" stroke-width="0.75" opacity="0.6"/><circle cx="7" cy="3.5" r="1.1" fill="#fbbf24"/><circle cx="17" cy="3.5" r="1.1" fill="#fbbf24"/><circle cx="7" cy="3.5" r="0.5" fill="#ffffff"/><circle cx="17" cy="3.5" r="0.5" fill="#ffffff"/></svg>';
        container.appendChild(rotator);
        return { el: container, rot: rotator };
    }

    async function queryOsrm(lat1, lng1, lat2, lng2) {
        try {
            const url = 'https://router.project-osrm.org/route/v1/driving/' + lng1 + ',' + lat1 + ';' + lng2 + ',' + lat2 + '?overview=full&geometries=geojson';
            const resp = await fetch(url);
            const data = await resp.json();
            if (data && data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry && Array.isArray(data.routes[0].geometry.coordinates)) {
                return data.routes[0].geometry.coordinates;
            }
        } catch (e) {}
        return null;
    }

    function drawRoute(map, coords) {
        if (!map || !Array.isArray(coords) || !coords.length) return;
        const applyLine = () => {
            const fc = { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } };
            if (map.getSource('smd-route-src')) {
                map.getSource('smd-route-src').setData(fc);
            } else {
                map.addSource('smd-route-src', { type: 'geojson', data: fc });
                map.addLayer({
                    id: 'smd-route-line',
                    type: 'line',
                    source: 'smd-route-src',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.92 }
                });
            }
        };
        if (map.isStyleLoaded()) applyLine();
        else map.once('load', applyLine);
    }

    window.toggleDriver3D = function () {
        if (!drvState || !drvState.map) return;
        drvState.is3D = !drvState.is3D;
        try { drvState.map.easeTo({ pitch: drvState.is3D ? 52 : 0, duration: 350 }); } catch (e) {}
        const btn = document.getElementById('driver-3d-btn');
        if (btn) btn.textContent = drvState.is3D ? '\uD83C\uDF10 3D: ON' : '\uD83C\uDF10 3D: OFF';
    };

    window.initDriverActiveMap = function () {
        if (typeof mapboxgl === 'undefined') return;
        const container = document.getElementById('driver-map-container');
        if (!container) return;
        mapboxgl.accessToken = window.MAPBOX_TOKEN || MAPBOX_TOKEN || '';

        if (drvState) {
            if (drvState.watchId !== null && drvState.watchId !== undefined && navigator.geolocation) {
                try { navigator.geolocation.clearWatch(drvState.watchId); } catch (e) {}
            }
            if (drvState.map) { try { drvState.map.remove(); } catch (e) {} }
            drvState = null;
        }

        hasLiveLock = false;
        lastAccMeters = null;

        const dest = getSavedDest();
        const cached = (window.__smdGps && window.__smdGps.last && isFinite(window.__smdGps.last.lat) && isFinite(window.__smdGps.last.lng))
            ? window.__smdGps.last : null;

        const startCenter = cached ? [cached.lng, cached.lat] : (dest ? [dest.lng, dest.lat] : [-95.3698, 29.7604]);
        const startZoom = cached ? 15 : (dest ? 12 : 11);

        let map;
        try {
            map = new mapboxgl.Map({
                container: container,
                style: STYLE_URL,
                center: startCenter,
                zoom: startZoom,
                pitch: 52
            });
            map.on('error', (e) => {
                console.error('Mapbox runtime error:', e && e.error ? e.error : e);
            });
        } catch (err) {
            console.error('Mapbox init error:', err);
            setGpsBadge('GPS: map init error', false);
            return;
        }
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        if (dest) {
            const pin = document.createElement('div');
            pin.textContent = '\uD83D\uDCCD';
            pin.style.fontSize = '26px';
            new mapboxgl.Marker({ element: pin }).setLngLat([dest.lng, dest.lat]).addTo(map);
        }

        const driverName = ((window.SafeStorage && window.SafeStorage.getItem('smd_driver_name')) || localStorage.getItem('smd_driver_name')) || 'Driver';
        const truck = makeTruckElement(0, driverName);
        let truckMarker = null;
        let lastRouteFetch = 0;

        function placeLiveFix(lat, lng, acc, heading, speedMph, ts) {
            if (!isFinite(lat) || !isFinite(lng)) return;
            const h = (typeof heading === 'number' && isFinite(heading)) ? heading : 0;
            const mph = (typeof speedMph === 'number' && isFinite(speedMph)) ? speedMph : 0;
            const a = (typeof acc === 'number' && isFinite(acc) && acc > 0) ? Math.round(acc) : 50;

            hasLiveLock = true;
            lastAccMeters = a;
            window.lastLat = lat;
            window.lastLng = lng;
            window.lastHeading = h;
            if (window.__smdGps && typeof window.__smdGps === 'object') {
                window.__smdGps.last = { lat: lat, lng: lng, acc: a, speedMps: mph / 2.23694, speedMph: mph, heading: h, t: ts || Date.now() };
            }
            setGpsBadge('GPS \u00B1' + a + ' m' + (a > 300 ? ' (weak)' : ''), a <= 300);

            truck.rot.style.transform = 'rotate(' + (h % 360).toFixed(1) + 'deg)';
            if (!truckMarker) {
                truckMarker = new mapboxgl.Marker({ element: truck.el }).setLngLat([lng, lat]).addTo(map);
                map.easeTo({ center: [lng, lat], zoom: 15, duration: 500 });
            } else {
                truckMarker.setLngLat([lng, lat]);
                if (!drvState || drvState.follow !== false) {
                    map.panTo([lng, lat], { duration: 400 });
                }
            }

            const dNow = getSavedDest();
            if (dNow && Date.now() - lastRouteFetch > 4000) {
                lastRouteFetch = Date.now();
                queryOsrm(lat, lng, dNow.lat, dNow.lng).then((coords) => {
                    if (coords && coords.length) drawRoute(map, coords);
                });
            }
        }

        const handlePos = (pos) => {
            if (!pos || !pos.coords) return;
            const mph = (typeof pos.coords.speed === 'number' && isFinite(pos.coords.speed) && pos.coords.speed >= 0)
                ? Math.round(pos.coords.speed * 2.23694) : 0;
            placeLiveFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.heading, mph, pos.timestamp || Date.now());
        };

        const handleErr = (err) => {
            if (err && err.code === 1) {
                setGpsBadge('GPS: permission denied', false);
            } else if (hasLiveLock && lastAccMeters !== null) {
                setGpsBadge('GPS \u00B1' + lastAccMeters + ' m (stale)', false);
            } else {
                setGpsBadge('GPS: searching\u2026', false);
            }
        };

        let watchId = null;
        if (navigator.geolocation) {
            try {
                navigator.geolocation.getCurrentPosition(handlePos, (err) => {
                    handleErr(err);
                    try {
                        navigator.geolocation.getCurrentPosition(handlePos, handleErr, { enableHighAccuracy: false, maximumAge: 15000, timeout: 10000 });
                    } catch (e2) {}
                }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 });
                watchId = navigator.geolocation.watchPosition(handlePos, handleErr, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
            } catch (e) {}
        }

        if (cached) {
            placeLiveFix(cached.lat, cached.lng, cached.acc, cached.heading, cached.speedMph, cached.t);
        }

        drvState = { map: map, watchId: watchId, follow: true, is3D: true };
        [150, 500, 1200].forEach((ms) => setTimeout(() => { try { map.resize(); } catch (e) {} }, ms));
    };

    const origEndFn = window.endBroadcastAndHome;
    window.endBroadcastAndHome = async function () {
        if (drvState) {
            if (drvState.watchId !== null && drvState.watchId !== undefined && navigator.geolocation) {
                try { navigator.geolocation.clearWatch(drvState.watchId); } catch (e) {}
            }
            if (drvState.map) { try { drvState.map.remove(); } catch (e) {} }
            drvState = null;
        }
        if (typeof origEndFn === 'function') return await origEndFn.apply(this, arguments);
    };

    window.initCustomerMapLive = function () {
        if (typeof mapboxgl === 'undefined') return;
        const container = document.getElementById('customer-map-container');
        if (!container) return;
        const params = new URLSearchParams(window.location.search);
        const sid = params.get('session') || params.get('s');
        const headerEl = document.getElementById('cust-driver-header');
        if (!sid) { if (headerEl) headerEl.textContent = 'Invalid tracking link'; return; }
        const database = window.db || (typeof db !== 'undefined' ? db : null);
        if (!database) return;

        mapboxgl.accessToken = window.MAPBOX_TOKEN || MAPBOX_TOKEN || '';
        if (custState && custState.map) { try { custState.map.remove(); } catch (e) {} }

        const map = new mapboxgl.Map({ container: container, style: STYLE_URL, center: [0, 0], zoom: 2 });
        map.addControl(new mapboxgl.NavigationControl(), 'top-right');

        let truckMarker = null, truckRot = null, destMarker = null, fitted = false, lastRouteFetch = 0;

        database.ref('broadcasts/' + sid).on('value', (snap) => {
            const data = snap.val();
            if (!data) return;
            if (headerEl && data.driverName) headerEl.textContent = data.driverName;

            const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
            const haveDest = isFinite(dLat) && isFinite(dLng) && !(dLat === 0 && dLng === 0);
            if (haveDest && !destMarker) {
                const pin = document.createElement('div');
                pin.textContent = '\uD83D\uDCCD';
                pin.style.fontSize = '26px';
                destMarker = new mapboxgl.Marker({ element: pin }).setLngLat([dLng, dLat]).addTo(map);
            }

            const lat = parseFloat(data.lat), lng = parseFloat(data.lng);
            const havePos = isFinite(lat) && isFinite(lng) && !(lat === 0 && lng === 0);
            if (!havePos) return;

            const deg = parseFloat(data.heading) || 0;
            if (!truckMarker) {
                const t = makeTruckElement(deg, data.driverName || 'Driver');
                truckRot = t.rot;
                truckMarker = new mapboxgl.Marker({ element: t.el }).setLngLat([lng, lat]).addTo(map);
            } else {
                truckMarker.setLngLat([lng, lat]);
                if (truckRot) truckRot.style.transform = 'rotate(' + deg.toFixed(1) + 'deg)';
            }

            if (haveDest && !fitted) {
                fitted = true;
                map.fitBounds(new mapboxgl.LngLatBounds([lng, lat], [dLng, dLat]), { padding: 60, duration: 500 });
            } else if (!fitted) {
                fitted = true;
                map.easeTo({ center: [lng, lat], zoom: 15, duration: 400 });
            }

            if (haveDest && Date.now() - lastRouteFetch > 4000) {
                lastRouteFetch = Date.now();
                queryOsrm(lat, lng, dLat, dLng).then((coords) => {
                    if (coords && coords.length) drawRoute(map, coords);
                });
            }
        });
})();
    };
})();
