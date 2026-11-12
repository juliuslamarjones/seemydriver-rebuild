// ==========================================================
// SEEMYDRIVER - 3D GPS ENGINE (route-snapped, glide-smoothed)
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage;
const MPS_TO_MPH = 2.23694;
const ENGINE_VERSION = 'v68-stable-geo';
const HEADING_UP = false;

// Unrestricted Default public Mapbox token
const MAPBOX_TOKEN = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.Ex0EVNUoTyEeWQiH0jqMQ';
mapboxgl.accessToken = MAPBOX_TOKEN;

const $ = (id) => document.getElementById(id);
const getDb = () => window.db || (typeof db !== 'undefined' ? db : null);

const OSM_STYLE = {
    version: 8,
    sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '&copy; OpenStreetMap contributors' } },
    layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }]
};

const M_PER_DEG = 111194.9;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;
const normDeg = (d) => ((d % 360) + 360) % 360;
const angleDiff = (from, to) => ((to - from + 540) % 360) - 180;

function distM(lng1, lat1, lng2, lat2) {
    const dx = (lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2)) * M_PER_DEG;
    const dy = (lat2 - lat1) * M_PER_DEG;
    return Math.hypot(dx, dy);
}

function bearingBetween(lng1, lat1, lng2, lat2) {
    const dx = (lng2 - lng1) * Math.cos(toRad((lat1 + lat2) / 2));
    const dy = lat2 - lat1;
    return normDeg(toDeg(Math.atan2(dx, dy)));
}

function makeProjector(lat0, lng0) {
    const kx = Math.cos(toRad(lat0)) * M_PER_DEG, ky = M_PER_DEG;
    return {
        toXY: (lng, lat) => [(lng - lng0) * kx, (lat - lat0) * ky],
        toLngLat: (x, y) => [lng0 + x / kx, lat0 + y / ky]
    };
}

function buildRoute(coords, durationSec) {
    const proj = makeProjector(coords[0][1], coords[0][0]);
    const pts = coords.map((c) => proj.toXY(c[0], c[1]));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
        cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    return { coords, proj, pts, cum, length: cum[cum.length - 1], duration: durationSec || 0 };
}

function snapToRoute(route, lng, lat, hintS, backM, fwdM) {
    const p = route.proj.toXY(lng, lat);
    const pts = route.pts, cum = route.cum;
    let bestD = Infinity, bestS = 0;
    for (let i = 0; i < pts.length - 1; i++) {
        if (hintS !== null && (cum[i + 1] < hintS - backM || cum[i] > hintS + fwdM)) continue;
        const ax = pts[i][0], ay = pts[i][1];
        const dx = pts[i + 1][0] - ax, dy = pts[i + 1][1] - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 > 0 ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const d = Math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy));
        if (d < bestD) { bestD = d; bestS = cum[i] + t * Math.sqrt(len2); }
    }
    return { dist: bestD, s: bestS };
}

function pointAtS(route, s) {
    const cum = route.cum, pts = route.pts;
    s = s < 0 ? 0 : (s > route.length ? route.length : s);
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const segLen = cum[hi] - cum[lo];
    const t = segLen > 0 ? (s - cum[lo]) / segLen : 0;
    const x = pts[lo][0] + (pts[hi][0] - pts[lo][0]) * t;
    const y = pts[lo][1] + (pts[hi][1] - pts[lo][1]) * t;
    const ll = route.proj.toLngLat(x, y);
    return { lng: ll[0], lat: ll[1], x, y };
}

function bearingAtS(route, s) {
    const s0 = Math.max(0, Math.min(s, route.length - 12));
    const a = pointAtS(route, s0), b = pointAtS(route, s0 + 12);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return null;
    return normDeg(toDeg(Math.atan2(b.x - a.x, b.y - a.y)));
}

function estimateMotion(hist, now) {
    if (hist.length < 4) return null;
    let accSum = 0;
    for (const h of hist) accSum += h.acc;
    const avgAcc = accSum / hist.length;
    const win = avgAcc > 40 ? 20000 : 8000;
    const pts = hist.filter((h) => now - h.t <= win);
    if (pts.length < 4) return null;
    const span = (pts[pts.length - 1].t - pts[0].t) / 1000;
    if (span < (avgAcc > 40 ? 8 : 3)) return null;
    const p0 = pts[0], n = pts.length;
    const k = Math.cos(toRad(p0.lat)) * M_PER_DEG;
    const ts = pts.map((h) => (h.t - p0.t) / 1000);
    const xs = pts.map((h) => (h.lng - p0.lng) * k);
    const ys = pts.map((h) => (h.lat - p0.lat) * M_PER_DEG);
    const mean = (a) => a.reduce((s, v) => s + v, 0) / n;
    const tm = mean(ts), xm = mean(xs), ym = mean(ys);
    let sxx = 0, sxt = 0, syt = 0;
    for (let i = 0; i < n; i++) {
        const dt = ts[i] - tm;
        sxx += dt * dt; sxt += dt * (xs[i] - xm); syt += dt * (ys[i] - ym);
    }
    if (sxx < 1e-6) return null;
    const vx = sxt / sxx, vy = syt / sxx;
    const speed = Math.hypot(vx, vy);
    const noise = (avgAcc * 0.7) / Math.sqrt(sxx);
    const moving = speed > Math.max(1.5, noise * 2.5);
    return { speed: moving ? speed : 0, heading: moving ? normDeg(toDeg(Math.atan2(vx, vy))) : null };
}

function formatEta(seconds) {
    const mins = Math.max(1, Math.round(seconds / 60));
    if (mins < 60) return mins + ' mins';
    const h = Math.floor(mins / 60), m = mins % 60;
    return m > 0 ? h + ' hr ' + m + ' mins' : h + ' hr';
}

function toast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#fbbf24;color:#000;font:700 12px sans-serif;padding:10px 16px;border-radius:12px;z-index:99999';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
}

const broadcasting = () => LS.getItem('smd_active_broadcast') === 'true';
const sessionId = () => window.activeSessionId || LS.getItem('smd_session_id');

function compId() {
    const u = window.firebase && window.firebase.auth ? window.firebase.auth().currentUser : null;
    return (u && u.uid) || window.activeCompanyUuid || LS.getItem('smd_comp_uuid') || null;
}
function broadcastRef(database, sid, comp) {
    return comp ? database.ref('companies/' + comp + '/broadcasts/' + sid) : database.ref('broadcasts/' + sid);
}
function trackingLink() {
    const comp = compId();
    return 'https://www.seemydriver.com/?view=customer' + (comp ? '&comp=' + encodeURIComponent(comp) : '') + '&session=' + sessionId();
}

function getDest() {
    const lat = parseFloat(LS.getItem('smd_dest_lat')), lng = parseFloat(LS.getItem('smd_dest_lng'));
    return (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) ? null : { lat, lng };
}

window.launchLiveBroadcast = function() {
    const authUser = window.firebase && window.firebase.auth ? window.firebase.auth().currentUser : null;
    if (!authUser) {
        alert('Please sign in to start a broadcast.');
        return;
    }

    const driverName = $('job-driver-name').value.trim();
    const driverPhone = $('job-driver-phone').value.trim();
    const custName = $('job-cust-name').value.trim();
    const custPhone = $('job-cust-phone').value.trim();
    const companyName = $('job-company-name') ? $('job-company-name').value.trim() : '';
    const address = $('job-cust-address').value.trim();

    const destLat = parseFloat(LS.getItem('smd_dest_lat'));
    const destLng = parseFloat(LS.getItem('smd_dest_lng'));

    if (!driverName || !address) {
        alert('Please enter a driver name and destination address.');
        return;
    }

    if (isNaN(destLat) || isNaN(destLng) || (destLat === 0 && destLng === 0)) {
        alert('Please select a valid destination address from autocomplete.');
        return;
    }

    LS.setItem('smd_driver_name', driverName);
    LS.setItem('smd_driver_phone', driverPhone);
    LS.setItem('smd_cust_name', custName);
    LS.setItem('smd_cust_phone', custPhone);
    LS.setItem('smd_company_name', companyName);
    LS.setItem('smd_cust_address', address);
    LS.setItem('smd_active_broadcast', 'true');
    LS.setItem('smd_started_at', String(Date.now()));

    const buffer = new Uint8Array(8);
    window.crypto.getRandomValues(buffer);
    window.activeSessionId = 'smd_' + Array.from(buffer, b => b.toString(16).padStart(2, '0')).join('');
    LS.setItem('smd_session_id', window.activeSessionId);

    const sid = sessionId();
    const database = getDb();
    const comp = authUser.uid;
    window.activeCompanyUuid = comp;
    LS.setItem('smd_comp_uuid', comp);

    if (database) {
        broadcastRef(database, sid, comp).set({
            ownerUid: comp,
            driverName: driverName,
            driverPhone: driverPhone,
            companyName: companyName,
            destLat: destLat,
            destLng: destLng,
            destAddress: address,
            speed: 0,
            heading: 0,
            timestamp: Date.now()
        }).catch((err) => {
            console.error('Firebase broadcast init failed:', err);
            if (err && err.code === 'PERMISSION_DENIED') broadcastDenied();
        });
    }

    window.switchView('active-broadcast');
    if (typeof window.startRealTimeTracking === 'function') {
        window.startRealTimeTracking();
    }
};

function broadcastDenied() {
    LS.removeItem('smd_active_broadcast');
    LS.removeItem('smd_session_id');
    LS.removeItem('smd_started_at');
    window.activeSessionId = undefined;
    try { window.stopRealTimeTracking(); } catch (e) {}
    try { teardownDriver(); } catch (e) {}
    alert('Your broadcast could not start. Your free trial may have ended, or your account has not been verified yet. Please sign out and sign back in.');
    window.switchView('job-setup-view');
}

let geocodeTimer = null;
window.handleAddressInput = async function(value) {
    window.cachedDestLat = null;
    window.cachedDestLng = null;
    LS.removeItem('smd_dest_lat');
    LS.removeItem('smd_dest_lng');
    
    let suggestions = document.getElementById('address-suggestions');
    const inputField = document.getElementById('job-cust-address');
    
    if (!suggestions && inputField && inputField.parentNode) {
        suggestions = document.createElement('div');
        suggestions.id = 'address-suggestions';
        inputField.parentNode.style.position = 'relative';
        inputField.parentNode.appendChild(suggestions);
    }
    
    if (!suggestions) return;

    suggestions.style.cssText = "position: absolute; top: 100%; left: 0; right: 0; margin-top: 4px; background: #161923; border: 1px solid #262626; border-radius: 12px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.8); max-height: 220px; overflow-y: auto; z-index: 99999;";

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
            const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&types=address,poi&limit=5`);
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
                div.style.cssText = "padding: 12px 16px; font-size: 13px; color: #e5e5e5; cursor: pointer; border-bottom: 1px solid #262626; background: #161923;";
                div.innerText = name;
                
                div.onpointerdown = (e) => {
                    e.preventDefault();
                    if (inputField) inputField.value = name;
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

const gps = { running: false, last: null, handle: null, wake: null, lastSend: 0, deniedToastAt: 0 };

function ingest(pos) {
    const c = pos.coords;
    const fix = {
        lat: c.latitude,
        lng: c.longitude,
        speedMs: (c.speed !== null && isFinite(c.speed)) ? c.speed : null,
        heading: (c.heading !== null && isFinite(c.heading)) ? c.heading : null,
        acc: c.accuracy || 0,
        t: pos.timestamp || Date.now()
    };
    fix.speedMph = Math.round((fix.speedMs || 0) * MPS_TO_MPH);
    gps.last = fix;

    let out = { lat: fix.lat, lng: fix.lng, heading: Math.round(fix.heading || 0), speedMph: fix.speedMph };
    if (D && D.handleFix) {
        out = D.handleFix(fix);
        if (!out) return;
    }
    sendFirebase(out);
}

function sendFirebase(out) {
    const database = getDb();
    if (!out || !broadcasting() || !database) return;
    const sid = sessionId();
    const comp = compId();
    if (!sid || !comp) return;
    const now = Date.now();
    if (now - gps.lastSend < 1500) return;
    gps.lastSend = now;

    broadcastRef(database, sid, comp).update({
        lat: out.lat,
        lng: out.lng,
        speed: out.speedMph,
        heading: out.heading,
        timestamp: now
    }).catch((err) => {
        console.error('Firebase update error:', err);
        const signedIn = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        if (err && err.code === 'PERMISSION_DENIED' && signedIn && now - gps.deniedToastAt > 30000) {
            gps.deniedToastAt = now;
            toast('Broadcast paused: subscription inactive');
        }
    });
}

function setBadge(text, ok) {
    document.querySelectorAll('.smd-gps-badge').forEach((b) => {
        b.textContent = text + ' · ' + ENGINE_VERSION;
        b.style.color = ok ? '#fbbf24' : '#f87171';
    });
}

function onGpsError(e) {
    console.error('GPS error:', e);
    setBadge('GPS: ' + (e && e.message ? e.message : 'no signal'), false);
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator && gps.running) gps.wake = await navigator.wakeLock.request('screen');
    } catch (e) {}
}

function watchGps() {
    if (!navigator.geolocation) return;
    if (gps.handle !== null) { try { navigator.geolocation.clearWatch(gps.handle); } catch (e) {} }
    gps.handle = navigator.geolocation.watchPosition(ingest, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}

window.startRealTimeTracking = function () {
    if (gps.running) return;
    gps.running = true;
    watchGps();
    requestWakeLock();
};

window.stopRealTimeTracking = function () {
    gps.running = false;
    if (gps.handle !== null) {
        try { navigator.geolocation.clearWatch(gps.handle); } catch (e) {}
        gps.handle = null;
    }
    try { if (gps.wake) gps.wake.release(); } catch (e) {}
    gps.wake = null;
    LS.removeItem('smd_active_broadcast');
};

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (gps.running) {
        requestWakeLock();
        if (!gps.last || Date.now() - gps.last.t > 5000) watchGps();
    }
    if (C && C.resync) C.resync();
});

function createTruckElement() {
    const el = document.createElement('div');
    el.style.cssText = 'width:36px;height:54px;filter:drop-shadow(0px 8px 10px rgba(0,0,0,0.55));pointer-events:none;';
    el.innerHTML = `<svg viewBox="0 0 24 36" width="36" height="54" fill="none" xmlns="http://www.w3.org/2000/svg" style="transform: translateZ(10px);">
                <rect x="1" y="8" width="4" height="8" rx="1.5" fill="#030712" stroke="#fbbf24" stroke-width="0.75"/>
                <rect x="19" y="8" width="4" height="8" rx="1.5" fill="#030712" stroke="#fbbf24" stroke-width="0.75"/>
                <rect x="1" y="24" width="4" height="8" rx="1.5" fill="#030712" stroke="#fbbf24" stroke-width="0.75"/>
                <rect x="19" y="24" width="4" height="8" rx="1.5" fill="#030712" stroke="#fbbf24" stroke-width="0.75"/>
                <rect x="3.5" y="11" width="17" height="22" rx="3" fill="#1f2937" stroke="#fbbf24" stroke-width="1.25"/>
                <rect x="3.5" y="20" width="17" height="4" fill="#f59e0b"/>
                <line x1="3.5" y1="22" x2="20.5" y2="22" stroke="#ffffff" stroke-width="1" opacity="0.9"/>
                <path d="M5.5 11H18.5V5C18.5 3.34315 17.1569 2 15.5 2H8.5C6.84315 2 5.5 3.34315 5.5 5V11Z" fill="#111827" stroke="#374151" stroke-width="1.25"/>
                <path d="M7 7.5H17L16 4H8L7 7.5Z" fill="#38bdf8" fill-opacity="0.95" stroke="#bae6fd" stroke-width="0.75"/>
                <circle cx="6.5" cy="3" r="1.25" fill="#fbbf24"/>
                <circle cx="17.5" cy="3" r="1.25" fill="#fbbf24"/>
            </svg>`;
    return el;
}

function createPinElement() {
    const el = document.createElement('div');
    el.textContent = '📍';
    el.style.cssText = 'font-size:28px;line-height:28px;';
    return el;
}

function createTripEngine(map, opts) {
    const dest = opts.dest || null;
    const E = {
        running: true, follow: true, raf: 0,
        route: null, routeLoading: false, routeRetryAt: 0,
        offCount: 0, offSince: 0, lastRerouteAt: 0,
        marker: null, hasFix: false, snapped: false, pendingBlend: false,
        fixAt: 0, fixLng: 0, fixLat: 0, speedMs: 0, headingDeg: null,
        moveLng: 0, moveLat: 0,
        sRef: 0, rS: 0, dir: 1,
        refLng: 0, refLat: 0, freeLng: 0, freeLat: 0,
        rBearing: 0, offLng: 0, offLat: 0,
        drawLng: 0, drawLat: 0, lastFrame: 0,
        lastLine: 0, arrived: false, arriveCount: 0, nearCount: 0, backCount: 0, backSince: 0, dirVotes: 0, sHist: [], hist: []
    };

    function drawRoute(coords, attempt) {
        if (!E.running) return;
        const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
        try {
            const src = map.getSource('route-source');
            if (src) {
                src.setData(data);
            } else {
                map.addSource('route-source', { type: 'geojson', data: data });
                map.addLayer({
                    id: 'route-line', type: 'line', source: 'route-source',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#1d4ed8', 'line-width': 6, 'line-opacity': 0.9 }
                });
            }
        } catch (e) {
            if ((attempt || 0) < 25) setTimeout(() => drawRoute(coords, (attempt || 0) + 1), 300);
        }
    }

    async function fetchRoute(fromLng, fromLat, headingDeg) {
        if (!dest || E.routeLoading || !E.running) return;
        E.routeLoading = true;
        const base = 'https://router.project-osrm.org/route/v1/driving/' + fromLng + ',' + fromLat + ';' + dest.lng + ',' + dest.lat + '?overview=full&geometries=geojson';
        const get = async (url) => (await fetch(url)).json();
        try {
            let data = null;
            if (headingDeg !== null && headingDeg !== undefined && E.speedMs > 2) {
                try { data = await get(base + '&bearings=' + Math.round(normDeg(headingDeg)) + ',90;'); } catch (e) { data = null; }
            }
            if (!data || data.code !== 'Ok') data = await get(base);
            if (!E.running) return;
            if (data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry.coordinates.length > 1) {
                const r = data.routes[0];
                E.route = buildRoute(r.geometry.coordinates, r.duration);
                E.snapped = false;
                E.refLng = E.freeLng = E.drawLng;
                E.refLat = E.freeLat = E.drawLat;
                E.offCount = 0; E.offSince = 0; E.nearCount = 0; E.backCount = 0; E.dirVotes = 0; E.sHist = []; E.dir = 1;
                E.sRef = 0; E.rS = 0; E.offLng = 0; E.offLat = 0;
                drawRoute(r.geometry.coordinates, 0);
            } else {
                E.routeRetryAt = performance.now() + 8000;
            }
        } catch (e) {
            console.error('Route fetch error:', e);
            E.routeRetryAt = performance.now() + 8000;
        } finally {
            E.routeLoading = false;
        }
    }

    function alignToTravel(routeBearing) {
        return E.dir < 0 ? normDeg(routeBearing + 180) : routeBearing;
    }

    function output() {
        let lng = E.refLng, lat = E.refLat;
        let heading = E.headingDeg !== null ? E.headingDeg : E.rBearing;
        if (E.snapped && E.route) {
            const p = pointAtS(E.route, E.sRef);
            lng = p.lng; lat = p.lat;
            const b = bearingAtS(E.route, E.sRef);
            if (b !== null) heading = alignToTravel(b);
        }
        return { lat: lat, lng: lng, heading: Math.round(normDeg(heading)), speedMph: Math.round(E.speedMs * MPS_TO_MPH) };
    }

    const clampS = (s) => (s < 0 ? 0 : (s > E.route.length ? E.route.length : s));

    function updateLine(now) {
        if (!E.route || now - E.lastLine < 200) return;
        E.lastLine = now;
        try {
            const src = map.getSource('route-source');
            if (!src) return;
            const r = E.route;
            const s = E.snapped ? E.rS : E.sRef;
            if (E.arrived || r.length - s < 25) {
                src.setData({ type: 'FeatureCollection', features: [] });
                return;
            }
            let lo = 0, hi = r.cum.length - 1;
            while (hi - lo > 1) {
                const mid = (lo + hi) >> 1;
                if (r.cum[mid] <= s) lo = mid; else hi = mid;
            }
            const p = pointAtS(r, s);
            src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[p.lng, p.lat']].concat(r.coords.slice(hi)) } });
        } catch (e) {}
    }

    function frame(now) {
        if (!E.running) return;
        E.raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, Math.max(0.001, (now - E.lastFrame) / 1000));
        E.lastFrame = now;
        if (!E.hasFix) return;

        const age = (now - E.fixAt) / 1000;
        const v = age < 4 ? E.speedMs : 0;

        let baseLng, baseLat, targetBearing;
        if (E.snapped && E.route) {
            const step = E.dir * v * dt;
            E.sRef = clampS(E.sRef + step);
            E.rS = clampS(E.rS + step);
            const maxCatch = Math.max(12, v * 1.5) * dt;
            const corr = (E.sRef - E.rS) * (1 - Math.exp(-dt / 0.5));
            E.rS += Math.max(-maxCatch, Math.min(maxCatch, corr));
            const p = pointAtS(E.route, E.rS);
            baseLng = p.lng; baseLat = p.lat;
            const b = bearingAtS(E.route, E.rS);
            targetBearing = b !== null ? alignToTravel(b) : E.rBearing;
        } else {
            const h = E.headingDeg !== null ? E.headingDeg : E.rBearing;
            const dLat = (v * dt * Math.cos(toRad(h))) / M_PER_DEG;
            const dLng = (v * dt * Math.sin(toRad(h))) / (M_PER_DEG * Math.cos(toRad(E.refLat)));
            E.refLat += dLat; E.refLng += dLng;
            E.freeLat += dLat; E.freeLng += dLng;
            const k = 1 - Math.exp(-dt / 0.5);
            let ex = (E.refLng - E.freeLng) * k, ey = (E.refLat - E.freeLat) * k;
            const mag = Math.hypot(ex * M_PER_DEG * Math.cos(toRad(E.refLat)), ey * M_PER_DEG);
            const cap = Math.max(12, v * 1.5) * dt;
            if (mag > cap) { ex *= cap / mag; ey *= cap / mag; }
            E.freeLng += ex; E.freeLat += ey;
            baseLng = E.freeLng; baseLat = E.freeLat;
            targetBearing = h;
        }

        if (E.speedMs < 1.5) {
            if (!(E.snapped && E.route) || Math.abs(angleDiff(E.rBearing, targetBearing)) > 100) targetBearing = E.rBearing;
        }

        if (E.pendingBlend) {
            E.offLng = E.drawLng - baseLng;
            E.offLat = E.drawLat - baseLat;
            E.pendingBlend = false;
        }
        const decay = Math.exp(-dt / 0.45);
        E.offLng *= decay; E.offLat *= decay;

        const lng = baseLng + E.offLng, lat = baseLat + E.offLat;
        E.rBearing = normDeg(E.rBearing + angleDiff(E.rBearing, targetBearing) * (1 - Math.exp(-dt / 0.25)));
        E.drawLng = lng; E.drawLat = lat;

        E.marker.setLngLat([lng, lat]);
        E.marker.setRotation(E.rBearing);
        updateLine(now);
        
        if (E.follow && !map.isEasing()) {
            map.setCenter([lng, lat]);
            if (HEADING_UP) map.setBearing(E.rBearing);
        }
    }

    E.feed = function (fix) {
        const now = performance.now();
        if (E.hasFix && fix.acc > 120) return null;

        const hasDeviceSpeed = fix.speedMs !== null && fix.speedMs !== undefined && isFinite(fix.speedMs);
        E.hist.push({ t: now, lng: fix.lng, lat: fix.lat, acc: Math.max(fix.acc || 0, 5) });
        while (E.hist.length && now - E.hist[0].t > 25000) E.hist.shift();
        const est = estimateMotion(E.hist, now);
        let sp = hasDeviceSpeed ? fix.speedMs : (est ? est.speed : 0);
        const keep = hasDeviceSpeed ? 0.3 : 0.6;
        sp = E.hasFix ? E.speedMs * keep + sp * (1 - keep) : sp;
        E.speedMs = sp < 0.8 ? 0 : sp;

        let hd = E.headingDeg;
        if (hasDeviceSpeed && fix.heading !== null && fix.heading !== undefined && isFinite(fix.heading) && E.speedMs > 3) {
            hd = normDeg(fix.heading);
        } else if (est && est.heading !== null && E.speedMs > 3) {
            hd = est.heading;
        }
        E.headingDeg = hd;

        if (!E.hasFix) {
            E.hasFix = true;
            E.fixAt = now; E.fixLng = fix.lng; E.fixLat = fix.lat;
            E.refLng = E.freeLng = E.drawLng = fix.lng;
            E.refLat = E.freeLat = E.drawLat = fix.lat;
            E.rBearing = E.headingDeg !== null ? E.headingDeg : (dest ? bearingBetween(fix.lng, fix.lat, dest.lng, dest.lat) : 0);
            E.marker = new mapboxgl.Marker({ element: createTruckElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
                .setLngLat([fix.lng, fix.lat]).setRotation(E.rBearing).addTo(map);
            const cam = Object.assign({ center: [fix.lng, fix.lat], zoom: 16 }, opts.camera || {});
            if (HEADING_UP) cam.bearing = E.rBearing;
            map.jumpTo(cam);
            E.lastFrame = now;
            E.raf = requestAnimationFrame(frame);
            if (dest) fetchRoute(fix.lng, fix.lat);
            return output();
        }

        if (!E.route && dest && !E.routeLoading && now > E.routeRetryAt) fetchRoute(fix.lng, fix.lat);

        E.fixAt = now; E.fixLng = fix.lng; E.fixLat = fix.lat;

        if (dest) {
            const dd = distM(fix.lng, fix.lat, dest.lng, dest.lat);
            if (dd < 40 && E.speedMs < 3) { if (++E.arriveCount >= 2) E.arrived = true; }
            else if (dd > 120) { E.arrived = false; E.arriveCount = 0; }
            else if (dd >= 40) { E.arriveCount = 0; }
        }

        let onLine = false;
        if (E.route) {
            const accC = Math.max(fix.acc || 0, 6);
            const sn = snapToRoute(E.route, fix.lng, fix.lat, E.snapped ? E.sRef : null, 150, 600);
            const limit = Math.max(50, accC * 2);

            if (!E.snapped) {
                if (sn.dist <= Math.max(60, accC * 2.5)) {
                    E.snapped = true; E.sRef = sn.s; E.rS = sn.s; E.pendingBlend = true;
                    E.offCount = 0; E.offSince = 0;
                    onLine = true;
                } else {
                    E.offCount++;
                    if (!E.offSince) E.offSince = now;
                }
            } else {
                onLine = true;
                if (sn.dist <= limit * 1.5) {
                    E.sHist.push({ t: now, s: sn.s });
                    while (E.sHist.length && now - E.sHist[0].t > 10000) E.sHist.shift();
                }
                if (sn.dist <= limit * 1.5 && E.speedMs > 0) {
                    const r = sn.s - E.sRef;
                    const trust = Math.max(25, accC * 2.5);
                    const alpha = Math.max(0.06, Math.min(0.25, 6 / accC)) * (sn.dist <= limit ? 1 : 0.5);
                    E.sRef = clampS(Math.abs(r) > trust ? sn.s : E.sRef + alpha * r);
                }
                if (sn.dist > limit) {
                    E.offCount++;
                    if (!E.offSince) E.offSince = now;
                } else {
                    E.offCount = 0; E.offSince = 0;
                }
            }

            if (E.snapped) {
                const b = bearingAtS(E.route, E.sRef);
                let trend = null;
                const trendWin = accC > 40 ? 10000 : 6000;
                const th = E.sHist.filter((q) => now - q.t <= trendWin);
                if (th.length >= 3 && (th[th.length - 1].t - th[0].t) >= (accC > 40 ? 4000 : 2500)) {
                    const k = Math.min(2, Math.floor(th.length / 2));
                    let first = 0, lastS = 0;
                    for (let i = 0; i < k; i++) { first += th[i].s; lastS += th[th.length - 1 - i].s; }
                    trend = (lastS - first) / k;
                }
                const backThr = 10 + accC * 0.35;
                const reallyBackwards = trend !== null && trend < -backThr;
                if (b !== null && E.headingDeg !== null && E.speedMs > 3) {
                    let want = Math.abs(angleDiff(b, E.headingDeg)) > 120 ? -1 : 1;
                    if (want < 0 && !reallyBackwards) want = E.dir;
                    if (want > 0 && E.dir < 0 && reallyBackwards) want = E.dir;
                    if (want !== E.dir) { if (++E.dirVotes >= 3) { E.dir = want; E.dirVotes = 0; } }
                    else E.dirVotes = 0;
                }
                if (E.dir < 0 && E.speedMs > 3) { if (!E.backSince) E.backSince = now; E.backCount++; }
                else if (E.dir > 0 || E.speedMs <= 1) { E.backCount = 0; E.backSince = 0; }
                if (dest && !E.arrived && reallyBackwards && E.backCount >= 4 && now - E.backSince > 4000 && now - E.lastRerouteAt > 12000) {
                    E.backCount = 0; E.backSince = 0; E.lastRerouteAt = now;
                    fetchRoute(fix.lng, fix.lat, E.headingDeg);
                }
            }
            if (dest && !E.arrived && E.speedMs > 3 && E.offCount >= 3 && now - E.offSince > 4000 && now - E.lastRerouteAt > 12000) {
                E.lastRerouteAt = now;
                fetchRoute(fix.lng, fix.lat, E.headingDeg);
            }
        }
        if (!onLine) {
            const acc = Math.max(fix.acc || 0, 6);
            const miss = distM(E.refLng, E.refLat, fix.lng, fix.lat);
            if (E.speedMs > 0) {
                const a = miss > Math.max(25, acc * 2.5) ? 1 : Math.max(0.08, Math.min(0.3, 8 / acc));
                E.refLng += (fix.lng - E.refLng) * a;
                E.refLat += (fix.lat - E.refLat) * a;
            } else if (miss > Math.max(30, acc * 3)) {
                E.refLng = fix.lng; E.refLat = fix.lat;
            }
        }
        return output();
    };

    E.remaining = function () {
        if (!E.route || !E.snapped) return null;
        const meters = Math.max(0, E.route.length - E.rS);
        const seconds = E.route.duration > 0 ? E.route.duration * (meters / E.route.length) : meters / 12;
        return { meters: meters, seconds: seconds };
    };

    E.position = function () { return E.hasFix ? { lng: E.drawLng, lat: E.drawLat } : null; };

    E.destroy = function () {
        E.running = false;
        if (E.raf) cancelAnimationFrame(E.raf);
        try { if (E.marker) E.marker.remove(); } catch (e) {}
    };

    return E;
}

let D = null;
function teardownDriver() {
    if (D) {
        try { if (D.engine) D.engine.destroy(); } catch (e) {}
        try { clearInterval(D.timer); } catch (e) {}
        try { if (D.map) D.map.remove(); } catch (e) {}
    }
    D = null;
}

window.initDriverActiveMap = function () {
    const box = $('driver-map-container');
    if (!box) return;
    teardownDriver();
    box.style.width = '100%';
    box.style.height = '100%';
    
    window.is3DMode = false;

    const dest = getDest();
    let map;
    try {
        map = new mapboxgl.Map({
            container: box,
            style: OSM_STYLE,
            center: dest ? [dest.lng, dest.lat] : [-95.3698, 29.7604],
            zoom: 15, pitch: 0, bearing: -17, antialias: true
        });
    } catch (err) {
        D = { map: null, engine: null, timer: null };
        return;
    }

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    if (dest) new mapboxgl.Marker({ element: createPinElement() }).setLngLat([dest.lng, dest.lat]).addTo(map);

    const engine = createTripEngine(map, { dest: dest, camera: { pitch: 0, bearing: -17 } });
    D = {
        map: map,
        engine: engine,
        timer: setInterval(() => {
            if (!gps.last || Date.now() - gps.last.t > 8000) setBadge('GPS: waiting for signal…', false);
        }, 2000),
        handleFix(fix) {
            const out = engine.feed(fix);
            if (out) {
                const spd = $('driver-map-speed');
                if (spd) spd.textContent = out.speedMph + ' mph';
                const accTxt = Math.round(fix.acc || 0);
                if (accTxt > 50) setBadge('GPS weak ±' + accTxt + ' m', false);
                else setBadge('GPS ±' + accTxt + ' m', true);
            }
            return out;
        }
    };

    map.on('load', () => { map.resize(); });
    if (gps.last && Date.now() - gps.last.t < 30000) D.handleFix(gps.last);
};

window.toggleDriver3D = function () {
    if (!D || !D.map) {
        toast('Map is not ready');
        return;
    }
    window.is3DMode = !window.is3DMode;
    D.map.easeTo({ pitch: window.is3DMode ? 55 : 0, duration: 1000 });
    
    const btn = document.getElementById('driver-3d-btn');
    if (btn) {
        btn.textContent = window.is3DMode ? '🌐 3D: ON' : '🌐 3D: OFF';
    }
    toast(window.is3DMode ? '3D View Enabled' : '2D Top-Down Enabled');
};

window.recenterDriverMap = function () {
    if (!D || !D.map || !D.engine) { toast('Map is not ready'); return; }
    D.map.dragPan.enable();
    D.map.scrollZoom.enable();
    D.map.touchZoomRotate.enable();
    D.engine.follow = true;
    D.map.setZoom(16);
    toast('Following your truck');
};

window.fitDriverMap = function () {
    if (!D || !D.map) return;
    const pos = D.engine.position();
    const dest = getDest();
    D.engine.follow = false;
    if (pos && dest) {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([pos.lng, pos.lat]);
        bounds.extend([dest.lng, dest.lat]);
        D.map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 1000 });
    }
};

window.openDriverDirections = function () {
    const dest = getDest();
    if (dest) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + dest.lat + ',' + dest.lng, '_blank');
};

window.copyTrackingLink = async function () {
    const u = trackingLink();
    try { await navigator.clipboard.writeText(u); } catch (e) {}
    toast('Tracking link copied');
};

window.textTrackingLink = function () {
    const u = trackingLink();
    const phone = (LS.getItem('smd_cust_phone') || '').replace(/[^\d+]/g, '');
    const name = LS.getItem('smd_driver_name') || 'Your driver';
    const a = document.createElement('a');
    a.href = 'sms:' + phone + '?body=' + encodeURIComponent(name + ' is on the way. Track live: ' + u);
    document.body.appendChild(a);
    a.click();
    a.remove();
};

window.endBroadcastAndHome = async function () {
    if (!confirm('End this broadcast?')) return;
    const sid = sessionId();
    const database = getDb();
    if (sid && database) {
        try { await broadcastRef(database, sid, compId()).update({ ended: true, timestamp: Date.now() }); } catch (e) {}
    }
    window.stopRealTimeTracking();
    teardownDriver();
    gps.last = null;
    LS.removeItem('smd_dest_lat');
    LS.removeItem('smd_dest_lng');
    LS.removeItem('smd_session_id');
    window.activeSessionId = undefined;
    window.switchView('job-setup-view');
};

let C = null;
function teardownCustomer() {
    if (!C) return;
    try { C.ref.off('value', C.cb); } catch (e) {}
    try { clearInterval(C.timer); } catch (e) {}
    try { if (C.engine) C.engine.destroy(); } catch (e) {}
    try { C.map.remove(); } catch (e) {}
    C = null;
}

window.playCustomerAudio = function () {
    if (!window.speechSynthesis) return;
    const driverName = (document.getElementById('cust-driver-header') ? document.getElementById('cust-driver-header').textContent : 'Your driver');
    const companyName = window.activeCompanyName || LS.getItem('smd_company_name') || '';

    let text = '';
    if (companyName && companyName.trim() !== '' && companyName.toLowerCase() !== 'null') {
        text = `Hello from ${companyName}! We want to take a quick second to personally thank you and let you know how much we truly value your business. Your driver, ${driverName}, is currently en route and tracked down to the exact foot on your screen. Sit back, relax, and watch us roll right on up to you!`;
    } else {
        text = `Hello! We want to take a quick second to personally thank you and let you know how much we truly value your business. Your driver, ${driverName}, is currently en route and tracked down to the exact foot on your screen. Sit back, relax, and watch us roll right on up to you!`;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.lang && v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('English')));
    if (preferredVoice) utterance.voice = preferredVoice;

    window.speechSynthesis.speak(utterance);
};

window.initCustomerMapLive = function () {
    const box = $('customer-map-container');
    if (!box) return;
    teardownCustomer();

    const q = new URLSearchParams(window.location.search);
    const sid = q.get('session') || q.get('sid') || q.get('s');
    const head = $('cust-driver-header'), etaEl = $('cust-eta-sub'), distEl = $('cust-distance');
    const speedEl = $('cust-speed'), pill = $('cust-status-pill');
    const callBtn = $('cust-call-btn'), msgBtn = $('cust-msg-btn');
    if (!sid) { if (head) head.textContent = 'Invalid tracking link'; return; }

    const database = getDb();
    if (!database) return;

    let map;
    try {
        map = new mapboxgl.Map({ container: box, style: OSM_STYLE, center: [-95.3698, 29.7604], zoom: 14, pitch: 0, bearing: -17, antialias: true });
    } catch (err) {
        return;
    }
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => { map.resize(); });

    const me = C = { map: map, engine: null, destMarker: null, ref: null, cb: null, timer: null, lastTs: null, lastChange: Date.now(), ended: false };

    function setPill(text, tone) {
        if (!pill) return;
        const tones = {
            ok: 'inline-flex items-center gap-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-3 py-1 rounded-full mt-2',
            warn: 'inline-flex items-center gap-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold px-3 py-1 rounded-full mt-2'
        };
        pill.className = tones[tone];
        pill.textContent = text;
    }

    function handleData(data) {
        if (C !== me || !data) return;
        
        if (data.companyName) {
            window.activeCompanyName = data.companyName;
            LS.setItem('smd_company_name', data.companyName);
        } else {
            window.activeCompanyName = '';
            LS.removeItem('smd_company_name');
        }

        if (head) head.textContent = data.driverName || 'Driver';
        if (data.driverPhone) {
            const tel = String(data.driverPhone).replace(/[^\d+]/g, '');
            if (callBtn) callBtn.href = 'tel:' + tel;
            if (msgBtn) msgBtn.href = 'sms:' + tel;
        }

        const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
        const dest = (isFinite(dLat) && isFinite(dLng)) ? { lat: dLat, lng: dLng } : null;
        if (dest && !me.destMarker) {
            me.destMarker = new mapboxgl.Marker({ element: createPinElement() }).setLngLat([dest.lng, dest.lat]).addTo(map);
        }

        if (data.ended) {
            me.ended = true;
            if (head) head.textContent = (data.driverName || 'Driver') + ' — trip ended';
            setPill('Trip ended', 'warn');
            return;
        }

        const lat = parseFloat(data.lat), lng = parseFloat(data.lng);
        if (!isFinite(lat) || !isFinite(lng)) {
            setPill('Waiting for the driver’s location…', 'warn');
            return;
        }

        if (data.timestamp !== me.lastTs) { me.lastTs = data.timestamp; me.lastChange = Date.now(); }
        if (!me.engine) me.engine = createTripEngine(map, { dest: dest, camera: { pitch: 0, bearing: -17 } });

        const mph = Number(data.speed) || 0;
        me.engine.feed({ lat: lat, lng: lng, speedMs: mph / MPS_TO_MPH, heading: Number(data.heading), acc: 5 });
        if (speedEl) speedEl.textContent = Math.round(mph) + ' mph';

        const rem = me.engine.remaining();
        if (rem) {
            if (etaEl) etaEl.textContent = formatEta(rem.seconds);
            if (distEl) distEl.textContent = (rem.meters / 1609.34).toFixed(1) + ' mi';
        }
    }

    me.ref = broadcastRef(database, sid, q.get('comp'));
    me.ref.once('value').then((snap) => {
        const data = snap.val();
        if (data && data.companyName) {
            window.activeCompanyName = data.companyName;
            LS.setItem('smd_company_name', data.companyName);
        }
    });

    me.cb = me.ref.on('value', (snap) => handleData(snap.val()));
    me.resync = () => { me.ref.once('value').then((snap) => handleData(snap.val())).catch(() => {}); };

    me.timer = setInterval(() => {
        if (C !== me || me.ended || !me.lastTs) return;
        const secs = Math.round((Date.now() - me.lastChange) / 1000);
        if (secs > 20) setPill('Driver’s location paused · last update ' + (secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s') + ' ago', 'warn');
        else setPill('● Live', 'ok');
    }, 2000);
};

window.recenterCustomerMap = function () {
    if (!C || !C.map || !C.engine) return;
    C.map.dragPan.enable();
    C.map.scrollZoom.enable();
    C.map.touchZoomRotate.enable();
    C.engine.follow = true;
    C.map.setZoom(16);
};

window.fitCustomerMap = function () {
    if (!C || !C.engine) return;
    const pos = C.engine.position();
    const dLat = C.destMarker ? C.destMarker.getLngLat() : null;
    if (!pos || !dLat) return;
    C.engine.follow = false;
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([pos.lng, pos.lat]);
    bounds.extend([dLat.lng, dLat.lat]);
    C.map.fitBounds(bounds, { padding: 70, maxZoom: 17, duration: 1000 });
};

// Native DOMContentLoaded event binding to ensure handleAddressInput triggers reliably on mobile
document.addEventListener('DOMContentLoaded', () => {
    const addressInput = document.getElementById('job-cust-address');
    if (addressInput) {
        addressInput.addEventListener('input', (e) => {
            window.handleAddressInput(e.target.value);
        });
    }

    const q = new URLSearchParams(window.location.search);
    const hasSession = q.has('session') || q.has('sid') || q.has('s') || q.get('view') === 'customer';
    
    if (hasSession) {
        const cv = $('customer-view-view') || $('customer-view');
        if (cv) {
            document.querySelectorAll('.app-view').forEach((v) => {
                if (v !== cv) { v.style.display = 'none'; v.classList.add('hidden'); }
            });
            cv.classList.remove('hidden');
            cv.style.display = 'block';
        }
        setTimeout(() => { if (!C && typeof window.initCustomerMapLive === 'function') window.initCustomerMapLive(); }, 400);
        return;
    }

    if (!broadcasting()) return;
    const storedSessionId = sessionId();
    if (!storedSessionId) { LS.removeItem('smd_active_broadcast'); return; }
    window.activeSessionId = storedSessionId;
    if (typeof window.switchView === 'function') window.switchView('active-broadcast');
    if (typeof window.startRealTimeTracking === 'function') window.startRealTimeTracking();
});

})();