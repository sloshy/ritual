import { describe, expect, test } from 'bun:test'
import { AUDIT_REASONS, auditReasonKey } from '../../../src/admin/audit-reasons'
import { DEFAULT_LOCALE } from '../../../src/i18n/runtime'
import { tDynamic } from '../../../src/i18n/t'

/**
 * The audit log stores each reason's English verbatim; the Audit Log page shows
 * it through the catalog. The two must agree in English, so a log written by any
 * version reads exactly as it always has until the reader picks another language.
 */
describe('AUDIT_REASONS', () => {
  test('are the exact strings every earlier log holds', () => {
    // Persisted user data: changing one orphans the entries already written.
    expect(AUDIT_REASONS).toEqual({
      loginSucceeded: 'Login successful',
      invalidCredentials: 'Invalid credentials',
      invalidTotp: 'Invalid TOTP code',
      accountCreatedViaCli: 'Admin account created via CLI',
      passwordResetViaCli: 'Admin password reset via CLI',
      totpDisabledViaCli: 'TOTP disabled via CLI',
    })
  })
})

describe('auditReasonKey', () => {
  test.each(Object.values(AUDIT_REASONS))(
    'maps %p to a key whose English is the stored text',
    (reason) => {
      const key = auditReasonKey(reason)
      if (key === undefined) throw new Error(`no key for ${reason}`)
      expect(tDynamic(DEFAULT_LOCALE, key)).toBe(reason)
    },
  )

  test('leaves a reason it does not know to be shown as stored', () => {
    expect(auditReasonKey('Locked out by the moon')).toBeUndefined()
    // Inherited object properties are not reasons.
    expect(auditReasonKey('toString')).toBeUndefined()
  })
})
