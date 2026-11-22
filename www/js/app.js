// ==========================================================
// SEEMYDRIVER - MAIN APP UI & ROUTING CONTROLLER
// ==========================================================
(function () {
'use strict';

window.switchView = function (viewId) {
    document.querySelectorAll('.app-view').forEach((el) => {
        el.classList.add('hidden');
        el.style.display = 'none';
    });
    
    const targetId = viewId === 'landing' ? 'landing-view' : (viewId.includes('-view') ? viewId : viewId + '-view');
    const target = document.getElementById(targetId);
    
    // Hide header action buttons (Sign In / Get Started) on active broadcast or customer views to eliminate clutter
    const headerNav = document.getElementById('header-nav-actions');
    if (headerNav) {
        if (targetId === 'active-broadcast-view' || targetId === 'customer-view-view') {
            headerNav.style.display = 'none';
        } else {
            headerNav.style.display = 'flex';
        }
    }

    if (target) {
        target.classList.remove('hidden');
        target.style.display = 'block';
        
        if (targetId === 'active-broadcast-view' && typeof window.initDriverActiveMap === 'function') {
            setTimeout(window.initDriverActiveMap, 150);
        } else if (targetId === 'customer-view-view' && typeof window.initCustomerMapLive === 'function') {
            setTimeout(window.initCustomerMapLive, 150);
        }
    }
};

window.handleSignOut = function () {
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    localStorage.removeItem('smd_user_email');
    if (window.innerWidth >= 1024) {
        window.switchView('landing-view');
    } else {
        window.switchView('signin-view');
    }
};

window.handleSignIn = function () {
    const email = (document.getElementById('signin-email') ? document.getElementById('signin-email').value.trim() : '').toLowerCase();
    if (!email) {
        alert('Please enter your email address.');
        return;
    }
    try { localStorage.setItem('smd_signed_in', '1'); if (email) localStorage.setItem('smd_user_email', email); if (window.SafeStorage) window.SafeStorage.setItem('smd_signed_in', '1'); } catch (e) {}
    if (!smdIsInstalledApp()) {
        smdPromptAppDownload(email);
        return;
    }
    window.switchView('job-setup-view');
};

function smdIsInstalledApp() {
    try {
        if (window.matchMedia && (
            window.matchMedia('(display-mode: standalone)').matches ||
            window.matchMedia('(display-mode: fullscreen)').matches ||
            window.matchMedia('(display-mode: minimal-ui)').matches
        )) return true;
        if (window.navigator && window.navigator.standalone === true) return true;
        if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return true;
        if (window.cordova) return true;
    } catch (e) {}
    return false;
}

function smdPromptAppDownload(email) {
    try {
        if (email) {
            localStorage.setItem('smd_user_email', email);
            if (window.SafeStorage) window.SafeStorage.setItem('smd_user_email', email);
        }
    } catch (e) {}
    const regView = document.getElementById('register-view');
    if (regView && !document.getElementById('smd-apk-gate-box')) {
        const box = document.createElement('div');
        box.id = 'smd-apk-gate-box';
        box.className = 'mt-4 p-4 rounded-2xl bg-amber-400/10 border border-amber-400/40 text-amber-200 text-xs flex flex-col gap-3';
        box.innerHTML = '<div class="font-bold text-amber-400">Install the SeeMyDriver app to continue</div>' +
            '<div>Driver broadcast runs inside the installed app, not a mobile browser tab.</div>' +
            '<a href="https://github.com/juliuslamarjones/seemydriver-rebuild/releases/download/v1.0.0/seemydriver.apk" download="seemydriver.apk" class="w-full text-center bg-amber-400 text-black font-black py-2.5 px-4 rounded-xl">Install SeeMyDriver</a>';
        const card = regView.querySelector('.w-full.bg-\\[\\#12141c\\]') || regView.firstElementChild;
        if (card) card.appendChild(box);
    }
     on your device instead of using the mobile browser.');
}

window.handleRegister = function () {
    const emailEl = document.getElementById('reg-email');
    const passEl = document.getElementById('reg-password');
    const email = (emailEl && emailEl.value ? emailEl.value.trim() : '').toLowerCase();
    const password = passEl && passEl.value ? passEl.value : '';
    if (!email) {
        alert('Please enter your email address.');
        return;
    }
    if (!password || password.length < 4) {
        alert('Please enter a password.');
        return;
    }
    try {
        localStorage.setItem('smd_signed_in', '1');
        localStorage.setItem('smd_user_email', email);
        if (window.SafeStorage) {
            window.SafeStorage.setItem('smd_signed_in', '1');
            window.SafeStorage.setItem('smd_user_email', email);
        }
    } catch (e) {}
    window.switchView('job-setup-view');
};

window.endBroadcastAndHome = function () {
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
    try { localStorage.setItem('smd_signed_in', '1'); if (window.SafeStorage) window.SafeStorage.setItem('smd_signed_in', '1'); } catch (e) {}
    window.switchView('job-setup-view');
};

document.addEventListener('DOMContentLoaded', () => {
    const q = new URLSearchParams(window.location.search);
    const view = q.get('view');
    
    if (view === 'customer') {
        window.switchView('customer-view-view');
    } else if (localStorage.getItem('smd_active_broadcast') === 'true' && localStorage.getItem('smd_session_id')) {
        window.switchView('active-broadcast-view');
    } else {
        localStorage.removeItem('smd_active_broadcast');
        
        if (window.innerWidth >= 1024) {
            window.switchView('landing-view');
        } else {
            window.switchView('signin-view');
        }
    }
});

})();