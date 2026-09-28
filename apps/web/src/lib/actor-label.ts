import type { UserRefDto } from '@pallet/shared';
import { isolate } from './bidi';

/**
 * `ActorName` as plain text, for a translated sentence's `{{name}}` (Q121): the display name, then the
 * `@username` nobody else can take, each isolated so a Latin username keeps its order in a right-to-left line.
 */
export function actorLabel(user: Pick<UserRefDto, 'displayName' | 'username'>): string {
  return `${isolate(user.displayName)} ${isolate(`@${user.username}`)}`;
}
