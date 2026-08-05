// stonepool — the communal ancestor-stone pool
// GET  /pool   → latest public stones (anyone may read)
// POST /offer  → give a stone to the commons (age ≥ 20h, 1 per IP per day)
// POST /admin  → moderation (X-Admin-Token: purge or remove by index)

const POOL_KEY = 'pool_v1';
const MAX_POOL = 20;
const MIN_AGE_MS = 20 * 3600 * 1000;
const OFFER_COOLDOWN_MS = 24 * 3600 * 1000;

// Minimal blocklist: links/contact info (spam) + obvious abuse.
// Not a real moderation system — the admin endpoint is the backstop.
const BLOCKED = [
  'http', 'www.', '.com', '.cn', '.net', '.org', '.xyz', '.top',
  '微信', 'qq', '代购', '加v', '兼职', '刷', 'VPN',
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token',
};

function json(data, status = 200) {
  return Response.json(data, { status, headers: cors });
}

async function sha256short(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    // ── Read the commons ──
    if (url.pathname === '/pool' && request.method === 'GET') {
      const pool = (await env.STONEPOOL.get(POOL_KEY, 'json')) || [];
      return json({ stones: pool });
    }

    // ── Offer a stone ──
    if (url.pathname === '/offer' && request.method === 'POST') {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const ipKey = 'ip_' + (await sha256short(ip));
      const last = Number(await env.STONEPOOL.get(ipKey)) || 0;
      if (Date.now() - last < OFFER_COOLDOWN_MS) {
        return json({ error: 'too_often' }, 429);
      }

      let data;
      try { data = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }

      const t = String(data.t || '').trim().slice(0, 24);
      const c = String(data.c || '').trim().slice(0, 500);
      const ts = Number(data.ts) || 0;
      const w = Math.max(0, Math.min(2.5, Number(data.w) || 0));

      if (!t || !c) return json({ error: 'empty' }, 400);
      if (ts <= 0 || Date.now() - ts < MIN_AGE_MS) return json({ error: 'too_young' }, 400);
      if (ts > Date.now() + 3600 * 1000) return json({ error: 'bad_ts' }, 400);

      const hay = (t + ' ' + c).toLowerCase();
      if (BLOCKED.some(word => hay.includes(word.toLowerCase()))) {
        return json({ error: 'rejected' }, 400);
      }

      const pool = (await env.STONEPOOL.get(POOL_KEY, 'json')) || [];
      pool.push({ t, c, ts, w });
      while (pool.length > MAX_POOL) pool.shift();
      await env.STONEPOOL.put(POOL_KEY, JSON.stringify(pool));
      await env.STONEPOOL.put(ipKey, String(Date.now()), { expirationTtl: 86400 });

      return json({ ok: true, poolSize: pool.length });
    }

    // ── Moderation ──
    if (url.pathname === '/admin' && request.method === 'POST') {
      if (request.headers.get('X-Admin-Token') !== env.ADMIN_TOKEN) {
        return json({ error: 'forbidden' }, 403);
      }
      const body = await request.json().catch(() => ({}));
      let pool = (await env.STONEPOOL.get(POOL_KEY, 'json')) || [];
      if (body.purge) pool = [];
      else if (Number.isInteger(body.remove)) pool.splice(body.remove, 1);
      await env.STONEPOOL.put(POOL_KEY, JSON.stringify(pool));
      return json({ ok: true, poolSize: pool.length, stones: pool });
    }

    return new Response('stonepool', { status: 200, headers: cors });
  },
};
