export async function onRequest(context) {
  const { request, env } = context;

  const url = new URL(request.url);
  // Allow explicit SIGNALLING_URL override, otherwise derive from current host
  const signalingUrl = env.SIGNALLING_URL || `${url.protocol}//${url.host}`;

  const config = {
    signalingUrl,
    p2pEnabled: env.P2P_ENABLED === "true",
  };

  return new Response(JSON.stringify(config), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
