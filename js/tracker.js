// js/tracker.js

const SafeStorage = {
    getItem(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
    setItem(key, value) { try { localStorage.setItem(key, value); } catch (e) {} },
    removeItem(key) { try { localStorage.removeItem(key); } catch (e) {} }
};

const GEO = {
  kind: null,            // 'bg' | 'native' | 'web'
  watcherId: null,
  lastFix: null,         // {lat, lng, speed, accuracy}
  lastWatchFixAt: 0,     
  lastPushAt: 0,
  dirty: false,
  watchdog: null,
  restarting: false,
  failCount: 0,
  nextHealAt: 0,
  warnedPermission: false,
  STALE_MS: 25000,       
  PUSH_MIN_MS: 2000,     
  MAX_ACCURACY_M: 150    
};

const _capPlugins = {};
function capPlugin(name) {
  const C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return undefined;
  return _capPlugins[name] || (_capPlugins[name] = C.registerPlugin(name));
}

const CapGeo = () => capPlugin('Geolocation');
const CapBg  = () => capPlugin('BackgroundGeolocation');
const isBroadcasting = () => SafeStorage.getItem('smd_active_broadcast') === 'true';

function onFix(lat, lng, speed, accuracy, source) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
  if (lat === 0 && lng === 0) return;
  if (source === 'watch') { GEO.lastWatchFixAt = Date.now(); GEO.failCount = 0; }
  if (Number.isFinite(accuracy) && accuracy > GEO.MAX_ACCURACY_M) return;
  GEO.lastFix = { lat, lng, speed: Number.isFinite(speed) && speed > 0 ? speed : 0, accuracy };
  GEO.dirty = true;
  flushPosition(false);
}

function flushPosition(force) {
  const f = GEO.lastFix;
  if (!f || !isBroadcasting()) return;
  const sid = window.activeSessionId || SafeStorage.getItem('smd_active_session_id');
  if (!sid) return;
  const now = Date.now();
  if (!force && now - GEO.lastPushAt < GEO.PUSH_MIN_MS) return;
  GEO.lastPushAt = now;
  GEO.dirty = false;
  db.ref('broadcasts/' + sid).update({
    lat: f.lat,
    lng: f.lng,
    speed: Math.round(f.speed * 2.23694),
    timestamp: firebase.database.ServerValue.TIMESTAMP
  }).catch(e => { GEO.dirty = true; console.warn('Firebase write failed:', e); });
}

function getPositionOnce(timeoutMs) {
  const geo = CapGeo();
  if (geo) return geo.getCurrentPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
  return new Promise((res, rej) =>
    navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }));
}

async function pollOnce() {
  try {
    const p = await getPositionOnce(8000);
    const coords = p.coords || p;
    onFix(coords.latitude, coords.longitude, coords.speed, coords.accuracy, 'poll');
  } catch (e) { console.warn('GPS poll failed:', e); }
}

async function getFirstFix() {
  const geo = CapGeo();
  if (geo) {
    try {
      await Promise.race([
        geo.requestPermissions(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Permission timeout')), 4000))
      ]);
    } catch (e) {
      console.warn("Permission prompt skipped or timed out:", e);
    }
  }

  for (let i = 0; i < 2; i++) {
    try {
      const p = await Promise.race([
        getPositionOnce(6000),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Position timeout')), 6000))
      ]);
      const c = p.coords || p;
      if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
        return { lat: c.latitude, lng: c.longitude };
      }
    } catch (e) { 
      console.warn('First fix attempt failed, retrying...', e); 
    }
  }
  return null;
}

async function stopWatcher() {
  const id = GEO.watcherId, kind = GEO.kind;
  GEO.watcherId = null; GEO.kind = null;
  if (id === null || id === undefined) return;
  try {
    if (kind === 'bg') await CapBg().removeWatcher({ id });
    else if (kind === 'native') await CapGeo().clearWatch({ id });
    else if (kind === 'web') navigator.geolocation.clearWatch(id);
  } catch (e) { console.warn('stopWatcher:', e); }
}

async function startWatcher() {
  await stopWatcher();
  const bg = CapBg(), geo = CapGeo();

  if (bg) {
    try {
      GEO.watcherId = await bg.addWatcher(
        {
          backgroundTitle: 'SeeMyDriver is broadcasting',
          backgroundMessage: 'Sharing your live location with your customer.',
          requestPermissions: true,
          stale: false,
          distanceFilter: 0
        },
        (loc, err) => {
          if (err) {
            console.warn('BG watcher error:', err);
            if (err.code === 'NOT_AUTHORIZED' && !GEO.warnedPermission) {
              GEO.warnedPermission = true;
              alert('SeeMyDriver needs Location set to "Allow all the time" to keep broadcasting.');
              try { bg.openSettings(); } catch (e) {}
            }
            return;
          }
          if (loc) onFix(loc.latitude, loc.longitude, loc.speed, loc.accuracy, 'watch');
        }
      );
      GEO.kind = 'bg';
      return;
    } catch (e) { console.warn('BG watcher failed, trying @capacitor/geolocation:', e); }
  }

  if (geo) {
    try {
      const perm = await geo.requestPermissions();
      if (perm.location === 'granted') {
        GEO.watcherId = await geo.watchPosition(
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
          (pos, err) => {
            if (err) { console.warn('Native watch error:', err); return; }
            if (pos?.coords) onFix(pos.coords.latitude, pos.coords.longitude, pos.coords.speed, pos.coords.accuracy, 'watch');
          }
        );
        GEO.kind = 'native';
        return;
      }
    } catch (e) { console.warn('Native geolocation failed, trying web API:', e); }
  }

  if (navigator.geolocation) {
    GEO.watcherId = navigator.geolocation.watchPosition(
      (p) => onFix(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.accuracy, 'watch'),
      (e) => console.warn('Web GPS error:', e),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    GEO.kind = 'web';
  }
}

async function healTracking(reason) {
  if (GEO.restarting) return;
  GEO.restarting = true;
  try {
    GEO.failCount++;
    console.warn('Healing GPS watcher, reason:', reason, 'attempt', GEO.failCount);
    try { db.goOnline(); } catch (e) {}
    pollOnce();
    await startWatcher();
    GEO.nextHealAt = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(GEO.failCount, 4));
  } finally { GEO.restarting = false; }
}

async function watchdogTick() {
  if (!isBroadcasting()) return;
  if (GEO.dirty) flushPosition(false);
  if (Date.now() - GEO.lastWatchFixAt < GEO.STALE_MS) return;
  pollOnce();
  if (Date.now() >= GEO.nextHealAt) await healTracking('stale');
}

function startWatchdog() {
  stopWatchdog();
  GEO.lastWatchFixAt = Date.now();
  GEO.nextHealAt = 0;
  GEO.watchdog = setInterval(watchdogTick, 5000);
}

function stopWatchdog() {
  if (GEO.watchdog) { clearInterval(GEO.watchdog); GEO.watchdog = null; }
}

async function startRealTimeTracking() {
  startWatchdog();
  await startWatcher();
}

async function stopRealTimeTracking() {
  stopWatchdog();
  await stopWatcher();
  GEO.lastFix = null; GEO.dirty = false;
  SafeStorage.removeItem('smd_active_broadcast');
}

function onResumeLike() {
  if (!isBroadcasting()) return;
  try { db.goOnline(); } catch (e) {}
  if (Date.now() - GEO.lastWatchFixAt > 10000) healTracking('resume');
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onResumeLike(); });
window.addEventListener('online', onResumeLike);
try { window.Capacitor?.Plugins?.App?.addListener('resume', onResumeLike); } catch (e) {}

db.ref('.info/connected').on('value', (s) => { if (s.val() === true) flushPosition(true); });