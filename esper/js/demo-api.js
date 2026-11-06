/*
 * demo-api.js: a read-only stand-in for the Esper FastAPI backend.
 *
 * Loaded before the app. It intercepts fetch('/api/...') and answers from
 * the static snapshot in data/ (made by scripts/export_demo.py), so the real
 * Esper frontend runs with no server. Relations that the server computes in
 * PostGIS are computed here in the browser over the snapshot. Anything that
 * would write to the database is refused with a short notice.
 */
(function () {
  'use strict';

  const DATA = new URL('../data/', document.currentScript.src).href;
  const DEMO_PREFIX = 'BARONY_SLIGO_';
  const realFetch = window.fetch.bind(window);

  // ── tiny helpers ─────────────────────────────────────────────────────────
  const cache = new Map();
  function load(path) {
    if (!cache.has(path)) {
      cache.set(path, realFetch(DATA + path).then(r => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
      }));
    }
    return cache.get(path);
  }
  function reply(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
      status, headers: { 'Content-Type': 'application/json' },
    });
  }
  const fc = (features, extra = {}) => ({ type: 'FeatureCollection', features, ...extra });
  const isDemo = id => id.startsWith(DEMO_PREFIX);

  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('demo-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'demo-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }

  // ── snapshot pool ────────────────────────────────────────────────────────
  const pool = new Map();        // signal_id → full feature (demo baronies)
  const baronyOf = new Map();    // signal_id → barony context_id
  let demoBaronyIds = null;

  async function baronyIds() {
    if (!demoBaronyIds) {
      const b = await load('baronies.json');
      demoBaronyIds = b.features.map(f => f.id).filter(isDemo);
    }
    return demoBaronyIds;
  }

  async function loadBarony(id) {
    const data = await load(`signals/${id}.json`);
    for (const f of data.features) {
      pool.set(f.id, f);
      baronyOf.set(f.id, id);
    }
    return data.features;
  }

  async function loadAllDemo() {
    await Promise.all((await baronyIds()).map(loadBarony));
  }

  let extras = null;
  async function extraIndex() {
    if (!extras) {
      const d = await load('extra_signals.json');
      extras = new Map(d.features.map(f => [f.id, f]));
    }
    return extras;
  }

  let namesBySignal = null;
  async function names() {
    const byName = await load('names.json');
    if (!namesBySignal) {
      namesBySignal = new Map();
      for (const [norm, sids] of Object.entries(byName)) {
        for (const sid of sids) {
          if (!namesBySignal.has(sid)) namesBySignal.set(sid, []);
          namesBySignal.get(sid).push(norm);
        }
      }
    }
    return { byName, namesBySignal };
  }

  // ── geometry ─────────────────────────────────────────────────────────────
  function lonlat(f) {
    const c = f && f.geometry && f.geometry.coordinates;
    return c && c.length >= 2 ? c : null;
  }
  function distM(a, b) {
    const R = 6371008.8, rad = Math.PI / 180;
    const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) &&
          pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolygon(pt, rings) {
    return inRing(pt, rings[0]) && !rings.slice(1).some(h => inRing(pt, h));
  }
  function inGeometry(pt, g) {
    if (!g) return false;
    if (g.type === 'Polygon') return inPolygon(pt, g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.some(p => inPolygon(pt, p));
    return false;
  }
  async function townlandOf(sid, pt) {
    const b = baronyOf.get(sid);
    if (!b) return null;
    const tl = await load(`townlands/${b}.json`);
    return tl.features.find(t => inGeometry(pt, t.geometry)) || null;
  }

  function bpRange(f) {
    const tv = f.properties && f.properties.temporal_vector;
    if (!tv || tv.years_bp_min == null || tv.years_bp_max == null) return null;
    return [Number(tv.years_bp_min), Number(tv.years_bp_max)];
  }
  const withEvidence = (f, evidence) => ({ ...f, evidence });

  // ── /api/signals/{id}/related ────────────────────────────────────────────
  async function related(sid, params) {
    await loadAllDemo();
    const focus = pool.get(sid);
    if (!focus) return reply({ detail: `Signal not found: ${sid}` }, 404);

    const rel = new Set((params.get('relations') || 'spatial').split(',').map(s => s.trim()));
    const scope = params.get('scope') || 'radius';
    const radius = Number(params.get('radius_m') || 1500);
    const limit = Math.min(Number(params.get('limit') || 20), 100);
    const here = lonlat(focus);
    const result = { signal_id: sid, spatial: [], temporal: [], name: [] };

    // Scope gate, as in the PostGIS version (name links ignore it)
    let gate = () => true;
    if (here) {
      if (scope === 'radius') gate = (f, p) => distM(here, p) <= radius;
      else if (scope === 'region') gate = (f, p) => distM(here, p) <= 25000;
      else if (scope === 'barony') {
        const b = baronyOf.get(sid);
        gate = f => baronyOf.get(f.id) === b;
      } else if (scope === 'townland') {
        const t = await townlandOf(sid, here);
        gate = t ? (f, p) => inGeometry(p, t.geometry) : () => false;
      }
    }
    const candidates = [];
    if (here) {
      for (const f of pool.values()) {
        if (f.id === sid) continue;
        const p = lonlat(f);
        if (p && gate(f, p)) candidates.push([f, distM(here, p)]);
      }
      candidates.sort((a, b) => a[1] - b[1]);
    }

    if (rel.has('spatial')) {
      result.spatial = candidates.slice(0, limit).map(([f, d]) =>
        withEvidence(f, { relation_type: 'spatial', distance_m: Math.round(d * 10) / 10 }));
    }

    if (rel.has('temporal')) {
      const r = bpRange(focus);
      if (r) {
        const [lo, hi] = r;
        for (const [f] of candidates) {
          const o = bpRange(f);
          if (o && o[0] <= hi && o[1] >= lo) {
            result.temporal.push(withEvidence(f, {
              relation_type: 'temporal',
              overlapping_range: [Math.max(lo, o[0]), Math.min(hi, o[1])],
            }));
            if (result.temporal.length >= limit) break;
          }
        }
      }
    }

    if (rel.has('name')) {
      const { byName, namesBySignal } = await names();
      const shared = new Map();
      let rows = 0;
      for (const norm of namesBySignal.get(sid) || []) {
        for (const other of byName[norm] || []) {
          if (other === sid || rows >= 50) continue;
          if (!shared.has(other)) shared.set(other, []);
          shared.get(other).push(norm);
          rows++;
        }
      }
      if (shared.size) {
        const ex = await extraIndex();
        for (const [other, norms] of shared) {
          const f = pool.get(other) || ex.get(other);
          if (f) result.name.push(withEvidence(f, { relation_type: 'name', shared_entity_names: norms }));
        }
      }
    }
    return reply(result);
  }

  // ── router ───────────────────────────────────────────────────────────────
  async function handle(url, method) {
    const path = url.pathname.replace(/^.*?\/api\//, '/api/');
    const q = url.searchParams;

    if (method !== 'GET') {
      toast('Read-only demo: edits, bundles and imports need the full Esper with its database.');
      return reply({ detail: 'read-only demo' }, 403);
    }

    if (path === '/api/baronies') return reply(await load('baronies.json'));

    if (path === '/api/signals') {
      const limit = Number(q.get('limit') || 1000);
      if (q.get('names_entity')) {
        const norm = q.get('names_entity').trim().toLowerCase();
        await loadAllDemo();
        const [{ byName }, ex] = await Promise.all([names(), extraIndex()]);
        const feats = (byName[norm] || [])
          .map(id => pool.get(id) || ex.get(id))
          .filter(f => f && f.geometry)
          .slice(0, limit);
        return reply(fc(feats, { metadata: { total: feats.length, returned: feats.length, offset: 0, limit } }));
      }
      const ids = (q.get('barony_ids') || '').split(',').map(s => s.trim()).filter(Boolean);
      const wanted = ids.filter(isDemo);
      if (ids.length && !wanted.length) {
        toast('This demo holds the six baronies of Co. Sligo. Pick one of those.');
      }
      const lists = await Promise.all(wanted.map(loadBarony));
      const feats = lists.flat().slice(0, limit);
      return reply(fc(feats, { metadata: { total: feats.length, returned: feats.length, offset: 0, limit } }));
    }

    if (path === '/api/townlands') {
      const ids = (q.get('barony_id') || '').split(',').map(s => s.trim()).filter(isDemo);
      const lists = await Promise.all(ids.map(id => load(`townlands/${id}.json`)));
      return reply(fc(lists.flatMap(d => d.features)));
    }

    let m = path.match(/^\/api\/signals\/([^/]+)\/related$/);
    if (m) return related(decodeURIComponent(m[1]), q);

    m = path.match(/^\/api\/signals\/([^/]+)$/);
    if (m) {
      await loadAllDemo();
      const f = pool.get(decodeURIComponent(m[1]));
      return f ? reply(f) : reply({ detail: 'not found' }, 404);
    }

    return reply({ detail: 'not available in the demo' }, 404);
  }

  window.fetch = function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && /\/api\//.test(url.pathname)) {
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      return handle(url, method).catch(err => {
        console.error('demo-api:', err);
        return reply({ detail: String(err) }, 500);
      });
    }
    return realFetch(input, init);
  };

  // A saved bundle id from a real Esper session means nothing here
  try { localStorage.removeItem('bundle_id'); } catch (_) {}
})();
