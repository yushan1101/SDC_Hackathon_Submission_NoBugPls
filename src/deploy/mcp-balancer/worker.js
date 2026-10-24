// Cloudflare Worker: one stable MCP_URL for the main node, spread across the Replit worker nodes (src/worker.py).
// Tries the workers in random order and moves on when one is down, asleep or erroring. It holds no secret: the
// main node's "Authorization: Bearer <NODE_TOKEN>" is passed through, and each worker checks it.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/healthz") return new Response("ok");
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    if (!request.headers.has("authorization")) return new Response("unauthorized", { status: 401 });

    const workers = env.WORKERS.split(",").map((w) => w.trim()).filter(Boolean)
      .sort(() => Math.random() - 0.5); // ponytail: shuffle, no health tracking; fine for a handful of workers
    const body = request.method === "GET" ? null : await request.arrayBuffer(); // buffered so it can be resent
    let last = new Response("no worker nodes configured", { status: 503 });
    for (const w of workers) {
      try {
        const res = await fetch(w, { method: request.method, headers: request.headers, body,
                                     signal: AbortSignal.timeout(Number(env.TIMEOUT_MS)) });
        if (res.status < 500) return res; // 4xx (bad token, bad request) is the caller's problem, not the worker's
        last = res;
      } catch (e) {
        last = new Response(`worker unreachable: ${e.name}`, { status: 502 });
      }
    }
    return last; // every worker failed: the main node then runs the tool itself
  },
};
