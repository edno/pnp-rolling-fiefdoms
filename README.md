# Rolling Fiefdoms

This is a lightweight online version of the Rolling Fiefdoms roll-and-write game.

## Quick start

```
npm install
npm test     # eslint + vitest
npm run serve # start a static server at http://localhost:4173
npm run build # bundle + minify JS into dist/ for deployment
# tip: npm run serve -- --dist will serve the built dist/ output instead of source files
# clean: npm run clean will remove dist/ if you need a fresh build

The app now includes a service worker + manifest for install/offline use. When served over HTTPS or localhost, the core assets cache for offline play.
```

Open `index.html` directly or serve the folder with your preferred static server. The app is plain JS/DOM; no bundler required for basic usage.

### P2P signalling (optional)

- The app attempts to resolve a signalling endpoint for WebRTC offer/answer exchange via:
  1. URL parameter: `?signal=http://host:8787`
  2. Body data attribute: `data-signalling-url`
  3. Cloudflare API: `/api/config` (uses `SIGNALLING_URL` env var if set, otherwise derives from current deployment URL)
  4. Local development: if served from localhost, private LAN IP (10.x/192.168.x/172.16–31.x), or `.local`, targets `http://<host>:8787`
- If no signalling URL is available, the UI falls back to manual invite/answer exchange (QR code or link sharing).

To configure P2P in Cloudflare Pages, set these environment variables:
- `SIGNALLING_URL`: (optional) Explicit signalling server URL
- `P2P_ENABLED`: (optional) Set to `"false"` to disable P2P features (defaults to `true`)

## How to play in the helper

- Roll phase: four dice (two numbered, two X) appear in the Turn panel. Click two non-X dice to set the Location pair; X dice are auto-assigned to Build. Building/Guild overlays stay disabled until two location dice are selected.
- Build phase: pick a building from the overlay, then click a highlighted plot. Dice lock (grey) after a build/forfeit/pestilence and stay visible until the next roll; location/build previews should persist while locked.
- Pestilence: if both Xs show, skip pairing and forfeit any empty plot; dice lock during this step.
- The log shows the actions (newest first) and includes Pestilence details.

## Tests and lint

- `npm test` runs ESLint and Vitest. Add or update tests alongside any rule changes.

## Known gaps

See `AGENTS.md` Appendix for the current TODO/Known Gaps (pip fidelity, pestilence section config, turn flow alignment, etc.). Keep this list updated as you address issues.

## License

- Code: MIT (see `LICENSE`)
- Rulebook & player sheet: CC BY-NC-SA 4.0 (see `LICENSE-ASSETS` in `resources/`)
