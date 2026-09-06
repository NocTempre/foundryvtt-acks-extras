/**
 * Finding the Chromium-family binary the seat runs in. One list, read by the
 * installer when it asks and by the configuration when nothing was set: the
 * common case on a Foundry host is that a browser is already installed and
 * nobody should have to say where.
 */
import fs from "node:fs";

/** Where a Chromium-family browser sits on the platforms this bot runs on, likeliest first. */
export const BROWSERS = Object.freeze(
  process.platform === "win32"
    ? [
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
      ]
    : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
);

/** The first browser present, or "". */
export const findBrowser = (exists = fs.existsSync) => BROWSERS.find((p) => exists(p)) ?? "";
