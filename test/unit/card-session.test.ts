import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { Choice } from 'prompts'
import { PSEUDO_LOCALE, pseudoLocalize } from '../../scripts/generate-locales'
import { en, type MessageKey } from '../../src/i18n/messages/en'
import { enMeta } from '../../src/i18n/messages/en.meta'
import { loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import { displayWidth } from '../../src/i18n/width'
import type { ScryfallCard } from '../../src/scryfall/types'
import { localeTag } from '../../src/i18n/locale-tag'
import {
  applySessionConfigAnswers,
  buildInitialSessionConfig,
  buildSessionConfigQuestions,
  type SessionConfig,
} from '../../src/commands/session/config'
import {
  buildCollectorChoices,
  buildMenuChoices,
  ensureCollectorChoices,
  isMenuChoice,
  SESSION_MENU_LIMIT,
  suggestCollectorMode,
  suggestEditMode,
  suggestNameMode,
  type MenuBuildInput,
} from '../../src/commands/session/menu'
import { similarCopyInput } from '../../src/commands/session/strategy'
import { makeScryfallCard } from '../test-utils'

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
    const choice: Choice = { title: 'MKM:1 — Sol Ring', value: { type: 'card' } }
    expect(isMenuChoice(choice)).toBe(false)
  })
})

function nameModeChoices(): Choice[] {
  return [
    { title: '💾 Save 1 change (keep editing)', value: '__SAVE__' },
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

  // Menu rows are reachable by typing a word or two of their label, so past a
  // few characters the input is a card search and the rows drop out entirely
  // rather than sitting above the matches.
  test('menu items survive an input of three characters', () => {
    const result = suggestNameMode('exi', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['__EXIT__'])
  })

  test('menu items disappear once the input passes three characters', () => {
    const choices: Choice[] = [
      { title: '🚪 Exit', value: '__EXIT__' },
      { title: 'Exit Through the Gift Shop', value: 'Exit Through the Gift Shop' },
    ]
    expect(suggestNameMode('exit', choices).map((c) => c.value)).toEqual([
      'Exit Through the Gift Shop',
    ])
  })

  test('a colon hides the menu items whatever the length', () => {
    const choices: Choice[] = [
      { title: '🚪 Exit', value: '__EXIT__' },
      { title: 'Ex: The Card', value: 'Ex: The Card' },
    ]
    expect(suggestNameMode('e:', choices).map((c) => c.value)).toEqual(['Ex: The Card'])
  })

  test('the force marker is stripped before the menu-hiding length is measured', () => {
    // `exi!` is a four-character input but a three-character search.
    expect(suggestNameMode('exi!', nameModeChoices()).map((c) => c.value)).toEqual(['__EXIT__'])
  })

  test('trailing ! marks card matches to force prompts', () => {
    const result = suggestNameMode('sol ring!', nameModeChoices())
    expect(result).toHaveLength(1)
    expect(result[0]!.value).toBe('Sol Ring__FORCE__')
    expect(result[0]!.title).toBe('Sol Ring (Force Options)')
  })

  test('trailing ! does not rewrite menu items', () => {
    // Typing e.g. `sav!` should still surface the plain Save sentinel, never
    // a bogus `__SAVE____FORCE__` value.
    const result = suggestNameMode('sav!', nameModeChoices())
    expect(result.map((c) => c.value)).toEqual(['__SAVE__'])
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
      { title: 'Exi', value: 'Exi' },
    ]
    expect(suggestNameMode('exi', choices).map((c) => c.value)).toEqual([
      '__EXIT__',
      'Exi',
      'Exit Through the Gift Shop',
    ])
  })

  test('promotion applies to a forced (!) selection too', () => {
    const result = suggestNameMode('the end!', popularityOrderedChoices())
    expect(result[0]!.value).toBe('The End__FORCE__')
  })
})

/** A cached printing, for the collector-mode pool. */
function printing(set: string, collectorNumber: string, name: string): ScryfallCard {
  return makeScryfallCard({ set, collector_number: collectorNumber, name })
}

/**
 * The `SET:CN` of every printing row a search returned, in order. Read off the
 * choice's card rather than its title, so a reworded row label breaks only the
 * one test that pins the label.
 */
function printings(results: Choice[]): string[] {
  return results
    .filter((c) => !isMenuChoice(c))
    .map((c) => {
      const { card } = c.value as { card: ScryfallCard }
      return `${card.set.toUpperCase()}:${card.collector_number}`
    })
}

describe('suggestCollectorMode', () => {
  const pool = buildCollectorChoices([
    printing('mkm', '123', 'Sol Ring'),
    printing('mkm', '12', 'Arcane Signet'),
    printing('sld', '123', 'Mana Crypt'),
    printing('sec', '4', 'Lightning Bolt'),
    // A set code carrying `ls` in the middle rather than at the front, so a
    // substring match is distinguishable from a prefix match.
    printing('plst', '5', 'The List Card'),
  ])
  const choices: Choice[] = [
    { title: '💾 Save all changes', value: '__SAVE__' },
    { title: '🚪 Exit', value: '__EXIT__' },
    ...pool,
  ]

  test('empty input shows only menu items', () => {
    expect(suggestCollectorMode('', choices).map((c) => c.value)).toEqual(['__SAVE__', '__EXIT__'])
  })

  // One grammar smoke only: the query semantics themselves are pinned at the
  // engine layer in collector-query.test.ts — this proves the suggest wrapper
  // routes printing rows through parseCollectorQuery/matchesCollectorQuery.
  test('SET:CN matches the set by substring and the number by prefix', () => {
    expect(printings(suggestCollectorMode('mkm:12', choices))).toEqual(['MKM:12', 'MKM:123'])
  })

  test('card names are never matched', () => {
    expect(printings(suggestCollectorMode('sol', choices))).toEqual([])
  })

  test('a short input still narrows the menu rows by what was typed', () => {
    // `mkm` is a set code, not a menu label. Offering the whole menu here would
    // fill the prompt window with rows above the printings the user asked for.
    const result = suggestCollectorMode('mkm', choices)
    expect(result.some(isMenuChoice)).toBe(false)
    expect(printings(result)).toEqual(['MKM:12', 'MKM:123'])
  })

  test('a short input naming a menu row keeps that row', () => {
    expect(suggestCollectorMode('sav', choices).map((c) => c.value)).toEqual(['__SAVE__'])
  })

  test('menu items drop out past three characters, even for a matching label', () => {
    expect(suggestCollectorMode('save', choices).some(isMenuChoice)).toBe(false)
    expect(suggestCollectorMode('mkm1', choices).some(isMenuChoice)).toBe(false)
  })

  test('a colon hides the menu items whatever the length', () => {
    expect(suggestCollectorMode('m:', choices).some(isMenuChoice)).toBe(false)
  })
})

describe('buildMenuChoices', () => {
  const base = {
    sessionMode: 'add' as const,
    mode: 'name' as const,
    language: 'en' as const,
    lastAdded: null,
    changeCount: 0,
    extraItems: [],
    sessionAdds: [],
    editUndoLabel: null,
    sessionChangeCount: 0,
    cardChoices: [{ title: 'Sol Ring', value: 'Sol Ring' }],
  }

  test('without a last added card, the copy/note/edit shortcuts are absent', () => {
    const values = buildMenuChoices(base).map((c) => c.value)
    expect(values).toEqual([
      '__CARD_LANGUAGE__',
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
      '__EDIT_LAST_LANGUAGE__',
      '__UNDO_LAST__',
      '__UNDO_EDIT__',
      // ...then session-wide settings, review, save, and finally Exit.
      '__SECTION__',
      '__CARD_LANGUAGE__',
      '__CONFIG__',
      '__COLLECTOR_MODE__',
      '__EDIT_MODE__',
      '__CHANGES__',
      '__SAVE__',
      '__EXIT__',
      'Sol Ring',
    ])
  })

  /** The busiest menu the engine can build: a deck in a multi-list editor. */
  function tallestMenuInput(): MenuBuildInput {
    return {
      ...base,
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 3 },
      changeCount: 2,
      sessionAdds: [{ label: 'Sol Ring (LEA:269) &3', name: 'Sol Ring' }],
      editUndoLabel: 'printing on Lightning Bolt',
      sessionChangeCount: 2,
      extraItems: [
        { title: '🗂️  Set Target Section', value: '__SECTION__' },
        { title: '🏷️  Change Format', value: '__FORMAT__' },
        { title: '🔖 Edit Tags', value: '__TAGS__' },
        { title: '🏷️  Edit List Labels (default: none)', value: '__LIST_LABELS__' },
        { title: '🗂️  Rename Category…', value: '__RENAME_CATEGORY__' },
        { title: '🗂️  Reorder Categories…', value: '__REORDER_CATEGORIES__' },
      ],
      multiList: { totalChangeCount: 5, listsWithChanges: 2 },
      cardChoices: [],
    }
  }

  test('the tallest possible menu still fits the prompt window', () => {
    // Save and Exit sit at the foot of the menu, so the prompt must be tall
    // enough to show every item at once — otherwise the busiest session (a deck
    // in a multi-list editor, with every shortcut showing) pushes them below the
    // fold and they can only be reached by scrolling.
    const tallest = buildMenuChoices(tallestMenuInput())
    // Exact equality, so the limit can drift neither below the real maximum
    // (items fall below the fold) nor above it (dead rows of empty window).
    expect(tallest.length).toBe(SESSION_MENU_LIMIT)
    expect(tallest.at(-1)?.value).toBe('__EXIT__')
  })

  /**
   * The row budget survives translation, and the `cli.menu.*` length budgets are
   * what keep it surviving.
   *
   * `SESSION_MENU_LIMIT` counts rows, and a row that is too wide for the
   * terminal wraps onto a second one — so a 40%-longer label costs a row just as
   * surely as a new menu item does, and pushes Save and Exit below the fold.
   * German and Finnish run 30–50% longer than English, which the `en-XA`
   * pseudo-locale (English + 40% padding + brackets) stands in for here.
   *
   * The catalog validator enforces the budgets across the whole catalog; this
   * asserts the two things it cannot see: that every menu key actually declares
   * one, and that the menu the engine builds is still the same number of rows
   * once every label has been swapped.
   */
  describe('under the en-XA pseudo-locale', () => {
    const MENU_KEY_PREFIX = 'cli.menu.'
    /** One standard terminal line. A row wider than this wraps and costs a second. */
    const MENU_ROW_BUDGET = 80
    beforeAll(() => {
      loadDictionary(PSEUDO_LOCALE, pseudoLocalize(en, enMeta))
      setLocale(PSEUDO_LOCALE)
    })

    afterAll(() => {
      resetI18nRuntime()
    })

    test('every cli.menu.* key declares a length budget', () => {
      const unbudgeted = Object.keys(en)
        .filter((key) => key.startsWith(MENU_KEY_PREFIX))
        .filter((key) => enMeta[key as MessageKey]?.maxLen === undefined)
      expect(unbudgeted).toEqual([])
    })

    test('the tallest menu keeps its row count and its trailing Exit', () => {
      const input = tallestMenuInput()
      const tallest = buildMenuChoices(input)
      expect(tallest.length).toBe(SESSION_MENU_LIMIT)
      expect(tallest.at(-1)?.value).toBe('__EXIT__')
      // Every label the engine owns really was translated: an untouched row
      // stays plain ASCII with no brackets, which is what the pseudo-locale
      // exists to make visible. `extraItems` are spliced in verbatim by the
      // caller, so they are the strategy's labels, not the engine's.
      const callerRows = new Set(input.extraItems.map((item) => String(item.value)))
      expect([...callerRows]).toEqual([
        '__SECTION__',
        '__FORMAT__',
        '__TAGS__',
        '__LIST_LABELS__',
        '__RENAME_CATEGORY__',
        '__REORDER_CATEGORIES__',
      ])
      const untranslated = tallest
        .filter((choice) => !callerRows.has(String(choice.value)))
        .map((choice) => choice.title)
        .filter((title) => !title.includes('['))
      expect(untranslated).toEqual([])
    })

    test('no menu row wraps onto a second line', () => {
      const overrun = buildMenuChoices(tallestMenuInput())
        .map((choice) => ({ title: choice.title, width: displayWidth(choice.title) }))
        .filter((row) => row.width > MENU_ROW_BUDGET)
      expect(overrun).toEqual([])
    })
  })

  /**
   * Muscle memory survives translation.
   *
   * The session menu is driven entirely by typing, so translating it changes
   * what a user can type to reach a row — silently. A Japanese catalog is used
   * here rather than `en-XA` because the pseudo-locale only *accents* Latin
   * letters, and search normalization strips diacritics: `Şȧṽḗ` folds straight
   * back to `save`, so it could never fail this test whatever the code did.
   */
  describe('with a non-Latin menu', () => {
    const JAPANESE = localeTag('ja')

    beforeAll(() => {
      loadDictionary(JAPANESE, {
        'cli.menu.exit': '終了',
        'cli.menu.saveAll': 'すべての変更を保存 ({scope})',
        'cli.menu.switchList': 'リストを切り替える',
      })
      setLocale(JAPANESE)
    })

    afterAll(() => {
      resetI18nRuntime()
    })

    test('the English terms still select a translated row', () => {
      const menu = buildMenuChoices(tallestMenuInput())
      expect(menu.find((choice) => choice.value === '__EXIT__')?.title).toBe('🚪 終了')
      // (`exi` also answers the English "edit existing cards" row, so this
      // asserts membership rather than an exact list.)
      expect(suggestNameMode('exi', menu).map((choice) => choice.value)).toContain('__EXIT__')
      // Longer than the menu-hiding threshold, so name mode drops the row —
      // edit mode, which keeps its menu at any length, is where a whole English
      // label can still be typed.
      expect(suggestEditMode('save all', menu).map((choice) => choice.value)).toEqual(['__SAVE__'])
    })

    test('the translated text selects the row too, typed without spaces', () => {
      // Japanese is not whitespace-delimited, so `リストを 切り替える` is not how
      // anyone types it. Segmentation finds the boundaries the spaces would have
      // marked; without it only a contiguous substring of the label would match.
      // Asserted through edit mode: the phrase is far past the length at which
      // the card-adding modes stop offering menu rows at all.
      const menu = buildMenuChoices(tallestMenuInput())
      expect(suggestEditMode('リスト切り替える', menu).map((choice) => choice.value)).toEqual([
        '__SWITCH_LIST__',
      ])
    })
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

  test('the card-language row names the session language, not the configured one', () => {
    const english = buildMenuChoices(base).find((c) => c.value === '__CARD_LANGUAGE__')
    expect(english?.title).toContain('Card Language (English)')
    const japanese = buildMenuChoices({ ...base, language: 'ja' }).find(
      (c) => c.value === '__CARD_LANGUAGE__',
    )
    expect(japanese?.title).toContain('Card Language (Japanese)')
  })

  test('the change-language shortcut needs a last added card with an id', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__EDIT_LAST_LANGUAGE__')
    // A deck line the session added but cannot address by id (no `&N` yet).
    const idless = buildMenuChoices({ ...base, lastAdded: { name: 'Sol Ring', hasNote: false } })
    expect(idless.map((c) => c.value)).not.toContain('__EDIT_LAST_LANGUAGE__')

    const withId = buildMenuChoices({
      ...base,
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 3 },
    })
    const row = withId.find((c) => c.value === '__EDIT_LAST_LANGUAGE__')
    expect(row?.title).toContain('Change Language (Sol Ring)')
  })

  test('edit mode drops both language rows along with the other add shortcuts', () => {
    const values = buildMenuChoices({
      ...base,
      sessionMode: 'edit',
      language: 'ja',
      lastAdded: { name: 'Sol Ring', hasNote: false, cardId: 3 },
    }).map((c) => c.value)
    // Edit mode has its own per-entry Change Language action; the session
    // default only governs adds, which edit mode does not do.
    expect(values).not.toContain('__CARD_LANGUAGE__')
    expect(values).not.toContain('__EDIT_LAST_LANGUAGE__')
  })

  test('the undo-edit item appears with its label when an edit is undoable', () => {
    expect(buildMenuChoices(base).map((c) => c.value)).not.toContain('__UNDO_EDIT__')
    const choices = buildMenuChoices({ ...base, editUndoLabel: 'printing on Sol Ring' })
    const undoEdit = choices.find((c) => c.value === '__UNDO_EDIT__')
    expect(undoEdit?.title).toContain('Undo Last Edit (printing on Sol Ring)')
  })

  test('collector mode keeps the session filters and swaps in the name-mode item', () => {
    // The session set filter is what narrows the collector pool, so its row
    // stays in both modes — there is no separate set-code manager any more.
    const values = buildMenuChoices({ ...base, mode: 'collector' }).map((c) => c.value)
    expect(values).toContain('__CONFIG__')
    expect(values).toContain('__NAME_MODE__')
    expect(values).not.toContain('__COLLECTOR_MODE__')
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
      save: '💾 Save 3 changes (keep editing)',
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
      save: '💾 Save 3 changes (keep editing)',
      saveCurrent: null,
    },
    {
      label: 'the collapse also applies when the one changed list is not the current one',
      input: { changeCount: 0, multiList: { totalChangeCount: 3, listsWithChanges: 1 } },
      save: '💾 Save 3 changes (keep editing)',
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

  test('empty input lists the menu items and then every entry, so the list can be scrolled', () => {
    // The menu-rows-before-entries order this relies on is pinned where it is
    // built — see the `buildMenuChoices` edit-mode ordering test above.
    expect(suggestEditMode('', choices).map((c) => c.value)).toEqual([
      '__EXIT__',
      { type: 'entry', cardId: 1 },
      { type: 'entry', cardId: 2 },
    ])
  })

  test('a whitespace-only input still lists everything, like an empty one', () => {
    expect(suggestEditMode(' ', choices)).toEqual(choices)
  })

  test('menu rows survive an input past the length that hides them in the add modes', () => {
    // Unlike name and collector mode, edit mode never drops the menu rows: its
    // entry lines and the menu labels share one prompt, and there is no card
    // database behind it for a longer query to be searching instead.
    expect(suggestEditMode('exit', choices).map((c) => c.value)).toEqual(['__EXIT__'])
  })

  test('term-matches the rendered entry lines', () => {
    expect(suggestEditMode('bolt lea', choices).map((c) => c.value)).toEqual([
      { type: 'entry', cardId: 2 },
    ])
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
  test('groups by set code, then sorts numerically with a lexical tiebreak', () => {
    const titles = buildCollectorChoices([
      printing('sld', '10', 'Ten'),
      printing('mkm', '2', 'Two'),
      printing('sld', '2a', 'Two-A'),
      printing('sld', '2', 'Two'),
      printing('sld', '1', 'One'),
    ]).map((c) => c.title)
    expect(titles).toEqual([
      'MKM:2 — Two',
      'SLD:1 — One',
      'SLD:2 — Two',
      'SLD:2a — Two-A',
      'SLD:10 — Ten',
    ])
  })

  test('letter-prefixed collector numbers keep their natural order', () => {
    // The shared `compareCollectorNumbers` rule: A-10 sorts after A-2, not
    // between A-1 and A-2 as a lexical compare would put it.
    const titles = buildCollectorChoices([
      printing('spg', 'A-10', 'Ten'),
      printing('spg', 'A-2', 'Two'),
      printing('spg', 'A-1', 'One'),
    ]).map((c) => c.title)
    expect(titles).toEqual(['SPG:A-1 — One', 'SPG:A-2 — Two', 'SPG:A-10 — Ten'])
  })

  test('the match terms are lowercased however the cache spells the printing', () => {
    // The row still renders `MKM:2A`, but a user types lowercase.
    const rows = buildCollectorChoices([printing('MKM', '2A', 'Sol Ring')])
    expect(printings(suggestCollectorMode('mkm:2a', rows))).toEqual(['MKM:2A'])
  })
})

describe('buildInitialSessionConfig', () => {
  test('defaults to name mode with no collector pool built', () => {
    expect(buildInitialSessionConfig({}, undefined)).toEqual({
      sets: undefined,
      language: 'en',
      finish: undefined,
      condition: undefined,
      entryMode: 'name',
      collectorChoices: null,
      targetSection: null,
    })
  })

  test('--collector only picks the entry mode — nothing is preloaded', () => {
    const config = buildInitialSessionConfig({ collector: true }, ['mkm'])
    expect(config.entryMode).toBe('collector')
    expect(config.collectorChoices).toBeNull()
    expect(config.sets).toEqual(['mkm'])
  })

  test('an unrecognized finish is dropped rather than stamped on every card', () => {
    expect(buildInitialSessionConfig({ finish: 'shiny' }, undefined).finish).toBeUndefined()
  })

  test('a condition is normalized to its canonical uppercase spelling', () => {
    expect(buildInitialSessionConfig({ condition: 'nm' }, undefined).condition).toBe('NM')
  })
})

describe('applySessionConfigAnswers', () => {
  /** A config whose collector pool has already been built for `sets`. */
  function configWithPool(sets: string[] | undefined): SessionConfig {
    const config = buildInitialSessionConfig({ collector: true }, sets)
    config.collectorChoices = buildCollectorChoices([printing('mkm', '1', 'One')])
    return config
  }

  test('a re-ordered set filter is the same filter and keeps the pool', () => {
    // Re-confirming the filter unchanged must not throw away a whole-cache pool.
    const config = configWithPool(['mkm', 'sld'])
    applySessionConfigAnswers(config, { sets: ['sld', 'mkm'] })
    expect(config.collectorChoices).not.toBeNull()
    expect(config.sets).toEqual(['sld', 'mkm'])
  })

  test('a different set filter throws the pool away', () => {
    const config = configWithPool(['mkm'])
    applySessionConfigAnswers(config, { sets: ['sld'] })
    expect(config.collectorChoices).toBeNull()
  })

  test('clearing the set filter throws the pool away', () => {
    const config = configWithPool(['mkm'])
    applySessionConfigAnswers(config, { sets: [] })
    expect(config.collectorChoices).toBeNull()
    expect(config.sets).toBeUndefined()
  })

  test('filtering a previously unfiltered session throws the pool away', () => {
    const config = configWithPool(undefined)
    applySessionConfigAnswers(config, { sets: ['mkm'] })
    expect(config.collectorChoices).toBeNull()
  })

  test('a finish-only answer leaves the pool alone', () => {
    const config = configWithPool(['mkm'])
    applySessionConfigAnswers(config, { finish: 'foil' })
    expect(config.collectorChoices).not.toBeNull()
    expect(config.finish).toBe('foil')
  })

  test('an unrecognized finish or condition clears the default back to always-prompt', () => {
    const config = configWithPool(['mkm'])
    config.finish = 'foil'
    config.condition = 'NM'
    applySessionConfigAnswers(config, { finish: '', condition: 'shiny' })
    expect(config.finish).toBeUndefined()
    expect(config.condition).toBeUndefined()
  })

  test('NONE is a real condition answer, not an unrecognized one', () => {
    const config = configWithPool(['mkm'])
    applySessionConfigAnswers(config, { condition: 'NONE' })
    expect(config.condition).toBe('NONE')
  })
})

describe('buildSessionConfigQuestions', () => {
  type SetsFormat = (value: string, answers: Record<string, unknown>) => unknown

  test('asks sets and finish, in that order, and condition only when included', () => {
    const config = buildInitialSessionConfig({}, undefined)
    expect(buildSessionConfigQuestions(config, true).map((q) => [q.name, q.type])).toEqual([
      ['sets', 'text'],
      ['finish', 'select'],
      ['condition', 'select'],
    ])
    expect(buildSessionConfigQuestions(config, false).map((q) => q.name)).toEqual([
      'sets',
      'finish',
    ])
  })

  test('the set question starts on the current filter, rendered for display', () => {
    const [unfiltered] = buildSessionConfigQuestions(buildInitialSessionConfig({}, undefined), true)
    expect(unfiltered?.initial).toBe('')
    const [filtered] = buildSessionConfigQuestions(
      buildInitialSessionConfig({}, ['mkm', 'sld']),
      true,
    )
    expect(filtered?.initial).toBe('MKM, SLD')
  })

  test('the set answer is parsed through the set-code grammar on the way out', () => {
    const [question] = buildSessionConfigQuestions(buildInitialSessionConfig({}, undefined), true)
    const format = question?.format as SetsFormat
    expect(format(' Mkm, sld ,, mkm ', {})).toEqual(['mkm', 'sld'])
    expect(format('', {})).toEqual([])
  })

  test('the finish cursor lands on the current default, or on always-prompt', () => {
    const finishQuestion = (finish?: string) =>
      buildSessionConfigQuestions(buildInitialSessionConfig({ finish }, undefined), true)[1]
    expect(finishQuestion()?.initial).toBe(0)
    expect(finishQuestion('nonfoil')?.initial).toBe(1)
    expect(finishQuestion('foil')?.initial).toBe(2)
    expect(finishQuestion('etched')?.initial).toBe(3)
    expect((finishQuestion()?.choices as Choice[]).map((c) => c.value)).toEqual([
      '',
      'nonfoil',
      'foil',
      'etched',
    ])
  })

  test('the condition question always starts on always-prompt and lists every grade', () => {
    const [, , condition] = buildSessionConfigQuestions(
      buildInitialSessionConfig({ condition: 'lp' }, undefined),
      true,
    )
    expect(condition?.initial).toBe(0)
    expect((condition?.choices as Choice[]).map((c) => c.value)).toEqual([
      '',
      'NONE',
      'NM',
      'LP',
      'MP',
      'HP',
      'DMG',
    ])
  })
})

describe('ensureCollectorChoices', () => {
  test('a built pool is reused rather than rebuilt', async () => {
    // The miss path reads the whole card cache; the hit path must not touch it.
    const config = buildInitialSessionConfig({ collector: true }, undefined)
    const built = buildCollectorChoices([printing('mkm', '1', 'One')])
    config.collectorChoices = built
    expect(await ensureCollectorChoices(config, false)).toBe(built)
  })
})
