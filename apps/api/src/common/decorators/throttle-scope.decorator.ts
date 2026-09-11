import { SetMetadata } from '@nestjs/common';

export const THROTTLE_SCOPE_METADATA = 'pallet:throttle';

/** The named throttlers of §6.8.8 beyond `global`. */
export type ThrottleScopeName = 'login' | 'refresh' | 'upload';

/** Opts a route into a named throttler; `global` applies everywhere it is not skipped. */
export const ThrottleScope = (scope: ThrottleScopeName): MethodDecorator => SetMetadata(THROTTLE_SCOPE_METADATA, scope);
