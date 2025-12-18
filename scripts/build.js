#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
const path = require("node:path");
const { mkdir, rm, cp, readFile, writeFile, readdir, stat } = require("node:fs/promises");
const { build } = require("esbuild");
const brotli = require("brotli");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");
const staticEntries = ["index.html", "assets", "resources", "robots.txt", "manifest.webmanifest"];

// File extensions to compress with Brotli
const compressibleExtensions = [".js", ".css", ".html", ".svg", ".json", ".txt", ".webmanifest", ".xml", ".map"];

async function copyStatic(entry) {
  const src = path.join(root, entry);
  const dest = path.join(outDir, entry);
  try {
    await cp(src, dest, { recursive: true, force: true });
  } catch (err) {
    const reason = err?.code === "ENOENT" ? "missing source" : err.message || err;
    throw new Error(`Unable to copy ${entry}: ${reason}`);
  }
}

async function compressFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!compressibleExtensions.includes(ext)) return;
  
  const fileStats = await stat(filePath);
  // Skip files smaller than 1KB - compression overhead not worth it
  if (fileStats.size < 1024) return;
  
  try {
    const content = await readFile(filePath);
    const compressed = brotli.compress(content, {
      mode: 0, // generic mode
      quality: 11, // max compression (0-11)
      lgwin: 22, // window size
    });
    
    if (compressed && compressed.length < content.length) {
      await writeFile(`${filePath}.br`, Buffer.from(compressed));
      const savings = ((1 - compressed.length / content.length) * 100).toFixed(1);
      console.log(`  ✓ ${path.relative(outDir, filePath)} → ${(compressed.length / 1024).toFixed(1)}KB (${savings}% smaller)`);
    }
  } catch (err) {
    console.warn(`  ⚠ Failed to compress ${path.relative(outDir, filePath)}: ${err.message}`);
  }
}

async function compressDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await compressDirectory(fullPath);
    } else if (entry.isFile()) {
      await compressFile(fullPath);
    }
  }
}

async function run() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(root, "app/app.js")],
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: true,
    target: "es2020",
    outdir: path.join(outDir, "app"),
    entryNames: "[name]",
    logLevel: "info",
  });

  await build({
    entryPoints: [path.join(root, "sw.js")],
    minify: true,
    sourcemap: false,
    target: "es2020",
    format: "iife",
    outfile: path.join(outDir, "sw.js"),
    logLevel: "info",
  });

  for (const entry of staticEntries) {
    await copyStatic(entry);
  }

  console.log("\nCompressing assets with Brotli...");
  await compressDirectory(outDir);

  console.log(`\nBuild complete. Output in ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
