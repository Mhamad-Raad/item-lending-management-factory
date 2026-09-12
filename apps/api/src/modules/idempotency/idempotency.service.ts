import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { IDEMPOTENCY_KEY_PATTERN, IDEMPOTENCY_TTL_HOURS, canonicalJson } from '@pallet/shared';
import { Clock } from '../../common/clock';
import { ApiError } from '../../common/errors/api-error';
import { isUniqueViolation } from '../../common/errors/prisma-errors';
import type { IdempotencyScope, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const HOUR_MS = 60 * 60 * 1000;
const KEY_CONSTRAINT = { index: 'idempotency_keys_user_id_key_key', columns: ['user_id', 'key'] };

/** One creation request, as the key row records it. */
export interface IdempotentRequest {
  userId: number;
  key: string;
  scope: IdempotencyScope;
  requestHash: string;
}

export interface IdempotentResult<T> {
  body: T;
  /** True when this answer was stored by an earlier submission of the same request. */
  replayed: boolean;
}

/** What `run` hands the creating transaction. */
export interface IdempotentSession<T> {
  /** Writes the key row; must be the last statement of the creating transaction (§6.7 step 4). */
  store: (tx: Prisma.TransactionClient, body: T) => Promise<void>;
  /**
   * Looks the key up again, to be called right after the transaction's first lock. A submission on the
   * same key that was waiting for that lock finds the first one's answer here, instead of running its
   * checks against the stock or credit the first one just used; `run` then replays that answer.
   */
  replayIfStored: (tx: Prisma.TransactionClient) => Promise<void>;
}

/** Carries a stored answer out of a transaction that found it; `run` turns it into the replay. */
class StoredReplay<T> {
  constructor(readonly body: T) {}
}

/**
 * Order, return and payment creation happen once per key (§6.7). A retried submission — a lost
 * response, a double click, the admin's override re-submit — is answered from the stored response
 * instead of creating twice.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /** The request's key, or the error that it is missing or malformed (§6.7 step 1). */
  keyFrom(header: string | undefined): string {
    if (header === undefined || header === '') throw new ApiError('IDEMPOTENCY_KEY_REQUIRED');
    if (!IDEMPOTENCY_KEY_PATTERN.test(header)) throw new ApiError('IDEMPOTENCY_KEY_INVALID');
    return header;
  }

  /** sha256 of the method, the concrete path and the validated body as canonical JSON (§6.7 step 2). */
  requestHash(method: string, path: string, body: unknown): string {
    return createHash('sha256')
      .update(`${method} ${path}\n${canonicalJson(body)}`)
      .digest('hex');
  }

  /**
   * Runs `create` once per key. It receives `store`, which writes the key row inside its transaction,
   * so the key commits with the work or not at all: a refused attempt stores nothing, and the same
   * key can be sent again (§6.7 step 6).
   */
  async run<T>(
    request: IdempotentRequest,
    create: (session: IdempotentSession<T>) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const stored = await this.find<T>(this.prisma, request);
    if (stored !== null) return { body: stored, replayed: true };

    const session: IdempotentSession<T> = {
      store: (tx, body) => this.store(tx, request, body),
      replayIfStored: async (tx) => {
        const found = await this.find<T>(tx, request);
        if (found !== null) throw new StoredReplay(found);
      },
    };
    try {
      return { body: await create(session), replayed: false };
    } catch (error) {
      if (error instanceof StoredReplay) return { body: (error as StoredReplay<T>).body, replayed: true };
      if (!isUniqueViolation(error, KEY_CONSTRAINT)) throw error;
      // A concurrent submission with the same key committed first; answer as it did (§6.7 step 5).
      const winner = await this.find<T>(this.prisma, request);
      if (winner === null) throw error;
      return { body: winner, replayed: true };
    }
  }

  private async find<T>(client: Prisma.TransactionClient, request: IdempotentRequest): Promise<T | null> {
    const row = await client.idempotencyKey.findUnique({
      where: { userId_key: { userId: request.userId, key: request.key } },
    });
    if (!row) return null;
    if (row.expiresAt <= this.clock.now()) {
      await client.idempotencyKey.deleteMany({ where: { id: row.id } });
      return null;
    }
    if (row.requestHash !== request.requestHash) throw new ApiError('IDEMPOTENCY_KEY_REUSED');
    return row.responseBody as T;
  }

  private async store<T>(tx: Prisma.TransactionClient, request: IdempotentRequest, body: T): Promise<void> {
    // Both times from the injected clock: the row's expiry is measured from its own creation, and a
    // `created_at` from the database's clock beside an expiry from the app's would not agree.
    const now = this.clock.now();
    await tx.idempotencyKey.create({
      data: {
        userId: request.userId,
        key: request.key,
        scope: request.scope,
        requestHash: request.requestHash,
        responseStatus: 201,
        responseBody: body as Prisma.InputJsonValue,
        createdAt: now,
        expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_HOURS * HOUR_MS),
      },
    });
  }
}
