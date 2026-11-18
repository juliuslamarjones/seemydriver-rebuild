// ==========================================
// SEEMYDRIVER - MAIN CONTROLLER & TELEMETRY
// ==========================================

window.switchView = function(viewName, force = false) {
    const views = [
        'landing-view', 'plans-view', 'job-setup-view', 
        'active-broadcast-view', 'customer-view-view', 
        'fleet-dashboard-view', 'signin-view', 'register-view'
    ];
    
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const target = document.getElementById(viewName + '-view');
    if (target) {
        target.style.display = 'flex';
    }

    const banner = document.getElementById('active-broadcast-banner');
    if (banner) {
        const isBroadcasting = SafeStorage.getItem('smd_is_broadcasting') === 'true';
        if (isBroadcasting && viewName !== 'active-broadcast' && viewName !== 'customer-view') {
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    }

    setTimeout(() => {
        if (window.driverMap && viewName === 'active-broadcast') { window.driverMap.invalidateSize(); }
        if (window.customerMap && viewName === 'customer-view') { window.customerMap.invalidateSize(); }
        if (window.fleetMasterMap && viewName === 'fleet-dashboard') { window.fleetMasterMap.invalidateSize(); }
    }, 50);
};

window.openBatterySettings = function() { 
    alert('Please open your phone Settings > Apps > SeeMyDriver > Battery and set to Unrestricted.'); 
};

window.confirmBatteryExempted = function() { 
    const modal = document.getElementById('battery-opt-modal');
    if (modal) modal.style.display = 'none';
    window.startBroadcastExecution();
};

window.closeBatteryModal = function() {
    const modal = document.getElementById('battery-opt-modal');
    if (modal) modal.style.display = 'none';
    window.startBroadcastExecution();
};

window.setRegTier = function(tier) {
    const soloCard = document.getElementById('solo-plan-card');
    const fleetCard = document.getElementById('fleet-plan-card');
    if (tier === 'solo') {
        if (soloCard) soloCard.style.borderColor = '#fbbf24';
        if (fleetCard) fleetCard.style.borderColor = '#262626';
    } else {
        if (fleetCard) fleetCard.style.borderColor = '#fbbf24';
        if (soloCard) soloCard.style.borderColor = '#262626';
    }
};

window.selectAndRegister = function(tier) {
    SafeStorage.setItem('smd_tier', tier);
    window.switchView('register');
};

window.handleAddressInput = function(query) {
    if (!query || query.length < 3) {
        const sug = document.getElementById('address-suggestions');
        if (sug) sug.style.display = 'none';
        return;
    }
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`)
        .then(res => res.json())
        .then(data => {
            const sug = document.getElementById('address-suggestions');
            if (!sug) return;
            if (data && data.length > 0) {
                sug.innerHTML = data.map(item => `<div class="p-2.5 text-xs text-white hover:bg-[#1e2230] cursor-pointer border-b border-neutral-800" onclick="window.selectAddress('${item.display_name.replace(/'/g, "\\'")}', ${item.lat}, ${item.lon})">${item.display_name}</div>`).join('');
                sug.style.display = 'block';
            } else {
                sug.style.display = 'none';
            }
        }).catch(() => {});
};

window.selectAddress = function(name, lat, lon) {
    const input = document.getElementById('job-cust-address');
    if (input) input.value = name;
    window.selectedDest = { name, lat, lon };
    const sug = document.getElementById('address-suggestions');
    if (sug) sug.style.display = 'none';
};

window.launchLiveBroadcast = function() {
    const driverName = document.getElementById('job-driver-name')?.value.trim() || 'Driver';
    const driverPhone = document.getElementById('job-driver-phone')?.value.trim() || '';
    const custName = document.getElementById('job-cust-name')?.value.trim() || 'Client';
    const destAddress = document.getElementById('job-cust-address')?.value.trim() || '';

    SafeStorage.setItem('smd_driver_name', driverName);
    SafeStorage.setItem('smd_driver_phone', driverPhone);
    SafeStorage.setItem('smd_cust_name', custName);
    SafeStorage.setItem('smd_dest_address', destAddress);

    const modal = document.getElementById('battery-opt-modal');
    if (modal) {
        modal.style.display = 'flex';
    } else {
        window.startBroadcastExecution();
    }
};

window.startBroadcastExecution = function() {
    SafeStorage.setItem('smd_is_broadcasting', 'true');
    window.switchView('active-broadcast');
    initDriverMapAndTracking();
};

window.endBroadcastAndHome = function() {
    SafeStorage.setItem('smd_is_broadcasting', 'false');
    if (window.watchId !== null) {
        navigator.geolocation.clearWatch(window.watchId);
    }
    window.switchView('landing');
};

window.copyTrackingLink = function() {
    const input = document.getElementById('tracking-link-output');
    if (input) {
        input.select();
        navigator.clipboard.writeText(input.value);
        alert('Tracking link copied to clipboard!');
    }
};

window.textTrackingLink = function() {
    const input = document.getElementById('tracking-link-output');
    const phone = SafeStorage.getItem('smd_driver_phone') || '';
    if (input) {
        window.location.href = `sms:${phone}?body=${encodeURIComponent('Track my live delivery here: ' + input.value)}`;
    }
};

window.watchId = null;
function initDriverMapAndTracking() {
    const container = document.getElementById('driver-map-container');
    if (!container) return;

    if (!window.driverMap) {
        window.driverMap = L.map('driver-map-container', { zoomControl: false }).setView([29.7604, -95.3698], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(window.driverMap);
    }

    const sessionId = SafeStorage.getItem('smd_session_id');
    const trackingUrl = window.location.origin + window.location.pathname + '?s=' + sessionId;
    const linkOutput = document.getElementById('tracking-link-output');
    if (linkOutput) linkOutput.value = trackingUrl;

    if (navigator.geolocation) {
        window.watchId = navigator.geolocation.watchPosition(position => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const speedMph = Math.round((position.coords.speed || 0) * 2.23694);

            const speedEl = document.getElementById('driver-map-speed');
            if (speedEl) speedEl.innerText = speedMph + ' mph';

            window.driverMap.setView([lat, lon], 16);

            db.ref('broadcasts/' + sessionId).set({
                lat, lon, speed: speedMph,
                driverName: SafeStorage.getItem('smd_driver_name') || 'Driver',
                driverPhone: SafeStorage.getItem('smd_driver_phone') || '',
                destAddress: SafeStorage.getItem('smd_dest_address') || '',
                updatedAt: Date.now()
            });
        }, err => {
            console.error(err);
        }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    }
}

window.fitDriverMap = function() {};
window.recenterDriverMap = function() {};
window.openDriverDirections = function() {
    const dest = SafeStorage.getItem('smd_dest_address');
    if (dest) {
        window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(dest)}`, '_blank');
    }
};

window.fitCustomerMap = function() {};
window.recenterCustomerMap = function() {};
window.fitFleetMap = function() {};
window.generateDriverInvite = function() {
    const name = document.getElementById('new-driver-name-input')?.value.trim();
    if (!name) { alert('Enter driver name'); return; }
    const inviteUrl = window.location.origin + window.location.pathname + '?driver_invite=' + encodeURIComponent(name);
    prompt('Copy Driver Invite Link:', inviteUrl);
};
window.handleFleetAddressInput = function() {};
window.handleFleetDispatch = function() {};

// ==========================================
// SMART SIGN-IN & BOOT GATEWAY
// ==========================================

window.togglePasswordVisibility = function() {
    const pwdInput = document.getElementById('signin-password');
    if (pwdInput) {
        pwdInput.type = pwdInput.type === 'password' ? 'text' : 'password';
    }
};

window.handleSignIn = function() {
    const email = document.getElementById('signin-email')?.value.trim().toLowerCase() || '';
    const password = document.getElementById('signin-password')?.value.trim() || '';
    if (!email || !password) { alert('Email and password required.'); return; }
    
    SafeStorage.setItem('smd_is_logged_in', 'true');
    SafeStorage.setItem('smd_user_email', email);

    // Updated with correct email spelling including the 'u' in Julius
    if (email === 'juliuslamarjones@gmail.com' || email.includes('fleet') || email.includes('admin') || email.includes('command')) {
        SafeStorage.setItem('smd_user_role', 'fleet_manager');
        switchView('fleet-dashboard');
    } else {
        SafeStorage.setItem('smd_user_role', 'driver');
        switchView('job-setup');
    }
};

window.handleRegister = function() {
    const email = document.getElementById('reg-email')?.value.trim() || '';
    const password = document.getElementById('password-input')?.value.trim() || '';
    if (!email || !password) { alert('Email and password required.'); return; }
    SafeStorage.setItem('smd_is_logged_in', 'true');
    SafeStorage.setItem('smd_user_email', email);
    switchView('job-setup');
};

// BOOT GATEWAY
(() => {
    try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('view') === 'customer' || urlParams.has('s') || urlParams.has('session')) {
            switchView('customer-view');
        } else if (urlParams.has('driver_invite')) {
            const driverName = urlParams.get('driver_invite');
            SafeStorage.setItem('smd_driver_name', driverName);
            switchView('job-setup');
            const nameField = document.getElementById('job-driver-name');
            if (nameField) nameField.value = driverName;
        } else if (SafeStorage.getItem('smd_is_logged_in') === 'true') {
            const role = SafeStorage.getItem('smd_user_role');
            if (role === 'fleet_manager') {
                switchView('fleet-dashboard');
            } else {
                switchView('job-setup');
            }
        } else {
            switchView('signin'); 
        }
    } catch (e) {
        switchView('signin');
    }
})();