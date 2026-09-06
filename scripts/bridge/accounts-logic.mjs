/**
 * The arithmetic of a Foundry account reached from outside Foundry, with no
 * Foundry in it: what a password must be before the world is asked to take
 * it, what a new user's name must be, and the secret a new user is born with.
 *
 * A user a client creates gets a password nobody knows. The member then sets
 * their own from the client, so no secret ever passes through the Judge who
 * made the account — and until they do, nobody can join as that user.
 */

/** The floor on a password set from a chat command. Foundry has none; a one-letter password typed into Discord is a footgun. */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

/** Foundry caps nothing here; the window and the join screen both get unreadable past this. */
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
 * A secret nobody is told: the password a created user starts with. From
 * `getRandomValues`, which every context has; 32 characters of a 62-letter
 * alphabet is far past anything a join screen can be guessed against.
 */
export function randomSecret(length = 32) {
  // Bytes at or past the last whole multiple of the alphabet are skipped, so
  // every letter is equally likely rather than the first eight slightly more.
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const b of globalThis.crypto.getRandomValues(new Uint8Array(length))) {
      if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}
