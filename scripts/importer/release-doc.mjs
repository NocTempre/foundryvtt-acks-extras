/**
 * Releasing a pdf.js document. The document proxy has no `destroy`; its
 * loading task does, and ends the worker's copy of the file. So a release is
 * made through the task, and a stand-in with a `destroy` of its own (a
 * `BookHandle`, a test document) is released through that. Every importer site
 * that lets go of a document calls this, never `doc.destroy?.()`, which is a
 * silent no-op on a real proxy.
 *
 * @param {object|null|undefined} doc a pdf.js document, a handle, or nothing
 * @returns {Promise<void>} settles when the release has; a missing document is a no-op
 */
export async function releaseDoc(doc) {
  if (doc?.loadingTask?.destroy) await doc.loadingTask.destroy();
  else await doc?.destroy?.();
}
