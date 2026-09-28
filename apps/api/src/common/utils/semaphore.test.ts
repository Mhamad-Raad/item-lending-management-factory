import { afterEach, describe, expect, it, vi } from 'vitest';
import { Semaphore, SemaphoreBusyError } from './semaphore';

/** A piece of work that finishes when the test says so. */
function deferred(): { promise: Promise<void>; finish: () => void } {
  let finish = (): void => undefined;
  const promise = new Promise<void>((resolve) => (finish = resolve));
  return { promise, finish };
}

describe('Semaphore', () => {
  afterEach(() => vi.useRealTimers());

  it('runs at most `permits` at once and hands each freed slot to the longest waiter', async () => {
    const semaphore = new Semaphore({ permits: 2, maxQueue: 10, maxWaitMs: 10_000 });
    const works = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = works.map((work, index) =>
      semaphore.run(async () => {
        started.push(index);
        await work.promise;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    works[1]?.finish();
    await runs[1];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    works[0]?.finish();
    works[2]?.finish();
    works[3]?.finish();
    await Promise.all(runs);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  it('refuses at once when the queue is full, and frees the slot when work throws', async () => {
    const semaphore = new Semaphore({ permits: 1, maxQueue: 1, maxWaitMs: 10_000 });
    const first = deferred();
    const running = semaphore.run(() => first.promise);
    const queued = semaphore.run(() => Promise.reject(new Error('boom')));

    await expect(semaphore.run(() => Promise.resolve())).rejects.toEqual(new SemaphoreBusyError('queue-full'));
    first.finish();
    await running;
    await expect(queued).rejects.toThrow('boom');
    await expect(semaphore.run(() => Promise.resolve('free'))).resolves.toBe('free');
  });

  it('refuses a waiter whose wait runs out, and forgets it', async () => {
    vi.useFakeTimers();
    const semaphore = new Semaphore({ permits: 1, maxQueue: 5, maxWaitMs: 2_000 });
    const first = deferred();
    const running = semaphore.run(() => first.promise);
    const waiting = semaphore.run(() => Promise.resolve('late'));
    const refused = expect(waiting).rejects.toEqual(new SemaphoreBusyError('timeout'));

    await vi.advanceTimersByTimeAsync(2_001);
    await refused;
    first.finish();
    await running;
    await expect(semaphore.run(() => Promise.resolve('next'))).resolves.toBe('next');
  });
});
