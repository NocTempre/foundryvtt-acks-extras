/**
 * Whether a place carries notes someone wrote: the shared record or the
 * Judge's own holding any text once its markup is set aside. An editor that
 * was opened and saved empty leaves an empty paragraph, which is no note.
 * Pure, so the world-start prune's test of it runs without Foundry.
 *
 * @param {{notes?: string, gmNotes?: string}} [system] a location's system data
 * @returns {boolean}
 */
export function hasWrittenNotes(system) {
  const text = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/g, " ");
  return /\S/.test(text(system?.notes)) || /\S/.test(text(system?.gmNotes));
}
