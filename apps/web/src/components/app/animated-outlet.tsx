import { Outlet, useRouterState } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { DURATION, EASE_OUT, dirX } from '@/lib/motion';
import { isRtl, usePreferences } from '@/lib/preferences';

/**
 * The page inside the shell (§7.14): a new page fades in while sliding 8 px toward the reading start. It
 * only enters — there is no exit, so the new page is never held back by the old one. Keyed by the deepest
 * route, so a change of search params or record on the same page does not replay it.
 */
export function AnimatedOutlet() {
  const routeId = useRouterState({ select: (state) => state.matches.at(-1)?.routeId });
  const dir = isRtl(usePreferences().language) ? 'rtl' : 'ltr';
  return (
    <motion.div
      key={routeId}
      data-slot="page-transition"
      data-route-id={routeId}
      // The page's sections are this wrapper's children, so the space between them lives here. Margins, not a flex
      // column: a flex item's width and stacking would change how every page's own layout behaves.
      className="[&>*+*]:mt-6"
      initial={{ opacity: 0, x: dirX(dir, 8) }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
    >
      <Outlet />
    </motion.div>
  );
}
