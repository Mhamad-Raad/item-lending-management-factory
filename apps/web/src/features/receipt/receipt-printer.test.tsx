// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printRequest } from './print-receipt';
import { ReceiptPrinter } from './receipt-printer';

// The print itself (read, frame, print) is the e2e's; here, only which job the printer is drawing.
vi.mock('./print-job', () => ({
  PrintJob: ({ job }: { job: { kind: string; entryId?: number } }) => <p>printing {job.entryId}</p>,
}));

afterEach(cleanup);

describe('ReceiptPrinter (Q140)', () => {
  it('draws the print asked for, and a layout mounted after a sign-out never prints it again', async () => {
    const first = render(<ReceiptPrinter />);
    act(() => printRequest({ kind: 'money', entryId: 5 }));
    expect(await screen.findByText('printing 5')).toBeTruthy();

    // The app's layout leaves (a sign-out), then the next session's mounts at the same screen.
    first.unmount();
    render(<ReceiptPrinter />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByText(/printing/)).toBeNull();
  });
});
