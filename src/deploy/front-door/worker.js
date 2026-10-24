// Cloudflare Worker on sdc.olgtx.com: the public address. Every request goes on to the main node (env.ORIGIN) unchanged,
// so users only ever see sdc.olgtx.com. Headers pass through as-is: the backend allows Origin https://sdc.olgtx.com via
// CORS_ORIGINS, exactly as when sdc pointed at the server directly. Redirects to the main node come back as sdc.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = new URL(env.ORIGIN).origin;
    const res = await fetch(origin + url.pathname + url.search, {
      method: request.method, headers: request.headers, body: request.body, redirect: "manual",
    });
    const loc = res.headers.get("location");
    if (!loc?.startsWith(origin)) return res; // streams (SSE) pass straight through
    const out = new Response(res.body, res);
    out.headers.set("location", url.origin + loc.slice(origin.length));
    return out;
  },
};
