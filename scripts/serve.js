#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
const { createServer } = require("node:http");
const { readFile, stat, access } = require("node:fs/promises");
const path = require("node:path");
const zlib = require("node:zlib");

const args = new Set(process.argv.slice(2));
const useDist = args.has("--dist");
const root = path.resolve(__dirname, useDist ? "../dist" : "..");
const port = Number(process.env.PORT) || 4173;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureRootExists() {
  try {
    const stats = await stat(root);
    if (!stats.isDirectory()) throw new Error("serve root is not a directory");
  } catch (err) {
    const hint = useDist ? "Run `npm run build` or drop the flag to serve source." : "Check your project path.";
    console.error(`Cannot serve from ${root}: ${err.message || err}. ${hint}`);
    process.exit(1);
  }
}

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || "").split("?")[0]);
    
    // Mock /api/config for local development
    if (urlPath === "/api/config") {
      const host = req.headers.host || "localhost:4173";
      const hostname = host.split(":")[0];
      // If wrangler is running on default port, use it; otherwise no signalling
      const signalingUrl = `http://${hostname}:8787`;
      const config = {
        signalingUrl: signalingUrl,
        p2pEnabled: false,
      };
      res.writeHead(200, { 
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(config));
      return;
    }
    
    const safePath = urlPath === "/" ? "/index.html" : urlPath;
    const filePath = path.join(root, safePath);
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      res.writeHead(403).end("Directory listing not allowed");
      return;
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const contentType = mime[ext] || "application/octet-stream";
    
    // Check if browser supports Brotli and if .br file exists (only in dist mode)
    const acceptEncoding = req.headers["accept-encoding"] || "";
    const supportsBrotli = acceptEncoding.includes("br");
    const brotliPath = filePath + ".br";
    
    if (useDist && supportsBrotli && await fileExists(brotliPath)) {
      // Serve pre-compressed Brotli file
      const data = await readFile(brotliPath);
      res.writeHead(200, { 
        "Content-Type": contentType,
        "Content-Encoding": "br",
        "Vary": "Accept-Encoding",
      });
      res.end(data);
    } else {
      // Serve original file
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    }
  } catch (err) {
    const status = err.code === "ENOENT" ? 404 : 500;
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(status === 404 ? "Not found" : "Server error");
  }
});

ensureRootExists().then(() => {
  server.listen(port, () => {
    console.log(`Serving ${root} at http://localhost:${port}`);
  });
});
