import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { appendChangelog } from '../../src/changes/changelog-writer'
import { parseChangelog } from '../../src/changes/changelog-parser'
import {
  createAddChange,
  createAddSectionChange,
  createAddTagChange,
  createMoveFromChange,
  createMoveToChange,
  createRemoveChange,
  createRemoveSectionChange,
  createRemoveTagChange,
  createRenameCategoryChange,
  createRenameSectionChange,
  createSetCategoriesChange,
  createSetCategoryOrderChange,
  createSetCommanderChange,
  createSetFinishChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  createUnsetCommanderChange,
  type ChangeAction,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { formatChangelogLine, parseChangeSets } from '../../src/changes/changelog-blocks'
import { encodeChangeEvent } from '../../src/changes/change-event-decode'
import { formatChange } from '../../src/changes/change-message'
import { buildDefaultChangeLines } from '../../src/changes/list-snapshot'
import { en } from '../../src/i18n/messages/en'
import { enMeta } from '../../src/i18n/messages/en.meta'
import { loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import { PSEUDO_LOCALE, pseudoLocalize } from '../../scripts/generate-locales'
import { localeTag } from '../../src/i18n/locale-tag'
import { languageLabel } from '../../src/card/card-language'
import type { LocaleTag } from '../../src/i18n/types'

/**
 * **The regression this file exists for would destroy user data silently.**
 *
 * `.changes.md` is a data format, not prose. Its prose lines are the
 * git-diffable human record, written in English by construction (`Added` /
 * `Removed` / `Set` / `Unset`, English language names); its fenced
 * `ritual-changes` block is what `changelog-parser.ts` machine-reads. If a
 * localized string ever reached `appendChangelog`, the file would diverge
 * between collaborators, and `.sha256` sidecars hash the exact bytes, so the
 * corruption would also read as a spurious edit on every machine with a
 * different locale.
 *
 * So: perform the mutations under the generated `en-XA` pseudo-locale and
 * assert the written bytes are identical to the `en` run, and that the block
 * still round-trips through the parser. The pseudo-locale is built in-process from the English
 * catalog (the same function `scripts/generate-locales.ts` uses), so this test
 * needs no build artifact and can never drift from the shipped catalog.
 */

const pseudoCatalog = pseudoLocalize(en, enMeta)

/** A change set across the common line shapes; the full set is pinned in the last describe. */
function changeSet(): ChangeEvent[] {
  return [
    createAddSectionChange('Foils'),
    createAddChange('Lightning Bolt', {
      set: 'lea',
      collectorNumber: '161',
      finish: 'foil',
      condition: 'LP',
      language: 'ja',
      cardId: 1,
    }),
    createRemoveChange('Misty Rainforest', { board: 'Sideboard', cardId: 2 }),
    createSetCommanderChange('Avacyn', { cardId: 3 }),
    createSetPrintingChange('Sol Ring', {
      set: 'neo',
      collectorNumber: '234',
      language: 'ja',
      cardId: 4,
    }),
    createSetLanguageChange('Sol Ring', { language: 'zhs', cardId: 4 }),
    createSetNoteChange('Sol Ring', { note: 'great vs aggro', cardId: 4 }),
    createSetLabelChange('Sol Ring', { labels: ['sale', 'trade'], cardId: 4 }),
    createSetSectionChange('Sol Ring', 'Foils', 4),
  ]
}

/** The `- ` change lines only; the `## <iso>` header moves with wall-clock time. */
function changeLines(content: string): string[] {
  return content.split('\n').filter((line) => line.startsWith('- '))
}

async function writeChangelogUnder(locale: LocaleTag, dir: string, label: string): Promise<string> {
  setLocale(locale)
  const listPath = path.join(dir, `${label}.md`)
  const changelogPath = await appendChangelog(listPath, 'My Deck', changeSet())
  return await fs.readFile(changelogPath, 'utf-8')
}

let workDir: string | null = null

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  workDir = path.join(tmpdir(), `ritual-changelog-locale-${crypto.randomUUID()}`)
  await fs.mkdir(workDir, { recursive: true })
  await run(workDir)
}

afterEach(async () => {
  resetI18nRuntime()
  if (workDir !== null) {
    await fs.rm(workDir, { recursive: true, force: true })
    workDir = null
  }
})

describe('.changes.md is byte-identical under any UI locale', () => {
  test('the pseudo-locale is actually active — otherwise everything below is vacuous', () => {
    loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
    setLocale(PSEUDO_LOCALE)
    const display = formatChange(createAddChange('Sol Ring', { cardId: 5 }))
    expect(display).not.toBe('Add Sol Ring &5')
    // The pseudo-locale brackets every routed string and leaves placeholders
    // verbatim, so the card name and `&N` survive inside the bracketed frame.
    expect(display).toContain('Sol Ring')
    expect(display).toContain('&5')
  })

  test('a card mutation writes the same bytes under en and en-XA', async () => {
    await withDir(async (dir) => {
      const english = await writeChangelogUnder(localeTag('en'), dir, 'english')

      loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
      const pseudo = await writeChangelogUnder(PSEUDO_LOCALE, dir, 'pseudo')

      expect(changeLines(pseudo)).toEqual(changeLines(english))
      // Nothing outside the timestamp header may differ either.
      const strip = (content: string): string => content.replace(/^## .*$/gm, '## <ts>')
      expect(strip(pseudo)).toBe(strip(english))
    })
  })

  test('the pseudo-locale changelog still round-trips through the parser', async () => {
    await withDir(async (dir) => {
      loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
      const pseudo = await writeChangelogUnder(PSEUDO_LOCALE, dir, 'pseudo')

      const { pages, advisories } = parseChangelog(pseudo)
      expect(advisories).toEqual([])
      expect(pages).toHaveLength(1)
      const expectedActions: ChangeAction[] = [
        'add-section',
        'add',
        'remove',
        'set-commander',
        'set-printing',
        'set-language',
        'set-note',
        'set-label',
        'set-section',
      ]
      expect(pages[0]!.changes.map((change) => change.action)).toEqual(expectedActions)
      // The block carries the language code itself, never a translated name.
      const setLanguage = pages[0]!.changes.find((change) => change.action === 'set-language')
      expect(setLanguage?.action === 'set-language' && setLanguage.language).toBe('zhs')
    })
  })

  test('appending under a second locale merges into a consistent English file', async () => {
    await withDir(async (dir) => {
      loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
      const listPath = path.join(dir, 'merged.md')

      setLocale(localeTag('en'))
      await appendChangelog(listPath, 'My Deck', [createAddChange('Sol Ring', { cardId: 1 })])
      setLocale(PSEUDO_LOCALE)
      const changelogPath = await appendChangelog(
        listPath,
        'My Deck',
        [createRemoveChange('Sol Ring', { cardId: 1 })],
        { continueSession: true },
      )

      const content = await fs.readFile(changelogPath, 'utf-8')
      expect(changeLines(content)).toEqual(['- Added "Sol Ring" &1', '- Removed "Sol Ring" &1'])
    })
  })
})

describe('history rewrite lines are locale-invariant too', () => {
  /**
   * `ritual history`'s "rewrite with defaults" builds persisted lines through
   * the same formatter, from a different entry point — the fence has to hold on
   * both paths or a rewrite would localize a whole file at once.
   */
  test('buildDefaultChangeLines renders English under the pseudo-locale', () => {
    loadDictionary(PSEUDO_LOCALE, pseudoCatalog)

    setLocale(localeTag('en'))
    const english = buildDefaultChangeLines({
      sectionOrder: ['Main', 'Foils'],
      entries: [
        {
          name: 'Sol Ring',
          set: 'neo',
          collectorNumber: '234',
          language: 'ja',
          note: 'ramp',
          labels: ['sale'],
          cardId: 7,
          section: 'Foils',
          quantity: 2,
          isCommander: true,
        },
      ],
    })

    setLocale(PSEUDO_LOCALE)
    const pseudo = buildDefaultChangeLines({
      sectionOrder: ['Main', 'Foils'],
      entries: [
        {
          name: 'Sol Ring',
          set: 'neo',
          collectorNumber: '234',
          language: 'ja',
          note: 'ramp',
          labels: ['sale'],
          cardId: 7,
          section: 'Foils',
          quantity: 2,
          isCommander: true,
        },
      ],
    })

    expect(pseudo).toEqual(english)
    expect(english).toContain('- Added section "Foils"')
    expect(english).toContain('- Added "Sol Ring" (NEO:234) [ja] &7')
    expect(english).toContain('- Set note on "Sol Ring" &7 to "ramp"')
  })
})

/**
 * Every persisted prose shape `formatChangeCore` writes, pinned byte for byte.
 * The strings carry `// i18n-exempt:` in the source because they are a data
 * format; this is what holds them to it: written under the pseudo-locale, every
 * line is the English it has always been, and the file still reads back to the
 * same events. One row per action at least (the `satisfies` makes a new action
 * a compile error here), plus the clear and no-printing variants.
 */
describe('every persisted line shape is pinned English', () => {
  type PinnedLine = { event: ChangeEvent; line: string }
  const binder = { type: 'collection', name: 'Binder' } as const
  const wishlist = { type: 'wanted', name: 'Wishlist' } as const
  const burn = { type: 'deck', name: 'Burn' } as const

  const PINNED = {
    add: {
      event: createAddChange('Lightning Bolt', {
        set: 'lea',
        collectorNumber: '161',
        finish: 'foil',
        condition: 'LP',
        language: 'ja',
        board: 'Sideboard',
        cardId: 1,
      }),
      line: '- Added "Lightning Bolt" (LEA:161) [foil] [LP] [ja] to Sideboard &1',
    },
    remove: {
      event: createRemoveChange('Misty Rainforest', { board: 'Maybeboard', cardId: 2 }),
      line: '- Removed "Misty Rainforest" from Maybeboard &2',
    },
    'set-commander': {
      event: createSetCommanderChange('Avacyn', { cardId: 3 }),
      line: '- Set "Avacyn" as commander &3',
    },
    'unset-commander': {
      event: createUnsetCommanderChange('Avacyn', { cardId: 3 }),
      line: '- Unset "Avacyn" as commander &3',
    },
    'set-finish': {
      event: createSetFinishChange('Sol Ring', { finish: 'etched', cardId: 4 }),
      line: '- Set "Sol Ring" finish to etched &4',
    },
    'set-printing': {
      event: createSetPrintingChange('Sol Ring', {
        set: 'neo',
        collectorNumber: '234',
        condition: 'NONE',
        language: 'ja',
        cardId: 4,
      }),
      line: '- Set "Sol Ring" printing to NEO:234 [ja] &4',
    },
    'set-language': {
      event: createSetLanguageChange('Sol Ring', { language: 'zhs', cardId: 4 }),
      line: '- Set language of "Sol Ring" to Simplified Chinese &4',
    },
    'set-note': {
      event: createSetNoteChange('Sol Ring', { note: 'great vs aggro', cardId: 4 }),
      line: '- Set note on "Sol Ring" &4 to "great vs aggro"',
    },
    'set-label': {
      event: createSetLabelChange('Sol Ring', { labels: ['sale', 'no-trade'], cardId: 4 }),
      line: '- Set labels on "Sol Ring" &4 to [sale,no-trade]',
    },
    'add-tag': {
      event: createAddTagChange('Sol Ring', { tag: 'Card Draw', cardId: 4 }),
      line: '- Added tag "Card Draw" to "Sol Ring" &4',
    },
    'remove-tag': {
      event: createRemoveTagChange('Sol Ring', { tag: 'Ramp', cardId: 4 }),
      line: '- Removed tag "Ramp" from "Sol Ring" &4',
    },
    'move-from': {
      event: createMoveFromChange('Sol Ring', {
        set: 'c21',
        collectorNumber: '263',
        to: binder,
        cardId: 4,
      }),
      line: '- Moved "Sol Ring" (C21:263) &4 to Collection \'Binder\'',
    },
    'move-to': {
      event: createMoveToChange('Sol Ring', { from: wishlist, cardId: 5 }),
      line: '- Moved "Sol Ring" &5 from Wanted list \'Wishlist\'',
    },
    'add-section': {
      event: createAddSectionChange('Foils'),
      line: '- Added section "Foils"',
    },
    'remove-section': {
      event: createRemoveSectionChange('Foils'),
      line: '- Removed section "Foils"',
    },
    'rename-section': {
      event: createRenameSectionChange('Foils', 'Shiny'),
      line: '- Renamed section "Foils" to "Shiny"',
    },
    'set-section': {
      event: createSetSectionChange('Sol Ring', 'Shiny', 4),
      line: '- Moved "Sol Ring" to section "Shiny" &4',
    },
    'set-categories': {
      event: createSetCategoriesChange('Sol Ring', ['Ramp', 'Card Draw']),
      line: '- Set categories of "Sol Ring" to Ramp, Card Draw',
    },
    'rename-category': {
      event: createRenameCategoryChange('Draw', 'Card Draw'),
      line: '- Renamed category "Draw" to "Card Draw"',
    },
    'set-category-order': {
      event: createSetCategoryOrderChange(['Ramp', 'Removal']),
      line: '- Set category order to Ramp, Removal',
    },
  } satisfies Record<ChangeAction, PinnedLine>

  /** The variants a single action row cannot show: clears, no printing, a deck source. */
  const VARIANTS: PinnedLine[] = [
    {
      // A language every CLDR names differently from English, so a name taken
      // from `Intl` (rather than the English parse names) would show here.
      event: createSetLanguageChange('Sol Ring', { language: 'ja', cardId: 4 }),
      line: '- Set language of "Sol Ring" to Japanese &4',
    },
    {
      event: createSetPrintingChange('Sol Ring', { cardId: 4 }),
      line: '- Set "Sol Ring" printing to no specific printing &4',
    },
    {
      event: createSetNoteChange('Sol Ring', { note: '', cardId: 4 }),
      line: '- Cleared note on "Sol Ring" &4',
    },
    {
      event: createSetLabelChange('Sol Ring', { labels: [], cardId: 4 }),
      line: '- Cleared labels on "Sol Ring" &4',
    },
    {
      event: createMoveToChange('Sol Ring', { from: burn }),
      line: '- Moved "Sol Ring" from Deck \'Burn\'',
    },
    {
      event: createSetCategoriesChange('Sol Ring', []),
      line: '- Cleared categories of "Sol Ring"',
    },
    {
      event: createSetCategoryOrderChange([]),
      line: '- Cleared category order',
    },
  ]

  const pinned: PinnedLine[] = [...Object.values(PINNED), ...VARIANTS]

  test('each row pins the action it is keyed by', () => {
    for (const [action, row] of Object.entries(PINNED))
      expect<string>(row.event.action).toBe(action)
  })

  test('each line is the pinned English under a real locale too', () => {
    // en-XA brackets catalog text but has no CLDR data of its own, so it cannot
    // catch a name drawn from `Intl`; German can. Vacuity guard: it does differ.
    expect(languageLabel('ja', 'de')).not.toBe('Japanese')
    setLocale(localeTag('de'))
    expect(pinned.map((entry) => formatChangelogLine(entry.event))).toEqual(
      pinned.map((entry) => entry.line),
    )
  })

  test('each line is the pinned English under the pseudo-locale', () => {
    loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
    setLocale(PSEUDO_LOCALE)
    expect(pinned.map((entry) => formatChangelogLine(entry.event))).toEqual(
      pinned.map((entry) => entry.line),
    )
  })

  test('a changelog of every shape is byte-identical under en and en-XA, and reads back whole', async () => {
    await withDir(async (dir) => {
      loadDictionary(PSEUDO_LOCALE, pseudoCatalog)
      const events = pinned.map((entry) => entry.event)
      const write = async (locale: LocaleTag, name: string): Promise<string> => {
        setLocale(locale)
        const changelogPath = await appendChangelog(path.join(dir, name), 'My Deck', events)
        return await fs.readFile(changelogPath, 'utf-8')
      }
      const english = await write(localeTag('en'), 'english.md')
      const content = await write(PSEUDO_LOCALE, 'pseudo.md')

      // The entry header is an ISO timestamp, whatever the locale.
      const headers = content.split('\n').filter((line) => line.startsWith('## '))
      expect(headers).toHaveLength(1)
      expect(headers[0]).toMatch(/^## \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
      // Byte for byte, but for the timestamp's value.
      const stamp = (text: string): string => text.replace(/^## .*$/m, '## <timestamp>')
      expect(stamp(content)).toBe(stamp(english))

      // The header line is data too: re-read as the file's own, and hashed.
      expect(content.startsWith('# Changelog for My Deck\n')).toBe(true)
      expect(changeLines(content)).toEqual(pinned.map((entry) => entry.line))
      const read = parseChangeSets(content, 'fallback')
      expect(read.advisories).toEqual([])
      // Field for field, as the block persists them.
      expect(read.sets[0]?.events.map(encodeChangeEvent)).toEqual(events.map(encodeChangeEvent))
    })
  })
})
