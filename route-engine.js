// SeeMyDriver route engine: snap to route, heading from road, off-route reroute.
(function (root) {
  const M = 111320, rad = d => d * Math.PI / 180;

  function projectOnSegment(p, a, b) {
    const k = Math.cos(rad(a[0]));
    const bx = (b[1] - a[1]) * k, by = b[0] - a[0];
    const px = (p[1] - a[1]) * k, py = p[0] - a[0];
    const len2 = bx * bx + by * by;
    let t = len2 ? (px * bx + py * by) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const sx = bx * t, sy = by * t;
    return { point: [a[0] + sy, a[1] + sx / k], dist: Math.hypot(px - sx, py - sy) * M };
  }
  function meters(a, b) {
    return Math.hypot((b[1] - a[1]) * Math.cos(rad(a[0])), b[0] - a[0]) * M;
  }
  function bearing(a, b) {
    const p1 = rad(a[0]), p2 = rad(b[0]), dl = rad(b[1] - a[1]);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;

  function snapToRoute(route, p, fromIdx) {
    const n = route.length - 1;
    if (n < 1) return null;
    const search = (lo, hi) => {
      let best = null;
      for (let i = lo; i < hi; i++) {
        const r = projectOnSegment(p, route[i], route[i + 1]);
        if (!best || r.dist < best.dist) { best = r; best.idx = i; }
      }
      return best;
    };
    let best = search(Math.max(0, fromIdx - 1), Math.min(n, fromIdx + 60));
    if (!best || best.dist > 40) {
      const all = search(0, n);
      if (all && (!best || all.dist < best.dist)) best = all;
    }
    return best;
  }

  function createRouteTracker(opts) {
    const o = Object.assign({ offRouteMeters: 35, offRouteHits: 3, minFetchMs: 8000, smooth: 0.6 }, opts);
    const s = { route: [], idx: 0, off: 0, lastFetch: -Infinity, fetching: false,
                heading: 0, hasHeading: false, newRoute: false, prev: null };

    function requestRoute(lat, lng, now) {
      if (s.fetching || now - s.lastFetch < o.minFetchMs) return;
      s.fetching = true; s.lastFetch = now;
      Promise.resolve(o.fetchRoute(lat, lng))
        .then(r => { if (r && r.length > 1) { s.route = r; s.idx = 0; s.off = 0; s.newRoute = true; } })
        .catch(() => {})
        .then(() => { s.fetching = false; });
    }

    function update(lat, lng, now) {
      now = now === undefined ? Date.now() : now;
      const raw = [lat, lng];
      let display = raw, remaining = [], onRoute = false, target = null;

      if (s.route.length > 1) {
        const snap = snapToRoute(s.route, raw, s.idx);
        if (snap && snap.dist <= o.offRouteMeters) {
          onRoute = true; s.off = 0; s.idx = snap.idx; display = snap.point;
          remaining = [snap.point].concat(s.route.slice(snap.idx + 1));
          let j = snap.idx + 1;
          while (j < s.route.length - 1 && meters(snap.point, s.route[j]) < 8) j++;
          target = bearing(snap.point, s.route[j]);
        } else if (++s.off >= o.offRouteHits) requestRoute(lat, lng, now);
      } else requestRoute(lat, lng, now);

      if (target === null && s.prev && meters(s.prev, raw) > 5) target = bearing(s.prev, raw);
      if (!s.prev || meters(s.prev, raw) > 5) s.prev = raw;
      if (target !== null) {
        s.heading = s.hasHeading ? (s.heading + angDiff(s.heading, target) * o.smooth + 360) % 360 : target;
        s.hasHeading = true;
      }
      const out = { display, heading: s.heading, remaining, onRoute, newRoute: s.newRoute };
      s.newRoute = false;
      return out;
    }
    return { update, state: s };
  }

  const api = { createRouteTracker, snapToRoute, projectOnSegment, bearing, meters, angDiff };
  if (typeof module !== 'undefined') module.exports = api; else root.RouteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);