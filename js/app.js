// ==========================================================
// FLEET COMMAND LOCAL OVERLAY GATEWAY (NATIVE EMBEDDED MAP)
// ==========================================================
window.checkFleetAccessAndSwitch = async function(event) {
    if (event) event.preventDefault();
    console.log("🚀 Switch to Fleet clicked!");
    openLocalFleetModal();
};

function openLocalFleetModal() {
    const existing = document.getElementById('smd-fleet-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'smd-fleet-overlay';
    overlay.className = 'fixed inset-0 bg-black z-50 flex flex-col w-full h-full';
    overlay.innerHTML = `
        <div class="bg-[#12141c] border-b border-neutral-800 px-6 py-4 flex items-center justify-between shrink-0">
            <span class="font-black text-amber-400 text-sm flex items-center gap-2">👀 Fleet Command Center</span>
            <button onclick="document.getElementById('smd-fleet-overlay').remove()" class="bg-neutral-900 border border-neutral-800 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-neutral-800 cursor-pointer transition">✕ Close Fleet</button>
        </div>
        <div class="flex-1 flex flex-col md:flex-row w-full h-full overflow-hidden bg-black">
            <div class="w-full md:w-80 bg-[#12141c] border-r border-neutral-800 p-4 flex flex-col gap-3 overflow-y-auto shrink-0">
                <h3 class="text-xs font-bold uppercase tracking-wider text-neutral-400">Active Fleet Units</h3>
                <div id="fleet-list" class="flex flex-col gap-2">
                    <div class="p-3 bg-neutral-900 border border-neutral-800 rounded-xl text-xs text-neutral-400 text-center py-8">Scanning active broadcasts...</div>
                </div>
            </div>
            <div id="fleet-native-map" class="flex-1 w-full h-full relative bg-neutral-900"></div>
        </div>`;
    document.body.appendChild(overlay);

    setTimeout(() => {
        const mapContainer = document.getElementById('fleet-native-map');
        if (!mapContainer || typeof mapboxgl === 'undefined') return;

        const part1 = 'pk.eyJ1Ijoic29ubnlqb25lczIwMTQiLCJh';
        const part2 = 'IjoiY210ZjVxNXdjMGFmajJ5b2NoOWhvdHdhbiJ9.Ex0EVNUOtYeEwQHiOHjqMQ';
        mapboxgl.accessToken = part1 + part2;

        const fleetMap = new mapboxgl.Map({
            container: mapContainer,
            style: 'mapbox://styles/mapbox/dark-v11',
            center: [-95.3698, 29.7604],
            zoom: 12
        });
        fleetMap.addControl(new mapboxgl.NavigationControl(), 'top-right');

        const db = window.firebase && window.firebase.database ? window.firebase.database() : null;
        if (db) {
            const markers = {};
            const listEl = document.getElementById('fleet-list');

            db.ref('broadcasts').on('value', (snap) => {
                const data = snap.val() || {};
                listEl.innerHTML = '';
                const keys = Object.keys(data);
                if (keys.length === 0) {
                    listEl.innerHTML = '<div class="p-3 bg-neutral-900 border border-neutral-800 rounded-xl text-xs text-neutral-400 text-center py-8">No active drivers broadcasting. Start a Solo broadcast first!</div>';
                    return;
                }
                keys.forEach((sid) => {
                    const b = data[sid];
                    if (!b || b.ended || !b.lat || !b.lng) return;
                    const card = document.createElement('div');
                    card.className = 'p-3 bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl flex flex-col gap-1 cursor-pointer transition';
                    card.innerHTML = `<span class="font-bold text-white text-xs">${b.driverName || 'Driver'}</span><span class="text-[10px] text-neutral-400 truncate">Dest: ${b.destAddress || 'Route'}</span><span class="text-[10px] text-amber-400 font-mono">Speed: ${b.speed || 0} mph</span>`;
                    card.onclick = () => fleetMap.flyTo({ center: [b.lng, b.lat], zoom: 16 });
                    listEl.appendChild(card);

                    if (markers[sid]) {
                        markers[sid].setLngLat([b.lng, b.lat]);
                    } else {
                        const el = document.createElement('div');
                        el.innerHTML = '🚚';
                        el.style.cssText = 'font-size:24px;';
                        const m = new mapboxgl.Marker({ element: el }).setLngLat([b.lng, b.lat]).addTo(fleetMap);
                        markers[sid] = m;
                    }
                });
            });
        }
    }, 150);
}