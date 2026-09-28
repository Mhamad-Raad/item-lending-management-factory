/** Why `Semaphore.run` did not run the work: its queue was full, or the wait for a slot ran out. */
export class SemaphoreBusyError extends Error {
  constructor(readonly reason: 'queue-full' | 'timeout') {
    super(`semaphore busy: ${reason}`);
    this.name = 'SemaphoreBusyError';
  }
}

export interface SemaphoreOptions {
  /** How many `run` calls may be inside their work at once. */
  permits: number;
  /** How many may wait for a slot; one more is refused at once. */
  maxQueue: number;
  /** How long one may wait before it is refused. */
  maxWaitMs: number;
}

/**
 * A counting semaphore for one process: at most `permits` pieces of work at a time, a bounded queue in arrival
 * order, and a bounded wait. Waiting holds nothing but a closure — callers take their database connection
 * inside the work, never before it.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly options: SemaphoreOptions) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.options.permits) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.queue.length >= this.options.maxQueue) return Promise.reject(new SemaphoreBusyError('queue-full'));

    return new Promise((resolve, reject) => {
      const grant = (): void => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(grant);
        if (index !== -1) this.queue.splice(index, 1);
        reject(new SemaphoreBusyError('timeout'));
      }, this.options.maxWaitMs);
      this.queue.push(grant);
    });
  }

  /** Hands the slot straight to the longest waiter, or frees it. */
  private release(): void {
    const next = this.queue.shift();
    if (next) next();
    else this.active -= 1;
  }
}
