import { describe, expect, test } from 'bun:test'
import { isAdditiveEvent } from '../../../src/site/changelog-format'
import {
  createAddChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createSetLabelChange,
  createSetNoteChange,
  createUnsetCommanderChange,
} from '../../../src/changes/change-event'

// The wording that used to live beside this categorization now has exactly one
// implementation, `changeMessage` — see `test/unit/change-message.test.ts`.

describe('isAdditiveEvent', () => {
  // 'set-commander', 'unset-commander', and the cleared note are pinned end-to-end by
  // test/e2e/public-site/view-changes.spec.ts via changelog-change-item--remove class assertions.
  const list = { type: 'deck', name: 'Burn' } as const

  test('gains are additive', () => {
    expect(isAdditiveEvent(createAddChange('Sol Ring'))).toBe(true)
    expect(isAdditiveEvent(createSetNoteChange('Sol Ring', { note: 'ramp' }))).toBe(true)
    expect(isAdditiveEvent(createSetLabelChange('Sol Ring', { labels: ['sale'] }))).toBe(true)
    expect(isAdditiveEvent(createMoveToChange('Sol Ring', { from: list }))).toBe(true)
  })

  test('losses are destructive, the cleared forms included', () => {
    expect(isAdditiveEvent(createRemoveChange('Sol Ring'))).toBe(false)
    expect(isAdditiveEvent(createUnsetCommanderChange('Sol Ring'))).toBe(false)
    expect(isAdditiveEvent(createMoveFromChange('Sol Ring', { to: list }))).toBe(false)
    // An empty note / label set is a clear — written as `Cleared …` — and reads as a loss.
    expect(isAdditiveEvent(createSetNoteChange('Sol Ring', { note: '' }))).toBe(false)
    expect(isAdditiveEvent(createSetLabelChange('Sol Ring', { labels: [] }))).toBe(false)
  })
})
