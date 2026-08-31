/**
 * Sequential command queue: guarantees strictly one-at-a-time processing of
 * mutating commands for one auction, in arrival order. Errors in one command
 * never break the chain.
 */
export class CommandQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    // keep the chain alive even if fn rejects
    this.tail = next.catch(() => undefined);
    return next;
  }
}
