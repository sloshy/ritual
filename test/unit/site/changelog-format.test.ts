import { describe, expect, test } from 'bun:test'
import { isAdditiveAction } from '../../../src/site/changelog-format'
import type { ChangelogAction } from '../../../src/changes/changelog-parser'

// The wording that used to live beside this categorization now has exactly one
// implementation, `changeMessage` — see `test/unit/change-message.test.ts`.

describe('isAdditiveAction', () => {
  // 'Set as commander', 'Unset as commander', and 'Cleared note' are pinned end-to-end by
  // test/e2e/public-site/view-changes.spec.ts via changelog-change-item--remove class assertions.
  const additive: ChangelogAction[] = [
    'Added',
    'Set finish',
    'Set printing',
    'Set language',
    'Set note',
    'Moved from list',
  ]
  const destructive: ChangelogAction[] = ['Removed', 'Moved to list']

  for (const action of additive) {
    test(`${action} is additive`, () => {
      expect(isAdditiveAction(action)).toBe(true)
    })
  }

  for (const action of destructive) {
    test(`${action} is destructive`, () => {
      expect(isAdditiveAction(action)).toBe(false)
    })
  }
})
