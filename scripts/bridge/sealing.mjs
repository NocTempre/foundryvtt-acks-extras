/**
 * Sealing a secret to the client that must read it.
 *
 * Every world setting is vended whole to every connected client, so a bot
 * token typed into a Foundry window is a token every player can read out of
 * their own console. The client therefore holds a key pair on the machine it
 * runs on and publishes only the public half; the window encrypts to that
 * half and stores the ciphertext. What reaches a player is unreadable, and
 * the private half never enters the world.
 *
 * RSA-OAEP with SHA-256, interoperable with WebCrypto in both directions —
 * but the SEALING half is written out by hand here (SHA-256, MGF1, and a
 * modular exponentiation over BigInt) because `crypto.subtle` exists only in
 * a secure context and a Foundry server on a LAN is usually plain http. A
 * window that could not seal on the most ordinary install would be a window
 * that pushes the token back to the terminal. `getRandomValues` carries no
 * such condition and is what the padding's seed comes from.
 *
 * The opening half is WebCrypto: it runs where the private key is, which is
 * a Node process, where the API is always there.
 */

/** The one algorithm both halves use. A 2048-bit OAEP/SHA-256 key carries up to 190 bytes — a bot token is under 100. */
export const SEAL = Object.freeze({ name: "RSA-OAEP", hash: "SHA-256", modulusLength: 2048, hLen: 32 });

const subtle = () => {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error("sealing: this context has no WebCrypto (a secure context is needed to hold a private key)");
  return c;
};

/* ------------------------------------------------------------------ bytes */

const toBase64 = (bytes) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromBase64 = (text) => Uint8Array.from(atob(String(text ?? "")), (c) => c.charCodeAt(0));

/** A JWK's base64url field as bytes. */
const fromBase64Url = (text) => fromBase64(String(text ?? "").replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (String(text ?? "").length % 4)) % 4));

const bytesToBigInt = (bytes) => {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
};

/** A BigInt as exactly `length` bytes, big-endian (I2OSP). */
const bigIntToBytes = (value, length) => {
  const out = new Uint8Array(length);
  let v = value;
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error("sealing: value does not fit the modulus");
  return out;
};

/* ----------------------------------------------------------------- sha-256 */

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 of a byte array, by hand — the one hash OAEP needs, where WebCrypto may not exist. */
export function sha256(input) {
  const bytes = Uint8Array.from(input);
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const tail = new DataView(padded.buffer);
  tail.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  tail.setUint32(padded.length - 4, bitLength >>> 0);

  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const view = new DataView(padded.buffer);
  for (let block = 0; block < padded.length; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const next = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + next[i]) >>> 0;
  }
  const out = new Uint8Array(32);
  const view32 = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) view32.setUint32(i * 4, h[i]);
  return out;
}

/* -------------------------------------------------------------------- oaep */

/** RFC 8017 MGF1 over SHA-256. */
function mgf1(seed, length) {
  const out = new Uint8Array(length);
  const counter = new Uint8Array(4);
  for (let i = 0, at = 0; at < length; i++, at += SEAL.hLen) {
    new DataView(counter.buffer).setUint32(0, i);
    const block = sha256(Uint8Array.from([...seed, ...counter]));
    out.set(block.subarray(0, Math.min(SEAL.hLen, length - at)), at);
  }
  return out;
}

/** EME-OAEP encoding with an empty label, as WebCrypto's RSA-OAEP produces it. */
function padOaep(message, k) {
  const hLen = SEAL.hLen;
  if (message.length > k - 2 * hLen - 2) throw new Error(`sealing: ${message.length} bytes is more than this key carries`);
  const lHash = sha256(new Uint8Array(0));
  const db = new Uint8Array(k - hLen - 1);
  db.set(lHash, 0);
  db[db.length - message.length - 1] = 0x01;
  db.set(message, db.length - message.length);
  const seed = globalThis.crypto.getRandomValues(new Uint8Array(hLen));

  const dbMask = mgf1(seed, db.length);
  const maskedDb = db.map((b, i) => b ^ dbMask[i]);
  const seedMask = mgf1(maskedDb, hLen);
  const maskedSeed = seed.map((b, i) => b ^ seedMask[i]);

  const em = new Uint8Array(k);
  em.set(maskedSeed, 1);
  em.set(maskedDb, 1 + hLen);
  return em;
}

/** Modular exponentiation, square and multiply. The public exponent is 65537, so this is 17 squarings. */
function modPow(base, exponent, modulus) {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/* --------------------------------------------------------------- the pair */

/** A fresh key pair as `{publicKey, privateKey}` JWKs — the client's, generated where the client runs. */
export async function generateSealingPair() {
  const c = subtle();
  const pair = await c.generateKey({ name: SEAL.name, hash: SEAL.hash, modulusLength: SEAL.modulusLength, publicExponent: new Uint8Array([1, 0, 1] /* 65537 */) }, true, ["encrypt", "decrypt"]);
  return { publicKey: await c.exportKey("jwk", pair.publicKey), privateKey: await c.exportKey("jwk", pair.privateKey) };
}

/**
 * Seal a secret to a public JWK. Base64 ciphertext, openable by WebCrypto's
 * RSA-OAEP/SHA-256 with the matching private key. Runs anywhere — no secure
 * context needed.
 */
export function seal(publicJwk, secret) {
  const n = bytesToBigInt(fromBase64Url(publicJwk?.n));
  const e = bytesToBigInt(fromBase64Url(publicJwk?.e));
  if (!n || !e) throw new Error("sealing: that is not an RSA public key");
  const k = fromBase64Url(publicJwk.n).length;
  const em = padOaep(new TextEncoder().encode(String(secret ?? "")), k);
  return toBase64(bigIntToBytes(modPow(bytesToBigInt(em), e, n), k));
}

/** Open a sealed secret with the private JWK. Throws when the key is not the one it was sealed to. */
export async function unseal(privateJwk, sealed) {
  const key = await subtle().importKey("jwk", privateJwk, { name: SEAL.name, hash: SEAL.hash }, false, ["decrypt"]);
  const clear = await subtle().decrypt({ name: SEAL.name }, key, fromBase64(sealed));
  return new TextDecoder().decode(clear);
}

/**
 * A stable short name for a key, so a window can tell the operator which key
 * a stored secret was sealed to and a client can tell that a secret is not
 * sealed to its own. The modulus's tail is public and identifies the key.
 */
export const keyIdOf = (jwk) => String(jwk?.n ?? "").slice(-16);

/** What a window may show of a secret it can no longer read: its length and last four characters. */
export const hintOf = (secret) => {
  const s = String(secret ?? "");
  return s.length > 8 ? `${s.length} characters, ending ${s.slice(-4)}` : `${s.length} characters`;
};
