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

const gps = { running: false, last: null, handle: null, lastSend: 0 };
let D = null;

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
    gps.lastSend = now;

    database.ref('broadcasts/' + sid).update({
        lat: out.lat,
        lng: out.lng,
        speed: out.speedMph,
        heading: out.heading,
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
    gps.handle = navigator.geolocation.watchPosition(ingest, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000
    });
}

window.startRealTimeTracking = function () {
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
        lastLine: 0, arrived: false, arriveCount: 0, nearCount: 0
    };

    function drawRoute(coords, attempt) {
        if (!E.running) return;
        const data = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
        try {
            const src = map.getSource('smd-route-src');
            if (src) {
                src.setData(data);
            } else {
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
        if (!dest || E.routeLoading || !E.running) return;
        E.routeLoading = true;
        try {
            const url = 'https://router.project-osrm.org/route/v1/driving/' + fromLng + ',' + fromLat + ';' + dest.lng + ',' + dest.lat + '?overview=full&geometries=geojson';
            const res = await fetch(url);
            const data = await res.json();
            if (!E.running) return;
            if (data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry.coordinates.length > 1) {
                const r = data.routes[0];
                E.route = buildRoute(r.geometry.coordinates, r.duration);
                E.snapped = false;
                E.refLng = E.freeLng = E.drawLng;
                E.refLat = E.freeLat = E.drawLat;
                E.offCount = 0; E.offSince = 0; E.nearCount = 0; E.sRef = 0; E.rS = 0; E.offLng = 0; E.offLat = 0;
                drawRoute(r.geometry.coordinates, 0);
                if (E.hasFix) {
                    const sn = snapToRoute(E.route, E.fixLng, E.fixLat, null, 0, E.route.length);
                    if (sn.dist <= 160) {
                        E.snapped = true;
                        E.sRef = E.rS = Math.max(E.rS || 0, sn.s);
                        const pt = pointAtS(E.route, sn.s);
                        E.drawLng = E.freeLng = E.refLng = pt.lng;
                        E.drawLat = E.freeLat = E.refLat = pt.lat;
                        const b = bearingAtS(E.route, sn.s);
                        if (b !== null) E.rBearing = alignToTravel(b);
                        E.marker.setLngLat([E.drawLng, E.drawLat]);
                        E.marker.setRotation(E.rBearing);
                    }
                }
            }
        } catch (e) {
            E.routeRetryAt = performance.now() + 4000;
        } finally {
            E.routeLoading = false;
        }
    }

    function alignToTravel(deg) {
    if (!isFinite(deg)) return null;
    return ((deg % 360) + 360) % 360;
}

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
    window.is3DMode = true;

    const dest = getDest();
    let map;
    try {
        map = new mapboxgl.Map({
            container: box,
            style: LIGHT_STREETS_STYLE,
            center: dest ? [dest.lng, dest.lat] : [-95.3698, 29.7604],
            zoom: 15.6, pitch: 40, bearing: 0, antialias: true
        });
    } catch (err) {
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
    if (D && D.map && typeof D.map.easeTo === 'function') return D.map;
    if (window.soloMap && typeof window.soloMap.easeTo === 'function') return window.soloMap;
    if (window.__smdSoloMap && typeof window.__smdSoloMap.easeTo === 'function') return window.__smdSoloMap;
    if (window.map && typeof window.map.easeTo === 'function') return window.map;
    const box = $('driver-map-container');
    if (box && box._mapboxMap && typeof box._mapboxMap.easeTo === 'function') return box._mapboxMap;
    return null;
}

function resolveDriverPos(m) {
    if (D && D.engine && typeof D.engine.position === 'function') {
        const p = D.engine.position();
        if (p && isFinite(p.lng) && isFinite(p.lat)) return p;
    }
    if (gps && gps.last && isFinite(gps.last.lng) && isFinite(gps.last.lat)) {
        return { lng: Number(gps.last.lng), lat: Number(gps.last.lat) };
    }
    const lat = parseFloat(LS.getItem('smd_lat') || LS.getItem('smd_driver_lat'));
    const lng = parseFloat(LS.getItem('smd_lng') || LS.getItem('smd_driver_lng'));
    if (isFinite(lat) && isFinite(lng)) return { lng, lat };
    if (m && typeof m.getCenter === 'function') {
        const c = m.getCenter();
        if (c && isFinite(c.lng) && isFinite(c.lat)) return { lng: c.lng, lat: c.lat };
    }
    return null;
}

window.recenterDriverMap = function () {
        const m = resolveMobileMap();
        if (!m) return;
        if (D && D.engine) D.engine.follow = true;
        const pos = resolveDriverPos(m);
        if (typeof m.stop === 'function') m.stop();
        if (pos) {
            m.easeTo({ center: [pos.lng, pos.lat], zoom: 15.8, bearing: 0, pitch: window.is3DMode ? 40 : 0, duration: 450 });
        }
    };

window.fitDriverMap = function () {
        const m = resolveMobileMap();
        if (!m || typeof mapboxgl === 'undefined') return;
        const pos = resolveDriverPos(m);
        const dest = getDest();
        if (D && D.engine) D.engine.follow = false;
        if (typeof m.stop === 'function') m.stop();
        if (pos && dest && typeof m.fitBounds === 'function') {
            const bounds = new mapboxgl.LngLatBounds();
            bounds.extend([pos.lng, pos.lat]);
            bounds.extend([dest.lng, dest.lat]);
            m.fitBounds(bounds, { padding: { top: 70, bottom: 85, left: 55, right: 55 }, maxZoom: 15.5, bearing: 0, pitch: 0, duration: 500 });
        } else if (pos) {
            m.easeTo({ center: [pos.lng, pos.lat], zoom: 15.8, bearing: 0, pitch: window.is3DMode ? 40 : 0, duration: 450 });
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

window.endBroadcastAndHome = async function () {
    if (!confirm('End this broadcast?')) return;
    const sid = sessionId();
    const database = getDb();
    if (sid && database) {
        try { await database.ref('broadcasts/' + sid).update({ ended: true, timestamp: Date.now() }); } catch (e) {}
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
            if (head) head.textContent = (data.driverName || 'Driver') + ' \u2014 trip ended';
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

        const mph = Number(data.speed) || 0;
        me.engine.feed({ lat: lat, lng: lng, speedMs: mph / MPS_TO_MPH, heading: Number(data.heading), acc: 5 });
        if (speedEl) speedEl.textContent = Math.round(mph) + ' mph';

        const rem = me.engine.remaining();
        if (rem) {
            if (etaEl) etaEl.textContent = formatEta(rem.seconds);
            if (distEl) distEl.textContent = (rem.meters / 1609.34).toFixed(1) + ' mi';
        }
    }

    me.ref = database.ref('broadcasts/' + sid);
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
        if (secs > 20) setPill('Driver\u2019s location paused \u00b7 last update ' + (secs >= 90 ? Math.round(secs / 60) + ' min' : secs + ' s') + ' ago', 'warn');
        else setPill('\u25cf Live', 'ok');
    }, 2000);
};

window.recenterCustomerMap = function () {
    if (!C || !C.map || !C.engine) return;
    const pos = C.engine.position();
    C.engine.follow = true;
    if (typeof C.map.stop === 'function') C.map.stop();
    if (pos) {
        C.map.easeTo({ center: [pos.lng, pos.lat], zoom: 15.6, bearing: 0, pitch: 40, duration: 400 });
    } else {
        C.map.easeTo({ zoom: 15.6, bearing: 0, duration: 400 });
    }
};

window.fitCustomerMap = function () {
    if (!C || !C.engine) return;
    const pos = C.engine.position();
    const dLat = C.destMarker ? C.destMarker.getLngLat() : null;
    if (!pos || !dLat) return;
    C.engine.follow = false;
    if (typeof C.map.stop === 'function') C.map.stop();
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([pos.lng, pos.lat]);
    bounds.extend([dLat.lng, dLat.lat]);
    C.map.fitBounds(bounds, { padding: { top: 70, bottom: 85, left: 55, right: 55 }, maxZoom: 15.5, bearing: 0, pitch: 0, duration: 450 });
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
    setInterval(function smdKeepTruckInView() {
        try {
            const m = (typeof resolveMobileMap === 'function' && resolveMobileMap()) ||
                (D && D.map) || window.soloMap || window.__smdSoloMap || window.map;
            if (!m || typeof m.getBounds !== 'function' || typeof m.easeTo !== 'function') return;
            if (!m._smdPanGuardBound && typeof m.on === 'function') {
                m._smdPanGuardBound = true;
                m.on('dragstart', function() { userPanUntil = Date.now() + 4500; });
                m.on('zoomstart', function() { userPanUntil = Date.now() + 3000; });
            }
            const pos = (typeof resolveDriverPos === 'function') ? resolveDriverPos(m) : null;
            if (!pos || !isFinite(pos.lng) || !isFinite(pos.lat)) return;
            const b = m.getBounds();
            if (!b) return;
            const sw = b.getSouthWest(), ne = b.getNorthEast();
            const spanLng = Math.max(1e-6, ne.lng - sw.lng);
            const spanLat = Math.max(1e-6, ne.lat - sw.lat);
            const marginX = spanLng * 0.18;
            const marginY = spanLat * 0.18;
            const outsideSafeBox =
                pos.lng < sw.lng + marginX || pos.lng > ne.lng - marginX ||
                pos.lat < sw.lat + marginY || pos.lat > ne.lat - marginY;
            const following = !(D && D.engine && D.engine.follow === false);
            const now = Date.now();
            if ((following && now > userPanUntil) || outsideSafeBox) {
                if (now - lastFollowCamAt < 320) return;
                lastFollowCamAt = now;
                const curZoom = typeof m.getZoom === 'function' ? m.getZoom() : 15.8;
                const targetZoom = curZoom < 14.5 ? 15.8 : curZoom;
                m.easeTo({
                    center: [pos.lng, pos.lat],
                    zoom: targetZoom,
                    pitch: window.is3DMode ? 45 : 0,
                    duration: 320
                });
            }
        } catch (e) {}
    }, 300);
