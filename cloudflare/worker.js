/*
 * صندوق بريد رسائل البنك — Cloudflare Worker
 *
 * الأتمتة في الآيفون ترسل نص رسالة البنك إلى POST /in
 * والتطبيق يسحب الرسائل المعلقة من GET /pull ثم تُحذف.
 * ويرسل إشعار Web Push للأجهزة المشتركة عند وصول رسالة جديدة.
 *
 * يحتاج:
 *   - ربط KV باسم SMS_BOX
 *   - متغير سري RELAY_KEY (المفتاح السري)
 *   - متغير سري VAPID_PRIVATE + متغير VAPID_PUBLIC (مفاتيح الإشعارات)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

// ===== أدوات Web Push (VAPID) =====
function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
function bytesToB64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// توقيع JWT بخوارزمية ES256 لترويسة VAPID
async function vapidJwt(audience, env) {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:ab0d141414@gmail.com',
  })));
  const key = await crypto.subtle.importKey(
    'pkcs8', b64urlToBytes(env.VAPID_PRIVATE),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${bytesToB64url(sig)}`;
}

// إرسال دفعة (بدون محتوى — عامل الخدمة يعرض النص) لكل المشتركين
async function pushAll(env) {
  const list = await env.SMS_BOX.list({ prefix: 'sub:' });
  await Promise.all(list.keys.map(async (entry) => {
    try {
      const sub = JSON.parse(await env.SMS_BOX.get(entry.name));
      if (!sub || !sub.endpoint) return;
      const jwt = await vapidJwt(new URL(sub.endpoint).origin, env);
      const res = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          TTL: '86400',
          Urgency: 'normal',
          Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`,
        },
      });
      // اشتراك ميت — نحذفه
      if (res.status === 404 || res.status === 410) await env.SMS_BOX.delete(entry.name);
    } catch { /* لا نوقف بقية الإشعارات */ }
  }));
}

async function endpointKey(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return 'sub:' + bytesToB64url(h).slice(0, 24);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // التحقق من المفتاح السري
    if (url.searchParams.get('key') !== env.RELAY_KEY) {
      return json({ error: 'unauthorized' }, 401);
    }

    // استقبال رسالة من الأتمتة
    if (request.method === 'POST' && url.pathname === '/in') {
      const text = (await request.text()).trim();
      if (!text) return json({ error: 'empty' }, 400);
      const id = `msg:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // تنحذف تلقائياً بعد 30 يوم لو ما سحبها التطبيق
      await env.SMS_BOX.put(id, text, { expirationTtl: 60 * 60 * 24 * 30 });
      // إشعار بالخلفية بدون تعطيل رد الأتمتة
      if (env.VAPID_PRIVATE && env.VAPID_PUBLIC) ctx.waitUntil(pushAll(env));
      return json({ ok: true });
    }

    // سحب الرسائل المعلقة (يرجعها ثم يحذفها)
    if (request.method === 'GET' && url.pathname === '/pull') {
      const list = await env.SMS_BOX.list({ prefix: 'msg:' });
      const messages = [];
      for (const entry of list.keys) {
        const text = await env.SMS_BOX.get(entry.name);
        if (text !== null) {
          messages.push({ id: entry.name, text });
          await env.SMS_BOX.delete(entry.name);
        }
      }
      return json({ ok: true, messages });
    }

    // تسجيل اشتراك إشعارات من التطبيق
    if (request.method === 'POST' && url.pathname === '/push-sub') {
      let sub;
      try { sub = await request.json(); } catch { return json({ error: 'bad-json' }, 400); }
      if (!sub || !sub.endpoint) return json({ error: 'bad-sub' }, 400);
      await env.SMS_BOX.put(await endpointKey(sub.endpoint), JSON.stringify(sub));
      return json({ ok: true });
    }

    // إلغاء اشتراك
    if (request.method === 'DELETE' && url.pathname === '/push-sub') {
      const endpoint = url.searchParams.get('endpoint') || '';
      if (endpoint) await env.SMS_BOX.delete(await endpointKey(endpoint));
      return json({ ok: true });
    }

    return json({ error: 'not-found' }, 404);
  },
};
