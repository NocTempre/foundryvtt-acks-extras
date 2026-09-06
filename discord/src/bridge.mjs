/**
 * The bridge client: `run(name, args)` evaluated in the seat's page, one call
 * at a time.
 *
 * Serialised on purpose. Two commands for the same character racing inside
 * one client are a write race Foundry does not arbitrate; one queue is the
 * cheapest way to never find out. The queue is short — a bridge call is
 * tens of milliseconds, a roll a second or two — so waiting is invisible.
 *
 * A bridge answer is always `{ok, data}` or `{ok:false, code, message}`;
 * this client turns the second into a `BridgeRefusal` so command handlers
 * write the happy path only.
 */
import { SeatDown } from "./seat.mjs";

export class BridgeRefusal extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

export class Bridge {
  #seat;
  #tail = Promise.resolve();

  constructor(seat) {
    this.#seat = seat;
  }

  /** Run one bridge command. Throws `BridgeRefusal` on `{ok:false}`, `SeatDown` between lives. */
  run(name, args = {}, { timeout = 30000 } = {}) {
    const expression = `(async () => JSON.stringify(await globalThis.acksExtras.bridge.run(${JSON.stringify(name)}, ${JSON.stringify(args)})))()`;
    const job = this.#tail.then(async () => {
      const raw = await this.#seat.eval(expression, { timeout });
      const answer = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!answer || typeof answer !== "object") throw new Error(`bridge "${name}" answered nothing`);
      if (!answer.ok) throw new BridgeRefusal(answer.code ?? "failed", answer.message ?? "");
      return answer.data;
    });
    // The queue survives a failure: the next job waits on this one settling, not succeeding.
    this.#tail = job.catch(() => {});
    return job;
  }

  static isSeatDown = (err) => !!err?.seatDown || err instanceof SeatDown;
}
