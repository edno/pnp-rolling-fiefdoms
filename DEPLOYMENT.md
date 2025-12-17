# Cloudflare Pages Deployment Guide

## Quick Start

1. **Deploy to Cloudflare Pages**
   - Connect your GitHub repository
   - Build command: `npm run build`
   - Build output directory: `dist`

## P2P Configuration

To enable P2P multiplayer functionality, you need to configure signalling:

### Durable Object Binding

**Step 1: Deploy the Signalling Worker**
```bash
cd cloudflare
cp wrangler.toml.example wrangler.toml
# Edit wrangler.toml with your account_id
wrangler publish
```

**Step 2: Bind to Pages**
1. Go to Cloudflare Dashboard → Pages → Your Project → Settings → Functions
2. Add Durable Object Binding:
   - Variable name: `SIGNALLING`
   - Durable Object: `Signalling`
3. Redeploy your Pages project

### External Signalling Server (Alternative)

If your signalling server is deployed separately:

1. Deploy the Worker from `cloudflare/` directory to a separate domain
2. In Pages Settings → Environment variables, add:
   - `SIGNALLING_URL`: Your worker URL (e.g., `https://your-worker.workers.dev`)

## Environment Variables

Set these in Pages Settings → Environment variables:

- **`SIGNALLING_URL`** (optional): Override signalling endpoint
- **`P2P_ENABLED`** (optional): Set to `"false"` to disable P2P features

## Verifying the Setup

After deployment, check:
1. Visit `https://your-site.pages.dev/api/config` - should return configuration
2. Test P2P by creating an invite - should not see 405 errors in console
3. If issues persist, check Functions logs in Cloudflare dashboard

## Troubleshooting

### 405 Method Not Allowed on `/session/:id`
- **Cause**: Signalling endpoint not configured
- **Fix**: Follow one of the configuration options above

### 503 Service Unavailable
- **Cause**: SIGNALLING Durable Object binding is not configured
- **Fix**: Add the SIGNALLING binding in Pages Settings → Functions

### Connection fails but no errors
- **Cause**: Signalling works but peer connection blocked
- **Fix**: Check browser console for WebRTC errors, verify both peers have network connectivity
