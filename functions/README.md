# Cloudflare Pages Functions

This directory now only contains the global `_middleware.js`, which serves pre-compressed Brotli assets when available.

## `_middleware.js`

- Skips requests under `/api/*` to avoid interfering with any future API routes.
- Checks `Accept-Encoding` for `br` support and serves `.br` assets from `dist/` if present.
- Falls back to the original file when no `.br` variant exists.
- Adds `Content-Encoding`, `Content-Type`, and `Vary: Accept-Encoding` headers appropriately.

No additional Pages Functions are shipped with the app since peer-to-peer signalling has been removed.
