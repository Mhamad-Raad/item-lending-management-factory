import { useMutation } from '@tanstack/react-query';
import { useNavigate, type NavigateOptions } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useIdempotencyKey } from '@/lib/idempotency';

const SUCCESS_ACTION_MS = 15_000;

/** How a success is told: a toast, perhaps with a button, or a dialog of what was saved. */
type SuccessNotice<TBody, TResult> =
  | {
      /** The success toast. */
      successMessage: (result: TResult) => string;
      /** A button on the success toast, for what may be wanted straight after (a receipt, Q137); null for none. */
      successAction?: (result: TResult) => { label: string; onClick: () => void } | null;
      showSaved?: never;
    }
  | {
      /**
       * Instead of the toast: a dialog of what was saved (the payment's, Q139). The flow waits for it to be closed
       * before it refreshes and leaves, so the form stays as it was beneath it. The form settles it when it is
       * left with the dialog open (Back): the flow then refreshes and stays where the user went.
       */
      showSaved: (result: TResult, body: TBody) => Promise<void>;
      successMessage?: never;
      successAction?: never;
    };

type FlowMutationOptions<TBody, TResult> = SuccessNotice<TBody, TResult> & {
  /**
   * Sends the request. `idempotencyKey` gives the key for this payload (§7.7.6) — the same one while the
   * payload is unchanged — and is only called by a request that sends one.
   */
  request: (body: TBody, idempotencyKey: () => string) => Promise<TResult>;
  /** What the change made stale. */
  invalidate: (result: TResult) => Promise<void>;
  /** Where the flow lands. */
  destination: (result: TResult) => NavigateOptions;
  /**
   * When the stale queries are refreshed. `'before-navigate'` waits for them before leaving, so the page
   * it lands on shows the new figures at once; `'after-navigate'` leaves first and refreshes behind it,
   * so the form being left never flashes a state the change produced ("nothing owed", "nothing out").
   */
  refresh: 'before-navigate' | 'after-navigate';
  /** Just before leaving: an unsaved-changes guard lets this navigation through. */
  beforeLeave?: () => void;
  /** Every failure; flow-specific codes first, then `handleApiError`. */
  onError: (error: unknown, body: TBody) => void | Promise<void>;
};

/**
 * The submit of a daily flow or an edit form (§7.4): the request with its idempotency key, then on
 * success the key dropped, the toast (or the saved dialog, closed), the refresh and the navigation in the
 * order `refresh` names. The mutation stays pending until it has left, so the form cannot be sent twice.
 */
export function useFlowMutation<TBody, TResult>(options: FlowMutationOptions<TBody, TResult>) {
  const navigate = useNavigate();
  const idempotency = useIdempotencyKey();
  const left = useRef(false);
  useEffect(() => {
    left.current = false;
    return () => {
      left.current = true;
    };
  }, []);

  return useMutation({
    mutationFn: (body: TBody) => options.request(body, () => idempotency.getKey(body)),
    onSuccess: async (result, body) => {
      idempotency.reset();
      if (options.showSaved) {
        await options.showSaved(result, body);
        if (left.current) {
          await options.invalidate(result);
          return;
        }
      } else {
        const action = options.successAction?.(result) ?? null;
        if (action) {
          // The app's own button (its size and focus ring, §7.15), not Sonner's; long enough to be read and pressed.
          const id = toast.success(options.successMessage(result), {
            duration: SUCCESS_ACTION_MS,
            action: (
              <Button
                size="sm"
                onClick={() => {
                  action.onClick();
                  toast.dismiss(id);
                }}
              >
                {action.label}
              </Button>
            ),
          });
        } else {
          toast.success(options.successMessage(result));
        }
      }
      if (options.refresh === 'before-navigate') {
        await options.invalidate(result);
        options.beforeLeave?.();
        await navigate(options.destination(result));
      } else {
        options.beforeLeave?.();
        await navigate(options.destination(result));
        void options.invalidate(result);
      }
    },
    onError: (error, body) => options.onError(error, body),
  });
}
