import { describe, expect, test } from 'bun:test'
import prompts, { type Choice, type PromptObject } from 'prompts'
import { createCollectionStrategy } from '../../src/commands/session/collection-strategy'
import { createWantedStrategy } from '../../src/commands/session/wanted-strategy'
import { createDeckStrategy } from '../../src/commands/session/deck-strategy'
import {
  newCollectionSession,
  newWantedSession,
  type CollectionSession,
  type WantedSession,
} from '../../src/commands/session/flat-list-session'
import { buildInitialSessionConfig, type SessionConfig } from '../../src/commands/session/config'
import {
  createCardSessionContext,
  type CardSessionStrategy,
} from '../../src/commands/session/strategy'
import type { MenuChoice } from '../../src/commands/session/menu'
import { scratchListPath, stubTty } from '../test-utils'

// The edit-action menu is a raw `prompts` select; the capture below swaps the
// select element itself, which needs no terminal, but the strategies' art
// prompts gate on one.
stubTty({ stdin: true })

/** A row of the edit-action menu as the user sees it: title and the value it submits. */
type MenuRow = { title: string; value: string }

/** A captured edit-action prompt: its message and every row, in order. */
type CapturedMenu = { message: string; rows: MenuRow[] }

type SelectElement = (question: PromptObject) => unknown

/**
 * Run `action` with the `prompts` select element replaced by one that records
 * the question it was handed and answers with its last row (the Cancel row,
 * so the strategy performs no edit). `prompts.inject` cannot observe the menu:
 * an injected answer skips the element entirely.
 */
async function captureSelect(action: () => Promise<void>): Promise<CapturedMenu> {
  // An injection queue (even a drained one) bypasses the element entirely, so
  // a leftover `prompts.inject` would make this helper capture nothing.
  if ((prompts as unknown as { _injected?: unknown[] })._injected !== undefined) {
    throw new Error('prompts._injected is set: an injection queue would bypass the select element')
  }
  const elements = prompts.prompts as unknown as Record<string, SelectElement>
  const original = elements.select
  if (!original) throw new Error('prompts has no select element')
  let captured: CapturedMenu | undefined
  let selectCount = 0
  elements.select = (question) => {
    selectCount++
    const choices = (question.choices ?? []) as Choice[]
    captured = {
      message: String(question.message),
      rows: choices.map((c) => ({ title: c.title, value: String(c.value) })),
    }
    return choices.at(-1)?.value
  }
  try {
    await action()
  } finally {
    elements.select = original
  }
  if (!captured) throw new Error('the strategy opened no select prompt')
  expect(selectCount).toBe(1)
  return captured
}

function makeSessionConfig(): SessionConfig {
  return buildInitialSessionConfig({}, undefined)
}

const moveTargets = async () => []

function collectionSession(): CollectionSession {
  const session = newCollectionSession(scratchListPath('menus-binder.md'), 'Binder')
  session.entries = [
    {
      name: 'Sol Ring',
      set: 'c21',
      collectorNumber: '240',
      finish: 'nonfoil',
      condition: 'NM',
      price: 0,
      fileOrder: 0,
      section: 'Main',
      cardId: 1,
    },
  ]
  session.dirty = false
  return session
}

function wantedSession(pinned: boolean): WantedSession {
  const session = newWantedSession(scratchListPath('menus-needs.md'), 'Needs')
  session.entries = [
    {
      name: 'Demonic Tutor',
      set: pinned ? 'lea' : undefined,
      collectorNumber: pinned ? '105' : undefined,
      price: 0,
      fileOrder: 0,
      section: 'Main',
      state: pinned ? 'printing' : 'name-only',
      cardId: 1,
    },
  ]
  session.dirty = false
  return session
}

function collectionStrategy(withMove: boolean): CardSessionStrategy {
  return createCollectionStrategy(
    collectionSession(),
    makeSessionConfig(),
    'Binder',
    true,
    withMove ? moveTargets : undefined,
  )
}

function wantedStrategy(pinned: boolean, withMove: boolean): CardSessionStrategy {
  return createWantedStrategy(
    wantedSession(pinned),
    makeSessionConfig(),
    'Needs',
    true,
    withMove ? moveTargets : undefined,
  )
}

function deckStrategy(quantity = 0, withMove = false): CardSessionStrategy {
  const sessionConfig: SessionConfig = makeSessionConfig()
  return createDeckStrategy({
    deckFile: scratchListPath('menus-deck.md'),
    deckName: 'Test Deck',
    initialDeck: {
      name: 'Test Deck',
      sections:
        quantity > 0
          ? [
              {
                name: 'Main',
                cards: [
                  {
                    quantity,
                    name: 'Sol Ring',
                    set: 'c21',
                    collectorNumber: '240',
                    finish: 'nonfoil',
                    cardId: 1,
                  },
                ],
              },
            ]
          : [],
    },
    frontMatter: {},
    sessionConfig,
    excludeDigitalOnly: true,
    moveTargets: withMove ? moveTargets : undefined,
  })
}

async function editMenu(strategy: CardSessionStrategy): Promise<CapturedMenu> {
  return captureSelect(() => strategy.editEntry(createCardSessionContext(), 1))
}

function extraRows(strategy: CardSessionStrategy): MenuRow[] {
  return (strategy.extraMenuItems?.() ?? []).map((item: MenuChoice) => ({
    title: item.title,
    value: item.value,
  }))
}

// Byte-exact rows. The double-space icons (`🖼️  `, `🏷️  `, `🗑️  `, `🗂️  `) are
// deliberate: those emoji carry a variation selector and render narrower, so
// the extra space keeps the labels aligned. Keep them when the menus move.
const CANCEL_ROW: MenuRow = { title: '← Cancel', value: '__CANCEL__' }
const LANGUAGE_ROW: MenuRow = { title: '🌐 Change Language', value: 'language' }
const TAGS_ROW: MenuRow = { title: '🔖 Edit Tags', value: 'tags' }
const ART_ROW: MenuRow = { title: '🎨 Set Custom Art', value: 'art' }
const CATEGORIES_ROW: MenuRow = { title: '🗂️  Edit Categories', value: 'categories' }
/** The two list-level category rows every strategy carries (design §1.5). */
const CATEGORY_MENU_ROWS: MenuRow[] = [
  { title: '🗂️  Rename Category…', value: '__RENAME_CATEGORY__' },
  { title: '🗂️  Reorder Categories…', value: '__REORDER_CATEGORIES__' },
]
const MOVE_ROW: MenuRow = { title: '📤 Move to Another List', value: 'move-list' }
const NOTE_ROW: MenuRow = { title: '📝 Edit Note', value: 'note' }
const REMOVE_ROW: MenuRow = { title: '🗑️  Remove', value: 'remove' }

describe('collection strategy menus', () => {
  test('managerLabel', () => {
    expect(collectionStrategy(true).managerLabel).toBe('collection manager')
  })

  test('the extra session-menu items are Edit List Labels then the two category rows', () => {
    expect(extraRows(collectionStrategy(true))).toEqual([
      { title: '🏷️  Edit List Labels (default: none)', value: '__LIST_LABELS__' },
      ...CATEGORY_MENU_ROWS,
    ])
  })

  test('edit-action menu for a collection entry (unified editor, with move)', async () => {
    const menu = await editMenu(collectionStrategy(true))
    expect(menu.message).toBe('Edit - Sol Ring (C21:240) &1:')
    expect(menu.rows).toEqual([
      { title: '🖼️  Change Printing', value: 'printing' },
      { title: '✨ Change Finish', value: 'finish' },
      { title: '📋 Change Condition', value: 'condition' },
      LANGUAGE_ROW,
      { title: '🏷️  Change Label', value: 'label' },
      TAGS_ROW,
      ART_ROW,
      CATEGORIES_ROW,
      MOVE_ROW,
      NOTE_ROW,
      REMOVE_ROW,
      CANCEL_ROW,
    ])
  })

  test('edit-action menu without move targets drops only the move row', async () => {
    const menu = await editMenu(collectionStrategy(false))
    expect(menu.rows.map((r) => r.value)).toEqual([
      'printing',
      'finish',
      'condition',
      'language',
      'label',
      'tags',
      'art',
      'categories',
      'note',
      'remove',
      '__CANCEL__',
    ])
  })
})

describe('wanted strategy menus', () => {
  test('managerLabel', () => {
    expect(wantedStrategy(true, true).managerLabel).toBe('wanted list manager')
  })

  test('the wanted strategy offers exactly the two list-level category rows', () => {
    // Its first extra menu items: design §1.5 puts categories on all three types.
    expect(extraRows(wantedStrategy(true, true))).toEqual(CATEGORY_MENU_ROWS)
  })

  test('edit-action menu for a pinned wanted entry', async () => {
    const menu = await editMenu(wantedStrategy(true, true))
    expect(menu.message).toBe('Edit - Demonic Tutor (LEA:105) &1:')
    expect(menu.rows).toEqual([
      { title: '🖼️  Change Printing', value: 'printing' },
      { title: '✨ Change Finish', value: 'finish' },
      LANGUAGE_ROW,
      TAGS_ROW,
      ART_ROW,
      CATEGORIES_ROW,
      MOVE_ROW,
      NOTE_ROW,
      REMOVE_ROW,
      CANCEL_ROW,
    ])
  })

  test('edit-action menu for a name-only wanted entry: Set Printing, no finish row', async () => {
    const menu = await editMenu(wantedStrategy(false, true))
    expect(menu.message).toBe('Edit - Demonic Tutor &1:')
    expect(menu.rows).toEqual([
      { title: '🖼️  Set Printing', value: 'printing' },
      LANGUAGE_ROW,
      TAGS_ROW,
      ART_ROW,
      CATEGORIES_ROW,
      MOVE_ROW,
      NOTE_ROW,
      REMOVE_ROW,
      CANCEL_ROW,
    ])
  })

  test('edit-action menu without move targets drops only the move row', async () => {
    const menu = await editMenu(wantedStrategy(false, false))
    expect(menu.rows.map((r) => r.value)).toEqual([
      'printing',
      'language',
      'tags',
      'art',
      'categories',
      'note',
      'remove',
      '__CANCEL__',
    ])
  })
})

describe('deck strategy menus', () => {
  test('managerLabel', () => {
    expect(deckStrategy().managerLabel).toBe('deck manager')
  })

  test('the extra session-menu items, in order, with their icons', () => {
    expect(extraRows(deckStrategy())).toEqual([
      { title: '🗂️  Set Target Section (prompt every time)', value: '__SECTION__' },
      { title: '🏷️  Change Format (not set)', value: '__FORMAT__' },
      { title: '🔖 Edit Deck Tags (none)', value: '__TAGS__' },
      { title: '🏷️  Edit List Labels (default: none)', value: '__LIST_LABELS__' },
      ...CATEGORY_MENU_ROWS,
    ])
  })

  test('edit-action menu for a single copy, without move targets', async () => {
    const menu = await editMenu(deckStrategy(1))
    expect(menu.message).toBe('Edit 1 Sol Ring (C21:240) — Main &1:')
    expect(menu.rows).toEqual([
      { title: '🖼️  Change Printing', value: 'printing' },
      { title: '➕ Add a Copy', value: 'add-copy' },
      LANGUAGE_ROW,
      { title: '🏷️  Change Label', value: 'label' },
      TAGS_ROW,
      ART_ROW,
      CATEGORIES_ROW,
      { title: '🗂️  Move to Section', value: 'move' },
      NOTE_ROW,
      { title: '🗑️  Remove Card', value: 'remove-line' },
      CANCEL_ROW,
    ])
  })

  test('a second copy adds the remove-copy row and counts the removal; move targets add move-list', async () => {
    const menu = await editMenu(deckStrategy(2, true))
    expect(menu.message).toBe('Edit 2 Sol Ring (C21:240) — Main &1:')
    expect(menu.rows).toEqual([
      { title: '🖼️  Change Printing', value: 'printing' },
      { title: '➕ Add a Copy', value: 'add-copy' },
      { title: '➖ Remove a Copy', value: 'remove-copy' },
      LANGUAGE_ROW,
      { title: '🏷️  Change Label', value: 'label' },
      TAGS_ROW,
      ART_ROW,
      CATEGORIES_ROW,
      { title: '🗂️  Move to Section', value: 'move' },
      MOVE_ROW,
      NOTE_ROW,
      { title: '🗑️  Remove All Copies (2)', value: 'remove-line' },
      CANCEL_ROW,
    ])
  })
})
