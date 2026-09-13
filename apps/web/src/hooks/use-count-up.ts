import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { DURATION, EASE_OUT } from '@/lib/motion';

/**
 * A number that counts to `value` (§7.14): from 0 on first render, from the previous value after that,
 * in 300 ms. Under reduced motion it is the value at once.
 */
export function useCountUp(value: number): number {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced) {
      from.current = value;
      return;
    }
    const controls = animate(from.current, value, {
      duration: DURATION.slow,
      ease: EASE_OUT,
      onUpdate: (latest) => setShown(Math.round(latest)),
    });
    return () => {
      from.current = value;
      controls.stop();
    };
  }, [value, reduced]);

  // Reduced motion shows the value itself, never a number on its way there.
  return reduced ? value : shown;
}
