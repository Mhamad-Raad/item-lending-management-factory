// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';

const toast = vi.hoisted(() => ({ loading: vi.fn(), dismiss: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { clearPrintJob, currentJob, finishPrintJob, printRequest, returnPaper, usePrintPreparing } =
  await import('./print-receipt');

/** The notice of the press that made `job`: its own, so one never merges into the last one's closing. */
const noticeOf = (job: { seq: number } | null) => `receipt-preparing-${job?.seq ?? 0}`;

describe('a print press (Q140, Q180)', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  beforeEach(() => {
    clearPrintJob();
    toast.loading.mockClear();
    toast.dismiss.mockClear();
  });
  afterEach(cleanup);

  it('says at once that it was taken, and closes the notice when the receipt prints', () => {
    printRequest({ kind: 'order', orderId: 9 });
    const job = currentJob();
    expect(job).toMatchObject({ kind: 'order', orderId: 9 });
    expect(toast.loading).toHaveBeenCalledWith('Preparing the receipt…', { id: noticeOf(job) });

    finishPrintJob(job?.seq ?? 0);
    expect(toast.dismiss).toHaveBeenCalledWith(noticeOf(job));
  });

  it('pressed again keeps the one notice, which only the last press closes; the next print has a new one', () => {
    printRequest({ kind: 'order', orderId: 9 });
    const first = currentJob();
    printRequest({ kind: 'money', entryId: 11 });
    const second = currentJob();
    expect(second).toMatchObject({ kind: 'money', entryId: 11 });
    // Updated in place, not closed and opened again: no flicker while presses come.
    expect(toast.loading).toHaveBeenLastCalledWith('Preparing the receipt…', { id: noticeOf(first) });
    expect(toast.dismiss).not.toHaveBeenCalled();

    finishPrintJob(first?.seq ?? 0);
    expect(toast.dismiss).not.toHaveBeenCalled();
    finishPrintJob(second?.seq ?? 0);
    expect(toast.dismiss).toHaveBeenCalledWith(noticeOf(first));

    // A print after: its own notice, never one merging into the last one's closing.
    printRequest({ kind: 'order', orderId: 9 });
    expect(toast.loading).toHaveBeenLastCalledWith('Preparing the receipt…', { id: noticeOf(currentJob()) });
    expect(noticeOf(currentJob())).not.toBe(noticeOf(first));
  });

  it("names a return's paper: its refund's money receipt when it paid cash back, else its own (Q166)", () => {
    expect(returnPaper(4, 17)).toEqual({ kind: 'money', entryId: 17 });
    expect(returnPaper(4, null)).toEqual({ kind: 'return', returnId: 4 });
  });

  it('closes the notice when the app is left, even before the receipt was drawn', () => {
    printRequest({ kind: 'order', orderId: 9 });
    const job = currentJob();
    clearPrintJob();
    expect(toast.dismiss).toHaveBeenCalledWith(noticeOf(job));
    expect(currentJob()).toBeNull();
  });

  it('spins the buttons of the receipt being prepared alone, until it prints or the app is left', () => {
    const order = renderHook(() => usePrintPreparing({ kind: 'order', orderId: 9 }));
    const other = renderHook(() => usePrintPreparing({ kind: 'order', orderId: 10 }));
    const money = renderHook(() => usePrintPreparing({ kind: 'money', entryId: 9 }));
    expect(order.result.current).toBe(false);

    act(() => printRequest({ kind: 'order', orderId: 9 }));
    expect([order.result.current, other.result.current, money.result.current]).toEqual([true, false, false]);
    act(() => finishPrintJob(currentJob()?.seq ?? 0));
    expect(order.result.current).toBe(false);

    act(() => printRequest({ kind: 'order', orderId: 9 }));
    // Another press replaces it: the spinner moves to that one's buttons.
    act(() => printRequest({ kind: 'money', entryId: 9 }));
    expect([order.result.current, money.result.current]).toEqual([false, true]);
    act(() => clearPrintJob());
    expect(money.result.current).toBe(false);
  });
});
