#!/usr/bin/env node
const path = require("node:path");
const { createHash } = require("node:crypto");
const { mkdir, rm, cp, readFile, writeFile, readdir, stat } = require("node:fs/promises");
const { build } = require("esbuild");
const { minify: minifyHtml } = require("html-minifier-terser");
const brotli = require("brotli");
const sharp = require("sharp");
const { optimize } = require("svgo");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");
const staticEntries = ["index.html", "assets", "resources", "robots.txt", "sitemap.xml", "llms.txt", "manifest.webmanifest"];
// Every board-art variant, as a filename suffix ("" = the plain English board). Keep in sync with
// sw.js's SHEET_VARIANT_SUFFIXES and each challenge's sheetVariant in app/challenges.js.
const PLAYER_SHEET_SUFFIXES = [
  "",
  "-fr",
  "-challenge-vii",
  "-fr-challenge-vii",
  "-challenge-viii",
  "-fr-challenge-viii",
];
const PLAYER_SHEET_VARIANTS = PLAYER_SHEET_SUFFIXES.flatMap((suffix) => [
  {
    relative: path.join("resources", `rolling-fiefdoms-player-sheet${suffix}.webp`),
    target: { width: 1086, height: 768 },
  },
  {
    relative: path.join("resources", `rolling-fiefdoms-player-sheet${suffix}@2x.webp`),
    target: { width: 2172, height: 1536 },
  },
]);

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
    throw new Error(`Unable to copy ${entry}: ${reason}`, { cause: err });
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

async function optimizeSVG(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".svg") return;
  
  try {
    const svgContent = await readFile(filePath, "utf8");
    const originalSize = Buffer.byteLength(svgContent);
    
    const result = optimize(svgContent, {
      path: filePath,
      multipass: true,
      plugins: [
        {
          name: "preset-default",
          params: {
            overrides: {
              removeViewBox: false, // Keep viewBox for scaling
              cleanupIds: false, // Keep IDs if they're used
            },
          },
        },
      ],
    });
    
    const optimizedSize = Buffer.byteLength(result.data);
    
    if (optimizedSize < originalSize) {
      await writeFile(filePath, result.data, "utf8");
      const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1);
      console.log(`  ✓ ${path.relative(outDir, filePath)} → ${(optimizedSize / 1024).toFixed(1)}KB (${savings}% smaller)`);
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

async function downscalePlayerSheetVariant(relativePath, target) {
  const sheetPath = path.join(outDir, relativePath);
  try {
    const sheetStat = await stat(sheetPath);
    if (!sheetStat.isFile()) return;
  } catch (err) {
    if (err?.code !== "ENOENT") console.warn(`  ⚠ Player sheet missing (${relativePath}): ${err.message}`);
    return;
  }

  try {
    const image = sharp(sheetPath);
    const metadata = await image.metadata();
    if (metadata.width <= target.width && metadata.height <= target.height) {
      return; // already appropriately sized
    }
    const tempPath = `${sheetPath}.tmp`;
    let transformer = image.resize(target.width, target.height, { fit: "inside" });
    const format = path.extname(sheetPath).toLowerCase();
    if (format === ".webp") {
      transformer = transformer.webp({
        quality: 85,
        effort: 6,
        smartSubsample: true,
      });
    } else if (format === ".png") {
      transformer = transformer.png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      });
    }
    await transformer.toFile(tempPath);
    await rm(sheetPath);
    await cp(tempPath, sheetPath);
    await rm(tempPath);
    console.log(
      `  ✓ Downscaled ${path.relative(outDir, sheetPath)} to ${target.width}x${target.height}`,
    );
  } catch (err) {
    console.warn(`  ⚠ Failed to downscale player sheet (${relativePath}): ${err.message}`);
  }
}

async function downscalePlayerSheet() {
  for (const variant of PLAYER_SHEET_VARIANTS) {
    await downscalePlayerSheetVariant(variant.relative, variant.target);
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

async function minifyHtmlFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await minifyHtmlFiles(fullPath);
    } else if (entry.isFile() && path.extname(fullPath).toLowerCase() === ".html") {
      const original = await readFile(fullPath, "utf8");
      const minified = await minifyHtml(original, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeOptionalTags: false,
        minifyCSS: true,
        minifyJS: true,
        keepClosingSlash: true,
      });
      if (minified.length < original.length) {
        await writeFile(fullPath, minified, "utf8");
      }
    }
  }
}

async function minifyCssFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await minifyCssFiles(fullPath);
    } else if (entry.isFile() && path.extname(fullPath).toLowerCase() === ".css") {
      const original = await readFile(fullPath, "utf8");
      const minified = original
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s*([{}:;>,])\s*/g, "$1")
        .replace(/;}/g, "}");
      if (minified.length < original.length) {
        await writeFile(fullPath, minified.trim(), "utf8");
      }
    }
  }
}

// Computes a Subresource Integrity hash for each same-origin module script
// from the final (minified) dist output and injects it into index.html, so
// the hash can never drift from what's actually shipped and a tampered
// CDN/cache copy of app.js will fail to execute.
async function patchSecurityHashes(dirPath) {
  const indexPath = path.join(dirPath, "index.html");
  let html = await readFile(indexPath, "utf8");

  html = await replaceAsync(html, /<script type="module" src="(app\/[^"]+\.js)(\?[^"]*)?">/g, async (match, src) => {
    const scriptPath = path.join(dirPath, src);
    try {
      const content = await readFile(scriptPath);
      const hash = createHash("sha384").update(content).digest("base64");
      return match.replace('">', `" integrity="sha384-${hash}">`);
    } catch (err) {
      if (err?.code === "ENOENT") {
        console.warn(`⚠ Could not compute SRI hash, script not found: ${src}`);
        return match;
      }
      throw err;
    }
  });

  await writeFile(indexPath, html, "utf8");
  console.log("✓ Injected SRI integrity attributes for module scripts");
}

async function replaceAsync(str, regex, asyncFn) {
  const matches = [...str.matchAll(regex)];
  const replacements = await Promise.all(matches.map((m) => asyncFn(...m)));
  let result = str;
  matches.forEach((m, i) => {
    result = result.replace(m[0], replacements[i]);
  });
  return result;
}

async function optimizeSVGsInDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await optimizeSVGsInDirectory(fullPath);
    } else if (entry.isFile()) {
      await optimizeSVG(fullPath);
    }
  }
}

async function run() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const result = await build({
    entryPoints: [path.join(root, "app/app.js"), path.join(root, "app/inline-init.js")],
    bundle: true,
    format: "esm",
    minify: true,
    sourcemap: enableSourcemaps,
    target: "es2020",
    outdir: path.join(outDir, "app"),
    entryNames: "[name]",
    chunkNames: "[name]-[hash]",
    splitting: true,
    logLevel: "info",
    metafile: true,
  });

  if (enableSourcemaps) {
    console.log("\n⚠️  Source maps enabled (adds ~438KB to bundle)");
  }

  // Write metafile for bundle analysis
  await writeFile(path.join(outDir, "meta.json"), JSON.stringify(result.metafile));

  // Extract lazy chunk names from metafile
  const lazyChunks = Object.keys(result.metafile.outputs)
    .filter(file => file.includes("/app/") && !file.endsWith("app.js") && file.endsWith(".js"))
    .map(file => `/${path.relative(outDir, file)}`);
  
  console.log(`\nFound ${lazyChunks.length} lazy chunk(s):`, lazyChunks.join(", "));

  // Read sw.js, inject chunk names, write to temp location
  const swSource = await readFile(path.join(root, "sw.js"), "utf8");
  const chunkLines = lazyChunks.map(chunk => `  "${chunk}",`).join("\n");
  const swWithChunks = swSource.replace(
    "/* LAZY_CHUNKS_PLACEHOLDER */",
    chunkLines
  );
  const swTempPath = path.join(outDir, "sw-temp.js");
  await writeFile(swTempPath, swWithChunks);

  await build({
    entryPoints: [swTempPath],
    minify: true,
    sourcemap: false,
    target: "es2020",
    format: "iife",
    outfile: path.join(outDir, "sw.js"),
    logLevel: "info",
  });

  // Clean up temp file
  await rm(swTempPath);

  for (const entry of staticEntries) {
    await copyStatic(entry);
  }

  // Stamp sitemap.xml with the build date so <lastmod> reflects the actual deploy
  const sitemapPath = path.join(outDir, "sitemap.xml");
  const sitemapContent = await readFile(sitemapPath, "utf8");
  const buildDate = new Date().toISOString().slice(0, 10);
  await writeFile(sitemapPath, sitemapContent.replace("__BUILD_DATE__", buildDate));

  // Remove source-only assets that are not meant for deployment (e.g., oversized masters)
  const sourceOnlyAssets = [path.join("resources", "rolling-fiefdoms-player-sheet.png")];
  for (const asset of sourceOnlyAssets) {
    const assetPath = path.join(outDir, asset);
    try {
      await rm(assetPath, { force: true });
    } catch (err) {
      if (err?.code !== "ENOENT") {
        console.warn(`⚠ Could not remove source-only asset ${asset}: ${err.message}`);
      }
    }
  }

  console.log("\nMinifying HTML files...");
  await minifyHtmlFiles(outDir);

  console.log("\nDownscaling player sheet image...");
  await downscalePlayerSheet();

  console.log("\nMinifying CSS files...");
  await minifyCssFiles(outDir);

  // Copy _headers if it exists
  const headersPath = path.join(root, "public/_headers");
  try {
    await cp(headersPath, path.join(outDir, "_headers"));
    console.log("✓ Copied _headers for Cloudflare optimization");
  } catch (err) {
    if (err?.code !== "ENOENT") {
      console.warn("⚠ Could not copy _headers:", err.message);
    }
  }

  console.log("\nPatching SRI/CSP security hashes...");
  await patchSecurityHashes(outDir);

  console.log("\nCleaning up unnecessary files...");
  await cleanupUnnecessaryFiles(outDir);

  console.log("\nOptimizing SVG images...");
  await optimizeSVGsInDirectory(outDir);

  console.log("\nOptimizing WebP images...");
  await optimizeImagesInDirectory(outDir);

  // Note: Brotli compression is opt-in for local development
  // Cloudflare Pages automatically compresses assets in production
  // Use --brotli flag to generate .br files for local dev server testing
  const enableBrotli = process.argv.includes("--brotli");
  
  if (enableBrotli) {
    console.log("\nCompressing assets with Brotli (for local dev)...");
    await compressDirectory(outDir);
  } else {
    console.log("\nSkipping Brotli compression (production mode)");
  }

  console.log(`\nBuild complete. Output in ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
