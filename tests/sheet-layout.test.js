/* @vitest-environment jsdom */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCrop, initSheetWindows } from "../app/sheet-layout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("parseCrop", () => {
  it("parses a valid comma-separated crop string", () => {
    expect(parseCrop("0,0,539,764")).toEqual({ x: 0, y: 0, w: 539, h: 764 });
    expect(parseCrop("539, 0, 174, 764")).toEqual({ x: 539, y: 0, w: 174, h: 764 });
  });

  it("returns null for invalid input", () => {
    expect(parseCrop(null)).toBeNull();
    expect(parseCrop(undefined)).toBeNull();
    expect(parseCrop("")).toBeNull();
    expect(parseCrop("1,2,3")).toBeNull();
    expect(parseCrop("a,b,c,d")).toBeNull();
    expect(parseCrop("0,0,0,764")).toBeNull();
    expect(parseCrop("0,0,539,0")).toBeNull();
  });
});

describe("initSheetWindows", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("sets --crop-x, --crop-y, and --s from the window's clientWidth", () => {
    document.body.innerHTML = `
      <div class="sheet-window" data-crop="539,0,174,764"></div>
    `;
    const win = document.querySelector(".sheet-window");
    Object.defineProperty(win, "clientWidth", { value: 87, configurable: true });

    let observeCb = null;
    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    const originalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = function MockResizeObserver(cb) {
      observeCb = cb;
      return { observe: observeSpy, disconnect: disconnectSpy };
    };

    const dispose = initSheetWindows(document);

    expect(win.style.getPropertyValue("--crop-x")).toBe("539");
    expect(win.style.getPropertyValue("--crop-y")).toBe("0");
    expect(win.style.getPropertyValue("--s")).toBe(String(87 / 174));
    expect(observeSpy).toHaveBeenCalledWith(win);
    expect(typeof observeCb).toBe("function");

    dispose();
    expect(disconnectSpy).toHaveBeenCalled();

    globalThis.ResizeObserver = originalRO;
  });

  it("ignores windows with missing or invalid data-crop", () => {
    document.body.innerHTML = `<div class="sheet-window"></div>`;
    const win = document.querySelector(".sheet-window");
    expect(() => initSheetWindows(document)).not.toThrow();
    expect(win.style.getPropertyValue("--s")).toBe("");
  });

  it("returns a no-op disposer when root has no sheet windows", () => {
    const dispose = initSheetWindows(document);
    expect(() => dispose()).not.toThrow();
  });
});

describe("index.html markup", () => {
  const html = readFileSync(resolve(__dirname, "../index.html"), "utf8");

  const ids = [
    "sheet",
    "board",
    "turnTrackOverlay",
    "influenceOverlay",
    "popHousingOverlay",
    "scoreOverlayReputation",
    "scoreOverlayBuildings",
    "scoreOverlayGuilds",
    "buildingsOverlay",
    "guildsOverlay",
    "fiefdomInput",
  ];

  it.each(ids)('has exactly one element with id="%s"', (id) => {
    const matches = html.match(new RegExp(`id="${id}"`, "g")) || [];
    expect(matches.length).toBe(1);
  });

  it("has exactly three .sheet-base images", () => {
    const matches = html.match(/class="sheet-base"/g) || [];
    expect(matches.length).toBe(3);
  });

  it("has exactly one element with id=\"sheetBaseImage\"", () => {
    const matches = html.match(/id="sheetBaseImage"/g) || [];
    expect(matches.length).toBe(1);
  });
});
