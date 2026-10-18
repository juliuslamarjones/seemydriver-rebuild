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
    if (window.innerWidth >= 1024) {
        window.switchView('landing-view');
    } else {
        window.switchView('signin-view');
    }
};

window.handleSignIn = function () {
    const email = document.getElementById('signin-email') ? document.getElementById('signin-email').value.trim() : '';
    if (!email) {
        alert('Please enter your email address.');
        return;
    }
    window.switchView('job-setup-view');
};

window.endBroadcastAndHome = function () {
    localStorage.removeItem('smd_active_broadcast');
    localStorage.removeItem('smd_session_id');
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