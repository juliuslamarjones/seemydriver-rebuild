// ==========================================================
// SEEMYDRIVER - 3D GPS ENGINE (arc-length snapped, 60fps glide)
// ==========================================================
(function () {
'use strict';

const LS = window.SafeStorage || {
    getItem: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    setItem: (k, v) => { try { localStorage.setItem(k, String(v)); } catch (e) {} },
    removeItem: (k) => { try { localStorage.removeItem(k); } catch (e) {} }
};

const MPS_TO_MPH = 2.23694;
const ENGINE_VERSION = 'v65-3d-streets';
const HEADING_UP = false;

const MAPBOX_TOKEN = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.wq8EANp8vooYz3gE2o4Krg';
mapboxgl.accessToken = MAPBOX_TOKEN;

const LIGHT_STREETS_STYLE = 'mapbox://styles/mapbox/streets-v12';

const $ = (id) => document.getElementById(id);
const getDb = () => window.db || (typeof db !== 'undefined' ? db : null);

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
    const s0 = Math.max(0, Math.min(s, route.length - 14));
    const a = pointAtS(route, s0), b = pointAtS(route, s0 + 14);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.5) return null;
    return normDeg(toDeg(Math.atan2(b.x - a.x, b.y - a.y)));
}

function apply3DBuildingsLayer(map) {
    try {
        if (!map || typeof map.getStyle !== 'function' || typeof map.addLayer !== 'function') return;
        if (map.getLayer('smd-3d-buildings')) return;
        const style = map.getStyle();
        const layers = (style && style.layers) || [];
        const labelLayer = layers.find((l) => l.type === 'symbol' && l.layout && l.layout['text-field']);
        const sourceId = (style && style.sources && style.sources.composite) ? 'composite' : null;
        if (!sourceId) return;
        map.addLayer({
            id: 'smd-3d-buildings',
            source: sourceId,
            'source-layer': 'building',
            filter: ['==', 'extrude', 'true'],
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
                'fill-extrusion-color': '#94a3b8',
                'fill-extrusion-height': ['coalesce', ['get', 'height'], 14],
                'fill-extrusion-base': ['coalesce', ['get', 'min_height'], 0],
                'fill-extrusion-opacity': 0.65
            }
        }, labelLayer ? labelLayer.id : undefined);
    } catch (e) {}
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

function getDest() {
    const lat = parseFloat(LS.getItem('smd_dest_lat')), lng = parseFloat(LS.getItem('smd_dest_lng'));
    return (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) ? null : { lat, lng };
}

window.launchLiveBroadcast = function() {
    const authUser = window.firebase && window.firebase.auth ? window.firebase.auth().currentUser : null;

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

    if (database) {
        database.ref('broadcasts/' + sid).set({
            ownerUid: (authUser && authUser.uid) || 'browser-session',
            ownerEmail: (authUser && authUser.email ? String(authUser.email).toLowerCase() : ''),
            driverName: driverName,
            driverPhone: driverPhone,
            companyName: companyName,
            destLat: destLat,
            destLng: destLng,
            destAddress: address,
            speed: 0,
            heading: 0,
            timestamp: Date.now()
        }).catch(() => {});
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
    const query = (value || '').trim();
    if (query.length < 3) {
        suggestions.classList.add('hidden');
        suggestions.style.display = 'none';
        suggestions.innerHTML = '';
        return;
    }

    geocodeTimer = setTimeout(async () => {
        try {
            let items = [];
            const pRes = await fetch('https://photon.komoot.io/api/?q=' + encodeURIComponent(query) + '&limit=5');
            if (pRes.ok) {
                const pData = await pRes.json();
                const feats = (pData && Array.isArray(pData.features)) ? pData.features : [];
                items = feats
                    .filter(f => f && f.geometry && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
                    .map(f => {
                        const p = f.properties || {};
                        const label = [p.housenumber, p.street || p.name, p.city || p.district, p.state, p.postcode]
                            .filter(Boolean)
                            .join(', ') || p.name || query;
                        return { name: label, coords: [parseFloat(f.geometry.coordinates[0]), parseFloat(f.geometry.coordinates[1])] };
                    });
            }

            if (items.length === 0 && typeof MAPBOX_TOKEN !== 'undefined' && MAPBOX_TOKEN) {
                const mRes = await fetch('https://api.mapbox.com/geocoding/v5/mapbox.places/' + encodeURIComponent(query) + '.json?access_token=' + MAPBOX_TOKEN + '&autocomplete=true&types=address,poi&limit=5');
                if (mRes.ok) {
                    const mData = await mRes.json();
                    const mFeats = (mData && Array.isArray(mData.features)) ? mData.features : [];
                    items = mFeats
                        .filter(f => f && Array.isArray(f.center) && f.center.length >= 2)
                        .map(f => ({ name: f.place_name || f.text || query, coords: [parseFloat(f.center[0]), parseFloat(f.center[1])] }));
                }
            }

            suggestions.innerHTML = '';
            if (!items || items.length === 0) {
                suggestions.classList.add('hidden');
                suggestions.style.display = 'none';
                return;
            }

            items.forEach(item => {
                const div = document.createElement('div');
                div.className = 'px-3.5 py-2.5 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-amber-400 cursor-pointer border-b border-neutral-800/80 transition font-medium';
                div.textContent = item.name;
                div.onpointerdown = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const addrInput = document.getElementById('job-cust-address');
                    if (addrInput) addrInput.value = item.name;
                    window.cachedDestLng = item.coords[0];
                    window.cachedDestLat = item.coords[1];
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
    }, 250);
};

const gps = { running: false, last: null, handle: null, lastSend: 0 };
let D = null;

function ingest(pos) {
    try { if (typeof window.initDriverActiveMap === 'function' && (!D || !D.map)) window.initDriverActiveMap(); } catch (e) {}
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
    if (D && typeof D.handleFix === 'function') {
        out = D.handleFix(fix);
        if (!out) return;
    }
    sendFirebase(out);
}

function sendFirebase(out) {
    const database = getDb();
    if (!out || !broadcasting() || !database) return;
    const sid = sessionId();
    if (!sid) return;
    const now = Date.now();
    if (now - gps.lastSend < 1500) return;
    const lat = Number(out.lat);
    const lng = Number(out.lng);
    if (!isFinite(lat) || !isFinite(lng)) return;
    const speed = (typeof out.speedMph === "number" && isFinite(out.speedMph)) ? Math.round(out.speedMph) : 0;
    const heading = (typeof out.heading === "number" && isFinite(out.heading))
        ? Math.round(out.heading)
        : ((gps && gps.last && typeof gps.last.heading === "number" && isFinite(gps.last.heading)) ? Math.round(gps.last.heading) : 0);
    gps.lastSend = now;

    database.ref("broadcasts/" + sid).update({
        lat: lat,
        lng: lng,
        speed: speed,
        heading: heading,
        timestamp: now
    }).catch(() => {});
}
function setBadge(text, ok) {
    const targets = Array.from(document.querySelectorAll('.smd-gps-badge'));
    const activeView = $('active-broadcast-view');
    if (activeView) {
        const pill = activeView.querySelector('[class*="top-3"][class*="left-3"]');
        if (pill && targets.indexOf(pill) === -1) targets.push(pill);
    }
    targets.forEach((b) => {
        b.textContent = text + ' \u00b7 ' + ENGINE_VERSION;
        b.style.color = ok ? '#fbbf24' : '#f87171';
    });
}

function watchGps() {
    if (!navigator.geolocation) return;
    if (gps.handle !== null) { try { navigator.geolocation.clearWatch(gps.handle); } catch (e) {} }
    gps.handle = navigator.geolocation.watchPosition(ingest, (geoErr) => { const msg = (geoErr && geoErr.code === 1) ? 'GPS permission denied' : ((geoErr && geoErr.code === 3) ? 'GPS timeout' : 'GPS unavailable'); console.warn('Geolocation error:', geoErr); try { setBadge(msg, false); } catch (e) {} }, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
    });
}

window.startRealTimeTracking = function () {
    try { if (typeof window.initDriverActiveMap === 'function' && (!D || !D.map)) window.initDriverActiveMap(); } catch (e) {}
    [150, 500, 1000].forEach((ms) => {
        setTimeout(() => { try { if (D && D.map && typeof D.map.resize === 'function') D.map.resize(); } catch (e) {} }, ms);
    });
    if (gps.running) return;
    gps.running = true;
    watchGps();
};

window.stopRealTimeTracking = function () {
    gps.running = false;
    if (gps.handle !== null) {
        try { navigator.geolocation.clearWatch(gps.handle); } catch (e) {}
        gps.handle = null;
    }
    LS.removeItem('smd_active_broadcast');
};

function createTruckElement() {
    const el = document.createElement('div');
    el.className = 'pro-vehicle-marker';
    el.style.cssText = 'width:38px;height:56px;filter:drop-shadow(0px 8px 12px rgba(0,0,0,0.55));pointer-events:none;';
    el.innerHTML = `<svg viewBox="0 0 24 36" width="38" height="56" fill="none" xmlns="http://www.w3.org/2000/svg">
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
    const dest = (opts && opts.dest) || null;
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
        lastLine: 0, arrived: false, arriveCount: 0, nearCount: 0
    };

    let currentDest = (dest && isFinite(Number(dest.lat)) && isFinite(Number(dest.lng)) && !(Number(dest.lat) === 0 && Number(dest.lng) === 0))
        ? { lat: Number(dest.lat), lng: Number(dest.lng) }
        : null;

    function getActiveDest() {
        if (currentDest && isFinite(currentDest.lat) && isFinite(currentDest.lng)) return currentDest;
        if (typeof getDest === 'function') {
            const gd = getDest();
            if (gd && isFinite(Number(gd.lat)) && isFinite(Number(gd.lng)) && !(Number(gd.lat) === 0 && Number(gd.lng) === 0)) {
                currentDest = { lat: Number(gd.lat), lng: Number(gd.lng) };
                return currentDest;
            }
        }
        if (typeof C !== 'undefined' && C && C.destMarker && typeof C.destMarker.getLngLat === 'function') {
            const ll = C.destMarker.getLngLat();
            if (ll && isFinite(ll.lat) && isFinite(ll.lng)) {
                currentDest = { lat: Number(ll.lat), lng: Number(ll.lng) };
                return currentDest;
            }
        }
        return null;
    }

    function drawRoute(coords, attempt) {
        if (!E.running || !map) return;
        const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
        try {
            const src = map.getSource('smd-route-src');
            if (src) {
                src.setData(data);
            } else if (typeof map.addSource === 'function' && typeof map.addLayer === 'function') {
                map.addSource('smd-route-src', { type: 'geojson', data: data });
                map.addLayer({
                    id: 'smd-route-line', type: 'line', source: 'smd-route-src',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.94 }
                });
            }
        } catch (e) {
            if ((attempt || 0) < 25) setTimeout(() => drawRoute(coords, (attempt || 0) + 1), 300);
        }
    }

    async function fetchRoute(fromLng, fromLat) {
        const dPt = getActiveDest();
        if (!dPt || E.routeLoading || !E.running) return;
        E.routeLoading = true;
        try {
            const url = 'https://router.project-osrm.org/route/v1/driving/' + fromLng + ',' + fromLat + ';' + dPt.lng + ',' + dPt.lat + '?overview=full&geometries=geojson';
            const res = await fetch(url);
            const data = await res.json();
            if (!E.running) return;
            if (data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry && Array.isArray(data.routes[0].geometry.coordinates) && data.routes[0].geometry.coordinates.length > 1) {
                const r = data.routes[0];
                E.route = buildRoute(r.geometry.coordinates, r.duration);
                E.snapped = false;
                E.refLng = E.freeLng = E.drawLng;
                E.refLat = E.freeLat = E.drawLat;
                E.offCount = 0; E.offSince = 0; E.nearCount = 0; E.sRef = 0; E.rS = 0; E.offLng = 0; E.offLat = 0;
                drawRoute(r.geometry.coordinates, 0);
            } else {
                E.routeRetryAt = performance.now() + 4000;
            }
        } catch (e) {
            E.routeRetryAt = performance.now() + 4000;
        } finally {
            E.routeLoading = false;
        }
    }

    function alignToTravel(routeBearing) {
        if (!isFinite(routeBearing)) return 0;
        return E.dir < 0 ? normDeg(routeBearing + 180) : normDeg(routeBearing);
    }

    const clampS = (s) => (!E.route ? 0 : (s < 0 ? 0 : (s > E.route.length ? E.route.length : s)));

    function updateLine(now) {
        if (!E.route || !map || now - E.lastLine < 200) return;
        E.lastLine = now;
        try {
            const src = map.getSource('smd-route-src');
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
            src.setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[p.lng, p.lat]].concat(r.coords.slice(hi)) } });
        } catch (e) {}
    }

    function applyCameraFollow(lng, lat) {
        if (!E.follow || !map) return;
        if (Date.now() < (window.__smdFitLockUntil || 0)) return;
        try {
            const targetPitch = (window.is3DMode === false) ? 0 : ((opts && opts.camera && typeof opts.camera.pitch === 'number') ? opts.camera.pitch : 40);
            const targetBearing = HEADING_UP ? E.rBearing : ((opts && opts.camera && typeof opts.camera.bearing === 'number') ? opts.camera.bearing : 0);
            if (typeof map.jumpTo === 'function') {
                map.jumpTo({ center: [lng, lat], pitch: targetPitch, bearing: targetBearing });
            } else if (typeof map.setCenter === 'function') {
                map.setCenter([lng, lat]);
            }
        } catch (e) {}
    }

    function frame(now) {
        if (!E.running) return;
        E.raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, Math.max(0.001, (now - E.lastFrame) / 1000));
        E.lastFrame = now;
        if (!E.hasFix || !E.marker) return;

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
            const dLng = (v * dt * Math.sin(toRad(h))) / (M_PER_DEG * Math.cos(toRad(E.refLat || 29.76)));
            E.refLat += dLat; E.refLng += dLng;
            E.freeLat += dLat; E.freeLng += dLng;
            const k = 1 - Math.exp(-dt / 0.5);
            let ex = (E.refLng - E.freeLng) * k, ey = (E.refLat - E.freeLat) * k;
            const mag = Math.hypot(ex * M_PER_DEG * Math.cos(toRad(E.refLat || 29.76)), ey * M_PER_DEG);
            const cap = Math.max(12, v * 1.5) * dt;
            if (mag > cap) { ex *= cap / mag; ey *= cap / mag; }
            E.freeLng += ex; E.freeLat += ey;
            baseLng = E.freeLng; baseLat = E.freeLat;
            targetBearing = h;
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
        if (typeof E.marker.setRotation === 'function') E.marker.setRotation(E.rBearing);
        updateLine(now);
        applyCameraFollow(lng, lat);
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
        return {
            lat: lat,
            lng: lng,
            heading: Math.round(normDeg(heading)),
            speedMph: Math.round(E.speedMs * MPS_TO_MPH),
            snapped: E.snapped
        };
    }

    E.feed = function (fix) {
        if (!E.running || !fix || !isFinite(fix.lat) || !isFinite(fix.lng)) return null;
        const now = performance.now();
        const fixLat = Number(fix.lat), fixLng = Number(fix.lng);
        const acc = (typeof fix.acc === 'number' && isFinite(fix.acc) && fix.acc >= 0) ? fix.acc : 8;
        if (E.hasFix && acc > 120) return output();

        let sp = (fix.speedMs !== null && fix.speedMs !== undefined && isFinite(fix.speedMs) && fix.speedMs >= 0)
            ? fix.speedMs
            : ((typeof fix.speed === 'number' && isFinite(fix.speed) && fix.speed >= 0) ? fix.speed : null);
        if (sp === null) {
            const dtSec = (now - E.fixAt) / 1000;
            sp = (E.hasFix && dtSec > 0.3) ? distM(E.fixLng, E.fixLat, fixLng, fixLat) / dtSec : 0;
        }
        sp = E.hasFix ? E.speedMs * 0.4 + sp * 0.6 : sp;
        E.speedMs = sp < 0.8 ? 0 : sp;

        const movedFar = !E.hasFix || distM(E.moveLng, E.moveLat, fixLng, fixLat) > 8;
        let hd = E.headingDeg;
        if (fix.heading !== null && fix.heading !== undefined && isFinite(fix.heading) && E.speedMs > 2) {
            hd = normDeg(fix.heading);
        } else if (E.hasFix && movedFar && E.speedMs > 1.5) {
            hd = bearingBetween(E.moveLng, E.moveLat, fixLng, fixLat);
        }
        if (movedFar) { E.moveLng = fixLng; E.moveLat = fixLat; }
        E.headingDeg = hd;

        const dPt = getActiveDest();

        if (!E.hasFix) {
            E.hasFix = true;
            E.fixAt = now; E.fixLng = fixLng; E.fixLat = fixLat;
            E.refLng = E.freeLng = E.drawLng = fixLng;
            E.refLat = E.freeLat = E.drawLat = fixLat;
            E.rBearing = E.headingDeg !== null ? E.headingDeg : (dPt ? bearingBetween(fixLng, fixLat, dPt.lng, dPt.lat) : 0);
            if (typeof mapboxgl !== 'undefined' && map) {
                E.marker = new mapboxgl.Marker({ element: createTruckElement(), rotationAlignment: 'map', pitchAlignment: 'map' })
                    .setLngLat([fixLng, fixLat]);
                if (typeof E.marker.setRotation === 'function') E.marker.setRotation(E.rBearing);
                E.marker.addTo(map);
            }
            const cam = Object.assign({ center: [fixLng, fixLat], zoom: 16 }, (opts && opts.camera) || {});
            if (HEADING_UP) cam.bearing = E.rBearing;
            if (map && typeof map.jumpTo === 'function') map.jumpTo(cam);
            E.lastFrame = now;
            E.raf = requestAnimationFrame(frame);
            if (dPt) fetchRoute(fixLng, fixLat);
            return output();
        }

        if (dPt && !E.route && !E.routeLoading && now >= (E.routeRetryAt || 0)) {
            fetchRoute(fixLng, fixLat);
        }

        E.fixAt = now; E.fixLng = fixLng; E.fixLat = fixLat;

        if (dPt) {
            const dd = distM(fixLng, fixLat, dPt.lng, dPt.lat);
            if (dd < 40 && E.speedMs < 3) { if (++E.arriveCount >= 2) E.arrived = true; }
            else if (dd > 120) { E.arrived = false; E.arriveCount = 0; }
            else if (dd >= 40) { E.arriveCount = 0; }
        }

        let onLine = false;
        if (E.route) {
            const maxOff = Math.max(40, acc * 1.5);
            const sn = snapToRoute(E.route, fixLng, fixLat, E.snapped ? E.sRef : null, 150, 600);
            const limit = E.snapped ? maxOff : maxOff * 0.6;
            if (sn.dist <= limit) {
                E.nearCount++;
                E.offCount = 0; E.offSince = 0;
                if (E.snapped || E.nearCount >= 2) {
                    onLine = true;
                    const justSnapped = !E.snapped;
                    const b = bearingAtS(E.route, sn.s);
                    if (b !== null && E.headingDeg !== null && E.speedMs > 2) {
                        E.dir = Math.abs(angleDiff(b, E.headingDeg)) > 120 ? -1 : 1;
                    }
                    if (justSnapped) {
                        E.snapped = true; E.sRef = sn.s; E.rS = sn.s; E.pendingBlend = true;
                    } else if (E.speedMs > 0) {
                        const r = sn.s - E.sRef;
                        const safeAcc = Math.max(acc, 6);
                        const trust = Math.max(25, safeAcc * 2.5);
                        const alpha = Math.max(0.06, Math.min(0.25, 6 / safeAcc));
                        E.sRef = clampS(Math.abs(r) > trust ? sn.s : E.sRef + alpha * r);
                    }
                }
            } else {
                E.nearCount = 0;
                E.offCount++;
                if (!E.offSince) E.offSince = now;
                if (E.snapped && E.offCount < 2) {
                    onLine = true;
                } else if (E.snapped) {
                    E.snapped = false;
                    E.refLng = E.freeLng = E.drawLng; E.refLat = E.freeLat = E.drawLat;
                    E.offLng = 0; E.offLat = 0;
                }
                if (dPt && !E.arrived && E.offCount >= 3 && now - E.offSince > 4000 && now - E.lastRerouteAt > 10000) {
                    E.lastRerouteAt = now;
                    fetchRoute(fixLng, fixLat);
                }
            }
        }

        if (!onLine) {
            const safeAcc = Math.max(acc, 6);
            const miss = distM(E.refLng, E.refLat, fixLng, fixLat);
            if (E.speedMs > 0) {
                const a = miss > Math.max(25, safeAcc * 2.5) ? 1 : Math.max(0.08, Math.min(0.3, 8 / safeAcc));
                E.refLng += (fixLng - E.refLng) * a;
                E.refLat += (fixLat - E.refLat) * a;
            } else if (miss > Math.max(30, safeAcc * 3)) {
                E.refLng = fixLng; E.refLat = fixLat;
            }
        }

        return output();
    };

    E.position = function () {
        if (E.hasFix && isFinite(E.drawLat) && isFinite(E.drawLng)) {
            return { lat: E.drawLat, lng: E.drawLng };
        }
        if (E.hasFix && isFinite(E.fixLat) && isFinite(E.fixLng)) {
            return { lat: E.fixLat, lng: E.fixLng };
        }
        return null;
    };

    E.setDest = function (d) {
        if (d && isFinite(Number(d.lat)) && isFinite(Number(d.lng)) && !(Number(d.lat) === 0 && Number(d.lng) === 0)) {
            currentDest = { lat: Number(d.lat), lng: Number(d.lng) };
        }
    };

    E.remaining = function () {
        const pos = E.position();
        const activeDest = getActiveDest();
        if (!pos || !activeDest) return null;
        if (E.route && E.snapped) {
            const meters = Math.max(0, E.route.length - E.rS);
            const seconds = E.route.duration > 0 ? Math.max(1, Math.round(E.route.duration * (meters / E.route.length))) : Math.max(1, Math.round(meters / 12));
            return { meters: meters, seconds: seconds };
        }
        const rawMeters = Math.max(0, distM(pos.lng, pos.lat, activeDest.lng, activeDest.lat));
        if (rawMeters <= 50) return { meters: 0, seconds: 0 };
        const effSpeedMs = (E.speedMs > 1.5) ? E.speedMs : (30 / MPS_TO_MPH);
        const seconds = Math.max(1, Math.round(rawMeters / effSpeedMs));
        return { meters: rawMeters, seconds: seconds };
    };

    E.destroy = function () {
        E.running = false;
        if (E.raf) { try { cancelAnimationFrame(E.raf); } catch (e) {} E.raf = 0; }
        if (E.marker) { try { E.marker.remove(); } catch (e) {} E.marker = null; }
        try {
            if (map) {
                if (map.getLayer && map.getLayer('smd-route-line')) map.removeLayer('smd-route-line');
                if (map.getSource && map.getSource('smd-route-src')) map.removeSource('smd-route-src');
            }
        } catch (e) {}
    };

    return E;
}

function teardownDriver() {
    if (D) {
        try { if (D.engine) D.engine.destroy(); } catch (e) {}
        try { clearInterval(D.timer); } catch (e) {}
        try { if (D.map) D.map.remove(); } catch (e) {}
    }
    try { const box = $('driver-map-container'); if (box) box.innerHTML = ''; } catch (e) {}
    D = null;
}

window.initDriverActiveMap = function () {
    const box = $('driver-map-container');
    if (!box) return;
    teardownDriver();
    box.style.width = '100%';
    box.style.height = '100%';
    window.is3DMode = true;

    const dest = getDest();
    let map;
    try {
        if (typeof mapboxgl !== 'undefined' && !mapboxgl.accessToken) { mapboxgl.accessToken = window.MAPBOX_TOKEN || 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.wq8EANp8vooYz3gE2o4Krg'; }
        map = new mapboxgl.Map({
            container: box,
            style: LIGHT_STREETS_STYLE,
            center: dest ? [dest.lng, dest.lat] : [-95.3698, 29.7604],
            zoom: 15.6, pitch: 40, bearing: 0, antialias: true
        });
        try { window.soloMap = map; window.map = map; if (box) box._mapboxMap = map; } catch (e) {}
} catch (err) {
        console.error('initDriverActiveMap failed:', err);
        try { setBadge('Map error: ' + (err && err.message ? err.message : 'init failed'), false); } catch (e) {}
        D = { map: null, engine: null, timer: null };
        return;
    }

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    ['dragstart', 'zoomstart', 'touchstart', 'wheel'].forEach(evt => {
        map.on(evt, () => {
            if (D && D.engine) D.engine.follow = false;
        });
    });

    if (dest) new mapboxgl.Marker({ element: createPinElement() }).setLngLat([dest.lng, dest.lat]).addTo(map);

    const engine = createTripEngine(map, { dest: dest, camera: { pitch: 40, bearing: 0 } });
    D = {
        map: map,
        engine: engine,
        timer: setInterval(() => {
            if (!gps.last || Date.now() - gps.last.t > 8000) setBadge('GPS: waiting for signal\u2026', false);
        }, 2000),
        handleFix(fix) {
            const out = engine.feed(fix);
            const accVal = Math.round((fix && fix.acc) || 0);
            if (out || (fix && isFinite(fix.lat) && isFinite(fix.lng))) {
                const spd = $('driver-map-speed');
                if (spd && out) spd.textContent = out.speedMph + ' mph';
                setBadge(accVal > 0 ? ('GPS \u00b1' + accVal + ' m') : 'GPS LOCK', true);
            }
            return out;
        }
    };

    map.on('load', () => {
        map.resize();
        apply3DBuildingsLayer(map);
    });
    setTimeout(() => { try { map.resize(); } catch (e) {} }, 150);
    setTimeout(() => { try { map.resize(); apply3DBuildingsLayer(map); } catch (e) {} }, 450);
    if (gps.last && Date.now() - gps.last.t < 30000) D.handleFix(gps.last);
};


window.toggleDriver3D = function () {
        const m = (typeof resolveMobileMap === 'function' && resolveMobileMap()) ||
            (D && D.map) || window.soloMap || window.__smdSoloMap || window.map;
        if (!m || typeof m.easeTo !== 'function') return;
        window.is3DMode = (window.is3DMode === false) ? true : false;
        const btn = $('driver-3d-btn');
        if (btn) btn.textContent = window.is3DMode ? '\u{1F310} 3D: ON' : '\u{1F310} 3D: OFF';
        if (window.is3DMode) {
            try { if (typeof apply3DBuildingsLayer === 'function') apply3DBuildingsLayer(m); } catch (e) {}
            m.easeTo({ pitch: 45, duration: 400 });
        } else {
            m.easeTo({ pitch: 0, bearing: 0, duration: 400 });
        }
    };

function resolveMobileMap() {
    if (typeof D !== "undefined" && D && D.map && typeof D.map.easeTo === "function") return D.map;
    if (window.soloMap && typeof window.soloMap.easeTo === "function") return window.soloMap;
    if (window.__smdSoloMap && typeof window.__smdSoloMap.easeTo === "function") return window.__smdSoloMap;
    if (window.map && typeof window.map.easeTo === "function") return window.map;
    const box = $("driver-map-container");
    if (box && box._mapboxMap && typeof box._mapboxMap.easeTo === "function") return box._mapboxMap;
    return null;
}

function resolveDriverPos(m) {
    if (typeof D !== "undefined" && D && D.engine && typeof D.engine.position === "function") {
        const p = D.engine.position();
        if (p && isFinite(p.lng) && isFinite(p.lat)) return p;
    }
    if (typeof gps !== "undefined" && gps && gps.last && isFinite(gps.last.lng) && isFinite(gps.last.lat)) {
        return { lng: Number(gps.last.lng), lat: Number(gps.last.lat) };
    }
    const lat = parseFloat(LS.getItem("smd_lat") || LS.getItem("smd_driver_lat"));
    const lng = parseFloat(LS.getItem("smd_lng") || LS.getItem("smd_driver_lng"));
    if (isFinite(lat) && isFinite(lng)) return { lng, lat };
    if (m && typeof m.getCenter === "function") {
        const c = m.getCenter();
        if (c && isFinite(c.lng) && isFinite(c.lat)) return { lng: c.lng, lat: c.lat };
    }
    return null;
}

window.recenterDriverMap = function () {
    const m = resolveMobileMap();
    if (!m) return;
    if (typeof D !== "undefined" && D && D.engine) D.engine.follow = true;
    const pos = resolveDriverPos(m);
    if (typeof m.stop === "function") m.stop();
    if (pos) {
        m.easeTo({ center: [pos.lng, pos.lat], zoom: 15.8, bearing: 0, pitch: (window.is3DMode === false) ? 0 : 40, duration: 450 });
    }
};

window.fitDriverMap = function () {
    const m = resolveMobileMap();
    if (!m || typeof mapboxgl === "undefined") return;
    const pos = resolveDriverPos(m);
    const dest = typeof getDest === "function" ? getDest() : null;
    if (typeof D !== "undefined" && D && D.engine) D.engine.follow = false;
    if (typeof m.stop === "function") m.stop();
    if (pos && dest && typeof m.fitBounds === "function") {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([pos.lng, pos.lat]);
        bounds.extend([dest.lng, dest.lat]);
        m.fitBounds(bounds, { padding: { top: 70, bottom: 85, left: 55, right: 55 }, maxZoom: 15.5, bearing: 0, pitch: 0, duration: 500 });
    } else if (pos) {
        m.easeTo({ center: [pos.lng, pos.lat], zoom: 15.8, bearing: 0, pitch: (window.is3DMode === false) ? 0 : 40, duration: 450 });
    } else if (dest) {
        m.easeTo({ center: [dest.lng, dest.lat], zoom: 15, bearing: 0, pitch: 0, duration: 450 });
    }
};
window.openDriverDirections = function () {
    const dest = getDest();
    if (dest) window.open('https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + dest.lat + ',' + dest.lng, '_blank');
};

window.copyTrackingLink = async function () {
    const u = 'https://www.seemydriver.com/?view=customer&session=' + sessionId();
    try { await navigator.clipboard.writeText(u); } catch (e) {}
    toast('Tracking link copied');
};

window.textTrackingLink = function () {
    const u = 'https://www.seemydriver.com/?view=customer&session=' + sessionId();
    const phone = (LS.getItem('smd_cust_phone') || '').replace(/[^\d+]/g, '');
    const name = LS.getItem('smd_driver_name') || 'Your driver';
    const a = document.createElement('a');
    a.href = 'sms:' + phone + '?body=' + encodeURIComponent(name + ' is on the way. Track live: ' + u);
    document.body.appendChild(a);
    a.click();
    a.remove();
};

window.endBroadcastAndHome = function () {
    try {
        if (typeof confirm === "function" && !confirm("End this broadcast?")) return;
    } catch (e) {}
    const sid = typeof sessionId === "function" ? sessionId() : null;
    const database = typeof getDb === "function" ? getDb() : null;
    if (sid && database) {
        try { database.ref("broadcasts/" + sid).update({ ended: true, timestamp: Date.now() }).catch(() => {}); } catch (e) {}
    }
    try { if (typeof window.stopRealTimeTracking === "function") window.stopRealTimeTracking(); } catch (e) {}
    try { if (typeof teardownDriver === "function") teardownDriver(); } catch (e) {}
    try { gps.last = null; } catch (e) {}
    try {
        LS.removeItem("smd_active_broadcast");
        LS.removeItem("smd_dest_lat");
        LS.removeItem("smd_dest_lng");
        LS.removeItem("smd_session_id");
    } catch (e) {}
    window.activeSessionId = undefined;
    try { if (typeof window.switchView === "function") window.switchView("job-setup-view"); } catch (e) {}
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
    const etaText = (document.getElementById('cust-eta-sub') && document.getElementById('cust-eta-sub').textContent.trim()) || '';
    const distText = (document.getElementById('cust-distance') && document.getElementById('cust-distance').textContent.trim()) || '';

    const hasEta = etaText && etaText !== '--';
    const hasDist = distText && distText !== '--';

    let text = '';
    if (hasEta && hasDist) {
        text = `Estimated arrival in ${etaText}, ${distText} away.`;
    } else if (hasEta) {
        text = `Estimated arrival in ${etaText}.`;
    } else if (hasDist) {
        text = `${distText} away.`;
    } else {
        text = 'Estimated arrival is not available yet.';
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
        if (typeof mapboxgl !== 'undefined' && !mapboxgl.accessToken) { mapboxgl.accessToken = window.MAPBOX_TOKEN || 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.wq8EANp8vooYz3gE2o4Krg'; }
        map = new mapboxgl.Map({ container: box, style: LIGHT_STREETS_STYLE, center: [-95.3698, 29.7604], zoom: 14, pitch: 40, bearing: 0, antialias: true });
    } catch (err) {
        return;
    }
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    ['dragstart', 'zoomstart', 'touchstart', 'wheel'].forEach(evt => {
        map.on(evt, () => {
            if (C && C.engine) C.engine.follow = false;
        });
    });

    map.on('load', () => {
        apply3DBuildingsLayer(map);
        map.resize();
    });

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

        const resolvedName = resolveDriverName(data.driverName, urlDriver);
        data.driverName = resolvedName;
        if (head) head.textContent = resolvedName;
        if (data.driverPhone) {
            const tel = String(data.driverPhone).replace(/[^\d+]/g, '');
            if (callBtn) callBtn.href = 'tel:' + tel;
            if (msgBtn) msgBtn.href = 'sms:' + tel;
        }

        const dLat = parseFloat(data.destLat), dLng = parseFloat(data.destLng);
        const rawDest = (isFinite(dLat) && isFinite(dLng) && !(dLat === 0 && dLng === 0)) ? { lat: dLat, lng: dLng } : null;
        const dest = rawDest || ((typeof getDest === 'function') ? getDest() : null);
        if (dest && !me.destMarker) {
            me.destMarker = new mapboxgl.Marker({ element: createPinElement() }).setLngLat([dest.lng, dest.lat]).addTo(map);
        }

        if (data.ended) {
            me.ended = true;
            if (head) head.textContent = resolveDriverName(data.driverName, urlDriver) + ' \u2014 trip ended';
            setPill('Trip ended', 'warn');
            return;
        }

        const lat = parseFloat(data.lat), lng = parseFloat(data.lng);
        if (!isFinite(lat) || !isFinite(lng)) {
            setPill('Waiting for the driver\u2019s location\u2026', 'warn');
            return;
        }

        if (data.timestamp !== me.lastTs) { me.lastTs = data.timestamp; me.lastChange = Date.now(); }
        if (!me.engine) me.engine = createTripEngine(map, { dest: dest, camera: { pitch: 40, bearing: 0 } });
        if (dest && typeof me.engine.setDest === 'function') me.engine.setDest(dest);

        const mph = Number(data.speed) || 0;
        me.engine.feed({ lat: lat, lng: lng, speedMs: mph / MPS_TO_MPH, heading: Number(data.heading), acc: 5 });
        if (speedEl) speedEl.textContent = Math.round(mph) + ' mph';

        let rem = null;
        try { rem = me.engine && typeof me.engine.remaining === 'function' ? me.engine.remaining() : null; } catch (e) { rem = null; }
        if (!rem) {
            const fbDest = dest || ((typeof getDest === 'function') ? getDest() : null) || (() => {
                try {
                    const ll = me.destMarker && typeof me.destMarker.getLngLat === 'function' ? me.destMarker.getLngLat() : null;
                    return (ll && isFinite(ll.lat) && isFinite(ll.lng)) ? { lat: ll.lat, lng: ll.lng } : null;
                } catch (e) { return null; }
            })();
            if (fbDest && isFinite(Number(fbDest.lat)) && isFinite(Number(fbDest.lng))) {
                const R = 6371000;
                const toRad = (d) => d * Math.PI / 180;
                const dLat = toRad(Number(fbDest.lat) - lat);
                const dLng = toRad(Number(fbDest.lng) - lng);
                const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(Number(fbDest.lat))) * Math.sin(dLng / 2) ** 2;
                const m = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                if (m <= 50) {
                    rem = { meters: 0, seconds: 0 };
                } else {
                    const speedMs = mph > 3.35 ? (mph / MPS_TO_MPH) : (30 / MPS_TO_MPH);
                    rem = { meters: m, seconds: Math.max(1, Math.round(m / speedMs)) };
                }
            }
        }
        if (rem) {
            if (etaEl) etaEl.textContent = (rem.meters === 0 && rem.seconds === 0) ? 'Arrived' : formatEta(rem.seconds);
            if (distEl) distEl.textContent = (rem.meters / 1609.34).toFixed(1) + ' mi';
        }
    }

    const compParam = q.get('comp') || '';
    const primaryPath = compParam ? ('companies/' + compParam + '/broadcasts/' + sid) : ('broadcasts/' + sid);
    const fallbackPath = 'broadcasts/' + sid;
    const urlDriver = q.get('driver') || '';
    const urlLat = parseFloat(q.get('lat'));
    const urlLng = parseFloat(q.get('lng'));
    const urlDest = q.get('dest') || '';

    let lockedDriverName = '';
    function resolveDriverName(candidate, fallback) {
        const cleanCand = (typeof candidate === 'string') ? candidate.trim() : '';
        const cleanFb = (typeof fallback === 'string') ? fallback.trim() : '';
        const isGenericCand = !cleanCand || /^driver$/i.test(cleanCand);
        const isGenericFb = !cleanFb || /^driver$/i.test(cleanFb);
        if (!isGenericCand) {
            lockedDriverName = cleanCand;
            return cleanCand;
        }
        if (!isGenericFb) {
            lockedDriverName = cleanFb;
            return cleanFb;
        }
        if (lockedDriverName && !/^driver$/i.test(lockedDriverName)) {
            return lockedDriverName;
        }
        return cleanCand || cleanFb || 'Driver';
    }

    function mergeUrlFallback(raw) {
        const base = (raw && typeof raw === 'object') ? Object.assign({}, raw) : {};
        base.driverName = resolveDriverName(base.driverName, urlDriver);
        if (!base.destAddress && urlDest) base.destAddress = urlDest;
        if ((!isFinite(parseFloat(base.destLat)) || !isFinite(parseFloat(base.destLng))) && isFinite(urlLat) && isFinite(urlLng)) {
            base.destLat = urlLat;
            base.destLng = urlLng;
        }
        const hasLiveLat = isFinite(parseFloat(base.lat));
        const hasLiveLng = isFinite(parseFloat(base.lng));
        if (!hasLiveLat || !hasLiveLng) {
            const oLat = parseFloat(q.get('olat'));
            const oLng = parseFloat(q.get('olng'));
            const dLatF = parseFloat(base.destLat);
            const dLngF = parseFloat(base.destLng);
            if (isFinite(oLat) && isFinite(oLng)) {
                base.lat = oLat;
                base.lng = oLng;
            } else if (isFinite(dLatF) && isFinite(dLngF) && !(dLatF === 0 && dLngF === 0)) {
                base.lat = dLatF;
                base.lng = dLngF;
            }
            if (!isFinite(Number(base.speed))) base.speed = 0;
        }
        return Object.keys(base).length ? base : null;
    }

    me.ref = database.ref(primaryPath);
    const rootFallbackRef = (primaryPath !== fallbackPath) ? database.ref(fallbackPath) : null;

    me.ref.once('value').then((snap) => {
        const data = mergeUrlFallback(snap.val());
        if (data && data.companyName) {
            window.activeCompanyName = data.companyName;
            LS.setItem('smd_company_name', data.companyName);
        }
        if (data) handleData(data);
    }).catch(() => {});

    me.cb = me.ref.on('value', (snap) => {
        const val = snap.val();
        if (val) {
            const merged = mergeUrlFallback(val);
            writeCustomerCard(merged);
            handleData(merged);
        } else if (rootFallbackRef) {
            rootFallbackRef.once('value').then((rSnap) => {
                if (rSnap && rSnap.val()) handleData(mergeUrlFallback(rSnap.val()));
                else {
                    const fb = mergeUrlFallback(null);
                    if (fb) handleData(fb);
                }
            }).catch(() => {});
        } else {
            const fb = mergeUrlFallback(null);
            if (fb) handleData(fb);
        }
    });

    if (rootFallbackRef) {
        rootFallbackRef.on('value', (snap) => {
            const rVal = snap.val();
            if (!rVal) return;
            me.ref.once('value').then((cSnap) => {
                if (!cSnap || !cSnap.val()) handleData(mergeUrlFallback(rVal));
            }).catch(() => {});
        });
    }

    function writeCustomerCard(d) {
        if (!d) return;
        const hEl = $('cust-driver-header');
        const pEl = $('cust-status-pill');
        const eEl = $('cust-eta-sub');
        const dEl = $('cust-distance');
        const sEl = $('cust-speed');

        if (hEl) hEl.textContent = resolveDriverName(d.driverName, urlDriver);

        const dLat = parseFloat(d.destLat), dLng = parseFloat(d.destLng);
        const destPt = (isFinite(dLat) && isFinite(dLng) && !(dLat === 0 && dLng === 0))
            ? { lat: dLat, lng: dLng }
            : ((typeof getDest === 'function') ? getDest() : null);

        const lat = parseFloat(d.lat), lng = parseFloat(d.lng);
        const mph = Number(d.speed) || 0;
        if (sEl && isFinite(mph)) sEl.textContent = Math.round(mph) + ' mph';

        if (isFinite(lat) && isFinite(lng)) {
            if (pEl) {
                pEl.className = 'shrink-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-3 py-1 rounded-full';
                pEl.textContent = 'Live';
            }
            if (destPt && isFinite(destPt.lat) && isFinite(destPt.lng)) {
                const R = 6371000;
                const toRad = (deg) => deg * Math.PI / 180;
                const dLatRad = toRad(destPt.lat - lat);
                const dLngRad = toRad(destPt.lng - lng);
                const a = Math.sin(dLatRad / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(destPt.lat)) * Math.sin(dLngRad / 2) ** 2;
                const meters = Math.max(0, 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
                if (dEl) dEl.textContent = (meters / 1609.344).toFixed(1) + ' mi';
                if (eEl) {
                    if (meters <= 50) {
                        eEl.textContent = 'Arrived';
                    } else {
                        const effMps = mph > 3.35 ? (mph / MPS_TO_MPH) : (30 / MPS_TO_MPH);
                        const secs = Math.max(60, Math.round(meters / effMps));
                        eEl.textContent = (typeof formatEta === 'function') ? formatEta(secs) : (Math.round(secs / 60) + ' mins');
                    }
                }
            }
        } else if (pEl) {
            pEl.className = 'shrink-0 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-bold px-3 py-1 rounded-full';
            pEl.textContent = 'Connecting';
        }
    }

    function runUrlParamBootstrap() {
        const seed = mergeUrlFallback(null);
        if (!seed) return;
        const applySeed = () => {
            if (!C || C !== me) return;
            try { writeCustomerCard(seed); handleData(seed); } catch (e) {}
        };
        applySeed();
        if (map && typeof map.once === 'function') {
            map.once('load', applySeed);
        }
        setTimeout(applySeed, 300);
        setTimeout(applySeed, 1000);
    }

    runUrlParamBootstrap();

    me.resync = () => {
        me.ref.once('value').then((snap) => {
            const v = snap.val();
            if (v) return handleData(mergeUrlFallback(v));
            if (rootFallbackRef) return rootFallbackRef.once('value').then((rSnap) => handleData(mergeUrlFallback(rSnap.val())));
        }).catch(() => {});
    };

    me.timer = setInterval(() => {
        if (C !== me || me.ended || !me.lastTs) return;
        const secs = Math.round((Date.now() - me.lastChange) / 1000);
        if (secs > 20) setPill('Driver\u2019s location paused \u00b7 last update ' + (secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s') + ' ago', 'warn');
        else setPill('\u25cf Live', 'ok');
    }, 2000);
};

function getCustomerMapAndPoints() {
    const m = (C && C.map) || window.soloMap || window.map || null;
    const qp = new URLSearchParams(window.location.search);
    const qLat = parseFloat(qp.get('lat'));
    const qLng = parseFloat(qp.get('lng'));
    const qOLat = parseFloat(qp.get('olat'));
    const qOLng = parseFloat(qp.get('olng'));

    let drv = null;
    try {
        if (C && C.engine && typeof C.engine.position === 'function') {
            const p = C.engine.position();
            if (p && isFinite(Number(p.lat)) && isFinite(Number(p.lng))) {
                drv = { lat: Number(p.lat), lng: Number(p.lng) };
            }
        }
    } catch (e) {}
    if (!drv && isFinite(qOLat) && isFinite(qOLng)) {
        drv = { lat: qOLat, lng: qOLng };
    }

    let dst = null;
    try {
        if (C && C.destMarker && typeof C.destMarker.getLngLat === 'function') {
            const ll = C.destMarker.getLngLat();
            if (ll && isFinite(Number(ll.lat)) && isFinite(Number(ll.lng))) {
                dst = { lat: Number(ll.lat), lng: Number(ll.lng) };
            }
        }
    } catch (e) {}
    if (!dst && typeof getDest === 'function') {
        const gd = getDest();
        if (gd && isFinite(Number(gd.lat)) && isFinite(Number(gd.lng))) {
            dst = { lat: Number(gd.lat), lng: Number(gd.lng) };
        }
    }
    if (!dst && isFinite(qLat) && isFinite(qLng)) {
        dst = { lat: qLat, lng: qLng };
    }

    return { map: m, drv, dst };
}

window.recenterCustomerMap = function () {
    const { map: m, drv, dst } = getCustomerMapAndPoints();
    if (!m || typeof m.easeTo !== 'function') return;
    window.__smdFitLockUntil = 0;
    if (C && C.engine) C.engine.follow = true;
    if (typeof m.stop === 'function') m.stop();
    const target = drv || dst;
    if (target) {
        m.easeTo({
            center: [target.lng, target.lat],
            zoom: 15.8,
            bearing: 0,
            pitch: 40,
            duration: 450,
            essential: true
        });
    } else {
        m.easeTo({ zoom: 15.8, bearing: 0, pitch: 40, duration: 450, essential: true });
    }
};

window.fitCustomerMap = function () {
    const { map: m, drv, dst } = getCustomerMapAndPoints();
    if (!m) return;
    if (C && C.engine) C.engine.follow = false;
    window.__smdFitLockUntil = Date.now() + 20000;
    if (typeof m.stop === 'function') m.stop();
    if (drv && dst && typeof mapboxgl !== 'undefined' && typeof m.fitBounds === 'function') {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([drv.lng, drv.lat]);
        bounds.extend([dst.lng, dst.lat]);
        m.fitBounds(bounds, {
            padding: { top: 70, bottom: 85, left: 55, right: 55 },
            maxZoom: 15.5,
            bearing: 0,
            pitch: 0,
            duration: 500,
            essential: true
        });
    } else if (drv || dst) {
        const only = drv || dst;
        m.easeTo({
            center: [only.lng, only.lat],
            zoom: 15.5,
            bearing: 0,
            pitch: 0,
            duration: 450,
            essential: true
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    const hasSession = q.has('session') || q.has('sid') || q.has('s') || q.get('view') === 'customer';

    if (hasSession) {
        document.querySelectorAll('.app-view').forEach(v => {
            v.style.display = 'none';
            v.classList.add('hidden');
        });
        const custView = $('customer-view');
        if (custView) {
            custView.style.display = 'flex';
            custView.classList.remove('hidden');
        }
        if (typeof window.initCustomerMapLive === 'function') {
            window.initCustomerMapLive();
        }
        return;
    }

    if (typeof window.__smdRestoreActiveBroadcast === 'function' && window.__smdRestoreActiveBroadcast()) return;
    if (!broadcasting()) return;
    const storedSessionId = sessionId();
    if (!storedSessionId) { LS.removeItem('smd_active_broadcast'); return; }
    window.activeSessionId = storedSessionId;
    if (typeof window.switchView === 'function') window.switchView('active-broadcast');
    if (typeof window.startRealTimeTracking === 'function') window.startRealTimeTracking();
});



    window.toggleDriver3D = function () {
        const m = (typeof resolveMobileMap === 'function' && resolveMobileMap()) ||
            (D && D.map) || window.soloMap || window.__smdSoloMap || window.map;
        if (!m || typeof m.easeTo !== 'function') return;
        window.is3DMode = (window.is3DMode === false) ? true : false;
        const btn = $('driver-3d-btn');
        if (btn) btn.textContent = window.is3DMode ? '\u{1F310} 3D: ON' : '\u{1F310} 3D: OFF';
        if (window.is3DMode) {
            try { if (typeof apply3DBuildingsLayer === 'function') apply3DBuildingsLayer(m); } catch (e) {}
            m.easeTo({ pitch: 45, duration: 400 });
        } else {
            m.easeTo({ pitch: 0, bearing: 0, duration: 400 });
        }
    };

    let userPanUntil = 0;
let lastFollowCamAt = 0;
window.__smdFitLockUntil = window.__smdFitLockUntil || 0;

function getActiveDriverMap() {
    if (typeof resolveMobileMap === "function") {
        const rm = resolveMobileMap();
        if (rm) return rm;
    }
    if (typeof D !== "undefined" && D && D.map && typeof D.map.easeTo === "function") return D.map;
    if (window.soloMap && typeof window.soloMap.easeTo === "function") return window.soloMap;
    if (window.__smdSoloMap && typeof window.__smdSoloMap.easeTo === "function") return window.__smdSoloMap;
    if (window.map && typeof window.map.easeTo === "function") return window.map;
    const box = (typeof $ === "function") ? $("driver-map-container") : document.getElementById("driver-map-container");
    if (box && box._mapboxMap && typeof box._mapboxMap.easeTo === "function") return box._mapboxMap;
    return null;
}

function getActiveDriverPos(m) {
    if (typeof resolveDriverPos === "function") {
        const p = resolveDriverPos(m);
        if (p && isFinite(Number(p.lng)) && isFinite(Number(p.lat))) {
            return { lng: Number(p.lng), lat: Number(p.lat) };
        }
    }
    if (typeof gps !== "undefined" && gps && gps.last && isFinite(Number(gps.last.lng)) && isFinite(Number(gps.last.lat))) {
        return { lng: Number(gps.last.lng), lat: Number(gps.last.lat) };
    }
    if (m && typeof m.getCenter === "function") {
        const c = m.getCenter();
        if (c && isFinite(Number(c.lng)) && isFinite(Number(c.lat))) {
            return { lng: Number(c.lng), lat: Number(c.lat) };
        }
    }
    return null;
}

window.recenterDriverMap = function () {
    window.__smdFitLockUntil = 0;
    userPanUntil = 0;
    const m = getActiveDriverMap();
    if (!m || typeof m.easeTo !== "function") return;
    if (typeof D !== "undefined" && D && D.engine) D.engine.follow = true;
    const pos = getActiveDriverPos(m);
    if (typeof m.stop === "function") m.stop();
    if (pos) {
        m.easeTo({
            center: [pos.lng, pos.lat],
            zoom: 15.8,
            pitch: (window.is3DMode === false) ? 0 : 40,
            duration: 450,
            essential: true
        });
    }
};

window.fitDriverMap = function () {
    window.__smdFitLockUntil = Date.now() + 5000;
    const m = getActiveDriverMap();
    if (!m || typeof mapboxgl === "undefined") return;
    const pos = getActiveDriverPos(m);
    const dest = (typeof getDest === "function") ? getDest() : null;
    if (typeof D !== "undefined" && D && D.engine) D.engine.follow = false;
    if (typeof m.stop === "function") m.stop();
    if (pos && dest && isFinite(Number(dest.lng)) && isFinite(Number(dest.lat)) && typeof m.fitBounds === "function") {
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([pos.lng, pos.lat]);
        bounds.extend([Number(dest.lng), Number(dest.lat)]);
        m.fitBounds(bounds, {
            padding: { top: 70, bottom: 85, left: 55, right: 55 },
            maxZoom: 15.5,
            pitch: (window.is3DMode === false) ? 0 : 40,
            duration: 500,
            essential: true
        });
    } else if (pos && typeof m.easeTo === "function") {
        m.easeTo({ center: [pos.lng, pos.lat], zoom: 15.8, pitch: (window.is3DMode === false) ? 0 : 40, duration: 450, essential: true });
    } else if (dest && isFinite(Number(dest.lng)) && isFinite(Number(dest.lat)) && typeof m.easeTo === "function") {
        m.easeTo({ center: [Number(dest.lng), Number(dest.lat)], zoom: 15, pitch: 0, duration: 450, essential: true });
    }
};

setInterval(function smdKeepTruckInView() {
    try {
        const now = Date.now();
        if (now < (window.__smdFitLockUntil || 0)) return;
        const m = getActiveDriverMap();
        if (!m || typeof m.getBounds !== "function" || typeof m.easeTo !== "function") return;
        if (!m._smdPanGuardBound && typeof m.on === "function") {
            m._smdPanGuardBound = true;
            ["dragstart", "touchstart"].forEach(function(ev) { m.on(ev, function() { userPanUntil = Date.now() + 4500; }); });
            m.on("zoomstart", function() { userPanUntil = Date.now() + 3000; });
        }
        const following = !(typeof D !== "undefined" && D && D.engine && D.engine.follow === false);
        if (!following || now < userPanUntil) return;
        const pos = getActiveDriverPos(m);
        if (!pos) return;
        const b = m.getBounds();
        if (!b) return;
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        const spanLng = Math.max(1e-6, ne.lng - sw.lng);
        const spanLat = Math.max(1e-6, ne.lat - sw.lat);
        const marginX = spanLng * 0.22;
        const marginY = spanLat * 0.22;
        const outsideSafeBox =
            pos.lng < sw.lng + marginX || pos.lng > ne.lng - marginX ||
            pos.lat < sw.lat + marginY || pos.lat > ne.lat - marginY;
        if (!outsideSafeBox) return;
        if (now - lastFollowCamAt < 500) return;
        lastFollowCamAt = now;
        const curZoom = typeof m.getZoom === "function" ? m.getZoom() : 15.8;
        const targetZoom = curZoom < 14.5 ? 15.8 : curZoom;
        m.easeTo({
            center: [pos.lng, pos.lat],
            zoom: targetZoom,
            bearing: 0,
            pitch: (window.is3DMode === false) ? 0 : 40,
            duration: 400,
            essential: true
        });
    } catch (e) {}
}, 400);
})();
