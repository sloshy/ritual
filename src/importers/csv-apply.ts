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
import { getDefaultLanguage, loadDefaultCategories } from '../config/ritual-config'
import { getCachedCardPrintings } from '../scryfall'
import { withFrontMatter } from '../list/list-export'
import { parseFlatListFrontMatter } from '../list/flat-list-front-matter'
import type { CardLabel } from '../card/card-labels'
import type { CardTag } from '../card/card-tags'
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
import {
  createAddChange,
  createSetCategoriesChange,
  isSamePrinting,
  type ChangeEvent,
} from '../changes/change-event'
import {
  commitCategoryChanges,
  type CardCategoriesWarning,
  type CommitCategoryChangesResult,
} from '../list/card-categories-sidecar'
import { foldCategoryCardName } from '../card/card-categories'
import { foldedCardNameSet } from '../list/card-names'
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
   * Whether the source explicitly carried a categories column — a mapped
   * `category`/`categories` column, even one whose every cell is blank. Only then
   * does the import touch `<list>.categories.json` at all: a create/overwrite that
   * carried categories prunes the entries the replaced list left behind, and one
   * that carried none must not silently prune (or unlink) a sidecar it knows
   * nothing about. URL and text-file imports never set it.
   */
  sourceHadCategoriesColumn?: boolean
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
export type ImportCardEntry = CsvCardEntry & {
  note?: string
  labels?: CardLabel[]
  tags?: CardTag[]
}

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
  /**
   * Files the import wrote **besides** the list file and its `.sha256` — today
   * the categories sidecar and its own `.sha256`, when the import carried
   * categories. Empty for a dry run and for any source with no categories column.
   * The caller's auto-commit set needs them, exactly as `SetCardResult.writtenFiles`
   * does.
   */
  writtenFiles: string[]
  /**
   * News about the categories sidecar the import wrote: entries pruned because
   * the replaced list no longer holds the card, and stale names the sidecar
   * already carried. English by contract, like `categoryError` — the caller
   * reports them on its own non-fatal channel. Empty when there is none.
   */
  categoryNotices: string[]
  /**
   * Why the categories sidecar was not written, when it was not. The list file
   * itself imported fine — this is a warning channel, never a failure.
   */
  categoryError?: string
}

export type CsvImportError = { error: string }

export type CsvImportOutcome = CsvImportSuccess | CsvImportError

function totalCards(entries: ImportCardEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0)
}

/**
 * One `set-categories` event per distinct card name the import assigned
 * categories to, in first-appearance order. A name on several rows with
 * different cells keeps the **first** row's spelling and its categories: an
 * import states a name's role once, and a later row silently winning would make
 * the sidecar depend on row order in a way no one can see.
 */
function importedCategoryChanges(entries: ImportCardEntry[]): ChangeEvent[] {
  const seen = new Set<string>()
  const changes: ChangeEvent[] = []
  for (const entry of entries) {
    if (entry.categories === undefined || entry.categories.length === 0) continue
    const key = foldCategoryCardName(entry.name)
    if (seen.has(key)) continue
    seen.add(key)
    changes.push(createSetCategoriesChange(entry.name, entry.categories))
  }
  return changes
}

/**
 * Write the import's categories to `<list>.categories.json`. Runs after the
 * list file is written, so a failure is news rather than a save to undo — the
 * sidecar module never throws and reports an unreadable sidecar instead of
 * overwriting it.
 *
 * `knownCardNames` — and therefore pruning — is passed only when the source
 * actually carried a categories column AND the mode replaces the list's whole
 * body: `commitCategoryChanges` treats a non-`undefined` set as "reconcile this
 * sidecar", so passing it on a categories-less import would prune (or unlink) a
 * sidecar the import never spoke about. `append` cannot enumerate the surviving
 * names at all, which is the rule `applyTargetedChanges` states
 * (`src/list/line-mutate.ts`).
 */
async function commitImportedCategories(
  filePath: string,
  entries: ImportCardEntry[],
  mode: CsvImportMode,
  sourceHadCategoriesColumn: boolean,
): Promise<CommitCategoryChangesResult> {
  const changes = importedCategoryChanges(entries)
  const knownCardNames =
    sourceHadCategoriesColumn && mode !== 'append'
      ? foldedCardNameSet(entries.map((entry) => entry.name))
      : undefined
  // `commitCategoryChanges` short-circuits on exactly this condition; delegating
  // the empty case to it rather than re-spelling its result keeps one owner of
  // both the rule and the shape.
  if (changes.length === 0 && knownCardNames === undefined) {
    return commitCategoryChanges(filePath, [], {})
  }
  return commitCategoryChanges(filePath, changes, {
    knownCardNames,
    defaultCategories: await loadDefaultCategories(),
  })
}

/** A sidecar load warning as English prose. A `switch` so a new kind is a compile error. */
function formatCategoryWarning(warning: CardCategoriesWarning): string {
  switch (warning.kind) {
    case 'unknown-card-names':
      return `Categories are recorded for card(s) the list does not hold: ${warning.names.join(', ')}`
  }
}

/**
 * The categories half of a `CsvImportSuccess`, projected from the sidecar commit
 * so both write paths state the contract once. `categoryError` is attached by
 * conditional spread because the result is handed to `Response.json`, where an
 * explicit `undefined` key would differ from an absent one.
 */
function importedCategoryFields(
  result: CommitCategoryChangesResult,
): Pick<CsvImportSuccess, 'writtenFiles' | 'categoryNotices' | 'categoryError'> {
  // When the commit pruned, the load's stale-name warning named exactly the
  // entries it went on to drop — reporting both would say the same names twice,
  // once as news and once as an outcome. The outcome wins.
  const categoryNotices =
    result.pruned.length > 0
      ? [`Dropped categories for card(s) no longer in the list: ${result.pruned.join(', ')}`]
      : result.warnings.map(formatCategoryWarning)
  return {
    writtenFiles: result.writtenFiles,
    categoryNotices,
    ...(result.error === undefined ? {} : { categoryError: result.error }),
  }
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
      tags: entry.tags,
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
  /** `#tag` tokens — parsed entries and text-file imports carry them through. */
  tags?: CardTag[]
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
      tags: entry.tags,
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
    tags: entry.tags,
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
  sourceHadCategoriesColumn: boolean,
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

  if (dryRun) {
    return {
      filePath,
      cardCount: totalCards(entries),
      mode: target.mode,
      writtenFiles: [],
      categoryNotices: [],
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await writeFileWithHash(filePath, content)
  // The replaced lines' `&N` ids are retired: the new lines are numbered from
  // scratch, so custom art or a cover filed under an old id would otherwise
  // reappear on whichever card takes the number next.
  if (replaced !== null) {
    const retired = existingCardIds(target.listType, replaced, target.name)
    if (retired.length > 0) await reconcileListRefs(filePath, { removed: retired })
  }
  const categories = await commitImportedCategories(
    filePath,
    entries,
    target.mode,
    sourceHadCategoriesColumn,
  )
  return {
    filePath,
    cardCount: totalCards(entries),
    mode: target.mode,
    ...importedCategoryFields(categories),
  }
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
        tags: entry.tags,
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
        // Labels and tags are add-merge identity in the deck engine, so the
        // event must describe the line the import actually wrote.
        labels: entry.labels,
        tags: entry.tags,
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
      labels: copy.labels,
      tags: copy.tags,
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
  sourceHadCategoriesColumn: boolean,
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
    return {
      filePath: location.filePath,
      cardCount: totalCards(entries),
      mode: 'append',
      writtenFiles: [],
      categoryNotices: [],
    }
  }

  await writeFileWithHash(location.filePath, result.content)
  // The sidecar is committed *before* the changelog is written so the two can
  // never disagree: a sidecar Ritual refuses to overwrite (hand-edited,
  // unparseable) must not leave `set-categories` prose in `.changes.md`
  // describing assignments that were never persisted.
  const categories = await commitImportedCategories(
    location.filePath,
    entries,
    'append',
    sourceHadCategoriesColumn,
  )
  // An append has a changelog, so the categories it states are recorded there
  // too — create/overwrite have none, and a first snapshot picks their sidecar
  // up through `buildDefaultChangeEvents`.
  const changelogPath = await appendChangelog(location.filePath, location.name, [
    ...result.changes,
    ...(categories.error === undefined ? importedCategoryChanges(entries) : []),
  ])

  return {
    filePath: location.filePath,
    cardCount: totalCards(entries),
    mode: 'append',
    changelogPath,
    ...importedCategoryFields(categories),
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
  const hadCategoriesColumn = options.sourceHadCategoriesColumn === true
  const withLanguage = await stampDefaultLanguage(entries, options)
  if (target.mode === 'append') {
    return appendToList(target, withLanguage, dryRun, hadCategoriesColumn)
  }
  return createList(target, withLanguage, dryRun, hadCategoriesColumn)
}
