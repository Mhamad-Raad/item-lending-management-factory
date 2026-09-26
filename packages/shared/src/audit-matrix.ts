import { AUDIT_ENTITY_TYPES, type AuditAction, type AuditEntityType } from './enums.js';
import type { PermissionKey } from './permissions.js';

/**
 * The action × entity matrix of §11.3, which is exhaustive: every audit row the API writes is one of
 * these pairs, and each pair has the summary `audit.summary.<ENTITY>.<ACTION>` in every language.
 */
export const AUDIT_MATRIX: Readonly<Record<AuditEntityType, readonly AuditAction[]>> = {
  USER: [
    'CREATE',
    'UPDATE',
    'USER_DEACTIVATE',
    'USER_ACTIVATE',
    'PERMISSION_CHANGE',
    'PASSWORD_RESET',
    'PASSWORD_CHANGE',
    'LOGOUT_ALL',
    'LOGIN_FAILURE',
    'LOCKOUT',
  ],
  SESSION: ['LOGIN_SUCCESS', 'LOGOUT', 'SESSION_REUSE_DETECTED'],
  SETTINGS: ['SETTINGS_CHANGE'],
  UPLOAD: ['UPLOAD_CREATE'],
  ITEM: ['CREATE', 'UPDATE', 'DELETE', 'STOCK_ADJUST'],
  PURCHASE_BATCH: ['CREATE', 'UPDATE', 'DELETE'],
  CUSTOMER: ['CREATE', 'UPDATE', 'DELETE'],
  DRIVER: ['CREATE', 'UPDATE', 'DELETE'],
  ORDER: ['CREATE', 'UPDATE', 'CANCEL', 'CREDIT_OVERRIDE'],
  RETURN: ['RETURN_CREATE', 'RETURN_EDIT', 'RETURN_DELETE'],
  LEDGER_ENTRY: ['PAYMENT_CREATE', 'PAYMENT_REVERSE', 'REFUND_CREATE', 'REFUND_REVERSE'],
};

/** `audit.summary.<ENTITY>.<ACTION>` of every pair in the matrix. */
export const AUDIT_SUMMARY_KEYS: readonly string[] = Object.entries(AUDIT_MATRIX).flatMap(([entity, actions]) =>
  actions.map((action) => `audit.summary.${entity}.${action}`),
);

export function isAuditPair(entityType: AuditEntityType, action: AuditAction): boolean {
  return AUDIT_MATRIX[entityType].includes(action);
}

/**
 * What a history reader must also be allowed to see for each kind of row (Q73): `audit.view` shows the
 * history of what the reader may otherwise read, never more. `null` = any reader (settings and uploads
 * are shown to every signed-in user). Users and sessions (sign-ins) are the admin's (`users.manage`).
 */
export const AUDIT_ENTITY_VIEW_PERMISSION: Readonly<Record<AuditEntityType, PermissionKey | null>> = {
  USER: 'users.manage',
  SESSION: 'users.manage',
  SETTINGS: null,
  UPLOAD: null,
  ITEM: 'items.view',
  PURCHASE_BATCH: 'purchases.view',
  CUSTOMER: 'customers.view',
  DRIVER: 'drivers.view',
  ORDER: 'orders.view',
  RETURN: 'orders.view',
  LEDGER_ENTRY: 'orders.view',
};

/** The entity types whose history a reader holding `can` may see, in `AUDIT_ENTITY_TYPES` order. */
export function visibleAuditEntityTypes(can: (key: PermissionKey) => boolean): AuditEntityType[] {
  return AUDIT_ENTITY_TYPES.filter((type) => {
    const required = AUDIT_ENTITY_VIEW_PERMISSION[type];
    return required === null || can(required);
  });
}
