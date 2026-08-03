import { describe, expect, test } from 'bun:test'
import type { Choice } from 'prompts'
import type { ScryfallCard } from '../../src/types'
import {
  buildCollectorChoices,
  buildMenuChoices,
  isMenuChoice,
  SESSION_MENU_LIMIT,
  similarCopyInput,
  suggestCollectorMode,
  suggestEditMode,
  suggestNameMode,
  type MenuBuildInput,
} from '../../src/commands/card-session'

describe('isMenuChoice', () => {
  test('recognizes menu sentinel values', () => {
    for (const value of [
      '__SAVE__',
      '__EXIT__',
      '__SECTION__',
      '__ADD_ANOTHER__',
      '__ADD_SIMILAR__',
    ]) {
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
    { title: '💾 Save 1 change(s) (keep editing)', value: '__SAVE__' },
    { title: '🚪 Exit', value: '__EXIT__' },
    { title: 'Sol Ring', value: 'Sol Ring' },
    { title: 'Lightning Bolt', value: 'Lightning Bolt' },
    { title: 'Bolt of Lightning', value: 'Bolt of Lightning' },
  ]
}

describe('suggestNameMode', () => {
  test('empty input shows only menu items', () => {
    const result = suggestNameMode('', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['__SAVE__', '__EXIT__'])
  })

  test('all space-separated terms must match the title, in any order', () => {
    const result = suggestNameMode('bolt light', nameModeChoices())
    // Both match; "Bolt of Lightning" leads because its words begin with the
    // terms in the order they were typed (see rankNameMatches).
    expect(result.map((c) => c.value)).toEqual(['Bolt of Lightning', 'Lightning Bolt'])
  })

  test('trailing ! marks card matches to force prompts', () => {
    const result = suggestNameMode('sol ring!', nameModeChoices())
    expect(result).toHaveLength(1)
    expect(result[0]!.value).toBe('Sol Ring__FORCE__')
    expect(result[0]!.title).toBe('Sol Ring (Force Options)')
  })

  test('trailing ! does not rewrite menu items', () => {
    // Typing e.g. `exit!` should still surface the plain Exit sentinel, never
    // a bogus `__EXIT____FORCE__` value.
    const result = suggestNameMode('exit!', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['__EXIT__'])
  })

  test('trailing ! rewrites all card matches, not just the first', () => {
    const result = suggestNameMode('bolt!', nameModeChoices())
    expect(result).toHaveLength(2)
    expect(result.every((c) => String(c.value).endsWith('__FORCE__'))).toBe(true)
  })

  // Card choices arrive in EDHRec-popularity order, so an unpopular card whose
  // name is a substring of popular ones ("The End") sits at the bottom until the
  // query spells it out in full.
  function popularityOrderedChoices(): Choice[] {
    return [
      { title: '🚪 Exit', value: '__EXIT__' },
      { title: 'The Enduring Renown', value: 'The Enduring Renown' },
      { title: 'The Endless Swarm', value: 'The Endless Swarm' },
      { title: 'The End', value: 'The End' },
    ]
  }

  test('a fully typed card name jumps ahead of more popular partial matches', () => {
    const result = suggestNameMode('The End', popularityOrderedChoices())
    expect(result.map((c) => c.value)).toEqual([
      'The End',
      'The Enduring Renown',
      'The Endless Swarm',
    ])
  })

  test('a partially typed name keeps the popularity order', () => {
    const result = suggestNameMode('The En', popularityOrderedChoices())
    expect(result.map((c) => c.value)).toEqual([
      'The Enduring Renown',
      'The Endless Swarm',
      'The End',
    ])
  })

  test('menu items stay ahead of a promoted card match', () => {
    // A card name that also term-matches a menu item must not displace the menu.
    const choices: Choice[] = [
      { title: '🚪 Exit', value: '__EXIT__' },
      { title: 'Exit Through the Gift Shop', value: 'Exit Through the Gift Shop' },
      { title: 'Exit', value: 'Exit' },
    ]
    expect(suggestNameMode('exit', choices).map((c) => c.value)).toEqual([
      '__EXIT__',
      'Exit',
      'Exit Through the Gift Shop',
    ])
  })

  test('promotion applies to a forced (!) selection too', () => {
    const result = suggestNameMode('the end!', popularityOrderedChoices())
    expect(result[0]!.value).toBe('The End__FORCE__')
  })
})

describe('suggestCollectorMode', () => {
  const choices: Choice[] = [
    { title: '🚪 Exit', value: '__EXIT__' },
    { title: '1 - Sol Ring', value: { type: 'card', num: '1' } },
    { title: '12 - Arcane Signet', value: { type: 'card', num: '12' } },
    { title: '2 - Mana Crypt', value: { type: 'card', num: '2' } },
  ]

  test('empty input shows only menu items', () => {
    expect(suggestCollectorMode('', choices).map((c) => c.value)).toEqual(['__EXIT__'])
  })

  test('filters by collector-number prefix, keeping menu items', () => {
    const result = suggestCollectorMode('1', choices)
    expect(result.map((c) => c.value)).toEqual([
      '__EXIT__',
      { type: 'card', num: '1' },
      { type: 'card', num: '12' },
    ])
  })

  test('matches collector-number prefixes only, not substrings', () => {
    // '12 - Arcane Signet' contains a 2 but does not start with one.
    const result = suggestCollectorMode('2', choices)
    expect(result.map((c) => c.value)).toEqual(['__EXIT__', { type: 'card', num: '2' }])
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
      '__EXIT__',
      'Sol Ring',
    ])
  })

  test('the note shortcut drops out once the last added card has a note', () => {
    const lastAdded = { name: 'Sol Ring', hasNote: true, cardId: 3 }
    const values = buildMenuChoices({ ...base, lastAdded }).map((c) => c.value)
    expect(values).not.toContain('__ADD_NOTE__')
    // The copy/edit shortcuts stay available regardless of the note state.
    expect(values.slice(0, 3)).toEqual(['__ADD_ANOTHER__', '__ADD_SIMILAR__', '__EDIT_LAST__'])
  })

  test('a similar copy re-enters the add flow with the prompts forced', () => {
    // This is the input the __ADD_SIMILAR__ shortcut hands to the strategy: a
    // fresh add (not an edit) of the same card, with no preselected printing
    // and the prompts forced past any session defaults — otherwise the "choose
    // new options" promise in the menu label would silently not hold.
    expect(similarCopyInput({ name: 'Sol Ring', hasNote: true, cardId: 3 })).toEqual({
      cardName: 'Sol Ring',
      preselected: null,
      forcePrompts: true,
      intent: 'similar-copy',
    })
  })

  test('the copy shortcuts disambiguate exact and similar copies', () => {
    const lastAdded = { name: 'Sol Ring', hasNote: false, cardId: 3 }
    const choices = buildMenuChoices({ ...base, lastAdded })
    expect(choices.find((c) => c.value === '__ADD_ANOTHER__')?.title).toBe(
      '➕ Add Exact Copy (Sol Ring)',
    )
    expect(choices.find((c) => c.value === '__ADD_SIMILAR__')?.title).toBe(
      '➕ Add Similar Copy (Sol Ring, choose new options)',
    )
  })

  test('add mode leads with the last-added shortcuts and ends with Exit', () => {
    const values = buildMenuChoices({
      ...base,
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 3 },
      changeCount: 2,
      sessionAdds: [{ label: 'Sol Ring (LEA:269) &3', name: 'Sol Ring' }],
      editUndoLabel: 'printing on Lightning Bolt',
      sessionChangeCount: 2,
      extraItems: [{ title: '🗂️  Set Target Section', value: '__SECTION__' }],
    }).map((c) => c.value)
    expect(values).toEqual([
      // Everything about the card just added, then the undo shortcuts...
      '__ADD_ANOTHER__',
      '__ADD_SIMILAR__',
      '__ADD_NOTE__',
      '__EDIT_LAST__',
      '__UNDO_LAST__',
      '__UNDO_EDIT__',
      // ...then session-wide settings, review, save, and finally Exit.
      '__SECTION__',
      '__CONFIG__',
      '__COLLECTOR_MODE__',
      '__EDIT_MODE__',
      '__CHANGES__',
      '__SAVE__',
      '__EXIT__',
      'Sol Ring',
    ])
  })

  test('the tallest possible menu still fits the prompt window', () => {
    // Save and Exit sit at the foot of the menu, so the prompt must be tall
    // enough to show every item at once — otherwise the busiest session (a deck
    // in a multi-list editor, with every shortcut showing) pushes them below the
    // fold and they can only be reached by scrolling.
    const tallest = buildMenuChoices({
      ...base,
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 3 },
      changeCount: 2,
      sessionAdds: [{ label: 'Sol Ring (LEA:269) &3', name: 'Sol Ring' }],
      editUndoLabel: 'printing on Lightning Bolt',
      sessionChangeCount: 2,
      extraItems: [
        { title: '🗂️  Set Target Section', value: '__SECTION__' },
        { title: '🏷️  Change Format', value: '__FORMAT__' },
      ],
      multiList: { totalChangeCount: 5, listsWithChanges: 2 },
      cardChoices: [],
    })
    // Exact equality, so the limit can drift neither below the real maximum
    // (items fall below the fold) nor above it (dead rows of empty window).
    expect(tallest.length).toBe(SESSION_MENU_LIMIT)
    expect(tallest.at(-1)?.value).toBe('__EXIT__')
  })

  test('edit mode pares the menu down to undo, mode switch, save/exit, and cards', () => {
    const entryChoice = {
      title: '- Sol Ring (C19:221) &1',
      value: { type: 'entry', cardId: 1 },
    }
    const choices = buildMenuChoices({
      ...base,
      sessionMode: 'edit',
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 1 },
      editUndoLabel: 'printing on Sol Ring',
      changeCount: 1,
      sessionChangeCount: 1,
      cardChoices: [entryChoice],
    })
    const values = choices.map((c) => c.value)
    expect(values).toEqual([
      '__UNDO_EDIT__',
      '__ADD_MODE__',
      '__CHANGES__',
      '__SAVE__',
      '__EXIT__',
      entryChoice.value,
    ])
    // The add-mode shortcuts must not leak into edit mode, even with a last added card.
    expect(values).not.toContain('__ADD_ANOTHER__')
    expect(values).not.toContain('__ADD_SIMILAR__')
    expect(values).not.toContain('__EDIT_LAST__')
    expect(values).not.toContain('__CONFIG__')
  })

  test('the undo-edit item appears with its label when an edit is undoable', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__UNDO_EDIT__')
    const choices = buildMenuChoices({ ...base, editUndoLabel: 'printing on Sol Ring' })
    const undoEdit = choices.find((c) => c.value === '__UNDO_EDIT__')
    expect(undoEdit?.title).toContain('Undo Last Edit (printing on Sol Ring)')
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
    expect(undo?.title).toContain('Undo Last Add (Lightning Bolt)')
  })

  test('the view-changes item counts every session change, adds or not', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__CHANGES__')

    // Edit-only sessions (no adds) still surface the viewer.
    const choices = buildMenuChoices({ ...base, sessionChangeCount: 3 })
    expect(choices.map((c) => c.value)).not.toContain('__UNDO_LAST__')
    const changes = choices.find((c) => c.value === '__CHANGES__')
    expect(changes?.title).toContain('View Session Changes (3)')
  })

  test('Switch List appears only in multi-list sessions, before Exit', () => {
    const single = buildMenuChoices({ ...base, changeCount: 2 }).map((c) => c.value)
    expect(single).not.toContain('__SWITCH_LIST__')

    const values = buildMenuChoices({
      ...base,
      multiList: { totalChangeCount: 0, listsWithChanges: 0 },
    }).map((c) => c.value)
    expect(values.indexOf('__SWITCH_LIST__')).toBeLessThan(values.indexOf('__EXIT__'))
  })

  // The Save / Save-current matrix: one row per (changeCount, dirty, multiList)
  // state, asserting each item's exact title, or its absence (null).
  type SaveMenuCase = {
    label: string
    input: Partial<Pick<MenuBuildInput, 'changeCount' | 'dirty' | 'multiList'>>
    save: string | null
    saveCurrent: string | null
  }

  const saveMenuCases: SaveMenuCase[] = [
    {
      label: 'single-list Save shows the pending change count',
      input: { changeCount: 3 },
      save: '💾 Save 3 change(s) (keep editing)',
      saveCurrent: null,
    },
    {
      label: 'Save is hidden when there are no pending changes',
      input: {},
      save: null,
      saveCurrent: null,
    },
    {
      // e.g. a deck format change: the file differs from disk but no card
      // change events exist, so the label drops the count.
      label: 'a dirty model with no tracked changes still surfaces Save, without a count',
      input: { dirty: true },
      save: '💾 Save changes (keep editing)',
      saveCurrent: null,
    },
    {
      label: 'multi-list save covers all lists and offers a save-current item',
      input: { changeCount: 2, multiList: { totalChangeCount: 5, listsWithChanges: 3 } },
      save: '💾 Save all changes (5 across 3 lists)',
      saveCurrent: '💾 Save current list changes (2)',
    },
    {
      label: 'multi-list save-current is hidden when the current list has no changes',
      input: { changeCount: 0, multiList: { totalChangeCount: 4, listsWithChanges: 2 } },
      save: '💾 Save all changes (4 across 2 lists)',
      saveCurrent: null,
    },
    {
      label: 'multi-list save collapses to the plain label when only one list has changes',
      input: { changeCount: 3, multiList: { totalChangeCount: 3, listsWithChanges: 1 } },
      save: '💾 Save 3 change(s) (keep editing)',
      saveCurrent: null,
    },
    {
      label: 'the collapse also applies when the one changed list is not the current one',
      input: { changeCount: 0, multiList: { totalChangeCount: 3, listsWithChanges: 1 } },
      save: '💾 Save 3 change(s) (keep editing)',
      saveCurrent: null,
    },
    {
      label: 'a dirty-only list still collapses to the plain single-list label, without a count',
      input: { dirty: true, multiList: { totalChangeCount: 0, listsWithChanges: 1 } },
      save: '💾 Save changes (keep editing)',
      saveCurrent: null,
    },
    {
      label: 'multi-list save items are hidden when no list has changes',
      input: { multiList: { totalChangeCount: 0, listsWithChanges: 0 } },
      save: null,
      saveCurrent: null,
    },
    {
      // dirty (not changeCount) is what makes the current list saveable here,
      // so the save-current item must appear and drop its count.
      label: 'a dirty current list offers save-current without a count when others have changes',
      input: {
        changeCount: 0,
        dirty: true,
        multiList: { totalChangeCount: 3, listsWithChanges: 2 },
      },
      save: '💾 Save all changes (3 across 2 lists)',
      saveCurrent: '💾 Save current list changes',
    },
    {
      label: 'a scoped session has no save-current item — Save always means save all',
      input: {
        changeCount: 2,
        multiList: { totalChangeCount: 5, listsWithChanges: 3, scoped: true },
      },
      save: '💾 Save all changes (5 across 3 lists)',
      saveCurrent: null,
    },
    {
      // e.g. two decks that each only changed their format: "0 across 2 lists"
      // would misread as nothing to save.
      label: 'multi-list Save all drops the change count when every list is dirty-only',
      input: { dirty: true, multiList: { totalChangeCount: 0, listsWithChanges: 2 } },
      save: '💾 Save all changes (2 lists)',
      saveCurrent: '💾 Save current list changes',
    },
  ]

  test.each(saveMenuCases)('$label', ({ input, save, saveCurrent }) => {
    const choices = buildMenuChoices({ ...base, ...input })
    expect(choices.find((c) => c.value === '__SAVE__')?.title ?? null).toBe(save)
    expect(choices.find((c) => c.value === '__SAVE_CURRENT__')?.title ?? null).toBe(saveCurrent)
    // Whatever the save state, Exit stays a plain item.
    expect(choices.find((c) => c.value === '__EXIT__')?.title).toContain('Exit')
  })
})

describe('suggestEditMode', () => {
  const choices: Choice[] = [
    { title: '🚪 Exit', value: '__EXIT__' },
    { title: '- Sol Ring (C19:221) &1', value: { type: 'entry', cardId: 1 } },
    { title: '- Lightning Bolt (LEA:161) &2', value: { type: 'entry', cardId: 2 } },
  ]

  test('empty input shows only menu items', () => {
    expect(suggestEditMode('', choices).map((c) => c.value)).toEqual(['__EXIT__'])
  })

  test('term-matches the rendered entry lines', () => {
    const result = suggestEditMode('bolt lea', choices)
    expect(result).toHaveLength(1)
    expect(result[0]!.title).toContain('Lightning Bolt')
  })

  test('a trailing ! never becomes a force marker', () => {
    // Name mode reads a trailing `!` as "force the prompts"; edit mode must not,
    // because its entry values are objects that a __FORCE__ suffix would corrupt.
    // Punctuation is ignored when matching, so the entry is still found.
    const result = suggestEditMode('bolt!', choices)
    expect(result).toHaveLength(1)
    expect(result[0]!.value).toEqual({ type: 'entry', cardId: 2 })
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
