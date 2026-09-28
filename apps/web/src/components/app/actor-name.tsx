import type { UserRefDto } from '@pallet/shared';

/**
 * Who did something (Q121): the display name, then the `@username`. Anyone may rename themselves, so a
 * display name alone could borrow a colleague's; the username is unique and only an admin sets it. Both
 * parts are isolated — a Latin username keeps its order inside a right-to-left sentence.
 */
export function ActorName({ user }: { user: Pick<UserRefDto, 'displayName' | 'username'> }) {
  return (
    <span>
      <bdi>{user.displayName}</bdi>{' '}
      <bdi dir="ltr" className="text-muted-foreground">
        @{user.username}
      </bdi>
    </span>
  );
}
