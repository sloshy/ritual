import { describe, expect, test } from 'bun:test'
import type { Choice } from 'prompts'
import type { ScryfallCard } from '../../src/types'
import {
  buildCollectorChoices,
  buildMenuChoices,
  isMenuChoice,
  suggestCollectorMode,
  suggestEditMode,
  suggestNameMode,
} from '../../src/commands/card-session'

describe('isMenuChoice', () => {
  test('recognizes menu sentinel values', () => {
    for (const value of ['__DONE__', '__EXIT__', '__SECTION__', '__ADD_ANOTHER__']) {
      expect(isMenuChoice({ title: value, value })).toBe(true)
    }
  })

  test('does not treat underscore-prefixed card names as menu items', () => {
    // Real MTG card names can begin with underscores (e.g. the Unstable card
    // `_____ Goblin`); a prefix check on `__` would wrongly leak them into the
    // pre-typing menu. Exact sentinel membership must reject them.
    const goblin: Choice = { title: '_____ Goblin', value: '_____ Goblin' }
    expect(isMenuChoice(goblin)).toBe(false)
    expect(isMenuChoice({ title: '__Wug__', value: '__Wug__' })).toBe(false)
  })

  test('rejects collector-mode object choices', () => {
    const choice: Choice = { title: '1 - Sol Ring', value: { type: 'card', num: '1' } }
    expect(isMenuChoice(choice)).toBe(false)
  })
})

function nameModeChoices(): Choice[] {
  return [
    { title: '✅ Done', value: '__DONE__' },
    { title: '🚪 Exit Without Saving Changelog', value: '__EXIT__' },
    { title: 'Sol Ring', value: 'Sol Ring' },
    { title: 'Lightning Bolt', value: 'Lightning Bolt' },
    { title: 'Bolt of Lightning', value: 'Bolt of Lightning' },
  ]
}

describe('suggestNameMode', () => {
  test('empty input shows only menu items', () => {
    const result = suggestNameMode('', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['__DONE__', '__EXIT__'])
  })

  test('all space-separated terms must match the title', () => {
    const result = suggestNameMode('bolt light', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['Lightning Bolt', 'Bolt of Lightning'])
  })

  test('trailing ! marks card matches to force prompts', () => {
    const result = suggestNameMode('sol ring!', nameModeChoices())
    expect(result).toHaveLength(1)
    expect(result[0]!.value).toBe('Sol Ring__FORCE__')
    expect(result[0]!.title).toBe('Sol Ring (Force Options)')
  })

  test('trailing ! does not rewrite menu items', () => {
    // Typing e.g. `done!` should still surface the plain Done sentinel, never
    // a bogus `__DONE____FORCE__` value.
    const result = suggestNameMode('done!', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['__DONE__'])
  })

  test('trailing ! rewrites all card matches, not just the first', () => {
    const result = suggestNameMode('bolt!', nameModeChoices())
    expect(result).toHaveLength(2)
    expect(result.every((c) => String(c.value).endsWith('__FORCE__'))).toBe(true)
  })
})

describe('suggestCollectorMode', () => {
  const choices: Choice[] = [
    { title: '✅ Done', value: '__DONE__' },
    { title: '1 - Sol Ring', value: { type: 'card', num: '1' } },
    { title: '12 - Arcane Signet', value: { type: 'card', num: '12' } },
    { title: '2 - Mana Crypt', value: { type: 'card', num: '2' } },
  ]

  test('empty input shows only menu items', () => {
    expect(suggestCollectorMode('', choices).map((c) => c.value)).toEqual(['__DONE__'])
  })

  test('filters by collector-number prefix, keeping menu items', () => {
    const result = suggestCollectorMode('1', choices)
    expect(result.map((c) => c.title)).toEqual(['✅ Done', '1 - Sol Ring', '12 - Arcane Signet'])
  })

  test('matches collector-number prefixes only, not substrings', () => {
    // '12 - Arcane Signet' contains a 2 but does not start with one.
    const result = suggestCollectorMode('2', choices)
    expect(result.map((c) => c.title)).toEqual(['✅ Done', '2 - Mana Crypt'])
  })
})

describe('buildMenuChoices', () => {
  const base = {
    sessionMode: 'add' as const,
    mode: 'name' as const,
    lastAdded: null,
    changeCount: 0,
    activeSet: '',
    extraItems: [],
    sessionAdds: [],
    editUndoLabel: null,
    sessionChangeCount: 0,
    cardChoices: [{ title: 'Sol Ring', value: 'Sol Ring' }],
  }

  test('without a last added card, the copy/note/edit shortcuts are absent', () => {
    const values = buildMenuChoices(base).map((c) => c.value)
    expect(values).toEqual([
      '__CONFIG__',
      '__COLLECTOR_MODE__',
      '__EDIT_MODE__',
      '__DONE__',
      '__EXIT__',
      'Sol Ring',
    ])
  })

  test('with a last added card, copy and edit appear; note only when it has none', () => {
    const lastAdded = { name: 'Sol Ring', hasNote: false, cardId: 3 }
    const values = buildMenuChoices({ ...base, lastAdded }).map((c) => c.value)
    expect(values).toContain('__ADD_ANOTHER__')
    expect(values).toContain('__ADD_NOTE__')
    expect(values).toContain('__EDIT_LAST__')

    const noted = buildMenuChoices({ ...base, lastAdded: { ...lastAdded, hasNote: true } })
    expect(noted.map((c) => c.value)).not.toContain('__ADD_NOTE__')
    // The copy/edit shortcuts stay available regardless of the note state.
    expect(noted.map((c) => c.value)).toContain('__ADD_ANOTHER__')
    expect(noted.map((c) => c.value)).toContain('__EDIT_LAST__')
  })

  test('Done shows the pending change count, and Save appears alongside it', () => {
    const choices = buildMenuChoices({ ...base, changeCount: 3 })
    const done = choices.find((c) => c.value === '__DONE__')
    expect(done?.title).toBe('✅ Done — Save 3 change(s) & Exit')
    const save = choices.find((c) => c.value === '__SAVE__')
    expect(save?.title).toBe('💾 Save 3 change(s) (keep editing)')
  })

  test('Save is hidden when there are no pending changes', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__SAVE__')
  })

  test('edit mode pares the menu down to mode switch, save/exit, and cards', () => {
    const entryChoice = {
      title: '- Sol Ring (C19:221) [NM] &1',
      value: { type: 'entry', cardId: 1 },
    }
    const choices = buildMenuChoices({
      ...base,
      sessionMode: 'edit',
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 1 },
      cardChoices: [entryChoice],
    })
    const values = choices.map((c) => c.value)
    expect(values).toEqual(['__ADD_MODE__', '__DONE__', '__EXIT__', entryChoice.value])
    // The add-mode shortcuts must not leak into edit mode, even with a last added card.
    expect(values).not.toContain('__ADD_ANOTHER__')
    expect(values).not.toContain('__EDIT_LAST__')
    expect(values).not.toContain('__CONFIG__')
  })

  test('the undo-edit item appears with its label when an edit is undoable', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__UNDO_EDIT__')
    const choices = buildMenuChoices({ ...base, editUndoLabel: 'printing on Sol Ring' })
    const undoEdit = choices.find((c) => c.value === '__UNDO_EDIT__')
    expect(undoEdit?.title).toBe('↩️  Undo Last Edit (printing on Sol Ring)')
  })

  test('collector mode swaps config/mode items and shows the active set', () => {
    const choices = buildMenuChoices({ ...base, mode: 'collector', activeSet: 'fdn' })
    const values = choices.map((c) => c.value)
    expect(values).toContain('__MANAGE_SETS__')
    expect(values).toContain('__NAME_MODE__')
    expect(values).not.toContain('__CONFIG__')
    expect(values).not.toContain('__COLLECTOR_MODE__')
    const manage = choices.find((c) => c.value === '__MANAGE_SETS__')
    expect(manage?.title).toContain('FDN')
  })

  test('extra items are inserted before the mode items', () => {
    const extra: Choice = { title: 'Set Target Section', value: '__SECTION__' }
    const values = buildMenuChoices({ ...base, extraItems: [extra] }).map((c) => c.value)
    expect(values.indexOf('__SECTION__')).toBeLessThan(values.indexOf('__CONFIG__'))
  })

  test('the undo-last-add item appears only when there are session adds, naming the last add', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__UNDO_LAST__')

    const sessionAdds = [
      { label: 'Sol Ring (LEA:269) &1', name: 'Sol Ring' },
      { label: 'Lightning Bolt (LEA:161) &2', name: 'Lightning Bolt' },
    ]
    const choices = buildMenuChoices({ ...base, sessionAdds, sessionChangeCount: 2 })
    const undo = choices.find((c) => c.value === '__UNDO_LAST__')
    expect(undo?.title).toBe('↩️  Undo Last Add (Lightning Bolt)')
  })

  test('the view-changes item counts every session change, adds or not', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__CHANGES__')

    // Edit-only sessions (no adds) still surface the viewer.
    const choices = buildMenuChoices({ ...base, sessionChangeCount: 3 })
    expect(choices.map((c) => c.value)).not.toContain('__UNDO_LAST__')
    const changes = choices.find((c) => c.value === '__CHANGES__')
    expect(changes?.title).toBe('📋 View Session Changes (3)')
  })
})

describe('suggestEditMode', () => {
  const choices: Choice[] = [
    { title: '✅ Done', value: '__DONE__' },
    { title: '- Sol Ring (C19:221) [NM] &1', value: { type: 'entry', cardId: 1 } },
    { title: '- Lightning Bolt (LEA:161) [NM] &2', value: { type: 'entry', cardId: 2 } },
  ]

  test('empty input shows only menu items', () => {
    expect(suggestEditMode('', choices).map((c) => c.value)).toEqual(['__DONE__'])
  })

  test('term-matches the rendered entry lines', () => {
    const result = suggestEditMode('bolt lea', choices)
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toContain('Lightning Bolt')
  })

  test('a trailing ! is treated as a literal character, never a force marker', () => {
    // Edit-mode entry values are objects; a force suffix would corrupt them.
    const result = suggestEditMode('bolt!', choices)
    expect(result).toHaveLength(0)
  })
})

describe('buildCollectorChoices', () => {
  test('sorts numerically, then lexically for suffixed collector numbers', () => {
    const card = (name: string): ScryfallCard => ({ name }) as ScryfallCard
    const map = new Map([
      ['10', card('Ten')],
      ['2', card('Two')],
      ['2a', card('Two-A')],
      ['1', card('One')],
    ])
    const titles = buildCollectorChoices(map).map((c) => c.title)
    expect(titles).toEqual(['1 - One', '2 - Two', '2a - Two-A', '10 - Ten'])
  })
})
