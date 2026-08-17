import { describe, expect, test } from 'bun:test'
import {
  applyDeckAddToContent,
  applyTargetedChangesToContent,
} from '../../src/commands/line-mutate'
import {
  createRemoveChange,
  createSetCommanderChange,
  createSetFinishChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  createUnsetCommanderChange,
} from '../../src/change-event'
import type { EntryRef } from '../../src/commands/card-target'

/**
 * The line-preserving apply core: only the targeted entry's line may change;
 * every other byte — prose, comments, unusual headings, malformed lines —
 * survives verbatim. Placement of section/commander moves mirrors the editor
 * engine (`deck-changes.ts`).
 */

const proseDeck = [
  '---',
  'name: Prose Deck',
  '---',
  '',
  'Some prose the user wrote under the front matter.',
  '',
  '## Main',
  '4 Lightning Bolt (LEA:161) &1',
  'a note between cards',
  '1 Sol Ring {keep} &2',
  '',
  '## Sideboard',
  '2 Pyroblast &3',
  '',
].join('\n')

const bolt: EntryRef = {
  name: 'Lightning Bolt',
  set: 'lea',
  collectorNumber: '161',
  quantity: 4,
  cardId: 1,
}
const solRing: EntryRef = { name: 'Sol Ring', quantity: 1, cardId: 2 }

describe('applyTargetedChangesToContent', () => {
  test('set-finish rewrites only the target line; prose survives', () => {
    const result = applyTargetedChangesToContent(proseDeck, 'deck', bolt, [
      createSetFinishChange('Lightning Bolt', { finish: 'foil', cardId: 1 }),
    ])
    expect(result).toBe(
      proseDeck.replace('4 Lightning Bolt (LEA:161) &1', '4 Lightning Bolt (LEA:161) [foil] &1'),
    )
  })

  test('set-printing followed by set-section moves the rewritten line', () => {
    const result = applyTargetedChangesToContent(proseDeck, 'deck', bolt, [
      createSetPrintingChange('Lightning Bolt', {
        set: '2xm',
        collectorNumber: '117',
        cardId: 1,
      }),
      createSetSectionChange('Lightning Bolt', 'Sideboard', 1),
    ])
    const lines = result.split('\n')
    expect(lines).toContain('4 Lightning Bolt (2XM:117) &1')
    // Moved to the end of the Sideboard block, after its existing card.
    expect(lines.indexOf('4 Lightning Bolt (2XM:117) &1')).toBe(lines.indexOf('2 Pyroblast &3') + 1)
    // The prose lines are untouched.
    expect(result).toContain('Some prose the user wrote under the front matter.')
    expect(result).toContain('a note between cards')
  })

  test('set-section creates a missing section at the end', () => {
    const result = applyTargetedChangesToContent(proseDeck, 'deck', solRing, [
      createSetSectionChange('Sol Ring', 'Maybeboard', 2),
    ])
    const lines = result.split('\n')
    const heading = lines.indexOf('## Maybeboard')
    expect(heading).toBeGreaterThan(lines.indexOf('## Sideboard'))
    expect(lines[heading + 1]).toBe('1 Sol Ring {keep} &2')
  })

  test('set-section is idempotent when the card is already there', () => {
    const result = applyTargetedChangesToContent(proseDeck, 'deck', solRing, [
      createSetSectionChange('Sol Ring', 'Main', 2),
    ])
    expect(result).toBe(proseDeck)
  })

  test('set-commander creates the Commander section in front of the others', () => {
    const result = applyTargetedChangesToContent(proseDeck, 'deck', solRing, [
      createSetCommanderChange('Sol Ring', { cardId: 2 }),
    ])
    const lines = result.split('\n')
    const commander = lines.indexOf('## Commander')
    expect(commander).toBeGreaterThan(-1)
    expect(commander).toBeLessThan(lines.indexOf('## Main'))
    expect(lines[commander + 1]).toBe('1 Sol Ring {keep} &2')
    // Prose above the first heading stays above the new Commander section.
    expect(lines.indexOf('Some prose the user wrote under the front matter.')).toBeLessThan(
      commander,
    )
  })

  test('unset-commander moves the card to the first non-commander/non-sideboard section', () => {
    const withCommander = proseDeck.replace(
      '## Main',
      '## Commander\n1 Atraxa, Praetors’ Voice &4\n\n## Main',
    )
    const atraxa: EntryRef = { name: 'Atraxa, Praetors’ Voice', quantity: 1, cardId: 4 }
    const result = applyTargetedChangesToContent(withCommander, 'deck', atraxa, [
      createUnsetCommanderChange('Atraxa, Praetors’ Voice', { cardId: 4 }),
    ])
    const lines = result.split('\n')
    const moved = lines.indexOf('1 Atraxa, Praetors’ Voice &4')
    expect(moved).toBeGreaterThan(lines.indexOf('## Main'))
    expect(moved).toBeLessThan(lines.indexOf('## Sideboard'))
    // Placed after the last card line of Main.
    expect(lines[moved - 1]).toBe('1 Sol Ring {keep} &2')
  })

  test('deck remove decrements quantity per event and deletes the line at zero', () => {
    const decremented = applyTargetedChangesToContent(proseDeck, 'deck', bolt, [
      createRemoveChange('Lightning Bolt', { cardId: 1 }),
    ])
    expect(decremented).toContain('3 Lightning Bolt (LEA:161) &1')
    expect(decremented).toContain('a note between cards')

    const removed = applyTargetedChangesToContent(proseDeck, 'deck', bolt, [
      createRemoveChange('Lightning Bolt', { cardId: 1 }),
      createRemoveChange('Lightning Bolt', { cardId: 1 }),
      createRemoveChange('Lightning Bolt', { cardId: 1 }),
      createRemoveChange('Lightning Bolt', { cardId: 1 }),
    ])
    expect(removed).not.toContain('Lightning Bolt')
    expect(removed).toContain('a note between cards')
  })

  test('collection updates preserve prose and custom heading levels', () => {
    const binder = [
      '# Trade Binder',
      '',
      'Some prose about my binder.',
      '',
      '## Page 1',
      '- Sol Ring (C21:263) &1',
      '### keep sorted',
      '- Mana Crypt (2XM:1) [foil] &2',
      '',
    ].join('\n')
    const crypt: EntryRef = {
      name: 'Mana Crypt',
      set: '2xm',
      collectorNumber: '1',
      finish: 'foil',
      cardId: 2,
    }
    const result = applyTargetedChangesToContent(binder, 'collection', crypt, [
      createSetNoteChange('Mana Crypt', { note: 'grade this', cardId: 2 }),
    ])
    expect(result).toContain('- Mana Crypt (2XM:1) [foil] {grade this} &2')
    expect(result).toContain('Some prose about my binder.')
    expect(result).toContain('### keep sorted')
  })

  test('wanted remove deletes only the target line', () => {
    const wants =
      '# Wants\n\n- Demonic Tutor &1\nTODO: check prices\n- Underground Sea (LEB:286) &2\n'
    const tutor: EntryRef = { name: 'Demonic Tutor', cardId: 1 }
    const result = applyTargetedChangesToContent(wants, 'wanted', tutor, [
      createRemoveChange('Demonic Tutor', { cardId: 1 }),
    ])
    expect(result).toBe('# Wants\n\nTODO: check prices\n- Underground Sea (LEB:286) &2\n')
  })

  test('a YAML `#` comment in front matter is never mistaken for a section heading', () => {
    // Regression: deckHeadings used to scan the front matter, so a commander
    // move could splice the card line INTO the YAML block.
    const withComment = proseDeck.replace(
      'name: Prose Deck',
      '# imported from Archidekt\nname: Prose Deck',
    )
    const result = applyTargetedChangesToContent(withComment, 'deck', solRing, [
      createSetCommanderChange('Sol Ring', { cardId: 2 }),
    ])
    const lines = result.split('\n')
    const commander = lines.indexOf('## Commander')
    expect(commander).toBeGreaterThan(lines.indexOf('---', 1))
    expect(lines[commander + 1]).toBe('1 Sol Ring {keep} &2')
    // Front matter is byte-identical.
    expect(result.startsWith('---\n# imported from Archidekt\nname: Prose Deck\n---\n')).toBe(true)
  })

  test('a leading `# Title` H1 with no cards is the document title, not a section', () => {
    // parseDeckText folds such an H1 into the synthetic Main bucket; a
    // commander move must create its section after the title, not above it.
    const withTitle = proseDeck.replace(
      'Some prose the user wrote under the front matter.',
      '# My Commander Deck\n\nSome prose the user wrote under the front matter.',
    )
    const result = applyTargetedChangesToContent(withTitle, 'deck', solRing, [
      createSetCommanderChange('Sol Ring', { cardId: 2 }),
    ])
    const lines = result.split('\n')
    const commander = lines.indexOf('## Commander')
    // Created before the first real section, below the title and its prose —
    // and the commander-ish title text is NOT treated as the commander section.
    expect(commander).toBeGreaterThan(lines.indexOf('# My Commander Deck'))
    expect(commander).toBeLessThan(lines.indexOf('## Main'))
    expect(lines[commander + 1]).toBe('1 Sol Ring {keep} &2')
  })

  test('unset-commander is a no-op for a card outside the commander section', () => {
    // Mirrors the engine: a Sideboard card is already the requested end state.
    const pyroblast: EntryRef = { name: 'Pyroblast', quantity: 2, cardId: 3 }
    const result = applyTargetedChangesToContent(proseDeck, 'deck', pyroblast, [
      createUnsetCommanderChange('Pyroblast', { cardId: 3 }),
    ])
    expect(result).toBe(proseDeck)
  })

  test('set-commander pushes onto an existing commander section and is idempotent there', () => {
    const withCommander = proseDeck.replace(
      '## Main',
      '## Commander\n1 Atraxa, Praetors’ Voice &4\n\n## Main',
    )
    const moved = applyTargetedChangesToContent(withCommander, 'deck', solRing, [
      createSetCommanderChange('Sol Ring', { cardId: 2 }),
    ])
    const lines = moved.split('\n')
    expect(lines.indexOf('1 Sol Ring {keep} &2')).toBe(
      lines.indexOf('1 Atraxa, Praetors’ Voice &4') + 1,
    )
    // Already in Commander → byte-identical no-op.
    const atraxa: EntryRef = { name: 'Atraxa, Praetors’ Voice', quantity: 1, cardId: 4 }
    expect(
      applyTargetedChangesToContent(withCommander, 'deck', atraxa, [
        createSetCommanderChange('Atraxa, Praetors’ Voice', { cardId: 4 }),
      ]),
    ).toBe(withCommander)
  })

  test('set-section inserts directly under an existing empty section heading', () => {
    const withEmpty = proseDeck.replace('## Sideboard', '## Maybeboard\n\n## Sideboard')
    const result = applyTargetedChangesToContent(withEmpty, 'deck', solRing, [
      createSetSectionChange('Sol Ring', 'Maybeboard', 2),
    ])
    const lines = result.split('\n')
    expect(lines[lines.indexOf('## Maybeboard') + 1]).toBe('1 Sol Ring {keep} &2')
  })

  test('flat structural matching without a cardId narrows by printing and keeps the line id', () => {
    const binder = '# Binder\n\n- Sol Ring (LEA:270) &1\n- Sol Ring (C21:263) &2\n'
    const target: EntryRef = { name: 'Sol Ring', set: 'c21', collectorNumber: '263' }
    const result = applyTargetedChangesToContent(binder, 'collection', target, [
      createSetFinishChange('Sol Ring', { finish: 'foil' }),
    ])
    expect(result).toBe('# Binder\n\n- Sol Ring (LEA:270) &1\n- Sol Ring (C21:263) [foil] &2\n')
  })

  test('deck decrement trusts the line quantity and preserves indentation', () => {
    const indented = '## Main\n  4 Lightning Bolt (LEA:161) &1\n'
    // Stale target claims 2 copies; the line says 4 — removing 1 must yield 3.
    const stale: EntryRef = { ...bolt, quantity: 2 }
    const result = applyTargetedChangesToContent(indented, 'deck', stale, [
      createRemoveChange('Lightning Bolt', { cardId: 1 }),
    ])
    expect(result).toBe('## Main\n  3 Lightning Bolt (LEA:161) &1\n')
  })

  test('an unhandled change kind throws rather than applying partially', () => {
    const add = { ...createRemoveChange('Sol Ring', { cardId: 2 }), action: 'add' as const }
    expect(() => applyTargetedChangesToContent(proseDeck, 'deck', solRing, [add as never])).toThrow(
      "does not handle 'add'",
    )
  })

  test('a vanished target line throws without altering anything', () => {
    expect(() =>
      applyTargetedChangesToContent(proseDeck, 'deck', { name: 'Ghost Card', cardId: 99 }, [
        createSetFinishChange('Ghost Card', { finish: 'foil', cardId: 99 }),
      ]),
    ).toThrow('Card line no longer present in file')
  })

  test('structural matching works without a cardId, narrowing by printing', () => {
    const noIdTarget: EntryRef = {
      name: 'Lightning Bolt',
      set: 'lea',
      collectorNumber: '161',
      quantity: 4,
    }
    const result = applyTargetedChangesToContent(proseDeck, 'deck', noIdTarget, [
      createSetFinishChange('Lightning Bolt', { finish: 'etched' }),
    ])
    expect(result).toContain('4 Lightning Bolt (LEA:161) [etched] &1')
  })
})

/**
 * The deck-add core: the same placement and merge rules as the editor engine
 * (`deck-changes.ts`), applied line-preservingly to markdown.
 */
describe('applyDeckAddToContent', () => {
  const mainboardDeck = [
    '---',
    'name: Mainboard Deck',
    '---',
    '',
    '## Mainboard',
    '1 Mana Crypt &1',
    '2 Sol Ring &2',
    '',
    '## Sideboard',
    '1 Pyroblast &3',
    '',
  ].join('\n')

  test('merges copies onto the existing line for the same card and printing', () => {
    const { content, outcome } = applyDeckAddToContent(mainboardDeck, { name: 'Sol Ring' }, 3)
    expect(content).toContain('5 Sol Ring &2')
    expect(content).not.toContain('3 Sol Ring')
    expect(outcome).toEqual({ cardId: 2, quantity: 5, section: 'Mainboard', merged: true })
  })

  test("a merge keeps the destination line's note, which is not part of its printing", () => {
    // Notes are outside `isSamePrinting`, so an annotated line is a valid merge
    // target — and rebuilding it from the incoming card would silently delete
    // text the user wrote.
    const noted = ['## Main', '2 Sol Ring (LEA:270) {my pet card} &2', ''].join('\n')
    const { content, outcome } = applyDeckAddToContent(
      noted,
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270' },
      1,
    )
    expect(content).toContain('3 Sol Ring (LEA:270) {my pet card} &2')
    expect(outcome).toEqual({ cardId: 2, quantity: 3, section: 'Main', merged: true })
  })

  test('a proxy add never merges onto the line holding the real copies', () => {
    // Labels are part of what the copies *are*: folding them together would
    // either lose the `[proxy]` or hand it to cards that are not proxies.
    const { content, outcome } = applyDeckAddToContent(
      mainboardDeck,
      { name: 'Sol Ring', labels: ['proxy'] },
      1,
    )
    expect(content).toContain('2 Sol Ring &2')
    expect(content).toContain('1 Sol Ring [proxy] &4')
    expect(outcome).toEqual({ cardId: 4, quantity: 1, section: 'Mainboard', merged: false })
  })

  test('a real add never merges onto a proxy line', () => {
    const proxied = ['## Main', '2 Sol Ring (LEA:270) [proxy] &1', ''].join('\n')
    const { content, outcome } = applyDeckAddToContent(
      proxied,
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270' },
      1,
    )
    expect(content).toContain('2 Sol Ring (LEA:270) [proxy] &1')
    expect(content).toContain('1 Sol Ring (LEA:270) &2')
    expect(outcome.merged).toBe(false)
  })

  test('copies with the same override do merge', () => {
    const proxied = ['## Main', '2 Sol Ring (LEA:270) [proxy] &1', ''].join('\n')
    const { content, outcome } = applyDeckAddToContent(
      proxied,
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270', labels: ['proxy'] },
      2,
    )
    expect(content).toContain('4 Sol Ring (LEA:270) [proxy] &1')
    expect(outcome).toEqual({ cardId: 1, quantity: 4, section: 'Main', merged: true })
  })

  test('a merge onto a line with no &N allocates one rather than reporting none', () => {
    // Reachable under --dry-run, which deliberately skips the ID backfill.
    const idLess = ['## Main', '1 Sol Ring (LEA:270)', ''].join('\n')
    const { content, outcome } = applyDeckAddToContent(
      idLess,
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270' },
      3,
    )
    expect(content).toContain('4 Sol Ring (LEA:270) &1')
    expect(outcome.cardId).toBe(1)
  })

  test('refuses a copy count below one rather than reporting an unallocated id', () => {
    expect(() => applyDeckAddToContent(mainboardDeck, { name: 'Sol Ring' }, 0)).toThrow(
      /at least one copy/,
    )
  })

  test('a different printing of the same card becomes its own line', () => {
    const { content, outcome } = applyDeckAddToContent(
      mainboardDeck,
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263' },
      1,
    )
    expect(content).toContain('2 Sol Ring &2')
    expect(content).toContain('1 Sol Ring (C21:263) &4')
    expect(outcome.merged).toBe(false)
  })

  test('a new card appends at the end of the first regular section, creating no ## Main', () => {
    const { content, outcome } = applyDeckAddToContent(mainboardDeck, { name: 'Brainstorm' }, 1)
    expect(content).not.toContain('## Main\n')
    expect(outcome.section).toBe('Mainboard')
    const lines = content.split('\n')
    expect(lines[lines.indexOf('2 Sol Ring &2') + 1]).toBe('1 Brainstorm &4')
  })

  test('--section places the card in a named section, created at the end when missing', () => {
    const { content, outcome } = applyDeckAddToContent(mainboardDeck, { name: 'Brainstorm' }, 1, {
      section: 'Maybeboard',
    })
    expect(outcome.section).toBe('Maybeboard')
    expect(content.trimEnd().endsWith('## Maybeboard\n1 Brainstorm &4')).toBe(true)
    // Exactly one blank line separates the created section from what precedes it.
    expect(content).toContain('1 Pyroblast &3\n\n## Maybeboard')
  })

  test('--commander creates the Commander section in front of the others', () => {
    const { content, outcome } = applyDeckAddToContent(
      mainboardDeck,
      { name: 'Kenrith, the Returned King' },
      1,
      { commander: true },
    )
    expect(outcome.section).toBe('Commander')
    expect(content.indexOf('## Commander')).toBeLessThan(content.indexOf('## Mainboard'))
    expect(content).toContain('1 Kenrith, the Returned King &4')
  })

  test('annotations and the allocated id land on the new line', () => {
    const { content, outcome } = applyDeckAddToContent(
      mainboardDeck,
      {
        name: 'Lightning Bolt',
        set: 'sta',
        collectorNumber: '42',
        finish: 'foil',
        condition: 'LP',
      },
      2,
    )
    expect(content).toContain('2 Lightning Bolt (STA:42) [foil] [LP] &4')
    expect(outcome).toEqual({ cardId: 4, quantity: 2, section: 'Mainboard', merged: false })
  })

  test('reuses an id freed by a removal before allocating a new one', () => {
    const gapDeck = ['## Main', '1 Mana Crypt &1', '1 Sol Ring &3', ''].join('\n')
    const { outcome } = applyDeckAddToContent(gapDeck, { name: 'Brainstorm' }, 1)
    expect(outcome.cardId).toBe(2)
  })

  test('a headless deck body keeps one section instead of gaining a ## Main', () => {
    const headless = ['1 Mana Crypt &1', ''].join('\n')
    const { content } = applyDeckAddToContent(headless, { name: 'Brainstorm' }, 1)
    expect(content).not.toContain('## Main')
    expect(content).toContain('1 Mana Crypt &1\n1 Brainstorm &2')
  })

  test('leaves every other byte of the file untouched', () => {
    const { content } = applyDeckAddToContent(proseDeck, { name: 'Brainstorm' }, 1)
    expect(content).toContain('Some prose the user wrote under the front matter.')
    expect(content).toContain('a note between cards')
    expect(content).toContain('1 Sol Ring {keep} &2')
  })
})

describe('fenced code blocks are never mutation targets', () => {
  const fencedDeck = [
    '---',
    'name: Fenced Deck',
    '---',
    '',
    '## Main',
    '1 Sol Ring &1',
    '',
    'Example of a deck file:',
    '',
    '```',
    '## Fake Section',
    '9 Sol Ring &7',
    '1 Black Lotus (LEA:232) &8',
    '```',
    '',
    '## Sideboard',
    '1 Pyroblast &3',
    '',
  ].join('\n')

  /** The fenced block, exactly as authored — nothing below may alter these bytes. */
  const fencedBlock = [
    '```',
    '## Fake Section',
    '9 Sol Ring &7',
    '1 Black Lotus (LEA:232) &8',
    '```',
  ].join('\n')

  test('an add merges onto the real line, not the fenced one', () => {
    const { content, outcome } = applyDeckAddToContent(fencedDeck, { name: 'Sol Ring' }, 2)
    expect(outcome.merged).toBe(true)
    expect(outcome.quantity).toBe(3)
    expect(outcome.section).toBe('Main')
    expect(content).toContain(fencedBlock)
    expect(content.split('\n')).toContain('3 Sol Ring &1')
  })

  test('an add for a card that only exists inside the fence creates a new line outside it', () => {
    const { content, outcome } = applyDeckAddToContent(
      fencedDeck,
      { name: 'Black Lotus', set: 'lea', collectorNumber: '232' },
      1,
    )
    expect(outcome.merged).toBe(false)
    expect(outcome.section).toBe('Main')
    expect(content).toContain(fencedBlock)
    const lines = content.split('\n')
    // Appended after Main's last real card line, not after the fenced one.
    // &2 — the fenced example's ids are prose, so only &1 and &3 were in use.
    expect(lines.indexOf('1 Black Lotus (LEA:232) &2')).toBe(lines.indexOf('1 Sol Ring &1') + 1)
  })

  test('a set-note targets the real line and leaves the fenced block byte-identical', () => {
    const result = applyTargetedChangesToContent(
      fencedDeck,
      'deck',
      { name: 'Sol Ring', cardId: 1 },
      [createSetNoteChange('Sol Ring', { note: 'keep', cardId: 1 })],
    )
    expect(result).toContain(fencedBlock)
    expect(result.split('\n')).toContain('1 Sol Ring {keep} &1')
  })

  test('a remove for a card that exists only inside the fence has no target', () => {
    expect(() =>
      applyTargetedChangesToContent(fencedDeck, 'deck', { name: 'Black Lotus', cardId: 8 }, [
        createRemoveChange('Black Lotus', { cardId: 8 }),
      ]),
    ).toThrow('no longer present')
  })

  test('an add refuses when the deck ends inside an unclosed fence', () => {
    // An unclosed fence runs to end of file, so the appended `## Main` + card
    // line would be prose: written and changelogged, then invisible.
    const openFenced = ['---', 'name: Open', '---', '', '```', '## Example', ''].join('\n')
    expect(() => applyDeckAddToContent(openFenced, { name: 'Sol Ring' }, 1)).toThrow(
      'unclosed code fence',
    )
  })

  test('a fenced `## Heading` is not a section a move can land in', () => {
    const result = applyTargetedChangesToContent(
      fencedDeck,
      'deck',
      { name: 'Sol Ring', cardId: 1 },
      [createSetSectionChange('Sol Ring', 'Fake Section', 1)],
    )
    expect(result).toContain(fencedBlock)
    const lines = result.split('\n')
    // A real `## Fake Section` was created at the end of the file instead.
    expect(lines.lastIndexOf('## Fake Section')).toBeGreaterThan(lines.indexOf('## Sideboard'))
    expect(lines[lines.lastIndexOf('## Fake Section') + 1]).toBe('1 Sol Ring &1')
  })
})

describe('applyTargetedChangesToContent — labels', () => {
  const labeledCollection = [
    '# Binder',
    '',
    '## Main',
    '- Lightning Bolt (LEA:161) [foil] [keep] {my first rare} &1',
    '- Sol Ring (C21:263) &2',
    '',
  ].join('\n')

  test('set-label rewrites only the targeted line', () => {
    const result = applyTargetedChangesToContent(
      labeledCollection,
      'collection',
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
      [createSetLabelChange('Sol Ring', { labels: ['sale', 'trade'], cardId: 2 })],
    )
    expect(result).toContain('- Sol Ring (C21:263) [sale,trade] &2')
    expect(result).toContain('- Lightning Bolt (LEA:161) [foil] [keep] {my first rare} &1')
  })

  test('an empty label set clears the token', () => {
    const result = applyTargetedChangesToContent(
      labeledCollection,
      'collection',
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        note: 'my first rare',
        cardId: 1,
      },
      [createSetLabelChange('Lightning Bolt', { labels: [], cardId: 1 })],
    )
    expect(result).toContain('- Lightning Bolt (LEA:161) [foil] {my first rare} &1')
  })

  test('a note edit on a target resolved without labels preserves the line token', () => {
    // The target carries no labels (a structurally-resolved EntryRef predating
    // the token, say) — the rewrite must adopt the line's token, not strip it.
    const result = applyTargetedChangesToContent(
      labeledCollection,
      'collection',
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', finish: 'foil' },
      [createSetNoteChange('Lightning Bolt', { note: 'signed' })],
    )
    expect(result).toContain('- Lightning Bolt (LEA:161) [foil] [keep] {signed} &1')
  })

  test('set-label writes the deck line token, keeping &N last', () => {
    const result = applyTargetedChangesToContent(proseDeck, 'deck', bolt, [
      createSetLabelChange('Lightning Bolt', { labels: ['proxy'], cardId: 1 }),
    ])
    expect(result).toContain('4 Lightning Bolt (LEA:161) [proxy] &1')
  })

  test('an empty label set clears the deck line token', () => {
    const labeled = proseDeck.replace(
      '4 Lightning Bolt (LEA:161) &1',
      '4 Lightning Bolt (LEA:161) [proxy] &1',
    )
    const result = applyTargetedChangesToContent(labeled, 'deck', bolt, [
      createSetLabelChange('Lightning Bolt', { labels: [], cardId: 1 }),
    ])
    expect(result).toContain('4 Lightning Bolt (LEA:161) &1')
    expect(result).not.toContain('[proxy]')
  })

  test('a language edit on a labeled deck line preserves its token', () => {
    const labeled = proseDeck.replace(
      '4 Lightning Bolt (LEA:161) &1',
      '4 Lightning Bolt (LEA:161) [proxy] &1',
    )
    const result = applyTargetedChangesToContent(labeled, 'deck', bolt, [
      createSetLanguageChange('Lightning Bolt', { language: 'ja', cardId: 1 }),
    ])
    expect(result).toContain('4 Lightning Bolt (LEA:161) [ja] [proxy] &1')
  })

  test('set-label refuses a label the deck grammar cannot carry', () => {
    expect(() =>
      applyTargetedChangesToContent(proseDeck, 'deck', bolt, [
        createSetLabelChange('Lightning Bolt', { labels: ['sale'], cardId: 1 }),
      ]),
    ).toThrow('labels [sale] are not supported on a deck')
  })

  test('set-label on a wanted list throws — the clear included', () => {
    // The shared decision refuses an empty set on a label-less type too: there
    // is no override there to clear.
    const wanted = '# Wants\n\n- Sol Ring (C21:263) &1\n'
    for (const labels of [['proxy'] as const, [] as const]) {
      expect(() =>
        applyTargetedChangesToContent(
          wanted,
          'wanted',
          { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
          [createSetLabelChange('Sol Ring', { labels: [...labels], cardId: 1 })],
        ),
      ).toThrow('labels do not apply to a wanted')
    }
  })

  test('set-label repairs a line whose token the parser refuses', () => {
    // The one change that owns the token: refusing here would leave a bad
    // token unrepairable by the very command that replaces it.
    const conflicted = '# Binder\n\n## Main\n- Sol Ring (C21:263) [sale,keep] &1\n'
    const result = applyTargetedChangesToContent(
      conflicted,
      'collection',
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
      [createSetLabelChange('Sol Ring', { labels: ['keep'], cardId: 1 })],
    )
    expect(result).toContain('- Sol Ring (C21:263) [keep] &1')
    expect(result).not.toContain('[sale,keep]')
  })

  test('a decrement refuses a line whose labels token the parser refuses', () => {
    // The decrement rewrites the line, so it would delete the token — the same
    // silent loss every other rewrite refuses.
    const conflicted = '## Main\n2 Sol Ring (LEA:270) [sale,keep] &1\n'
    expect(() =>
      applyTargetedChangesToContent(
        conflicted,
        'deck',
        { name: 'Sol Ring', set: 'lea', collectorNumber: '270', cardId: 1 },
        [createRemoveChange('Sol Ring', { cardId: 1 })],
      ),
    ).toThrow('conflicting labels token [sale,keep]')
  })

  test('a decrement keeps a legal labels token', () => {
    const labeled = '## Main\n2 Sol Ring (LEA:270) [proxy] &1\n'
    const result = applyTargetedChangesToContent(
      labeled,
      'deck',
      { name: 'Sol Ring', set: 'lea', collectorNumber: '270', cardId: 1 },
      [createRemoveChange('Sol Ring', { cardId: 1 })],
    )
    expect(result).toContain('1 Sol Ring (LEA:270) [proxy] &1')
  })

  test('a conflicting labels token on the target line refuses the rewrite', () => {
    // `[sale,keep]` matches the token grammar but fails keep-exclusivity, so a
    // rewrite would silently drop it — the mutation must refuse instead.
    const conflicted = '# Binder\n\n## Main\n- Sol Ring (C21:263) [sale,keep] &1\n'
    expect(() =>
      applyTargetedChangesToContent(
        conflicted,
        'collection',
        { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
        [createSetNoteChange('Sol Ring', { note: 'signed', cardId: 1 })],
      ),
    ).toThrow('conflicting labels token [sale,keep]')
  })

  test('a collection edit never targets a card line inside the front matter', () => {
    // The YAML sequence item below trims to a byte-for-byte card line; the real
    // entry sits in the body. The edit must land on the body line, not the block.
    const withBlock = [
      '---',
      'examples:',
      '  - Sol Ring (C21:263) &1',
      '---',
      '',
      '# Binder',
      '',
      '## Main',
      '- Sol Ring (C21:263) &1',
      '',
    ].join('\n')
    const result = applyTargetedChangesToContent(
      withBlock,
      'collection',
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 1 },
      [createSetNoteChange('Sol Ring', { note: 'signed', cardId: 1 })],
    )
    expect(result).toContain('  - Sol Ring (C21:263) &1')
    expect(result).toContain('\n- Sol Ring (C21:263) {signed} &1')
  })
})

describe('applyTargetedChangesToContent — language token', () => {
  const languageCollection = [
    '# Binder',
    '',
    '## Main',
    '- Lightning Bolt (LEA:161) [foil] [ja] [keep] {my first rare} &1',
    '- Sol Ring (C21:263) [zhs] &2',
    '',
  ].join('\n')

  test('a note edit adopts the line language, so [ja] survives the rewrite', () => {
    const result = applyTargetedChangesToContent(
      languageCollection,
      'collection',
      { name: 'Lightning Bolt', set: 'lea', collectorNumber: '161', finish: 'foil' },
      [createSetNoteChange('Lightning Bolt', { note: 'signed' })],
    )
    expect(result).toContain('- Lightning Bolt (LEA:161) [foil] [ja] [keep] {signed} &1')
  })

  test('set-finish preserves the language token', () => {
    const result = applyTargetedChangesToContent(
      languageCollection,
      'collection',
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
      [createSetFinishChange('Sol Ring', { finish: 'foil', cardId: 2 })],
    )
    expect(result).toContain('- Sol Ring (C21:263) [foil] [zhs] &2')
  })

  test('set-printing preserves the language token', () => {
    const result = applyTargetedChangesToContent(
      languageCollection,
      'collection',
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
      [
        createSetPrintingChange('Sol Ring', {
          set: 'ltc',
          collectorNumber: '284',
          finish: 'nonfoil',
          cardId: 2,
        }),
      ],
    )
    expect(result).toContain('- Sol Ring (LTC:284) [zhs] &2')
  })

  test('the labels group still reads correctly alongside a language token', () => {
    const result = applyTargetedChangesToContent(
      languageCollection,
      'collection',
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        note: 'my first rare',
      },
      [createSetLabelChange('Lightning Bolt', { labels: ['sale'], cardId: 1 })],
    )
    expect(result).toContain('- Lightning Bolt (LEA:161) [foil] [ja] [sale] {my first rare} &1')
  })

  test('deck edits preserve a [ja] token through a note edit', () => {
    const deck = ['## Main', '2 Sol Ring (LTC:284) [foil] [ja] &1', ''].join('\n')
    const result = applyTargetedChangesToContent(
      deck,
      'deck',
      { name: 'Sol Ring', set: 'ltc', collectorNumber: '284', finish: 'foil', quantity: 2 },
      [createSetNoteChange('Sol Ring', { note: 'gift' })],
    )
    expect(result).toContain('2 Sol Ring (LTC:284) [foil] [ja] {gift} &1')
  })

  test('a deck add never merges an English copy onto a [ja] line', () => {
    const deck = ['## Main', '1 Sol Ring (LTC:284) [ja] &1', ''].join('\n')
    const { content, outcome } = applyDeckAddToContent(
      deck,
      { name: 'Sol Ring', set: 'ltc', collectorNumber: '284' },
      1,
    )
    expect(outcome.merged).toBe(false)
    expect(content).toContain('1 Sol Ring (LTC:284) [ja] &1')
    expect(content).toContain('1 Sol Ring (LTC:284) &2')
  })

  test('a deck add merges a [ja] copy onto the matching [ja] line, keeping the token', () => {
    const deck = ['## Main', '1 Sol Ring (LTC:284) [ja] {gift} &1', ''].join('\n')
    const { content, outcome } = applyDeckAddToContent(
      deck,
      { name: 'Sol Ring', set: 'ltc', collectorNumber: '284', language: 'ja' },
      1,
    )
    expect(outcome.merged).toBe(true)
    expect(content).toContain('2 Sol Ring (LTC:284) [ja] {gift} &1')
  })

  test('set-language stamps a [ja] token at its canonical slot', () => {
    const result = applyTargetedChangesToContent(
      languageCollection,
      'collection',
      {
        name: 'Lightning Bolt',
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        note: 'my first rare',
        cardId: 1,
      },
      [createSetLanguageChange('Lightning Bolt', { language: 'de', cardId: 1 })],
    )
    expect(result).toContain('- Lightning Bolt (LEA:161) [foil] [de] [keep] {my first rare} &1')
  })

  test('set-language to en clears the token (bare line means English)', () => {
    const result = applyTargetedChangesToContent(
      languageCollection,
      'collection',
      { name: 'Sol Ring', set: 'c21', collectorNumber: '263', cardId: 2 },
      [createSetLanguageChange('Sol Ring', { language: 'en', cardId: 2 })],
    )
    expect(result).toContain('- Sol Ring (C21:263) &2')
    expect(result).not.toContain('[zhs]')
  })
})
