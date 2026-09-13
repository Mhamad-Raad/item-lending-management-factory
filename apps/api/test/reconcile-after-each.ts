import { afterEach } from 'vitest';
import { expectReconciled } from './helpers/reconciliation';

// §4.9 asks for a clean reconciliation at the end of every integration file; checking after every
// test is stricter and names the test that broke it. Files that write around the services on
// purpose opt out with skipReconciliation.
afterEach(expectReconciled);
