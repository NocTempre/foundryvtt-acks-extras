/**
 * The stamp a bridge write carries, Foundry-free.
 *
 * Which client, which identity there, which channel and message asked for the
 * write. It rides under `flags["acks-extras"].bridge` on the document (and on
 * every chat message a command's roll posts, stamped by the event tap), so a
 * write made from outside Foundry can still be told apart from one made at
 * the table long after the seat is gone — the same reasoning as the
 * importer's provenance contract.
 */
import { MODULE_ID, BRIDGE_FLAG } from "./constants.mjs";

/** The stamp for a client identity, or null without one. */
export function stampFor(client, extra = {}) {
  if (!client || typeof client !== "object") return null;
  return {
    via: client.kind ?? null,
    user: client.user ?? null,
    guild: client.guild ?? null,
    channel: client.channel ?? null,
    message: client.message ?? null,
    at: Date.now(),
    ...extra,
  };
}

/** The `flags` fragment for a create call, or `{}` without a client. */
export function flagsFor(client, extra = {}) {
  const stamp = stampFor(client, extra);
  return stamp ? { [MODULE_ID]: { [BRIDGE_FLAG]: stamp } } : {};
}

/** The stamp a document carries, or null — reads a live document or raw data alike. */
export const provenanceOf = (doc) => doc?.getFlag?.(MODULE_ID, BRIDGE_FLAG) ?? doc?.flags?.[MODULE_ID]?.[BRIDGE_FLAG] ?? null;
