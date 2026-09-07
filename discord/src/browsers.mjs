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

/** How much of a candidate is read to tell a shell stub from a binary. A stub is a few hundred bytes; a browser starts with ELF. */
const STUB_PEEK = 512;

/** The first bytes of a file, without reading a browser's whole binary to look at them. */
function peek(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(STUB_PEEK);
    return buf.subarray(0, fs.readSync(fd, buf, 0, STUB_PEEK, 0));
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Whether a path is Ubuntu's `chromium-browser` shell stub, or the `/snap/bin`
 * symlink, rather than a browser: both run the Chromium snap, and a snap
 * refuses to start under a system service (no user session, no
 * `XDG_RUNTIME_DIR`, confinement), so the seat's DevTools endpoint never
 * comes up. Neither is ever offered as a default nor started as the seat.
 */
export function isSnapStub(file, { read = peek, link = (f) => fs.readlinkSync(f) } = {}) {
  try {
    if (link(file).endsWith("/snap")) return true;
  } catch {
    /* not a symlink */
  }
  try {
    const head = read(file).subarray(0, STUB_PEEK).toString("latin1");
    return head.startsWith("#!") && /snap/.test(head);
  } catch {
    return false;
  }
}

/** The first browser present that is a browser, or "". */
export const findBrowser = (exists = fs.existsSync, stub = isSnapStub) => BROWSERS.find((p) => exists(p) && !stub(p)) ?? "";

/** The one sentence to say when no browser will do, wherever it is said. */
export const NO_BROWSER = "install a Chromium-family browser the service user can run — on Ubuntu, Google Chrome's .deb (the `chromium-browser` package is a snap stub and cannot run as a service) — or set BROWSER to its path";
