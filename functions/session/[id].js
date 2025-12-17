// Cloudflare Pages Function for P2P signalling
// This handles /session/:id endpoints for WebRTC signalling

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders,
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const sessionId = params.id;
  
  if (!sessionId) {
    return new Response("bad request", { status: 400, headers: corsHeaders });
  }

  // Use Durable Object
  if (!env.SIGNALLING) {
    return new Response("signalling not configured", { status: 503, headers: corsHeaders });
  }

  try {
    const objId = env.SIGNALLING.idFromName(sessionId);
    const stub = env.SIGNALLING.get(objId);
    const resp = await stub.fetch(request);
    const merged = new Headers(resp.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => merged.set(k, v));
    return new Response(resp.body, { status: resp.status, headers: merged });
  } catch (err) {
    console.error("Durable Object error:", err);
    return new Response("internal error", { status: 500, headers: corsHeaders });
  }
}
