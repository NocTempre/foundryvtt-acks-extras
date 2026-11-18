/**
 * A field that writes on `change` loses the click that blurred it. Pressing a
 * button blurs the field, the field's write re-renders the window, and the
 * button under the pointer is replaced before the release, so no `click`
 * fires and the press does nothing.
 *
 * `writeOnChange` binds the window root once: a change made while one of the
 * root's controls is pressed is held until the press ends anywhere in the
 * document, and written on the next task, after the browser has dispatched
 * the click to the button that is still in place. A change with no press
 * under way (a Tab away, Enter) is written at once. The write is handed the
 * field that changed; a detached field still reads its value.
 *
 * Nodes are told by `closest`, never by `instanceof`. Foundry-free.
 * @param {EventTarget & {ownerDocument?: EventTarget}} root the window element
 * @param {(field: object) => void} write the change's write
 * @param {string} [controls] the selector a pressed control matches
 */
export function writeOnChange(root, write, controls = "button, [data-action]") {
  let held = null;
  let press = null;
  const release = () => {
    press?.abort();
    press = null;
    const field = held;
    held = null;
    if (field) setTimeout(() => write(field), 0);
  };
  root.addEventListener("pointerdown", (event) => {
    if (!event.target?.closest?.(controls)) return;
    press?.abort();
    press = new AbortController();
    const doc = root.ownerDocument ?? root;
    for (const type of ["pointerup", "pointercancel"]) {
      doc.addEventListener(type, release, { capture: true, signal: press.signal });
    }
  }, true);
  root.addEventListener("change", (event) => {
    if (press) held = event.target;
    else write(event.target);
  });
}
