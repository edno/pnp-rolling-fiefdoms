# Cloudflare Pages Functions

This directory contains Cloudflare Pages Functions that provide API endpoints for the application.

## Middleware

### `_middleware.js`
Global middleware that intercepts all requests to serve pre-compressed Brotli files when available and supported by the browser.

**How It Works:**
- Checks if the browser supports Brotli encoding (`Accept-Encoding: br`)
- Attempts to serve `.br` version of requested files
- Falls back to original file if `.br` doesn't exist
- Sets proper `Content-Encoding` and `Content-Type` headers
- Adds `Vary: Accept-Encoding` for proper caching

**Skipped Routes:**
- `/api/*` - API endpoints
- `/session/*` - WebRTC signalling endpoints

## Functions

### `/api/config`
Returns configuration for the application, including P2P signalling URL and feature flags.

**Environment Variables:**
- `SIGNALLING_URL`: Override signalling endpoint URL (optional)
- `P2P_ENABLED`: Enable/disable P2P features (default: true)

### `/session/:id`
WebRTC signalling endpoint for P2P connections. Stores and retrieves session data (SDP offers/answers and ICE candidates) to facilitate peer-to-peer connections.

**Supported Methods:**
- `OPTIONS`: CORS preflight
- `POST`: Store signalling data (offer/answer)
- `GET`: Retrieve counterpart's signalling data

**Query Parameters:**
- `role`: Either `host` or `join`
- `secret`: Shared secret for session authentication

**Bindings Required** (configure in Cloudflare Pages Settings → Functions):

- Binding name: `SIGNALLING`
- Type: Durable Object
- Class: `Signalling` (from cloudflare/worker.js)

## Local Testing

Pages Functions run automatically with Cloudflare's local development tools:

```bash
npm run dev
# or
npx wrangler pages dev dist
```

For testing with Durable Objects locally, you'll need to run the Worker separately and set the SIGNALLING_URL environment variable to point to it.
