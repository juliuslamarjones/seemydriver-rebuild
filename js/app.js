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
    try { localStorage.setItem('smd_signed_out', '1'); localStorage.removeItem('smd_signed_in'); } catch (e) {}
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
    try { localStorage.removeItem('smd_signed_out'); localStorage.setItem('smd_signed_in', '1'); if (email) localStorage.setItem('smd_user_email', email); if (window.SafeStorage) window.SafeStorage.setItem('smd_signed_in', '1'); } catch (e) {}
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
    const hostView = document.getElementById('signin-view') && getComputedStyle(document.getElementById('signin-view')).display !== 'none'
        ? document.getElementById('signin-view')
        : document.getElementById('register-view');
    if (hostView && !hostView.querySelector('.smd-signin-gate-box')) {
        const box = document.createElement('div');
        box.className = "smd-signin-gate-box mt-4 p-4 rounded-2xl bg-[#12141c] border border-amber-400/35 text-neutral-200 text-xs flex flex-col gap-3 shadow-lg";
        box.innerHTML = "<div class=\"flex items-center gap-2 font-black text-amber-400 text-sm\"><span>&#128064;</span><span>SeeMyDriver</span></div>" +
            "<button type=\"button\" onclick=\"if(typeof window.smdInstallSeeMyDriver==='function')window.smdInstallSeeMyDriver()\" class=\"w-full text-center bg-amber-400 hover:bg-amber-300 text-black font-black py-2.5 px-4 rounded-xl cursor-pointer transition\">Install SeeMyDriver</button>" +
            "<button type=\"button\" onclick=\"if(typeof window.switchView==='function')window.switchView('job-setup-view')\" class=\"w-full text-center bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-white font-bold py-2 px-4 rounded-xl cursor-pointer transition\">Continue to Job Setup &rarr;</button>";
        const card = hostView.querySelector("[class*=\"bg-[#12141c]\"], [class*=\"bg-gradient-to-b\"]") || hostView.firstElementChild;
        if (card) card.appendChild(box);
    }
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