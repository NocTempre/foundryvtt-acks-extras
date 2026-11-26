/* global console */
/**
 * Republish a derived document from the library when a library document changes.
 *
 * A feature that publishes a registry document from the imported library
 * (the weapon rows, the class tables) hears every create, update and delete of
 * the documents it reads, and a long import fires them by the hundred. This
 * coalesces those hooks into reads of the library (`libraryDocsWhere`) and
 * hands each answer to the feature to publish:
 *
 * - a burst of hooks is one read, which starts `debounceMs` after the last hook
 *   of the burst and never later than `maxWaitMs` after its first, so a steady
 *   stream cannot hold the read back for as long as it lasts;
 * - a hook that lands while a read is in flight is read again afterwards;
 * - the read starts behind `after()` (the feature's first publication), so a
 *   change heard before the first publication cannot publish ahead of it;
 * - a deleted document's id is left out of the next read, since a delete's hook
 *   can fire while its collection still lists the document;
 * - an answer that names a shelf it could not read (`libraryDocsWhere`'s
 *   `failed`) is not published, since it would publish short: the rows stand as
 *   last published, and the deleted ids heard meanwhile stay left out of the
 *   next read.
 *
 * An action that must act on the rows a change publishes awaits `whenCurrent`.
 */
import { MODULE_ID } from "./constants.mjs";

/**
 * Build a republisher.
 *
 * @param {object} options
 * @param {(except: Set<string>) => Promise<object[]>} options.read the library read, `libraryDocsWhere` with its test
 * @param {(docs: object[]) => void} options.apply publish one answer of `read`
 * @param {() => Promise<unknown>|undefined} [options.after] resolves once the feature's first publication has landed
 * @param {number} options.debounceMs how long the hooks of a burst settle before the read
 * @param {number} options.maxWaitMs the longest a burst holds the read back
 * @param {string} options.label what is republished, for the console
 * @returns {{queue: (id: string, deleted: boolean) => void, whenCurrent: () => Promise<void>|undefined}}
 *   `queue` records a hook; `whenCurrent` is undefined when no change is
 *   waiting to be read, else a promise that resolves once a read that began
 *   after the change has been applied (or has failed)
 */
export function createRepublisher({ read, apply, after = () => undefined, debounceMs, maxWaitMs, label }) {
  let timer = null;
  let burstStart = null;
  let reading = null;
  let dirty = false;
  let started = 0;
  let applied = 0;
  const gone = new Set();
  let waiters = [];

  const release = (all = false) => {
    const due = waiters.filter((w) => all || w.target <= applied);
    waiters = waiters.filter((w) => !due.includes(w));
    for (const { resolve } of due) resolve();
  };

  async function run() {
    await after();
    while (dirty) {
      dirty = false;
      const except = new Set(gone);
      gone.clear();
      started++;
      try {
        const docs = await read(except);
        if (docs?.failed?.length) {
          console.warn(`${MODULE_ID} | the ${label} were kept as published: ${docs.failed.join(", ")} could not be read.`);
          for (const id of except) gone.add(id);
        } else apply(docs);
      } catch (err) {
        console.error(`${MODULE_ID} | the ${label} could not be republished`, err);
        for (const id of except) gone.add(id);
      }
      applied++;
      release();
    }
  }

  const fire = () => {
    timer = null;
    burstStart = null;
    reading ??= run().finally(() => {
      reading = null;
      release(true);
    });
  };

  return {
    queue(id, deleted) {
      if (deleted) gone.add(id);
      else gone.delete(id);
      dirty = true;
      const now = Date.now();
      burstStart ??= now;
      clearTimeout(timer);
      timer = setTimeout(fire, Math.max(0, Math.min(debounceMs, burstStart + maxWaitMs - now)));
    },
    whenCurrent() {
      // A change not yet read waits for the next read to start; one a read in flight already took waits for that read.
      const target = dirty ? started + 1 : reading ? started : null;
      if (target === null || applied >= target) return undefined;
      return new Promise((resolve) => waiters.push({ target, resolve }));
    },
  };
}
