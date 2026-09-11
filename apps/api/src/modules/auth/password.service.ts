import { randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import argon2 from 'argon2';
import { ARGON2_OPTIONS } from './password.constants';

/**
 * Argon2id hashing, plus the dummy hash that makes every login attempt cost the same (§10.1 S4):
 * an unknown username, an inactive user and a locked pair all verify against it, so response time
 * never reveals whether an account exists.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    this.dummyHash = await argon2.hash(randomBytes(32).toString('hex'), ARGON2_OPTIONS);
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  verify(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  /** Burns exactly one verification against a hash nobody knows. */
  async verifyDummy(password: string): Promise<void> {
    await argon2.verify(this.dummyHash, password).catch(() => false);
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
