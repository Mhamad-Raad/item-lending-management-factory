import { useState } from 'react';

/**
 * A dialog a page used to mount only while open — so each opening starts from fresh defaults — kept mounted
 * through its exit animation instead (§7.14). `value` stays the last thing opened while the dialog fades out,
 * and `key` changes on every opening, so the dialog still starts fresh each time.
 */
export function useDialogState<T>(current: T | null): { value: T | null; open: boolean; key: number } {
  const open = current !== null;
  const [state, setState] = useState({ value: current, key: 0, open });
  if (open !== state.open || (open && current !== state.value)) {
    setState({ value: open ? current : state.value, key: open && !state.open ? state.key + 1 : state.key, open });
  }
  return { value: open ? current : state.value, open, key: state.key };
}
