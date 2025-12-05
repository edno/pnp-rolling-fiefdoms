#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console */
const path = require("node:path");
const { mkdir, rm, cp } = require("node:fs/promises");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist");
const staticEntries = ["index.html", "assets", "resources", "robots.txt", "manifest.webmanifest"];

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

  console.log(`Build complete. Output in ${outDir}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
