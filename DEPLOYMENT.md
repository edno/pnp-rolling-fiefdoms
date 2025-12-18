# Cloudflare Pages Deployment Guide

## Quick Start

1. **Deploy to Cloudflare Pages**
   - Connect your GitHub repository
   - Build command: `npm run build`
   - Build output directory: `dist`

## Performance Optimization

### Image Optimization

The build process automatically optimizes WebP images using Sharp with quality 80 and smart subsampling.

**Optimization Results:**
- Player sheet (5.4MB → 1.1MB): **80% size reduction**
- Small UI images (<10KB): Skipped (not worth reprocessing)
- Visual quality: Maintained at high quality (80) for crisp display

### Brotli Compression

The build process automatically pre-compresses all text-based assets (JS, CSS, HTML, SVG, etc.) with Brotli compression at quality level 11.

   - Optimizes all WebP images >10KB with Sharp (quality 80)
   - Creates `.br` files alongside text asset
**Compression Results:**
- JavaScript files: ~70-75% size reduction (e.g., 122KB → 32KB)
- CSS files: ~80-85% size reduction  
- HTML files: ~75-80% size reduction
- SVG images: ~55-75% size reduction

**How It Works:**

1. **Build Time**: `npm run build` creates `.br` files alongside originals in `dist/`
2. **Cloudflare Pages**: Automatically serves `.br` files via middleware in `functions/_middleware.js`
3. **Local Dev**: The dev server (`npm run serve --dist`) also serves `.br` files when the browser supports Brotli
4. **Browser Support**: All modern browsers support Brotli (Chrome, Firefox, Safari, Edge)

**Benefits:**
- **Faster initial page loads** - 3-4x smaller file transfers
- **Reduced bandwidth costs** - especially important for mobile users
- **Better cache efficiency** - smaller files in service worker cache
- **No runtime overhead** - compression happens once at build time

No additional configuration is needed - the middleware handles content negotiation automatically.

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
