import * as fs from 'node:fs/promises'
import matter from 'gray-matter'
import { BOARDS, type Board, type DeckData, type DeckSection } from '../list/deck'
import type { Card } from '../card/card'
import type { Condition, Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { ListType } from '../list/list-type'
import type { DeckFormatKey } from '../list/deck-format'
import type { CsvCardEntry } from './csv'
import { parseDeckText } from './text-file'
import { serializeDeckToMarkdown } from '../list/deck-file'
import { parseCollectionFile, type CollectionEntry } from '../list/collection-file'
import { parseWantedListFile, type WantedListEntry } from '../list/wanted-file'
import { formatCollectionLine, formatWantedListLine } from '../card/card-line'
import type { CardLanguage } from '../card/card-language'
import type { CardPrintingsLookup } from '../card/card-printing'
import { resolvePrintingLanguage } from '../card/printing-language'
import { getDefaultLanguage } from '../config/ritual-config'
import { getCachedCardPrintings } from '../scryfall'
import { withFrontMatter } from '../list/list-export'
import { parseFlatListFrontMatter } from '../list/flat-list-front-matter'
import type { CardLabel } from '../card/card-labels'
import { parseTitleFromContent, serializeSectionedList } from '../list/section-format'
import {
  allocateId,
  collectDeckCardIds,
  collectExistingIds,
  createIdPool,
  type CardIdPool,
} from '../card/card-id'
import { writeFileWithHash } from '../changes/content-hash'
import { unreadableContentMessage, unreadableLines } from '../list/markdown-fence'
import { unusableFileNameMessage } from '../list/list-file-name'
import { listNameCollision } from '../list/list-lifecycle'
import { reconcileListRefs } from '../list/list-refs'
import { createAddChange, isSamePrinting, type ChangeEvent } from '../changes/change-event'
import { appendChangelog } from '../changes/changelog-writer'
import {
  dirForType,
  listFilePath,
  formatResolveListError,
  isResolveListError,
  resolveList,
} from '../list/resolve-list'

/**
 * Applies converted card entries to a list on disk: creating a new list file,
 * overwriting one, or appending to an existing one. Shared by the `import`
 * CLI command (both its CSV and text-file sources) and the admin
 * `/api/import-csv` route (and through it the MCP server), so every surface
 * applies imports identically.
 */

export type CsvImportMode = 'create' | 'overwrite' | 'append'

/** Behavior switches for {@link applyCsvImport}. */
export type CsvImportOptions = {
  /** Validate and resolve everything, but write neither the list file nor its changelog. */
  dryRun?: boolean
  /**
   * Whether the source explicitly said something about language — a CSV with a
   * mapped language column, even one whose every cell is blank or `en`. When
   * true, the default-language stamping is skipped entirely: the column's cells
   * are honored verbatim, and a blank cell means English. Without it an all-EN
   * column would be indistinguishable from no column at all.
   */
  sourceHadLanguageColumn?: boolean
  /**
   * The language stamped on pinned entries when the source carried none;
   * defaults to the configured `defaultLanguage`. A test seam — production
   * callers omit it.
   */
  defaultLanguage?: CardLanguage
  /** Printings lookup for the language stamping; the Scryfall cache by default. */
  lookupPrintings?: CardPrintingsLookup
}

/**
 * A normalized card entry ready to apply to a list. CSV rows never produce a
 * `note` or `labels`; text-file imports carry both through to the written list line.
 */
export type ImportCardEntry = CsvCardEntry & { note?: string; labels?: CardLabel[] }

export type CsvImportTarget = {
  listType: ListType
  /** List name: the new list's name for create/overwrite, an existing list for append. */
  name: string
  mode: CsvImportMode
  /** Deck format. Required when creating or overwriting a deck; unused otherwise. */
  format?: DeckFormatKey
  /**
   * The file an overwrite replaces, when the caller has already settled it —
   * the folded twin (`Trade Binder.md` for `trade binder`) rather than the path
   * the import's own name would resolve to. Defaults to that path.
   */
  filePath?: string
}

export type CsvImportSuccess = {
  filePath: string
  /** Total copies imported (sum of row quantities). */
  cardCount: number
  mode: CsvImportMode
  /** The changelog written for an append; absent for create/overwrite and dry runs. */
  changelogPath?: string
}

export type CsvImportError = { error: string }

export type CsvImportOutcome = CsvImportSuccess | CsvImportError

function totalCards(entries: ImportCardEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0)
}

// ── Create / overwrite ──────────────────────────────────────────────

function buildDeckMarkdown(
  name: string,
  format: DeckFormatKey,
  entries: ImportCardEntry[],
): string {
  const sectionsByName = new Map<string, Card[]>()
  for (const entry of entries) {
    let cards = sectionsByName.get(entry.section)
    if (!cards) {
      cards = []
      sectionsByName.set(entry.section, cards)
    }
    // Rows naming the same card and the same printing merge into one deck line,
    // exactly as `appendToDeck` merges them into an existing one — real CSV
    // exports repeat a card across rows, and create/append must not disagree
    // about what the same file means. A different printing stays its own line.
    const existing = cards.find(
      (card) => card.name.toLowerCase() === entry.name.toLowerCase() && isSamePrinting(card, entry),
    )
    if (existing) {
      existing.quantity += entry.quantity
      continue
    }
    cards.push({
      quantity: entry.quantity,
      name: entry.name,
      set: entry.set,
      collectorNumber: entry.collectorNumber,
      finish: entry.finish,
      condition: entry.condition,
      language: entry.language,
      labels: entry.labels,
      note: entry.note,
    })
  }
  const sections: DeckSection[] = [...sectionsByName.entries()].map(([sectionName, cards]) => ({
    name: sectionName,
    cards,
  }))
  const deck: DeckData = { name, format, sections }
  return serializeDeckToMarkdown(deck, { format, tags: [] })
}

/** The list types that store flat per-copy bullet lines (everything but decks). */
export type FlatListType = Exclude<ListType, 'deck'>

type FlatCopy = ImportCardEntry & { cardId: number }

/** A pre-existing entry parsed from the target list during an append. */
type FlatEntry = (CollectionEntry | WantedListEntry) & { cardId?: number }

/** A re-serialized list body plus the change events describing what was added. */
type AppendResult = { content: string; changes: ChangeEvent[] }

/**
 * An append either produced new content, or found content the canonical
 * re-serialize would delete. Append rewrites the whole file from parsed
 * entries, so a skipped line or a fenced code block in the existing file is
 * content the write would drop — the same gate the admin saves, `cleanup` and
 * the sync engines apply.
 */
type AppendOutcome = AppendResult | { unreadable: string[] }

/** Expand entries into per-copy lines (flat lists store one line per physical card). */
function expandCopies(entries: ImportCardEntry[], pool: CardIdPool): FlatCopy[] {
  const copies: FlatCopy[] = []
  for (const entry of entries) {
    for (let i = 0; i < entry.quantity; i++) {
      copies.push({ ...entry, quantity: 1, cardId: allocateId(pool) })
    }
  }
  return copies
}

/**
 * The fields a flat-list line is rendered from — the common shape of parsed
 * entries ({@link FlatEntry}) and freshly imported copies ({@link FlatCopy}).
 * Wanted lists never render a condition; the formatter drops it.
 */
type FlatLineEntry = {
  name: string
  set?: string
  collectorNumber?: string
  finish?: Finish
  condition?: Condition
  /** Language token — carried through from parsed entries so a re-serialize never drops `[ja]`. */
  language?: CardLanguage
  /** Label override — parsed collection entries and text-file imports; CSV rows never carry one. */
  labels?: CardLabel[]
  note?: string
  cardId?: number
}

/** Render one flat-list bullet line in the target list type's canonical format. */
function formatFlatListLine(listType: FlatListType, entry: FlatLineEntry): string {
  if (listType === 'collection') {
    return formatCollectionLine({
      cardName: entry.name,
      set: entry.set ?? '',
      collectorNumber: entry.collectorNumber ?? '',
      finish: entry.finish ?? 'nonfoil',
      condition: entry.condition,
      language: entry.language,
      labels: entry.labels,
      note: entry.note,
      cardId: entry.cardId,
    })
  }
  return formatWantedListLine({
    name: entry.name,
    printing:
      entry.set && entry.collectorNumber
        ? { set: entry.set, collectorNumber: entry.collectorNumber }
        : undefined,
    finish: entry.finish,
    language: entry.language,
    note: entry.note,
    cardId: entry.cardId,
  })
}

function buildFlatListMarkdown(
  listType: FlatListType,
  name: string,
  entries: ImportCardEntry[],
): string {
  const copies = expandCopies(entries, createIdPool([]))
  const sectionOrder: string[] = []
  for (const copy of copies) {
    if (!sectionOrder.includes(copy.section)) sectionOrder.push(copy.section)
  }
  return serializeSectionedList(name, copies, sectionOrder, (copy) =>
    formatFlatListLine(listType, copy),
  )
}

async function createList(
  target: CsvImportTarget,
  entries: ImportCardEntry[],
  dryRun: boolean,
): Promise<CsvImportOutcome> {
  const targetDir = dirForType(target.listType)
  const filePath = target.filePath ?? listFilePath(target.listType, target.name)
  if (filePath === null) {
    return { error: unusableFileNameMessage(target.name) }
  }

  if (target.mode === 'create') {
    if (await Bun.file(filePath).exists()) {
      return {
        error: `File already exists: ${filePath}. Use overwrite or append mode to change it.`,
      }
    }
    // A name that merely *folds* onto an existing list would leave the two
    // mutually unaddressable by every name-resolving command — the same refusal
    // `new`, `rename`, and the editors give.
    const collision = await listNameCollision(target.listType, target.name)
    if (collision) {
      return { error: `${collision.message} Use overwrite or append mode to change it.` }
    }
  }

  /** The file an overwrite replaces, when there is one. */
  const replaced =
    target.mode === 'overwrite' && (await Bun.file(filePath).exists())
      ? await fs.readFile(filePath, 'utf-8')
      : null

  let content: string
  if (target.listType === 'deck') {
    if (target.format === undefined) {
      return { error: 'Creating a deck from CSV requires a format' }
    }
    content = buildDeckMarkdown(target.name, target.format, entries)
  } else {
    content = buildFlatListMarkdown(target.listType, target.name, entries)
    // Overwrite replaces the card lines, not the list's metadata — an existing
    // front-matter block (a collection's `labels:` default) survives verbatim.
    if (replaced !== null) {
      const parsed = parseFlatListFrontMatter(replaced.split('\n'), { validateLabels: false })
      content = withFrontMatter(parsed.frontMatter, content)
    }
  }

  if (!dryRun) {
    await fs.mkdir(targetDir, { recursive: true })
    await writeFileWithHash(filePath, content)
    // The replaced lines' `&N` ids are retired: the new lines are numbered from
    // scratch, so custom art or a cover filed under an old id would otherwise
    // reappear on whichever card takes the number next.
    if (replaced !== null) {
      const retired = existingCardIds(target.listType, replaced, target.name)
      if (retired.length > 0) await reconcileListRefs(filePath, { removed: retired })
    }
  }
  return { filePath, cardCount: totalCards(entries), mode: target.mode }
}

/** The `&N` ids a list file's card lines hold. */
function existingCardIds(listType: ListType, content: string, fallbackName: string): number[] {
  if (listType === 'deck') return collectDeckCardIds(parseDeckText(content, fallbackName).deck)
  const parsed =
    listType === 'collection' ? parseCollectionFile(content) : parseWantedListFile(content)
  return collectExistingIds(parsed.entries)
}

// ── Append ──────────────────────────────────────────────────────────

/** The Board value for a section name, when it is one of the canonical boards. */
function boardForSection(section: string): Board | undefined {
  return BOARDS.find((board) => board === section)
}

function appendToDeck(
  content: string,
  fallbackName: string,
  entries: ImportCardEntry[],
): AppendOutcome {
  const parsedDeck = parseDeckText(content, fallbackName)
  const lost = unreadableLines(parsedDeck)
  if (lost.length > 0) return { unreadable: lost }
  const { deck } = parsedDeck
  const frontMatter = matter(content).data
  const pool = createIdPool(collectDeckCardIds(deck))
  const changes: ChangeEvent[] = []

  for (const entry of entries) {
    let section = deck.sections.find((s) => s.name === entry.section)
    if (!section) {
      section = { name: entry.section, cards: [] }
      deck.sections.push(section)
    }
    const existing = section.cards.find(
      (card) => card.name.toLowerCase() === entry.name.toLowerCase() && isSamePrinting(card, entry),
    )
    let cardId: number | undefined
    if (existing) {
      existing.quantity += entry.quantity
      cardId = existing.cardId
    } else {
      cardId = allocateId(pool)
      section.cards.push({
        quantity: entry.quantity,
        name: entry.name,
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        language: entry.language,
        labels: entry.labels,
        note: entry.note,
        cardId,
      })
    }
    // One change per row (quantities merge into a single deck line).
    changes.push(
      createAddChange(entry.name, {
        set: entry.set,
        collectorNumber: entry.collectorNumber,
        finish: entry.finish,
        condition: entry.condition,
        language: entry.language,
        section: entry.section,
        board: boardForSection(entry.section),
        cardId,
      }),
    )
  }

  return { content: serializeDeckToMarkdown(deck, frontMatter), changes }
}

function appendToFlatList(
  listType: FlatListType,
  content: string,
  fallbackTitle: string,
  entries: ImportCardEntry[],
): AppendOutcome {
  const parsed =
    listType === 'collection' ? parseCollectionFile(content) : parseWantedListFile(content)
  const lost = unreadableLines(parsed)
  if (lost.length > 0) return { unreadable: lost }
  const existing: FlatEntry[] = parsed.entries
  const sectionOrder = parsed.sectionOrder

  const pool = createIdPool(collectExistingIds(existing))
  const copies = expandCopies(entries, pool)
  const changes: ChangeEvent[] = copies.map((copy) =>
    createAddChange(copy.name, {
      set: copy.set,
      collectorNumber: copy.collectorNumber,
      finish: copy.finish,
      condition: listType === 'collection' ? copy.condition : undefined,
      language: copy.language,
      section: copy.section,
      cardId: copy.cardId,
    }),
  )

  const title = parseTitleFromContent(content) ?? fallbackTitle
  const all: (FlatEntry | FlatCopy)[] = [...existing, ...copies]
  return {
    // The append re-serializes the whole body, so the file's front-matter
    // block (a collection's `labels:` default, say) must be re-emitted too.
    content: withFrontMatter(
      parsed.frontMatter,
      serializeSectionedList(title, all, sectionOrder, (entry) =>
        formatFlatListLine(listType, entry),
      ),
    ),
    changes,
  }
}

async function appendToList(
  target: CsvImportTarget,
  entries: ImportCardEntry[],
  dryRun: boolean,
): Promise<CsvImportOutcome> {
  const location = await resolveList(target.name, target.listType)
  if (isResolveListError(location)) {
    return { error: formatResolveListError(location, 'none') }
  }

  const content = await Bun.file(location.filePath).text()
  const result =
    target.listType === 'deck'
      ? appendToDeck(content, location.name, entries)
      : appendToFlatList(target.listType, content, location.name, entries)

  if ('unreadable' in result) {
    return { error: unreadableContentMessage(location.filePath, result.unreadable, 'appending') }
  }

  if (dryRun) {
    return { filePath: location.filePath, cardCount: totalCards(entries), mode: 'append' }
  }

  await writeFileWithHash(location.filePath, result.content)
  const changelogPath = await appendChangelog(location.filePath, location.name, result.changes)

  return {
    filePath: location.filePath,
    cardCount: totalCards(entries),
    mode: 'append',
    changelogPath,
  }
}

/**
 * Stamp the configured default language on pinned entries whose source said
 * nothing about language, per {@link resolvePrintingLanguage}: the language a
 * source is silent about is the user's primary one when the printing supports
 * it (or when the cache cannot say), else English, else the only available.
 *
 * Applies only when the source said nothing about language: a mapped language
 * column (`sourceHadLanguageColumn`) disables stamping outright — its cells,
 * including blank ones (which mean English), are honored verbatim even when
 * every one of them is empty or `en`. Sources without column info (text-file
 * imports) fall back to a batch heuristic: a language token anywhere in the
 * batch means the source was language-aware. Under an English
 * `defaultLanguage` a bare import stays bare, and unpinned entries (no
 * set + collector number) are never stamped: without a printing there is
 * nothing to check availability against, and the line stays self-describing.
 */
async function stampDefaultLanguage(
  entries: ImportCardEntry[],
  options: CsvImportOptions,
): Promise<ImportCardEntry[]> {
  const preferred = options.defaultLanguage ?? getDefaultLanguage()
  if (preferred === 'en') return entries
  if (options.sourceHadLanguageColumn) return entries
  if (entries.some((entry) => entry.language !== undefined)) return entries

  const lookup = options.lookupPrintings ?? getCachedCardPrintings
  // One lookup per distinct name: imports repeat names often, and the lookup is
  // a cache read.
  const printingsByName = new Map<string, ScryfallCard[]>()
  const stamped: ImportCardEntry[] = []
  for (const entry of entries) {
    if (!entry.set || !entry.collectorNumber) {
      stamped.push(entry)
      continue
    }
    const memoKey = entry.name.toLowerCase()
    let printings = printingsByName.get(memoKey)
    if (!printings) {
      printings = await lookup(entry.name)
      printingsByName.set(memoKey, printings)
    }
    const { language } = resolvePrintingLanguage(
      printings,
      entry.set,
      entry.collectorNumber,
      preferred,
    )
    // English is written bare, so an `en` choice leaves the entry untouched.
    stamped.push(language === 'en' ? entry : { ...entry, language })
  }
  return stamped
}

/**
 * Apply converted card entries to the target list. Create mode refuses to
 * replace an existing file; overwrite replaces it; append requires an existing
 * list (resolved like every other list-name lookup) and records the added
 * cards in the list's changelog. A dry run performs every validation and
 * resolution step but writes nothing (no list file, no changelog).
 *
 * Entries from a language-silent source are stamped with the configured
 * default language first — see {@link stampDefaultLanguage}.
 */
export async function applyCsvImport(
  target: CsvImportTarget,
  entries: ImportCardEntry[],
  options: CsvImportOptions = {},
): Promise<CsvImportOutcome> {
  const dryRun = options.dryRun === true
  const withLanguage = await stampDefaultLanguage(entries, options)
  if (target.mode === 'append') {
    return appendToList(target, withLanguage, dryRun)
  }
  return createList(target, withLanguage, dryRun)
}
