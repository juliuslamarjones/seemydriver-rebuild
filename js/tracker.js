// ==========================================
// SEEMYDRIVER - PURE GPS HARDWARE ENGINE & BACKGROUND WORKER
// ==========================================
let wakeLock = null;
let backgroundHeartbeatInterval = null;
let silentAudioContext = null;
let silentAudioNode = null;

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            if (wakeLock === null && document.visibilityState === 'visible') {
                wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {}
    }
}

async function releaseWakeLock() {
    if (wakeLock !== null) {
        try { await wakeLock.release(); } catch (err) {}
        wakeLock = null;
    }
}

function startSilentAudio() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!silentAudioContext || silentAudioContext.state === 'closed') {
            silentAudioContext = new AudioContext();
        }
        if (silentAudioContext.state === 'suspended') { silentAudioContext.resume(); }
        if (!silentAudioNode) {
            const buffer = silentAudioContext.createBuffer(1, silentAudioContext.sampleRate * 2, silentAudioContext.sampleRate);
            const source = silentAudioContext.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            const gainNode = silentAudioContext.createGain();
            gainNode.gain.value = 0.00001;
            source.connect(gainNode);
            gainNode.connect(silentAudioContext.destination);
            source.start(0);
            silentAudioNode = source;
        }
    } catch (err) {}
}

function stopSilentAudio() {
    try {
        if (silentAudioNode) { try { silentAudioNode.stop(); } catch (e) {} silentAudioNode.disconnect(); silentAudioNode = null; }
        if (silentAudioContext && silentAudioContext.state !== 'closed') { silentAudioContext.close(); silentAudioContext = null; }
    } catch (err) {}
}

async function getLivePosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported by device.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords ? pos.coords.latitude : pos.lat;
                const lng = pos.coords ? pos.coords.longitude : pos.lng;
                const speed = pos.coords && pos.coords.speed ? pos.coords.speed * 2.23694 : (pos.speed || 0);
                
                if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
                    reject(new Error('Invalid GPS coordinates received.'));
                    return;
                }
                resolve({ lat: Number(lat), lng: Number(lng), speed: Number(speed) });
            },
            (err) => {
                reject(new Error('GPS Hardware Lock Failed: ' + err.message));
            },
            { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
        );
    });
}

function handlePositionUpdate(position) {
    if (!position) return;
    
    let lat, lng, speedMph = 0;

    if (position.lat !== undefined && position.lng !== undefined) {
        lat = Number(position.lat);
        lng = Number(position.lng);
        speedMph = Number(position.speed || 0);
    } else if (position.coords) {
        lat = Number(position.coords.latitude);
        lng = Number(position.coords.longitude);
        speedMph = position.coords.speed ? Number(position.coords.speed * 2.23694) : 0;
    }

    if (lat === undefined || lng === undefined || isNaN(lat) || isNaN(lng)) {
        console.warn("Blocked undefined/NaN coordinate update:", position);
        return;
    }

    const sessionId = window.activeSessionId || SafeStorage.getItem('smd_session_id');
    if (SafeStorage.getItem('smd_active_broadcast') === 'true' && sessionId) {
        db.ref('broadcasts/' + sessionId).update({
            lat: lat,
            lng: lng,
            speed: Math.round(speedMph),
            timestamp: Date.now()
        });
    }
}

async function startRealTimeTracking() {
    await requestWakeLock();
    startSilentAudio();
    
    try {
        const initial = await getLivePosition();
        handlePositionUpdate(initial);
    } catch(err) {
        alert("GPS Error: " + err.message);
    }

    if (backgroundHeartbeatInterval) clearInterval(backgroundHeartbeatInterval);
    backgroundHeartbeatInterval = setInterval(async () => {
        if (SafeStorage.getItem('smd_active_broadcast') === 'true') {
            try {
                const pos = await getLivePosition();
                handlePositionUpdate(pos);
            } catch(e) {}
        } else {
            clearInterval(backgroundHeartbeatInterval);
        }
    }, 3000);
}

async function stopRealTimeTracking() {
    if (backgroundHeartbeatInterval) clearInterval(backgroundHeartbeatInterval);
    await releaseWakeLock();
    stopSilentAudio();
    SafeStorage.removeItem('smd_active_broadcast');
}