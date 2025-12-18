#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
const path = require("node:path");
const { mkdir, rm, cp, readFile, writeFile, readdir, stat } = require("node:fs/promises");
const { build } = require("esbuild");
const brotli = require("brotli");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");
const staticEntries = ["index.html", "assets", "resources", "robots.txt", "manifest.webmanifest"];

// Parse CLI flags
const enableSourcemaps = process.argv.includes("--sourcemap");

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

async function optimizeWebP(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".webp") return;
  
  const fileStats = await stat(filePath);
  // Skip very small images - not worth optimizing
  if (fileStats.size < 10240) return; // 10KB threshold
  
  try {
    const originalSize = fileStats.size;
    const image = sharp(filePath);
    const metadata = await image.metadata();
    
    // Optimize with quality 80, smart subsample, and effort 6 (good balance)
    await image
      .webp({
        quality: 80,
        effort: 6, // 0-6, higher is slower but better compression
        smartSubsample: true,
      })
      .toFile(filePath + ".tmp");
    
    const optimizedStats = await stat(filePath + ".tmp");
    const optimizedSize = optimizedStats.size;
    
    if (optimizedSize < originalSize) {
      // Replace original with optimized version
      await rm(filePath);
      await cp(filePath + ".tmp", filePath);
      await rm(filePath + ".tmp");
      
      const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
      console.log(`  ✓ ${path.relative(outDir, filePath)} → ${(optimizedSize / 1024 / 1024).toFixed(2)}MB (${savings}% smaller, ${metadata.width}x${metadata.height})`);
    } else {
      // Keep original if it's already optimal
      await rm(filePath + ".tmp");
    }
  } catch (err) {
    console.warn(`  ⚠ Failed to optimize ${path.relative(outDir, filePath)}: ${err.message}`);
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

async function optimizeImagesInDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await optimizeImagesInDirectory(fullPath);
    } else if (entry.isFile()) {
      await optimizeWebP(fullPath);
    }
  }
}

async function cleanupUnnecessaryFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await cleanupUnnecessaryFiles(fullPath);
    } else if (entry.isFile()) {
      // Remove text files from font directories
      if (fullPath.includes("/fonts/") && path.extname(fullPath).toLowerCase() === ".txt") {
        await rm(fullPath);
        console.log(`  ✓ Removed ${path.relative(outDir, fullPath)}`);
      }
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
    sourcemap: enableSourcemaps,
    target: "es2020",
    outdir: path.join(outDir, "app"),
    entryNames: "[name]",
    logLevel: "info",
  });

  if (enableSourcemaps) {
    console.log("\n⚠️  Source maps enabled (adds ~438KB to bundle)");
  }

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

  console.log("\nCleaning up unnecessary files...");
  await cleanupUnnecessaryFiles(outDir);

  console.log("\nOptimizing WebP images...");
  await optimizeImagesInDirectory(outDir);

  console.log("\nCompressing assets with Brotli...");
  await compressDirectory(outDir);

  console.log(`\nBuild complete. Output in ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
