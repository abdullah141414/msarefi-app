/*
 * صندوق بريد رسائل البنك — Cloudflare Worker
 *
 * الأتمتة في الآيفون ترسل نص رسالة البنك إلى POST /in
 * والتطبيق يسحب الرسائل المعلقة من GET /pull ثم تُحذف.
 *
 * يحتاج:
 *   - ربط KV باسم SMS_BOX
 *   - متغير سري باسم RELAY_KEY (المفتاح السري)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export default {
  async fetch(request, env) {
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

    return json({ error: 'not-found' }, 404);
  },
};
