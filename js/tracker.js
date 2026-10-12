// ==========================================================
// SEEMYDRIVER - GPS ENGINE + MAPS & TELEMETRY (PRODUCTION MASTER)
// v3 + Mutation Observer ETA Guard + Mapbox Integration
// NOTE: app.js owns cold-boot/resume. There is intentionally NO
//       DOMContentLoaded block in this file.
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage || {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k)
};
const $ = (id) => document.getElementById(id);
const MPS_TO_MPH = 2.23694;

// Mapbox Token Integration
const MAPBOX_TOKEN = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQi...'/* truncated for safety */;
const TILE_URL = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}@2x?access_token=' + MAPBOX_TOKEN;

const DEBUG_SPEED = false;
const getDb = () => window.db || (typeof db !== 'undefined' ? db : null);

window.launchLiveBroadcast = function () {
    const driverName = $('job-driver-name').value.trim();
    const driverPhone = $('job-driver-phone').value.trim();
    const custName = $('job-cust-name').value.trim();
    const custPhone = $('job-cust-phone').value.trim();
    const address = $('job-cust-address').value.trim();

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
    LS.setItem('smd_last_tx', String(Date.now()));

    const buffer = new Uint8Array(8);
    window.crypto.getRandomValues(buffer);
    window.activeSessionId = 'smd_' + Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
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

let geocodeTimer = null;
window.handleAddressInput = async function (value) {
    window.cachedDestLat = null;
    window.cachedDestLng = null;
    LS.removeItem('smd_dest_lat');
    LS.removeItem('smd_dest_lng');

    const suggestions = $('address-suggestions');
    if (!suggestions) return;

    clearTimeout(geocodeTimer);
    const query = String(value || '').trim();

    if (query.length < 3) {
        suggestions.classList.add('hidden');
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
        return;
    }

    geocodeTimer = setTimeout(async () => {
        try {
            // Mapbox Geocoding API replacing Photon
            const res = await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(query) + '.json?access_token=' + MAPBOX_TOKEN + '&limit=5&autocomplete=true');
            const data = await res.json();
            suggestions.innerHTML = '';

            if (!data.features || data.features.length === 0) {
                suggestions.classList.add('hidden');
                suggestions.style.display = 'none';
                return;
            }

            data.features.forEach((f) => {
                const name = f.place_name;
                const coords = (f.geometry && f.geometry.coordinates) || null;
                if (!coords) return;

                const div = document.createElement('div');
                div.className = 'px-4 py-3 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-amber-400 cursor-pointer border-b border-neutral-800/80 transition font-medium';
                div.innerText = name;
                div.onpointerdown = (e) => {
                    e.preventDefault();
                    $('job-cust-address').value = name;
                    window.cachedDestLat = coords[1]; // Mapbox returns [lng, lat]
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
    return (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) ? null : { lat: lat, lng: lng };
}

function startsReversed(pts, heading) {
    if (!pts || pts.length < 2 || !Number.isFinite(heading)) return false;
    let i = 1;
    while (i < pts.length - 1 && distM(pts[0][0], pts[0][1], pts[i][0], pts[i][1]) < 50) i++;
    const b = bearingDeg(pts[0][0], pts[0][1], pts[i][0], pts[i][1]);
    return Math.abs(angDelta(heading, b)) > 120;
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
    subs: new Set(), sent: { t: 0, lat: 0, lng: 0 }, stopTimer: null, denied: false, badSince: 0,
    restarts: 0
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

    if (acc > 100) {
        const haveRecent = gps.last && (Date.now() - gps.last.t) < 30000;
        if (haveRecent) {
            setStatus('GPS: weak signal ±' + Math.round(acc) + ' m', false);
            return;
        }
        if (acc > 300) {
            setStatus('GPS: acquiring ±' + Math.round(acc) + ' m', false);
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

    const hasSpeed = Number.isFinite(r.speed) && r.speed >= 0;
    let v = hasSpeed ? r.speed : (prev ? d / dt : 0);
    if (hasSpeed && r.speed === 0 && prev && acc < 30 && dt < 5 && d > Math.max(10, acc) && (d / dt) > 2) {
        v = d / dt;
    }
    gps.speedMps = prev ? gps.speedMps * 0.3 + v * 0.7 : v;
    if (gps.speedMps < 0.5) gps.speedMps = 0;

    let lat = r.lat, lng = r.lng;
    if (prev && gps.speedMps === 0 && d < Math.max(3, acc * 0.5)) { lat = prev.lat; lng = prev.lng; }

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

    setStatus('GPS ±' + Math.round(acc) + ' m' + (DEBUG_SPEED ? ' · raw ' + r.speed : ''), true);
    gps.subs.forEach((fn) => { try { fn(fix); } catch (e) { console.error('GPS subscriber error:', e); } });
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
        console.error('Firebase telemetry update error:', err);
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
            if (err) { console.error('BackgroundGeolocation error:', err); if (err.code === 'NOT_AUTHORIZED') permissionDenied(); return; }
            if (loc) ingest(fromBg(loc));
        }).then((id) => { if (gen === gps.gen) gps.handle = id; else BG.removeWatcher({ id: id }); }).catch((err) => { console.error('BG watcher failed:', err); });
    } else if (NG) {
        gps.kind = 'native';
        NG.watchPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }, (pos, err) => {
            if (err) { console.error('Native Geolocation error:', err); if (err.code === 1 || /denied/i.test(err.message || '')) permissionDenied(); return; }
            if (pos) ingest(fromWeb(pos));
        }).then((id) => { if (gen === gps.gen) gps.handle = id; else NG.clearWatch({ id: id }); }).catch((err) => { console.error('Native watch failed:', err); });
    } else if (navigator.geolocation) {
        gps.kind = 'web';
        gps.handle = navigator.geolocation.watchPosition(
            (p) => ingest(fromWeb(p)),
            (e) => { console.error('Web Geolocation error:', e); if (e.code === 1) permissionDenied(); else setStatus('GPS: searching…', false); },
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
    if (!gps.running || gps.denied) return;
    const limit = 15000 * Math.min(1 + gps.restarts, 4);
    if (Date.now() - gps.lastAlive > limit) {
        gps.restarts++;
        setStatus('GPS: reconnecting…', false);
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
    gps.last = null; gps.lastMoved = null; gps.speedMps = 0; gps.badSince = 0; gps.restarts = 0;
    gps.sent = { t: 0, lat: 0, lng: 0 };
}
window.teardownDriverMap = function () {
    teardownDriver();
    stopGps();
    resetGpsState();
};

function getTruckIcon(bearing) {
    bearing = bearing || 0;
    return L.divIcon({
        className: 'custom-truck-svg-marker',
        html: '' +
            '<div style="transform: rotate(' + bearing + 'deg); transform-origin: 50% 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 6px 10px rgba(0,0,0,0.7));">' +
            '<svg viewBox="0 0 24 36" width="30" height="45" fill="none" xmlns="http://www.w3.org/2000/svg">' +
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
            '</svg></div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
    });
}

function getDriverLabelIcon(name) {
    const safeName = String(name || 'Driver').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
    return L.divIcon({
        className: 'custom-driver-label-marker',
        html: '<div style="transform: translate(-50%, -100%); font-size: 11px; font-weight: 900; color: #000; text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff; white-space: nowrap; letter-spacing: 0.08em; text-transform: uppercase;">' + safeName + '</div>',
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
    if (fromS !== null && fromS !== undefined) {
        const lo = Math.max(0, fromS - 60);
        let a = 0, b = n - 1;
        while (a < b) { const m = (a + b) >> 1; if (cum[m + 1] >= lo) b = m; else a = m + 1; }
        i0 = a;
    }
    const cosL = Math.cos(lat * Math.PI / 180), K = 111320;
    let best = null;
    for (let i = i0; i <= n - 2; i++) {
        if (fromS !== null && fromS !== undefined && cum[i] > fromS + ahead) break;
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

function makeMover(marker, label, onFrame) {
    let cur = null, curH = 0, raf = 0, lastCall = 0, lastFrame = 0;
    let mode = 'll', from, to, hFrom, hTo, t0 = 0, dur = 1;
    let tr = null, curS = 0, sFrom = 0, sTo = 0, offLat = 0, offLng = 0;
    let vMps = 0;
    const MAX_COAST_MS = 15000;

    function paint() {
        marker.setLatLng(cur);
        if (label) label.setLatLng(cur);
        const el = marker.getElement();
        if (el && el.firstElementChild) el.firstElementChild.style.transform = 'rotate(' + curH + 'deg)';
    }

    function frame() {
        const nowT = performance.now();
        const k = Math.max(0, Math.min(1, (nowT - t0) / dur));
        let coasting = false;
        if (mode === 's') {
            if (k < 1) {
                curS = sFrom + (sTo - sFrom) * k;
            } else {
                const c = Math.min(nowT - (t0 + dur), MAX_COAST_MS);
                curS = Math.min(tr.total, sTo + vMps * (c / 1000) * (1 - c / (2 * MAX_COAST_MS)));
                coasting = vMps > 0.5 && c < MAX_COAST_MS && curS < tr.total;
            }
            const p = trackPoint(tr, curS), rest = 1 - k;
            cur = { lat: p.lat + offLat * rest, lng: p.lng + offLng * rest };
            const b = trackBearing(tr, curS);
            if (b !== null) {
                const dtf = lastFrame ? Math.min(50, nowT - lastFrame) : 16;
                const a = 1 - Math.exp(-dtf / 150);
                curH = (curH + angDelta(curH, b) * a + 360) % 360;
            }
        } else {
            cur = { lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k };
            curH = (hFrom + angDelta(hFrom, hTo) * k + 360) % 360;
        }
        lastFrame = nowT;
        paint();
        if (onFrame) onFrame(cur, mode === 's' ? curS : null, mode === 's' ? tr : null);
        raf = (k < 1 || coasting) ? requestAnimationFrame(frame) : 0;
    }

    return {
        moveTo(lat, lng, h, track, s, ms, speedMps) {
            const now = performance.now();
            cancelAnimationFrame(raf);
            vMps = (Number.isFinite(speedMps) && speedMps > 0) ? speedMps : 0;
            if (!cur) { cur = { lat: lat, lng: lng }; curH = Number.isFinite(h) ? h : 0; }
            dur = Math.max(300, Math.min(4000, ms || (lastCall ? now - lastCall : 1)));
            lastCall = now; t0 = now;

            if (track && s !== null && s !== undefined) {
                if (tr !== track || mode !== 's') {
                    const pr = trackProject(track, cur.lat, cur.lng, s, 150);
                    curS = (pr && pr.d < 100) ? pr.s : s;
                }
                tr = track; mode = 's';
                sFrom = curS; sTo = Math.max(s, curS);
                const p0 = trackPoint(track, sFrom);
                offLat = cur.lat - p0.lat; offLng = cur.lng - p0.lng;
            } else {
                mode = 'll'; tr = null;
                from = cur; hFrom = curH; to = { lat: lat, lng: lng }; hTo = Number.isFinite(h) ? h : curH;
            }
            frame();
        },
        pos: () => cur,
        stop() { cancelAnimationFrame(raf); }
    };
}

function pinIcon() {
    return L.divIcon({ className: 'custom-pin-marker', html: '<div style="font-size:28px;">📍</div>', iconSize: [32, 32], iconAnchor: [16, 32] });
}

function makeMap(box, zoomControl) {
    const map = L.map(box, { zoomControl: zoomControl, zoomAnimation: true });
    L.tileLayer(TILE_URL, {
        maxZoom: 19,
        keepBuffer: 4,
        updateWhenIdle: false,
        attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a>'
    }).addTo(map);
    [0, 250, 700].forEach((ms) => setTimeout(() => { try { map.invalidateSize(); } catch (e) {} }, ms));
    return map;
}

function routeManager(map, color) {
    let line = null, track = null, lastFetch = 0, busy = false;
    let offCount = 0, offSince = 0, prog = null, destKey = '', lastTrim = 0;
    const HOLD_MS = 6000, HOLD_MAX_OFFSET = 90;

    async function fetchRoute(lat, lng, dLat, dLng, heading) {
        const base = 'https://router.project-osrm.org/route/v1/driving/' + lng + ',' + lat + ';' + dLng + ',' + dLat + '?overview=full&geometries=geojson';
        const urls = (Number.isFinite(heading) ? [base + '&bearings=' + Math.round(heading) + ',60;'] : []).concat([base]);
        for (const url of urls) {
            const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 8000);
            try {
                const j = await (await fetch(url, { signal: ctl.signal })).json();
                if (j.code === 'Ok' && j.routes && j.routes[0]) {
                    return { pts: j.routes[0].geometry.coordinates.map((c) => [c[1], c[0]]), dur: j.routes[0].duration, dist: j.routes[0].distance };
                }
            } catch (e) {} finally { clearTimeout(to); }
        }
        return null;
    }

    return {
        async update(lat, lng, dLat, dLng, opts) {
            opts = opts || {};
            const now = Date.now(), key = dLat + ',' + dLng, off = offSince > 0 && (now - offSince) >= HOLD_MS;
            const need = !track || key !== destKey || off || opts.force;
            if (busy || !need) return null;
            if (now - lastFetch < (off ? 2000 : 3000)) return null;
            busy = true; lastFetch = now;
            const r = await fetchRoute(lat, lng, dLat, dLng, opts.moving ? opts.heading : NaN);
            busy = false;
            if (r && r.pts.length > 1) {
                if (opts.moving && Number.isFinite(opts.heading) && startsReversed(r.pts, opts.heading)) return null;
                track = buildTrack(r.pts, r.dur, r.dist);
                destKey = key; offCount = 0; offSince = 0; prog = null;
                try { if (line) line.setLatLngs(r.pts); else line = L.polyline(r.pts, { color: color, weight: 6, opacity: 0.95, lineJoin: 'round' }).addTo(map); } catch (e) {}
                return r;
            }
            return null;
        },

        snap(lat, lng, acc, moving, dtSec, speedMps) {
            if (!track) return { snapped: false };
            const limit = Math.min(150, Math.max(30, (Number.isFinite(acc) ? acc : 0) * 1.5));
            const ahead = Math.max(300, (speedMps || 0) * (dtSec || 0) * 1.5 + 150);
            const r = trackProject(track, lat, lng, prog, ahead);
            if (r && r.d <= limit) {
                offCount = 0; offSince = 0;
                prog = prog === null ? r.s : Math.max(prog, r.s);
                const p = trackPoint(track, prog);
                return {
                    snapped: true, lat: p.lat, lng: p.lng, bearing: trackBearing(track, prog),
                    track: track, s: prog, remaining: track.total - prog,
                    etaSec: track.total > 0 ? track.dur * (track.total - prog) / track.total : 0
                };
            }
            const nowMs = Date.now();
            if (!offSince) offSince = nowMs;
            offCount++;
            if (prog !== null && r && r.d < HOLD_MAX_OFFSET && (speedMps || 0) > 1 && (nowMs - offSince) < HOLD_MS) {
                prog = Math.min(track.total, prog + (speedMps || 0) * Math.min(dtSec || 0, 3));
                const hp = trackPoint(track, prog);
                return {
                    snapped: true, held: true, lat: hp.lat, lng: hp.lng, bearing: trackBearing(track, prog),
                    track: track, s: prog, remaining: track.total - prog,
                    etaSec: track.total > 0 ? track.dur * (track.total - prog) / track.total : 0
                };
            }
            return { snapped: false, off: (nowMs - offSince) >= HOLD_MS };
        },

        trim(tr, s) {
            if (!line || tr !== track) return;
            const now = performance.now();
            if (now - lastTrim < 300) return;
            lastTrim = now;
            const p = trackPoint(tr, s);
            try { line.setLatLngs([[p.lat, p.lng]].concat(tr.pts.slice(p.i + 1))); } catch (e) {}
        },
        getTrack: () => track
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
    badge.textContent = 'GPS: acquiring…';
    host.appendChild(badge);

    D = { map: map, follow: true, mover: null, route: routeManager(map, '#1d4ed8'), viewSet: false, truck: null, label: null, lastT: 0 };
    const me = D;
    map.on('dragstart', () => { me.follow = false; });

    const dest = getDest();
    if (dest) {
        L.marker([dest.lat, dest.lng], { icon: pinIcon() }).addTo(map);
        map.setView([dest.lat, dest.lng], 13, { animate: false });
    }

    me.off = subscribe((fix) => {
        if (D !== me) return;

        let lat = fix.lat, lng = fix.lng, heading = fix.heading, trk = null, sPos = null;
        const moving = fix.speedMph > 2;
        const gap = me.lastT ? fix.t - me.lastT : 0;
        me.lastT = fix.t;
        const spMps = fix.speedMph / MPS_TO_MPH;

        if (dest) {
            me.route.update(lat, lng, dest.lat, dest.lng, { heading: fix.heading, moving: moving });
            const sn = me.route.snap(lat, lng, fix.acc, moving, gap / 1000, spMps);
            if (sn.snapped) {
                lat = sn.lat; lng = sn.lng; trk = sn.track; sPos = sn.s;
                if (sn.bearing !== null) heading = sn.bearing;
            }
        }

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
        me.mover.moveTo(lat, lng, heading, trk, sPos, gap > 0 ? gap : 1000, spMps);
        const sp = $('driver-map-speed');
        if (sp) sp.textContent = fix.speedMph + ' mph';
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

function trackingUrl() {
    const base = 'https://www.seemydriver.com';
    const bk = LS.getItem('smd_brand_key');
    let u = window.activeTrackingUrl || (base + '/?view=customer&session=' + sessionId());
    if (bk && u.indexOf('brand=') === -1) u += (u.indexOf('?') === -1 ? '?' : '&') + 'brand=' + encodeURIComponent(bk);
    return u;
}

window.copyTrackingLink = async function () {
    const u = trackingUrl();
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
            await Promise.race([
                database.ref('broadcasts/' + sid).update({ ended: true, timestamp: Date.now() }),
                new Promise((resolve) => setTimeout(resolve, 3000))
            ]);
        }
    } catch (e) {
        console.error('End broadcast error:', e);
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

// ----------------------------------------------------------
// CUSTOMER MAP & ETA GUARD
// ----------------------------------------------------------
function humanizeEtaText(t) {
    return t.replace(/(\d[\d,]*)\s*(?:mins?|minutes?)\b/gi, (m, num) => {
        const total = parseInt(num.replace(/,/g, ''), 10);
        if (!(total >= 60)) return m;
        const h = Math.floor(total / 60), r = total % 60;
        const hw = h === 1 ? ' hr' : ' hrs';
        return r ? h + hw + ' ' + r + ' mins' : h + hw;
    });
}

function installEtaGuard() {
    const root = $('customer-view-view');
    if (!root || root.__etaGuard) return;
    root.__etaGuard = true;
    const sweep = () => {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            const t = n.nodeValue;
            if (t && /min/i.test(t)) {
                const out = humanizeEtaText(t);
                if (out !== t) n.nodeValue = out;
            }
        }
    };
    new MutationObserver(sweep).observe(root, { childList: true, subtree: true, characterData: true });
    sweep();
}

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
    installEtaGuard();
    const box = $('customer-map-container');
    if (!box || typeof L === 'undefined') return;
    teardownCustomer();

    const q = new URLSearchParams(window.location.search);
    const sid = q.get('session') || q.get('s');
    const head = $('cust-driver-header'), sub = $('cust-eta-sub'), pill = $('cust-status-pill'), distEl = $('cust-distance'), speedEl = $('cust-speed');
    if (!sid) { if (head) head.textContent = (q.get('brand') || q.get('co')) ? 'Waiting for your driver…' : 'Invalid tracking link'; return; }

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

    const formatEta = (totalMins) => {
        const mins = Math.max(1, Math.round(totalMins));
        if (mins >= 60) {
            const hrs = Math.floor(mins / 60), m = mins % 60;
            const hw = hrs === 1 ? ' hr' : ' hrs';
            return m > 0 ? hrs + hw + ' ' + m + ' mins' : hrs + hw;
        }
        return mins + ' mins';
    };

    me.ref = database.ref('broadcasts/' + sid);
    me.cb = me.ref.on('value', (snap) => {
        if (C !== me) return;
        const data = snap.val();

        if (!data) {
            me.waiting = true;
            if (head) head.textContent = 'Waiting for driver…';
            setPill('● Waiting', false);
            return;
        }

        const fresh = data.timestamp !== me.lastTs;
        const tsGap = (fresh && me.lastTs) ? (data.timestamp - me.lastTs) : 0;
        if (fresh) { me.lastTs = data.timestamp; me.lastChange = Date.now(); }
        if (data.ended) {
            me.ended = true; me.waiting = false;
            if (head) head.textContent = (data.driverName || 'Driver') + ' — trip ended';
            setPill('● Trip ended', false);
            return;
        }

        let lat = parseFloat(data.lat), lng = parseFloat(data.lng);
        const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
        const hRaw = parseFloat(data.heading);
        let heading = Number.isFinite(hRaw) ? hRaw : 0;
        let trk = null, sPos = null;
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

        const havePos = Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);
        if (!havePos) {
            me.waiting = true;
            setPill('● Waiting for driver GPS…', false);
            if (sub) sub.textContent = '-- mins';
            if (distEl) distEl.textContent = '-- mi';
            return;
        }
        me.waiting = false;

        me.speed = Math.round(data.speed || 0);
        const spMps = me.speed / MPS_TO_MPH;
        setPill('● Connected', true);
        if (speedEl) speedEl.textContent = me.speed + ' mph';

        if (haveDest) {
            const moving = me.speed > 2;
            me.route.update(lat, lng, dLat, dLng, { heading: heading, moving: moving }).then((r) => {
                if (r && C === me) {
                    me.etaMin = Math.max(1, Math.round(r.dur / 60));
                    me.roadMi = r.dist / 1609.34;
                    if (sub) sub.textContent = formatEta(me.etaMin);
                    if (distEl) distEl.textContent = me.roadMi.toFixed(1) + ' mi';
                }
            });
            const sn = me.route.snap(lat, lng, parseFloat(data.accuracy), moving, tsGap / 1000, spMps);
            if (sn.snapped) {
                lat = sn.lat; lng = sn.lng; trk = sn.track; sPos = sn.s;
                if (sn.bearing !== null) heading = sn.bearing;
                me.etaMin = Math.max(1, Math.round(sn.etaSec / 60));
                me.roadMi = sn.remaining / 1609.34;
                if (sub) sub.textContent = formatEta(me.etaMin);
                if (distEl) distEl.textContent = me.roadMi.toFixed(1) + ' mi';
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
        me.mover.moveTo(lat, lng, heading, trk, sPos, tsGap > 0 ? tsGap : 1500, spMps);

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
        if (Date.now() - me.lastChange > 20000) setPill('● GPS weak — estimating position', false);
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

})();