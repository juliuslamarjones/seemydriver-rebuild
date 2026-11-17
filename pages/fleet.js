import { useState, useEffect } from 'react';
import Head from 'next/head';
import Script from 'next/script';

export default function FleetDashboard() {
  return (
    <>
      <Head>
        <title>SeeMyDriver - Fleet Command Center</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet" />
      </Head>

      {/* Firebase SDKs */}
      <Script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js" strategy="beforeInteractive" />
      <Script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js" strategy="beforeInteractive" />
      <Script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js" strategy="beforeInteractive" />
      <Script src="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.js" strategy="beforeInteractive" />

      <div className="bg-black text-white h-screen w-screen overflow-hidden flex flex-col font-sans antialiased selection:bg-amber-400 selection:text-black">
        {/* HEADER */}
        <header className="w-full border-b border-neutral-900 bg-black/80 backdrop-blur-md px-4 py-3.5 flex items-center justify-between shrink-0 h-[65px]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-400 rounded-xl flex items-center justify-center font-black text-black text-xl shadow-[0_0_20px_rgba(251,191,36,0.3)]">👀</div>
            <div className="flex flex-col">
              <span className="font-black text-base text-white">SeeMy<span className="text-amber-400">Driver</span></span>
              <span className="text-[10px] font-mono text-neutral-400">Fleet Command Center v76</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div id="firebase-status" className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 shadow-inner">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span> Secure SDK Live
            </div>
          </div>
        </header>

        {/* MAIN INTERFACE */}
        <main className="flex-1 flex flex-col md:flex-row w-full h-[calc(100vh-65px)] overflow-hidden">
          
          {/* LEFT PANEL: DISPATCH CONTROLS & ACTIVE ROSTER */}
          <aside className="w-full md:w-[420px] bg-[#0c0d12] border-r border-neutral-900 flex flex-col h-full shrink-0 overflow-y-visible p-4 gap-4 relative z-30">
            
            {/* NEW JOB DISPATCH CONTROL */}
            <div className="bg-[#12141c] border border-neutral-800 rounded-2xl p-4 flex flex-col gap-3 shadow-lg shrink-0 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold tracking-wider text-amber-400 uppercase">⚡ New Job Dispatch Control</span>
              </div>
              
              <div className="flex flex-col gap-2.5">
                <div>
                  <label className="text-[11px] text-neutral-400 font-medium block mb-1">Driver Name</label>
                  <input type="text" id="input-driver-name" defaultValue="Sonny" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition" />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400 font-medium block mb-1">Driver Phone Number</label>
                  <input type="text" id="input-driver-phone" defaultValue="8329025417" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition" />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400 font-medium block mb-1">Customer Name</label>
                  <input type="text" id="input-customer-name" defaultValue="Julius L Jones" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition" />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-400 font-medium block mb-1">Customer Phone Number</label>
                  <input type="text" id="input-customer-phone" defaultValue="555-0142" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition" />
                </div>
                
                {/* Destination Address with Autocomplete */}
                <div className="relative">
                  <label className="text-[11px] text-neutral-400 font-medium block mb-1">Destination Address (Global Search)</label>
                  <input type="text" id="input-destination" defaultValue="3455 FM 1960 Rd West" autoComplete="off" className="w-full bg-neutral-900 border border-neutral-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400 transition" />
                  <div id="geocoder-suggestions" className="absolute left-0 right-0 top-full mt-1 bg-[#12141c] border border-neutral-700 rounded-xl overflow-hidden z-[999] shadow-2xl hidden max-h-52 overflow-y-auto"></div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 mt-2">
                <button id="btn-deploy-only" className="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-xs py-3 rounded-xl transition shadow-lg cursor-pointer flex items-center justify-center gap-1.5">
                  🚀 Deploy Truck Only
                </button>
                <button id="btn-deploy-text" className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs py-3 rounded-xl transition shadow-lg cursor-pointer flex items-center justify-center gap-1.5">
                  📲 Deploy Truck & Text Link to Driver
                </button>
              </div>
            </div>

            {/* ACTIVE FLEET ROSTER */}
            <div className="flex flex-col gap-2.5 flex-1">
              <div className="flex justify-between items-center px-1">
                <span className="text-xs font-mono font-bold tracking-wider text-neutral-400 uppercase">Active Fleet Roster</span>
                <span id="active-count" className="bg-neutral-800 text-amber-400 font-mono text-[10px] font-bold px-2 py-0.5 rounded-full">0 Active</span>
              </div>
              <div id="fleet-roster-container" className="flex flex-col gap-2.5 overflow-y-auto max-h-[calc(100vh-420px)]">
                {/* Dynamic active sessions populate here */}
              </div>
            </div>

            {/* Global Footer Controls */}
            <div className="pt-2 border-t border-neutral-900 flex flex-col gap-2 shrink-0">
              <div className="flex gap-2">
                <button id="btn-fit-all" className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-bold py-2.5 rounded-xl border border-neutral-800 transition cursor-pointer">Fit All</button>
                <button id="btn-reset-view" className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-amber-400 text-xs font-bold py-2.5 rounded-xl border border-neutral-800 transition cursor-pointer">Reset View</button>
              </div>
              <button id="btn-purge-all" className="w-full bg-red-950/40 hover:bg-red-900/50 text-red-400 border border-red-900/50 text-xs font-bold py-2 rounded-xl transition cursor-pointer">
                Purge All Broadcast Sessions
              </button>
            </div>
          </aside>

          {/* RIGHT PANEL: MAP CONTAINER */}
          <div className="flex-1 h-full relative bg-neutral-950 flex flex-col min-w-0">
            <div id="fleet-map-container" className="w-full h-full absolute inset-0"></div>
            
            {/* Map Overlay Info Badge */}
            <div className="absolute top-4 left-4 z-10 bg-black/85 border border-neutral-800 rounded-xl px-3.5 py-2 font-mono text-xs font-bold text-amber-400 backdrop-blur-md shadow-2xl flex items-center gap-2 pointer-events-none">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
              <span>Secure SDK Telemetry Active</span>
            </div>
          </div>
        </main>
      </div>

      {/* MAPBOX & FIREBASE INITIALIZATION SCRIPT */}
      <Script id="fleet-engine-script" strategy="afterInteractive">
        {
          setTimeout(() => {
            if (!firebase.apps.length) {
              firebase.initializeApp({
                apiKey: "AIzaSyAfT3ZCE8DEmjsf4FLIqDgdYIQL1woIJOI",
                authDomain: "seemydriver-prod.firebaseapp.com",
                databaseURL: "https://seemydriver-prod-default-rtdb.firebaseio.com",
                projectId: "seemydriver-prod",
                storageBucket: "seemydriver-prod.firebasestorage.app",
                messagingSenderId: "16366013329",
                appId: "1:16366013329:web:7e993e6ee37f940a04a064"
              });
            }

            const db = firebase.database();
            const auth = firebase.auth();
            auth.signInAnonymously().catch(err => console.error("Auth error:", err));

            const FULL_MAPBOX_TOKEN = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJhIjoiY212NHExMmxjMTBmODJ3cHh5cmcxbmZyZSJ9.wq8EANp8vooYz3gE2o4Krg';
            mapboxgl.accessToken = FULL_MAPBOX_TOKEN;

            let fleetMap = new mapboxgl.Map({
              container: 'fleet-map-container',
              style: {
                version: 8,
                sources: { 'osm': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256 } },
                layers: [{ id: 'osm-raster', type: 'raster', source: 'osm' }]
              },
              center: [-95.2821, 30.0024],
              zoom: 13,
              pitch: 45,
              bearing: -10,
              antialias: true
            });
            fleetMap.addControl(new mapboxgl.NavigationControl(), 'top-right');

            let activeMarkers = {};
            let selectedCoords = { lat: 30.0024, lng: -95.2821 };
            const companyUuid = 'default_fleet';

            // Geocoder Autocomplete
            const destInput = document.getElementById('input-destination');
            const suggestionsBox = document.getElementById('geocoder-suggestions');
            let debounceTimer;

            destInput.addEventListener('input', (e) => {
              const query = e.target.value.trim();
              clearTimeout(debounceTimer);
              if (query.length < 3) {
                suggestionsBox.classList.add('hidden');
                return;
              }

              debounceTimer = setTimeout(async () => {
                try {
                  const res = await fetch(\https://api.mapbox.com/geocoding/v5/mapbox.places/\.json?access_token=\&autocomplete=true&limit=5\);
                  const data = await res.json();
                  
                  suggestionsBox.innerHTML = '';
                  if (data && data.features && data.features.length > 0) {
                    data.features.forEach(feature => {
                      const item = document.createElement('div');
                      item.className = "px-3 py-2.5 text-xs text-neutral-200 hover:bg-neutral-800 hover:text-amber-400 cursor-pointer border-b border-neutral-900/50 truncate";
                      item.textContent = feature.place_name;
                      item.onclick = () => {
                        destInput.value = feature.place_name;
                        selectedCoords = {
                          lng: parseFloat(feature.center[0]),
                          lat: parseFloat(feature.center[1])
                        };
                        suggestionsBox.classList.add('hidden');
                        fleetMap.flyTo({ center: [selectedCoords.lng, selectedCoords.lat], zoom: 15, pitch: 45, duration: 1000 });
                      };
                      suggestionsBox.appendChild(item);
                    });
                    suggestionsBox.classList.remove('hidden');
                  } else {
                    suggestionsBox.classList.add('hidden');
                  }
                } catch (err) {
                  console.error('Geocoder error:', err);
                }
              }, 300);
            });

            document.addEventListener('click', (e) => {
              if (!destInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
                suggestionsBox.classList.add('hidden');
              }
            });

            function createTruckSvgMarker() {
              const el = document.createElement('div');
              el.innerHTML = \
                <div style="width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0px 10px 14px rgba(0,0,0,0.8)); cursor: pointer;">
                    <svg viewBox="0 0 24 36" width="34" height="50" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="3.5" y="11" width="17" height="22" rx="3" fill="#1f2937" stroke="#fbbf24" stroke-width="1.25"/>
                        <rect x="3.5" y="20" width="17" height="4" fill="#f59e0b"/>
                        <path d="M5.5 11H18.5V5C18.5 3.34315 17.1569 2 15.5 2H8.5C6.84315 2 5.5 3.34315 5.5 5V11Z" fill="#111827" stroke="#374151" stroke-width="1.25"/>
                        <path d="M7 7.5H17L16 4H8L7 7.5Z" fill="#38bdf8" fill-opacity="0.95"/>
                    </svg>
                </div>
              \;
              return el;
            }

            async function handleDeployTruckOnly() {
              const driverName = (document.getElementById('input-driver-name').value || 'Driver').trim();
              const destAddress = destInput.value || 'Destination';
              const sessionId = 'driver_' + driverName.toLowerCase().replace(/[^a-z0-9]/g, '_');

              const sessionData = {
                driverName,
                destAddress,
                lat: parseFloat(selectedCoords.lat),
                lng: parseFloat(selectedCoords.lng),
                speed: 0,
                heading: 0,
                timestamp: Date.now()
              };

              try {
                await db.ref(\roadcasts/\\).set(sessionData);
                console.log("✅ Native SDK deployed successfully for:", driverName);
              } catch (err) {
                console.error("❌ Native SDK write error:", err);
                alert('Database write failed: ' + err.message);
              }

              fleetMap.flyTo({ center: [selectedCoords.lng, selectedCoords.lat], zoom: 15, pitch: 45, duration: 1500 });
            }

            async function handleDeployAndTextDriver() {
              const driverName = (document.getElementById('input-driver-name').value || 'Driver').trim();
              const driverPhone = document.getElementById('input-driver-phone').value || '';
              const destAddress = destInput.value || 'Destination';
              const clientPhone = document.getElementById('input-customer-phone').value || '';
              const sessionId = 'driver_' + driverName.toLowerCase().replace(/[^a-z0-9]/g, '_');

              const sessionData = {
                driverName,
                destAddress,
                lat: parseFloat(selectedCoords.lat),
                lng: parseFloat(selectedCoords.lng),
                speed: 0,
                heading: 0,
                timestamp: Date.now()
              };

              try {
                await db.ref(\roadcasts/\\).set(sessionData);
              } catch (err) {
                console.error("❌ Native SDK write error:", err);
              }

              fleetMap.flyTo({ center: [selectedCoords.lng, selectedCoords.lat], zoom: 15, pitch: 45, duration: 1500 });

              const driverBroadcastUrl = \\/fleet/driver-broadcast.html?comp=\&session=\&driver=\&dest=\&lat=\&lng=\&phone=\\;
              const smsBody = encodeURIComponent(\SeeMyDriver Dispatch: Your destination is \. Open your driver broadcast console here: \\);
              window.open(\sms:\?body=\\);
            }

            document.getElementById('btn-deploy-only').addEventListener('click', handleDeployTruckOnly);
            document.getElementById('btn-deploy-text').addEventListener('click', handleDeployAndTextDriver);

            document.getElementById('btn-fit-all').addEventListener('click', () => {
              const keys = Object.keys(activeMarkers);
              if (keys.length === 0) return;
              const bounds = new mapboxgl.LngLatBounds();
              keys.forEach(k => bounds.extend(activeMarkers[k].marker.getLngLat()));
              fleetMap.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 1000 });
            });

            document.getElementById('btn-reset-view').addEventListener('click', () => {
              fleetMap.flyTo({ center: [-95.2821, 30.0024], zoom: 13, pitch: 45, bearing: -10, duration: 1000 });
            });

            document.getElementById('btn-purge-all').addEventListener('click', async () => {
              if (confirm('Are you sure you want to purge all active sessions?')) {
                await db.ref(\roadcasts\).remove();
              }
            });

            window.terminateSession = async function(sessionId) {
              await db.ref(\roadcasts/\\).remove();
              if (activeMarkers[sessionId]) {
                activeMarkers[sessionId].marker.remove();
                delete activeMarkers[sessionId];
              }
            };

            // Realtime DB Listener
            db.ref(\roadcasts\).on('value', (snapshot) => {
              const data = snapshot.val() || {};
              const rosterContainer = document.getElementById('fleet-roster-container');
              if (!rosterContainer) return;
              rosterContainer.innerHTML = '';
              
              let activeCount = 0;
              const currentSessionIds = Object.keys(data);

              Object.keys(activeMarkers).forEach(sessionId => {
                if (!currentSessionIds.includes(sessionId)) {
                  activeMarkers[sessionId].marker.remove();
                  delete activeMarkers[sessionId];
                }
              });

              currentSessionIds.forEach(sessionId => {
                const session = data[sessionId];
                if (!session) return;
                const lat = parseFloat(session.lat);
                const lng = parseFloat(session.lng);

                if (isNaN(lat) || isNaN(lng)) return;
                activeCount++;

                const lngLat = [lng, lat];

                if (!activeMarkers[sessionId]) {
                  const el = createTruckSvgMarker();
                  const marker = new mapboxgl.Marker(el).setLngLat(lngLat).addTo(fleetMap);
                  activeMarkers[sessionId] = { marker };
                } else {
                  activeMarkers[sessionId].marker.setLngLat(lngLat);
                }

                const card = document.createElement('div');
                card.className = "bg-[#12141c] border border-neutral-800 rounded-xl p-3 flex flex-col gap-2 shadow-md";
                card.innerHTML = \
                  <div class="flex justify-between items-center text-xs">
                      <span class="font-bold text-white">\</span>
                      <span class="text-amber-400 font-mono font-bold">\ mph</span>
                  </div>
                  <div class="text-[11px] text-neutral-400 truncate">
                      Dest: <span class="text-neutral-250">\</span>
                  </div>
                  <div class="flex justify-between items-center pt-1 border-t border-neutral-900 text-[10px]">
                      <span class="text-emerald-400 font-mono">Secure SDK Telemetry</span>
                      <button onclick="window.terminateSession('\')" class="text-red-400 hover:text-red-300 font-bold cursor-pointer">End Run</button>
                  </div>
                \;
                rosterContainer.appendChild(card);
              });

              const activeCountEl = document.getElementById('active-count');
              if (activeCountEl) activeCountEl.textContent = \\ Active\;
            });
          }, 1000);
        }
      </Script>
    </>
  );
}
