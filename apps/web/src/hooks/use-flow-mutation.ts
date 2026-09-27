import { useMutation } from '@tanstack/react-query';
import { useNavigate, type NavigateOptions } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useIdempotencyKey } from '@/lib/idempotency';

interface FlowMutationOptions<TBody, TResult> {
  /**
   * Sends the request. `idempotencyKey` gives the key for this payload (§7.7.6) — the same one while the
   * payload is unchanged — and is only called by a request that sends one.
   */
  request: (body: TBody, idempotencyKey: () => string) => Promise<TResult>;
  /** The success toast. */
  successMessage: (result: TResult) => string;
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
}

/**
 * The submit of a daily flow or an edit form (§7.4): the request with its idempotency key, then on
 * success the key dropped, the toast, the refresh and the navigation in the order `refresh` names.
 */
export function useFlowMutation<TBody, TResult>(options: FlowMutationOptions<TBody, TResult>) {
  const navigate = useNavigate();
  const idempotency = useIdempotencyKey();

  return useMutation({
    mutationFn: (body: TBody) => options.request(body, () => idempotency.getKey(body)),
    onSuccess: async (result) => {
      idempotency.reset();
      toast.success(options.successMessage(result));
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
