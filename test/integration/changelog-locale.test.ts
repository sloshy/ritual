import { afterEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { appendChangelog } from '../../src/changes/changelog-writer'
import { parseChangelog } from '../../src/changes/changelog-parser'
import { parseLegacyChangeLines } from '../../src/changes/changelog-legacy-parser'
import {
  createAddChange,
  createAddSectionChange,
  createRemoveChange,
  createSetCommanderChange,
  createSetLabelChange,
  createSetLanguageChange,
  createSetNoteChange,
  createSetPrintingChange,
  createSetSectionChange,
  type ChangeAction,
  type ChangeEvent,
} from '../../src/changes/change-event'
import { formatChange } from '../../src/changes/change-message'
import { buildDefaultChangeLines } from '../../src/changes/list-snapshot'
import { en } from '../../src/i18n/messages/en'
import { enMeta } from '../../src/i18n/messages/en.meta'
import { loadDictionary, resetI18nRuntime, setLocale } from '../../src/i18n/runtime'
import { PSEUDO_LOCALE, pseudoLocalize } from '../../scripts/generate-locales'
import { localeTag } from '../../src/i18n/locale-tag'
import type { LocaleTag } from '../../src/i18n/types'

/**
 * **The regression this file exists for would destroy user data silently.**
 *
 * `.changes.md` is a data format, not prose. Its prose lines are the
 * git-diffable human record and the only input of the migration-only
 * `changelog-legacy-parser.ts`, whose regexes anchor on the English verbs
 * (`Added` / `Removed` / `Set` / `Unset`) and on the English language names;
 * its fenced `ritual-changes` block is what `changelog-parser.ts` machine-reads.
 * If a localized string ever reached `appendChangelog`, the prose would no
 * longer migrate, and `.sha256` sidecars hash the exact bytes, so the
 * corruption would also read as a spurious edit on every machine with a
 * different locale.
 *
 * So: perform the mutations under the generated `en-XA` pseudo-locale and
 * assert the written bytes are identical to the `en` run, and that both the
 * block and the English-anchored prose still round-trip through their parsers. The pseudo-locale is built in-process from the English
 * catalog (the same function `scripts/generate-locales.ts` uses), so this test
 * needs no build artifact and can never drift from the shipped catalog.
 */

const pseudoCatalog = pseudoLocalize(en, enMeta)

/** A change set that reaches every persisted line shape the writer emits. */
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
      // The prose under the pseudo-locale is still what the migration parser reads.
      const legacy = parseLegacyChangeLines(changeLines(pseudo))
      expect(legacy.unparsedLines).toEqual([])
      expect(legacy.events.map((change) => change.action)).toEqual(expectedActions)
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
