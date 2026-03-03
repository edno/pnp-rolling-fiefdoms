# Cloudflare Pages Deployment Guide

## Quick Start

1. **Deploy to Cloudflare Pages**
   - Connect your GitHub repository
   - Build command: `npm run build`
   - Build output directory: `dist`
   - **Note**: Brotli pre-compression is disabled by default. Cloudflare handles compression automatically.

## Performance Optimization

### Image Optimization

The build process automatically optimizes WebP images using Sharp with quality 80 and smart subsampling.

**Optimization Results:**
- Player sheet (5.4MB → 1.1MB): **80% size reduction**
- Small UI images (<10KB): Skipped (not worth reprocessing)
- Visual quality: Maintained at high quality (80) for crisp display

### Brotli Compression
**For Production (Cloudflare Pages):**
- Cloudflare automatically compresses responses with Brotli/Gzip
- Use `npm run build -- --skip-brotli` to avoid uploading `.br` files
- Cloudflare's edge network handles compression dynamically

**For Local Development:**
- The build process can pre-compress assets with Brotli (quality 11)
- Run `npm run build -- --brotli` to generate `.br` files
- The dev server (`npm run serve --dist`) serves `.br` files when supported

**Compression Results (typical):**
- JavaScript files: ~70-75% size reduction (e.g., 122KB → 32KB)
- CSS files: ~80-85% size reduction  
- HTML files: ~75-80% size reduction
- SVG images: ~55-75% size reduction

**Benefits:**
- **Faster initial page loads** - 3-4x smaller file transfers
- **Reduced bandwidth costs** - especially important for mobile users
- **Better cache efficiency** - smaller files in service worker cache

**Note**: The `functions/_middleware.js` file is kept for compatibility but is not needed on Cloudflare Pages since the platform handles compression natively.

### Cloudflare Optimizations

The project includes a `public/_headers` file that configures:

**Caching Strategy:**
- Static assets (JS/CSS/fonts/images): 1 year cache with `immutable`
- Service worker: No cache (allows instant updates)
- HTML: No cache (always fresh)

**Security Headers:**
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection` - Browser XSS protection
- `Referrer-Policy` - Controls referrer information
- `Permissions-Policy` - Restricts browser features

**Additional Cloudflare Dashboard Settings (recommended):**
1. **Speed** → **Optimization**:
   - Auto Minify: Enable HTML, CSS, JavaScript
   - Brotli compression: Enabled by default
   - Early Hints: Enable for faster resource loading
   - HTTP/3 (with QUIC): Enable for better performance

2. **Caching** → **Configuration**:
   - Browser Cache TTL: Respect Existing Headers (default)
   - Always Online: Enable (serves cached version if origin is down)

3. **Network**:
   - WebSockets: Enable (needed for P2P signalling)
   - HTTP/2: Enabled by default
