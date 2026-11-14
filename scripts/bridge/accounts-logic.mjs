/**
 * The Foundry-free arithmetic of an account reached from outside Foundry: what
 * a password and a new user's name must be, and the secret a new user starts
 * with. A user a client creates gets a password nobody knows; the member sets
 * their own from the client.
 */

/** The shortest password a chat command may set. */
export const PASSWORD_MIN = 8;

/** The longest password a chat command may set. */
export const PASSWORD_MAX = 128;

/** The longest a user name may be. */
export const USER_NAME_MAX = 64;

/** Why a password is refused, as a code the client words — or "" when it is fine. */
export function passwordProblem(password) {
  const s = String(password ?? "");
  if (s.length < PASSWORD_MIN) return "tooShort";
  if (s.length > PASSWORD_MAX) return "tooLong";
  return "";
}

/** Why a user name is refused, or "". Trimmed by the caller; this only measures. */
export function userNameProblem(name) {
  const s = String(name ?? "").trim();
  if (!s) return "empty";
  if (s.length > USER_NAME_MAX) return "tooLong";
  return "";
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A random alphanumeric secret from `getRandomValues`: the password a created
 * user starts with.
 */
export function randomSecret(length = 32) {
  // Bytes at or past the last whole multiple of the alphabet are skipped so
  // every letter is equally likely.
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const b of globalThis.crypto.getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}
