import { SetMetadata } from '@nestjs/common';

export const THROTTLE_SCOPE_METADATA = 'pallet:throttle';

/**
 * The per-address throttlers of §6.8.8 beyond `global`. The `upload` limit counts per user, which
 * only a route guard can see, so it is `UploadThrottleGuard` rather than a scope here.
 */
export type ThrottleScopeName = 'login' | 'refresh';

/** Opts a route into a named throttler; `global` applies everywhere it is not skipped. */
export const ThrottleScope = (scope: ThrottleScopeName): MethodDecorator => SetMetadata(THROTTLE_SCOPE_METADATA, scope);
