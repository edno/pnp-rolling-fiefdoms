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

## Local testing

- Run `wrangler dev --local --persist-to=.wrangler-state` inside this folder. Endpoint: `http://127.0.0.1:8787`.
- The web app auto-picks the signalling URL based on the page host:
  - If served from localhost, a private LAN IP (10.x/192.168.x/172.16–31.x), or `.local`, it targets `http://<host>:8787`.
  - Otherwise it targets `https://signal.rolling-fiefdoms.edno.io`.
  - You can override with `?signal=http://host:8787` in the page URL or set `data-signalling-url` on `<body>`.
