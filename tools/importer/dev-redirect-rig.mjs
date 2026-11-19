/**
 * DEV-ONLY: stand in for a host that serves the module's files from another
 * origin, so a live walk can see what a worker does there.
 *
 * Two servers. The proxy forwards everything to a running Foundry, websockets
 * included, except a GET or HEAD under `/modules/acks-extras/`, which it
 * answers `307` to the second server. The second server is another origin
 * (`127.0.0.1` against the proxy's `localhost`, on its own port) with
 * cross-origin reads open, and serves this working tree under
 * `/bazaar/modules/acks-extras/rig/`. A browser joined through the proxy
 * loads the module as it would from such a host.
 *
 * Worker, wasm and engine requests print as they pass, redirected or served.
 * The recipe that walks it is `docs/importer/TESTING.md`, "A host that serves
 * the module's files from another origin".
 *
 * Usage: node tools/importer/dev-redirect-rig.mjs <foundryPort> <proxyPort> <filesPort>
 */
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const [foundryPort, proxyPort, filesPort] = process.argv.slice(2).map(Number);
if (!foundryPort || !proxyPort || !filesPort) {
  console.error("usage: node tools/importer/dev-redirect-rig.mjs <foundryPort> <proxyPort> <filesPort>");
  process.exit(2);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULE_PATH = "/modules/acks-extras/";
const FILES_PATH = "/bazaar/modules/acks-extras/rig/";
const WATCHED = /worker|wasm|tesseract/;
const TYPES = {
  ".mjs": "text/javascript", ".js": "text/javascript", ".json": "application/json", ".css": "text/css",
  ".wasm": "application/wasm", ".hbs": "text/plain", ".html": "text/html", ".png": "image/png",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf", ".gz": "application/gzip", ".txt": "text/plain",
};

http.createServer((req, res) => {
  const url = new URL(req.url, "http://files");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const file = url.pathname.startsWith(FILES_PATH) ? path.join(ROOT, decodeURIComponent(url.pathname.slice(FILES_PATH.length))) : null;
  if (!file || !file.startsWith(ROOT)) { res.writeHead(404).end(); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { console.log(`files 404 ${url.pathname}`); res.writeHead(404).end(); return; }
    if (WATCHED.test(url.pathname)) console.log(`files 200 ${url.pathname}`);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file).pipe(res);
  });
}).listen(filesPort, "127.0.0.1", () => console.log(`files: http://127.0.0.1:${filesPort}${FILES_PATH}`));

const proxy = http.createServer((req, res) => {
  if ((req.method === "GET" || req.method === "HEAD") && req.url.startsWith(MODULE_PATH)) {
    if (WATCHED.test(req.url)) console.log(`proxy 307 ${req.url}`);
    res.writeHead(307, { Location: `http://127.0.0.1:${filesPort}${FILES_PATH}${req.url.slice(MODULE_PATH.length)}`, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const upstream = http.request({ host: "localhost", port: foundryPort, method: req.method, path: req.url, headers: req.headers }, (answer) => {
    res.writeHead(answer.statusCode, answer.rawHeaders);
    answer.pipe(res);
  });
  upstream.on("error", (err) => { console.log(`proxy 502 ${req.url} ${err.message}`); res.writeHead(502).end(); });
  req.pipe(upstream);
});

// A websocket upgrade is replayed to Foundry byte for byte and the two sockets joined.
proxy.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(foundryPort, "localhost", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  const end = () => { socket.destroy(); upstream.destroy(); };
  upstream.on("error", end);
  socket.on("error", end);
});

proxy.listen(proxyPort, "localhost", () => console.log(`proxy: http://localhost:${proxyPort} -> Foundry on ${foundryPort}`));
