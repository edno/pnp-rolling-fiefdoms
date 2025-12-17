# Cloudflare Durable Object Signaling

This folder contains a minimal Durable Object you can deploy to Cloudflare to automate WebRTC signaling (offer/answer/ICE). It stores short‐lived blobs only; no game state is relayed.

## Deploy

1) Copy `wrangler.toml.example` to `wrangler.toml` and adjust the `name` and `account_id`/`route` as needed.  
2) Run `wrangler publish`. On free plans, the included migration uses `new_sqlite_classes` as required by Cloudflare (error code 10097 if missing).

The DO binding must be named `SIGNALLING` to match `worker.js`.

## API (signaling only)

- `POST /session/:id?role=host|join&secret=pass`  
  Body: `{ sdp, ice: [] }` (offer or answer). Saves that side’s blob (secret must match if already set).
- `GET /session/:id?role=host|join&secret=pass`  
  Returns the counterpart blob `{ sdp, ice }` when present; `202 pending` if not yet posted.

Sessions auto-expire after ~1 hour (configurable via `expirationTtl` in `worker.js`).

## Configuration

Configure P2P functionality using environment variables in your Cloudflare Pages settings:

### Environment Variables

- **`SIGNALLING_URL`** (optional): Explicit signalling endpoint URL. If not set, derives from the current deployment URL (protocol + host). Use this if your signalling server is on a different domain than your Pages deployment.
  - Example: `https://rolling-fiefdoms-signalling.example.workers.dev`
  
- **`P2P_ENABLED`** (optional): Controls whether P2P features are enabled by default. Defaults to `true`. Set to `"false"` to disable.
  - Example: `P2P_ENABLED=false`

These are exposed to the client via the `/api/config` endpoint implemented as a Cloudflare Pages Function.

### Durable Object Bindings

Bind the SIGNALLING Durable Object to your Pages project:

1. Deploy the Worker from this directory: `wrangler publish`
2. In your Cloudflare dashboard, go to Pages → Your Project → Settings → Functions
3. Add a Durable Object binding:
   - Variable name: `SIGNALLING`
   - Durable Object namespace: Select your deployed `Signalling` class

## Local testing

- Run `wrangler dev --local --persist-to=.wrangler-state` inside this folder. Endpoint: `http://127.0.0.1:8787`.
- The web app resolution order for signalling URL:
  1. URL parameter: `?signal=http://host:8787`
  2. Body data attribute: `data-signalling-url`
  3. API fetch from `/api/config` (uses `SIGNALLING_URL` env var)
  4. Local development detection: if localhost/private LAN IP/`.local`, targets `http://<host>:8787`
  5. Falls back to `null` (manual exchange only)
