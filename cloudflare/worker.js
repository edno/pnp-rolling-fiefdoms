// Minimal Cloudflare Durable Object for signaling only (no game state).
// Usage:
// - Bind this DO as SIGNALLING in wrangler.toml
// - Host POSTs /session/:id?role=host&secret=pass with { sdp, ice }
// - Joiner POSTs /session/:id?role=join&secret=pass with { sdp, ice }
// - Each side polls GET /session/:id?role=host|join&secret=pass to receive the counterpart blob.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response("ok", { status: 200, headers: corsHeaders });
    }
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/session/")) {
      return new Response("not found", { status: 404, headers: corsHeaders });
    }
    const id = url.pathname.replace("/session/", "");
    if (!id) return new Response("bad request", { status: 400, headers: corsHeaders });
    let objId;
    try {
      objId = env.SIGNALLING.idFromName(id);
    } catch (err) {
      return new Response("bad durable object id", { status: 400, headers: corsHeaders });
    }
    const stub = env.SIGNALLING.get(objId);
    const resp = await stub.fetch(request);
    const merged = new Headers(resp.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => merged.set(k, v));
    return new Response(resp.body, { status: resp.status, headers: merged });
  },
};

export class Signalling {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get("role"); // host | join
    const secret = url.searchParams.get("secret") || "";
    if (!role || !secret) return new Response("role/secret required", { status: 400, headers: corsHeaders });

    const stored = (await this.state.storage.get("session")) || { ts: Date.now() };
    const now = Date.now();

    if (request.method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return new Response("invalid json", { status: 400, headers: corsHeaders });
      }
      const side = stored[role];
      if (side && side.secret !== secret) return new Response("forbidden", { status: 403, headers: corsHeaders });
      stored[role] = { sdp: body.sdp || "", ice: body.ice || [], secret };
      stored.ts = now;
      await this.state.storage.put("session", stored, { expirationTtl: 3600 });
      return new Response("ok", { status: 200, headers: corsHeaders });
    }

    if (request.method === "GET") {
      const other = role === "host" ? stored.join : stored.host;
      if (!other) return new Response("pending", { status: 202, headers: corsHeaders });
      if (other.secret !== secret) return new Response("forbidden", { status: 403, headers: corsHeaders });
      const payload = { sdp: other.sdp || "", ice: other.ice || [] };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }
}
