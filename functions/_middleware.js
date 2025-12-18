// Cloudflare Pages middleware to serve pre-compressed Brotli files
// NOTE: This middleware is not needed on Cloudflare Pages (automatic compression)
// and not functional in wrangler pages dev (env.ASSETS not available).
// Keeping for backwards compatibility but effectively disabled.

export async function onRequest(context) {
  const { next } = context;
  
  // Skip middleware entirely in local dev (no env.ASSETS)
  // In production, Cloudflare handles compression automatically
  return next();
  
  /* Original code kept for reference
  const url = new URL(request.url);
  
  // Only handle GET requests for static assets
  if (request.method !== "GET") {
    return next();
  }
  
  // Skip API and function routes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/session/")) {
    return next();
  }
  
  // Check if browser supports Brotli
  const acceptEncoding = request.headers.get("accept-encoding") || "";
  const supportsBrotli = acceptEncoding.includes("br");
  
  if (!supportsBrotli) {
    return next();
  }
  
  // Try to fetch the .br version
  const brotliUrl = new URL(request.url);
  brotliUrl.pathname = url.pathname + ".br";
  
  try {
    // env.ASSETS is only available in production, not in wrangler pages dev
    if (!env.ASSETS) {
      return next();
    }
    
    const brotliResponse = await env.ASSETS.fetch(brotliUrl);
    
    if (brotliResponse.ok) {
      // Found pre-compressed version, serve it with proper headers
      const headers = new Headers(brotliResponse.headers);
      headers.set("Content-Encoding", "br");
      headers.set("Vary", "Accept-Encoding");
      
      // Set proper Content-Type based on original file extension
      const ext = url.pathname.split(".").pop()?.toLowerCase();
      const mimeTypes = {
        js: "text/javascript; charset=utf-8",
        css: "text/css; charset=utf-8",
        html: "text/html; charset=utf-8",
        svg: "image/svg+xml",
        json: "application/json; charset=utf-8",
        xml: "application/xml; charset=utf-8",
        txt: "text/plain; charset=utf-8",
        webmanifest: "application/manifest+json; charset=utf-8",
      };
      
      if (ext && mimeTypes[ext]) {
        headers.set("Content-Type", mimeTypes[ext]);
      }
      
      return new Response(brotliResponse.body, {
        status: brotliResponse.status,
        headers: headers,
      });
    }
  } catch (err) {
    // .br file doesn't exist, fall through to serve original
  }
  
  // Serve original file
  return next();
  */
}
