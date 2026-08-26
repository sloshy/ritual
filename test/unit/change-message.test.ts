import { afterEach, describe, expect, test } from 'bun:test'
import {
  changeSegments,
  displayChangeFromEvent,
  displayChangeFromLine,
  formatChange,
  renderChange,
} from '../../src/changes/change-message'
import {
  CHANGE_ACTIONS,
  createAddChange,
  createAddSectionChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createRemoveSectionChange,
  createRenameSectionChange,
  createSetCommanderChange,
  createSetFinishChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  createUnsetCommanderChange,
  formatChangeCore,
  type ChangeEvent,
  type ListRef,
} from '../../src/changes/change-event'
import type { ChangelogAction, ChangelogChange } from '../../src/changes/changelog-parser'
import { loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import { localeTag } from '../../src/i18n/locale-tag'

/**
 * `changeMessage` is the single display renderer for the 21 change actions,
 * replacing the wording `src/site/changelog-format.ts` used to mirror beside
 * `formatChangeCore`. Two properties matter and are both pinned here:
 *
 * 1. Under the default `en` locale it renders **exactly** what the old site
 *    renderer produced (`prefix + cardName + suffix`), so the public site's
 *    changelog modal is byte-for-byte unchanged.
 * 2. It really does follow the active locale — a translated catalog changes the
 *    rendered text — which is what makes the `.changes.md` byte-invariance test
 *    in `test/integration/changelog-locale.test.ts` non-vacuous.
 */

type ChangeOverrides = Partial<ChangelogChange> & { action: ChangelogAction }

function line(overrides: ChangeOverrides): string {
  return renderChange(displayChangeFromLine({ cardName: 'Lightning Bolt', ...overrides }))
}

afterEach(() => {
  resetI18nRuntime()
})

describe('changeMessage — parsed changelog lines', () => {
  test('Added — plain mainboard', () => {
    expect(line({ action: 'Added' })).toBe('Added Lightning Bolt')
  })

  test('Added — with printing annotation', () => {
    expect(line({ action: 'Added', set: 'lea', collectorNumber: '161', finish: 'foil' })).toBe(
      'Added Lightning Bolt (LEA:161) [foil]',
    )
  })

  test('Added — to a non-main board', () => {
    expect(line({ action: 'Added', board: 'Maybeboard' })).toBe(
      'Added Lightning Bolt to Maybeboard',
    )
  })

  test('Removed — from a non-main board', () => {
    expect(line({ action: 'Removed', board: 'Sideboard' })).toBe(
      'Removed Lightning Bolt from Sideboard',
    )
  })

  test('Set / Unset as commander', () => {
    expect(line({ action: 'Set as commander' })).toBe('Set Lightning Bolt as commander')
    expect(line({ action: 'Unset as commander' })).toBe('Unset Lightning Bolt as commander')
  })

  test('Set finish — and its nonfoil default when the line names none', () => {
    expect(line({ action: 'Set finish', finish: 'etched' })).toBe(
      'Set Lightning Bolt finish to etched',
    )
    expect(line({ action: 'Set finish' })).toBe('Set Lightning Bolt finish to nonfoil')
  })

  test('Set printing — descriptor, and the no-printing form', () => {
    expect(
      line({ action: 'Set printing', set: 'm10', collectorNumber: '146', finish: 'foil' }),
    ).toBe('Set Lightning Bolt printing to M10:146 [foil]')
    expect(line({ action: 'Set printing' })).toBe(
      'Set Lightning Bolt printing to no specific printing',
    )
    expect(
      line({ action: 'Set printing', set: 'm10', collectorNumber: '146', language: 'ja' }),
    ).toBe('Set Lightning Bolt printing to M10:146 [ja]')
  })

  test('Added — annotates a non-en language after finish and condition', () => {
    expect(
      line({
        action: 'Added',
        set: 'neo',
        collectorNumber: '234',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
      }),
    ).toBe('Added Lightning Bolt (NEO:234) [foil] [LP] [ja]')
    // en is the bare default and is never annotated.
    expect(line({ action: 'Added', language: 'en' })).toBe('Added Lightning Bolt')
  })

  test('Set language — resolves the code to its name', () => {
    expect(line({ action: 'Set language', language: 'ja' })).toBe(
      'Set language of Lightning Bolt to Japanese',
    )
    // zhs is not a BCP-47 tag, so ICU has no name for it and the frozen English
    // table stands in — the case the Intl.DisplayNames fallback exists for.
    expect(line({ action: 'Set language', language: 'zhs' })).toBe(
      'Set language of Lightning Bolt to Simplified Chinese',
    )
  })

  test('Set note — text, embedded quotes, and the empty-note clear', () => {
    expect(line({ action: 'Set note', note: 'great vs aggro' })).toBe(
      'Set note on Lightning Bolt to "great vs aggro"',
    )
    expect(line({ action: 'Set note', note: 'a "quoted" note' })).toBe(
      'Set note on Lightning Bolt to "a "quoted" note"',
    )
    expect(line({ action: 'Set note', note: '' })).toBe('Cleared note on Lightning Bolt')
    expect(line({ action: 'Cleared note' })).toBe('Cleared note on Lightning Bolt')
  })

  test('Set / Cleared labels', () => {
    expect(line({ action: 'Set labels', labels: ['sale', 'trade'] })).toBe(
      'Set labels on Lightning Bolt to [sale,trade]',
    )
    expect(line({ action: 'Set labels', labels: [] })).toBe('Cleared labels on Lightning Bolt')
    expect(line({ action: 'Cleared labels' })).toBe('Cleared labels on Lightning Bolt')
  })

  test('section-structural lines name no card', () => {
    expect(line({ action: 'Added section', cardName: '', section: 'Foils' })).toBe(
      'Added section "Foils"',
    )
    expect(line({ action: 'Removed section', cardName: '', section: 'Foils' })).toBe(
      'Removed section "Foils"',
    )
    expect(
      line({ action: 'Renamed section', cardName: '', section: 'Foils', newSection: 'Shinies' }),
    ).toBe('Renamed section "Foils" to "Shinies"')
    expect(line({ action: 'Moved to section', section: 'Foils' })).toBe(
      'Moved Lightning Bolt to section "Foils"',
    )
  })
})

describe('changeSegments', () => {
  test('isolates the card name as its own parameter segment', () => {
    const segments = changeSegments(
      displayChangeFromLine({ cardName: 'Sol Ring', action: 'Added', board: 'Sideboard' }),
    )
    expect(segments.filter((s) => s.kind === 'param' && s.name === 'name')).toHaveLength(1)
    expect(segments.map((s) => s.value).join('')).toBe('Added Sol Ring to Sideboard')
  })

  test('a section line has no card-name segment at all', () => {
    const segments = changeSegments(
      displayChangeFromLine({ cardName: '', action: 'Added section', section: 'Foils' }),
    )
    expect(segments.some((s) => s.kind === 'param' && s.name === 'name')).toBe(false)
  })
})

describe('formatChange — pending change events', () => {
  const event = (overrides: Partial<ChangeEvent>): ChangeEvent =>
    ({
      id: 'x',
      timestamp: 0,
      cardName: 'Sol Ring',
      action: 'add',
      ...overrides,
    }) as ChangeEvent

  test('renders the present tense with the card-ID suffix', () => {
    expect(formatChange(event({ action: 'add', cardId: 5 }))).toBe('Add Sol Ring &5')
    expect(formatChange(event({ action: 'remove', board: 'Sideboard' }))).toBe(
      'Remove Sol Ring from Sideboard',
    )
  })

  test('agrees with the persisted past-tense line, modulo tense and quoting', () => {
    const change = event({ action: 'add', set: 'neo', collectorNumber: '234', cardId: 3 })
    expect(renderChange(displayChangeFromEvent(change, 'past'))).toBe('Added Sol Ring (NEO:234) &3')
    expect(formatChangeCore(change, { tense: 'past' })).toBe('Added Sol Ring (NEO:234) &3')
  })

  /**
   * The byte-identity net. `formatChange` used to *be*
   * `formatChangeCore(change, { tense: 'present' })`, so the English catalog
   * reproducing that string exactly — for every action, in both tenses — is
   * what proves the split moved no bytes. A typo in one catalog entry fails
   * here rather than in a screenshot six months from now.
   */
  test('the English catalog reproduces formatChangeCore for every action', () => {
    const list: ListRef = { type: 'deck', name: 'Standard Burn' }
    const events: ChangeEvent[] = [
      createAddChange('Sol Ring', {
        set: 'neo',
        collectorNumber: '234',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        cardId: 1,
      }),
      createAddChange('Sol Ring', { board: 'Sideboard', cardId: 1 }),
      createAddChange('Sol Ring'),
      createRemoveChange('Sol Ring', { board: 'Maybeboard', cardId: 2 }),
      createRemoveChange('Sol Ring', { cardId: 2 }),
      createSetCommanderChange('Avacyn', { cardId: 3 }),
      createUnsetCommanderChange('Avacyn', { cardId: 3 }),
      createSetFinishChange('Sol Ring', { finish: 'etched', cardId: 4 }),
      createSetPrintingChange('Sol Ring', {
        set: 'm10',
        collectorNumber: '146',
        finish: 'foil',
        condition: 'NONE',
        cardId: 4,
      }),
      createSetPrintingChange('Sol Ring', { cardId: 4 }),
      createSetLanguageChange('Sol Ring', { language: 'zhs', cardId: 4 }),
      createSetNoteChange('Sol Ring', { note: 'ramp', cardId: 4 }),
      createSetNoteChange('Sol Ring', { note: '', cardId: 4 }),
      createSetLabelChange('Sol Ring', { labels: ['sale', 'trade'], cardId: 4 }),
      createSetLabelChange('Sol Ring', { labels: [], cardId: 4 }),
      createMoveFromChange('Sol Ring', { set: 'neo', collectorNumber: '234', cardId: 5, to: list }),
      createMoveToChange('Sol Ring', { cardId: 5, from: list }),
      createAddSectionChange('Foils'),
      createRemoveSectionChange('Foils'),
      createRenameSectionChange('Foils', 'Shinies'),
      createSetSectionChange('Sol Ring', 'Foils', 6),
    ]
    // Every action variant is exercised, so a new one cannot slip in untested.
    expect(new Set(events.map((e) => e.action)).size).toBe(CHANGE_ACTIONS.length)

    for (const change of events) {
      expect(formatChange(change)).toBe(formatChangeCore(change, { tense: 'present' }))
      expect(renderChange(displayChangeFromEvent(change, 'past'))).toBe(
        formatChangeCore(change, { tense: 'past' }),
      )
    }
  })
})

describe('changeMessage follows the active locale', () => {
  test('a translated catalog changes the rendered text but not the key', () => {
    loadDictionary(localeTag('xx'), {
      'domain.change.add': {
        $select: 'tense',
        present: 'AJOUTER {name}{annotation}{id}',
        past: 'AJOUTÉ {name}{annotation}{id}',
      },
    })
    setLocale(localeTag('xx'))
    expect(line({ action: 'Added' })).toBe('AJOUTÉ Lightning Bolt')
    // A key the dictionary does not carry still renders, in English.
    expect(line({ action: 'Removed' })).toBe('Removed Lightning Bolt')
  })
})
