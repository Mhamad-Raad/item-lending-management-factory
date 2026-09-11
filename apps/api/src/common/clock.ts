import { Injectable } from '@nestjs/common';

/**
 * The only source of "now" in the API. Injected rather than called directly so that
 * time-dependent behaviour (lockout windows, token lifetimes, business dates) is
 * deterministic in tests.
 */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

/** Test double: time stands still until `set` or `advance` moves it. */
export class FixedClock extends Clock {
  private current: Date;

  constructor(value: Date) {
    super();
    this.current = new Date(value);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(value: Date): void {
    this.current = new Date(value);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}
