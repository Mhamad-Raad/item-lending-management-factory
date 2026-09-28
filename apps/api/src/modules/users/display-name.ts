import { ApiError } from '../../common/errors/api-error';
import type { Prisma } from '../../generated/prisma/client';
import { lockDisplayNames } from '../../prisma/locks';

/**
 * Refuses a display name another active user already has (Q121), compared as a reader would see them: case,
 * Unicode compatibility forms (NFKC), runs of spaces and the zero-width non-joiner do not make two names
 * different. Both sides go through the same SQL, so the comparison cannot drift between JavaScript and
 * PostgreSQL. Takes the display-name lock first: call it inside the write's transaction, after its row locks.
 */
export async function assertDisplayNameFree(
  tx: Prisma.TransactionClient,
  displayName: string,
  exceptUserId: number | null,
): Promise<void> {
  await lockDisplayNames(tx);
  const clashes = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM users
     WHERE is_active
       AND id <> ${exceptUserId ?? 0}
       AND lower(regexp_replace(replace(normalize(display_name, NFKC), U&'\\200C', ''), '\\s+', ' ', 'g'))
         = lower(regexp_replace(replace(normalize(${displayName}, NFKC), U&'\\200C', ''), '\\s+', ' ', 'g'))
     LIMIT 1`;
  if (clashes.length > 0) throw new ApiError('DISPLAY_NAME_TAKEN');
}
