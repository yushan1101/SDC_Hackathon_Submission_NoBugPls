// Cloudflare Worker on sdc.olgtx.com: the public address. Every request goes on to the main node (env.ORIGIN) unchanged,
// so users only ever see sdc.olgtx.com. Headers pass through as-is: the backend allows Origin https://sdc.olgtx.com via
// CORS_ORIGINS, exactly as when sdc pointed at the server directly. Redirects to the main node come back as sdc.
// Maintenance: MAINTENANCE="1" answers 503 with a short page, except for a browser that opened ?bypass=<BYPASS> once
// (it gets a 1-hour cookie), so the site can be checked before it reopens.
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>AiversePulse: back in a few minutes</title>
<style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;
background:#f6f7fb;color:#1f2430}main{max-width:28rem;text-align:center}@media(prefers-color-scheme:dark){body{background:#14161c;color:#e7e9ef}}</style>
<main><h1>Back in a few minutes</h1><p>AiversePulse is moving to a new database. Your account and plans are safe;
please try again shortly.</p></main>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.MAINTENANCE === "1") {
      const pass = env.BYPASS && `ap_bypass=${env.BYPASS}`;
      if (pass && url.searchParams.get("bypass") === env.BYPASS) {
        return new Response(null, { status: 302, headers: { location: "/",
          "set-cookie": `${pass}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=3600` } });
      }
      if (!pass || !(request.headers.get("cookie") || "").split(/;\s*/).includes(pass)) {
        return new Response(PAGE, { status: 503, headers: { "content-type": "text/html; charset=utf-8",
          "retry-after": "600", "cache-control": "no-store" } });
      }
    }
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
