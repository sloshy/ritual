/**
 * The reasons the admin audit log records, as **persisted identifiers**.
 *
 * `.logins/admin-audit.log` stores each entry's `reason` verbatim, and entries
 * written by every earlier version carry these exact strings, so the stored
 * bytes never change: changing one would need a migration of the log. They are
 * not shown as they are either — the Audit Log page maps each known value to a
 * catalog key and renders it in the reader's language ({@link auditReasonKey}),
 * showing an unknown value (a reason some other version wrote) as stored.
 *
 * Browser-safe: the admin SPA imports the mapping.
 */

import type { ParameterlessKey } from '../i18n/t'

/** Every reason Ritual writes, by what it records. */
export const AUDIT_REASONS = {
  // i18n-exempt: a persisted audit-log identifier — `.logins/admin-audit.log` stores these bytes
  loginSucceeded: 'Login successful',
  // i18n-exempt: a persisted audit-log identifier — `.logins/admin-audit.log` stores these bytes
  invalidCredentials: 'Invalid credentials',
  // i18n-exempt: a persisted audit-log identifier — `.logins/admin-audit.log` stores these bytes
  invalidTotp: 'Invalid TOTP code',
  // i18n-exempt: a persisted audit-log identifier — `.logins/admin-audit.log` stores these bytes
  accountCreatedViaCli: 'Admin account created via CLI',
  // i18n-exempt: a persisted audit-log identifier — `.logins/admin-audit.log` stores these bytes
  passwordResetViaCli: 'Admin password reset via CLI',
  // i18n-exempt: a persisted audit-log identifier — `.logins/admin-audit.log` stores these bytes
  totpDisabledViaCli: 'TOTP disabled via CLI',
} as const

/** One reason identifier Ritual writes. */
export type AuditReason = (typeof AUDIT_REASONS)[keyof typeof AUDIT_REASONS]

/** The catalog key each reason is displayed with. */
const AUDIT_REASON_KEYS: Record<AuditReason, ParameterlessKey> = {
  [AUDIT_REASONS.loginSucceeded]: 'admin.auditLog.reason.loginSucceeded',
  [AUDIT_REASONS.invalidCredentials]: 'admin.auditLog.reason.invalidCredentials',
  [AUDIT_REASONS.invalidTotp]: 'admin.auditLog.reason.invalidTotp',
  [AUDIT_REASONS.accountCreatedViaCli]: 'admin.auditLog.reason.accountCreatedViaCli',
  [AUDIT_REASONS.passwordResetViaCli]: 'admin.auditLog.reason.passwordResetViaCli',
  [AUDIT_REASONS.totpDisabledViaCli]: 'admin.auditLog.reason.totpDisabledViaCli',
}

/** Whether a stored reason is one this version knows how to display. */
function isAuditReason(reason: string): reason is AuditReason {
  return Object.hasOwn(AUDIT_REASON_KEYS, reason)
}

/** The key a stored reason is displayed with, or `undefined` to show it as stored. */
export function auditReasonKey(reason: string): ParameterlessKey | undefined {
  return isAuditReason(reason) ? AUDIT_REASON_KEYS[reason] : undefined
}
