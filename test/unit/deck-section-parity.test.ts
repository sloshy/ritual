import { describe, expect, test } from 'bun:test'
import { applyChangeToDeck } from '../../src/changes/deck-changes'
import {
  createSetSectionChange,
  createUnsetCommanderChange,
  type ChangeInput,
  type SetSectionChange,
  type UnsetCommanderChange,
} from '../../src/changes/change-event'
import { parseDeckText } from '../../src/importers/text-file'
import { applyDeckAddToContent, applyTargetedChangesToContent } from '../../src/list/line-mutate'
import type { DeckData } from '../../src/list/deck'

/**
 * The two engines that place deck cards by section — the change reducer
 * (`applyChangeToDeck`, behind the editors, MCP and every replay) and the
 * on-disk line engine (`line-mutate`, behind `add-card`/`set-card`) — must put
 * the same request in the same place. Each case runs one request through both
 * and compares the decks they produce, as the parser reads them.
 */

/** A deck's sections as `[name, ['qty name', …]]`, IDs aside. */
type SectionShape = [string, string[]]

function shape(deck: DeckData): SectionShape[] {
  return deck.sections.map((section) => [
    section.name,
    section.cards.map((card) => `${card.quantity} ${card.name}`),
  ])
}

function parse(content: string): DeckData {
  return parseDeckText(content, 'Deck').deck
}

/** The reducer's deck after `change`, applied to the parsed file. */
function viaReducer(content: string, change: ChangeInput): SectionShape[] {
  return shape(applyChangeToDeck(parse(content), change, { listLabels: undefined }))
}

/** An add of one copy of `name` through both engines. */
function addBoth(
  content: string,
  name: string,
  section?: string,
): [SectionShape[], SectionShape[]] {
  const reducer = viaReducer(content, { action: 'add', cardName: name, section })
  const onDisk = applyDeckAddToContent(content, { name }, 1, { section }).content
  return [reducer, shape(parse(onDisk))]
}

/** A card-targeted placement change through both engines. */
function changeBoth(
  content: string,
  change: SetSectionChange | UnsetCommanderChange,
): [SectionShape[], SectionShape[]] {
  const reducer = viaReducer(content, change)
  const onDisk = applyTargetedChangesToContent(content, 'deck', { name: change.cardName }, [change])
  return [reducer, shape(parse(onDisk))]
}

/** A `set-section` of `cardName` to `section`. */
function setSection(cardName: string, section: string): SetSectionChange {
  return createSetSectionChange(cardName, section)
}

const LEADING = ['1 Sol Ring', '', '## Creatures', '1 Llanowar Elves', ''].join('\n')
const HEADLESS = ['1 Sol Ring', '1 Island', ''].join('\n')

describe('cards above the first heading are the leading Main section in both engines', () => {
  test.each(['Main', 'Deck', 'Mainboard'])('an add to %s joins the leading cards', (section) => {
    const [reducer, onDisk] = addBoth(LEADING, 'Brainstorm', section)
    expect(onDisk).toEqual(reducer)
    expect(onDisk).toEqual([
      ['Main', ['1 Sol Ring', '1 Brainstorm']],
      ['Creatures', ['1 Llanowar Elves']],
    ])
  })

  test.each(['Main', 'Deck'])(
    'an add to %s in a deck with no headings stays headless',
    (section) => {
      const [reducer, onDisk] = addBoth(HEADLESS, 'Brainstorm', section)
      expect(onDisk).toEqual(reducer)
      expect(onDisk).toEqual([['Main', ['1 Sol Ring', '1 Island', '1 Brainstorm']]])
    },
  )

  test('an unqualified add joins the leading cards, not the first heading', () => {
    const [reducer, onDisk] = addBoth(LEADING, 'Brainstorm')
    expect(onDisk).toEqual(reducer)
    expect(onDisk[0]).toEqual(['Main', ['1 Sol Ring', '1 Brainstorm']])
  })

  test('a set-section to Main on a leading card leaves it where it is', () => {
    const [reducer, onDisk] = changeBoth(HEADLESS, setSection('Sol Ring', 'Main'))
    expect(onDisk).toEqual(reducer)
    expect(onDisk).toEqual([['Main', ['1 Sol Ring', '1 Island']]])
  })

  test('a set-section to Deck moves a card into the leading section', () => {
    const [reducer, onDisk] = changeBoth(LEADING, setSection('Llanowar Elves', 'Deck'))
    expect(onDisk).toEqual(reducer)
    expect(onDisk).toEqual([
      ['Main', ['1 Sol Ring', '1 Llanowar Elves']],
      ['Creatures', []],
    ])
  })
})

describe('section requests resolve the same way in both engines', () => {
  const SECTIONS = [
    '## Creatures',
    '1 Llanowar Elves',
    '1 Elvish Mystic',
    '',
    '## Sideboard',
    '1 Duress',
    '',
  ].join('\n')

  test('a set-section that resolves to the card’s own section does not reorder it', () => {
    const [reducer, onDisk] = changeBoth(SECTIONS, setSection('Llanowar Elves', 'creatures'))
    expect(onDisk).toEqual(reducer)
    expect(onDisk[0]).toEqual(['Creatures', ['1 Llanowar Elves', '1 Elvish Mystic']])
  })

  test('Signature Spell does not fold into an Oathbreaker section', () => {
    const deck = ['## Oathbreaker', '1 Wrenn and Six', '', '## Main', '1 Island', ''].join('\n')
    const [reducer, onDisk] = addBoth(deck, 'Lightning Bolt', 'Signature Spell')
    expect(onDisk).toEqual(reducer)
    expect(onDisk).toEqual([
      ['Oathbreaker', ['1 Wrenn and Six']],
      ['Main', ['1 Island']],
      ['Signature Spell', ['1 Lightning Bolt']],
    ])
  })
})

describe('an unqualified add skips every reserved slot in both engines', () => {
  const SLOTS = [
    '## Commander',
    '1 Kenrith',
    '',
    '## Companion',
    '1 Lurrus',
    '',
    '## Creatures',
    '1 Llanowar Elves',
    '',
  ].join('\n')

  test('an add lands in Creatures, past Commander and Companion', () => {
    const [reducer, onDisk] = addBoth(SLOTS, 'Brainstorm')
    expect(onDisk).toEqual(reducer)
    expect(onDisk[2]).toEqual(['Creatures', ['1 Llanowar Elves', '1 Brainstorm']])
  })

  test('a card leaving the command zone lands in Creatures too', () => {
    const [reducer, onDisk] = changeBoth(SLOTS, createUnsetCommanderChange('Kenrith'))
    expect(onDisk).toEqual(reducer)
    expect(onDisk[2]).toEqual(['Creatures', ['1 Llanowar Elves', '1 Kenrith']])
  })

  test('an Oathbreaker section is a reserved slot as well', () => {
    const deck = ['## Oathbreaker', '1 Wrenn and Six', '', '## Spells', '1 Bolt', ''].join('\n')
    const [reducer, onDisk] = addBoth(deck, 'Brainstorm')
    expect(onDisk).toEqual(reducer)
    expect(onDisk[1]).toEqual(['Spells', ['1 Bolt', '1 Brainstorm']])
  })
})
