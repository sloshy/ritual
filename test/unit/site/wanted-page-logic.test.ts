import { describe, test, expect } from 'bun:test'
import { wantedStateLabel } from '../../../src/site/wanted-page-logic'
import { t } from '../../../src/i18n/t'

describe('wantedStateLabel', () => {
  test('a name-only line accepts any printing', () => {
    expect(wantedStateLabel(t, 'name-only')).toBe(t('site.wanted.anyPrinting'))
  })

  test('a printing-only line accepts any finish', () => {
    expect(wantedStateLabel(t, 'printing')).toBe(t('site.wanted.anyFinish'))
  })

  test('a fully-specified line gets no badge at all', () => {
    expect(wantedStateLabel(t, 'fully-specified')).toBeUndefined()
  })

  // The two loose states must not collapse onto one another: a name-only line
  // accepting "any finish" would claim its printing was already chosen.
  test('the two loose states carry different text', () => {
    expect(wantedStateLabel(t, 'name-only')).not.toBe(wantedStateLabel(t, 'printing'))
  })
})
