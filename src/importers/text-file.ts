import type { DeckData, DeckSection } from '../list/deck'
import type { Finish } from '../card/finish-condition'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import matter from 'gray-matter'
import { isFinish, isCondition } from '../card/finish-condition'
import {
  isCardLanguage,
  LANGUAGE_TOKEN_PATTERN,
  malformedLanguageTokenHint,
} from '../card/card-language'
import {
  LABEL_TOKEN_PATTERN,
  parseCardLabelsToken,
  readListDefaultLabels,
  unsupportedLabelsFor,
  type CardLabel,
} from '../card/card-labels'
import { listDescriptionOrUndefined } from '../list/list-description'
import { readListImage } from '../list/list-image'
import { isDroppedEmptySection, parseDeckFormat } from '../list/deck-format'
import { createFenceTracker } from '../list/markdown-fence'
import { isListMarkdownFile } from '../list/list-file-name'

/** A deck directory entry that is a deck's own file. Decks share the one list-file predicate. */
export const isDeckFile = isListMarkdownFile

export async function listDeckFiles(decksDir: string): Promise<string[]> {
  return (await readdir(decksDir)).filter(isDeckFile)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : undefined
}

/**
 * Resolve a deck's display name: the `name:` frontmatter field if present,
 * otherwise the supplied fallback (typically a file base name or user-entered name).
 */
function resolveDeckName(rawName: unknown, fallbackName: string): string {
  const parsedName = getString(rawName)
  if (parsedName) {
    return parsedName.replace(/\n/g, ' ')
  }
  return fallbackName
}

/**
 * Read just a deck file's display name without parsing its full card list.
 * Used to filter discovered decks by the site `includeDecks` selection.
 *
 * Throws whatever `gray-matter` throws for unparseable front matter — callers
 * (see `discoverListSources`) turn that into the reason a list could not be
 * built.
 *
 * The options argument is load-bearing, not decoration: `gray-matter` keeps a
 * module-level cache keyed on file content, and it stores a *partial* entry even
 * for input it threw on, so the second parse of the same broken front matter
 * quietly returns empty data instead of throwing. It only consults that cache
 * when no options are passed, so passing them makes this read report the same
 * answer no matter what parsed the file first.
 */
export async function readDeckName(filePath: string): Promise<string> {
  const rawText = await Bun.file(filePath).text()
  const data = matter(rawText, { language: 'yaml' }).data
  return resolveDeckName(data.name, path.basename(filePath, path.extname(filePath)))
}

/**
 * Matches a deck card line: `2 Lightning Bolt (LEA:161) [foil] [NM] [ja] [proxy] {note} &12`.
 * Set codes allow `_` (some art-series / playtest sets use underscores).
 * Whitespace is `\s+` so multiple spaces between tokens are tolerated. The four
 * bracketed vocabularies (finish, condition, language, labels) are disjoint, so
 * each token is unambiguous; the labels token accepts the whole label
 * vocabulary and {@link parseDeckText} warns about one a deck cannot carry. The
 * optional `&N` id stays the final capture group (the id backfill and the
 * line-preserving mutations index the match by its last group).
 */
export const DECK_CARD_LINE_RE = new RegExp(
  `^(\\d+)[xX]?\\s+(.+?)(?:\\s+\\(([A-Za-z0-9_]+):([^)]+)\\))?(?:\\s+\\[(nonfoil|foil|etched)\\])?(?:\\s+\\[(NM|LP|MP|HP|DMG)\\])?(?:\\s+\\[(${LANGUAGE_TOKEN_PATTERN})\\])?(?:\\s+\\[(${LABEL_TOKEN_PATTERN}(?:,${LABEL_TOKEN_PATTERN})*)\\])?(?:\\s+\\{(.*)\\})?(?:\\s+&(\\d+))?$`,
)

/** The {@link DECK_CARD_LINE_RE} capture group holding the language token body. */
export const DECK_LINE_LANGUAGE_GROUP = 7

/** The {@link DECK_CARD_LINE_RE} capture group holding the labels token body. */
export const DECK_LINE_LABELS_GROUP = 8

/** The {@link DECK_CARD_LINE_RE} capture group holding the `{note}` body. */
export const DECK_LINE_NOTE_GROUP = 9

/** The {@link DECK_CARD_LINE_RE} capture group holding the `&N` id. */
export const DECK_LINE_ID_GROUP = 10

/**
 * Matches an MTG Arena / MTGO export card line's printing suffix:
 * `4 Lightning Bolt (M10) 146` → name `Lightning Bolt`, set `M10`, number `146`.
 *
 * Two deliberate restrictions:
 *
 * - The set token excludes `:`, so a canonical `(LEA:161)` line can never match
 *   — the two grammars stay disjoint.
 * - **The collector number is required.** A parenthesized token alone is far too
 *   common in real card names (`Very Cryptic Command (Untap)`, `Hazmat Suit
 *   (Used)`, `Ineffable Blessing (Cardboard)`) to reinterpret as a set code, and
 *   a set with no collector number is not a printing the canonical card line can
 *   express anyway (see {@link resolvePrinting}) — it would be lifted out of the
 *   name only to be dropped by the serializer. Such a line keeps the name the
 *   user wrote and gets an advisory instead.
 */
const ARENA_PRINTING_RE = /^(.+?)\s+\(([A-Za-z0-9_]{2,10})\)\s+([A-Za-z0-9\-★†]+)$/

/**
 * A parenthesized set-like token left inside a parsed card name — the shape an
 * unrecognized export dialect leaves behind (`Lightning Bolt (M10) 146`). Used
 * for the safety-net advisory, so a dialect nobody taught the parser is never
 * silent corruption.
 */
const SUSPECT_PRINTING_IN_NAME_RE = /\([A-Za-z0-9_]{2,10}\)(?:\s+[A-Za-z0-9\-★†]+)?$/

/**
 * What a card name's trailing parenthesized token turned out to be. One
 * recognizer owns the whole grammar so the "lift it" and "warn about it"
 * decisions can never drift apart.
 */
export type ArenaSuffix =
  /** A complete printing, safe to lift out of the name. */
  | { kind: 'printing'; name: string; set: string; collectorNumber: string }
  /** Set-like enough to mention, but not a printing — the name is left alone. */
  | { kind: 'suspect' }
  /** An ordinary card name. */
  | { kind: 'none' }

/**
 * Classify a parsed card name's trailing parenthesized token. Pure and
 * exported so the grammar is testable on its own.
 */
export function matchArenaSuffix(cardName: string): ArenaSuffix {
  const printing = cardName.match(ARENA_PRINTING_RE)
  if (printing?.[1] && printing[2] && printing[3]) {
    return {
      kind: 'printing',
      name: printing[1].trim(),
      set: printing[2].toLowerCase(),
      collectorNumber: printing[3],
    }
  }
  if (SUSPECT_PRINTING_IN_NAME_RE.test(cardName)) return { kind: 'suspect' }
  return { kind: 'none' }
}

/**
 * The trailing finish marker Moxfield, Archidekt, and MTGO append to a plain-text
 * export line: `1 Sol Ring (LTC) 284 *F*` (foil) or `*E*` (etched). Stripped
 * before the card line is matched, so the marker never lands inside the name.
 */
const EXPORT_FINISH_MARKER_RE = /^(.*\S)\s+\*([FE])\*$/i

/**
 * Bare marker lines an Arena export uses in place of `##` section headers.
 *
 * A `Map` rather than an object literal: the key is arbitrary file content, and
 * an object lookup would resolve inherited keys (`constructor`, `__proto__`)
 * to something other than `undefined`.
 */
const ARENA_SECTION_MARKERS: ReadonlyMap<string, string> = new Map([
  ['deck', 'Main'],
  ['sideboard', 'Sideboard'],
  ['commander', 'Commander'],
  ['companion', 'Companion'],
])

/** How a text source should be read. */
export type ParseDeckTextOptions = {
  /**
   * Recognize the MTG Arena / MTGO export dialect: `N Name (SET) NUM` card
   * lines, bare `Deck`/`Sideboard`/`Commander`/`Companion` section markers, and
   * an `About` block (whose `Name …` line names the deck).
   *
   * Off by default, and deliberately so: this same parser loads Ritual's own
   * workspace list files, where the grammar must stay strict — a canonical
   * `(SET:NUM)` line must never be reinterpreted, and a marker word must keep
   * warning as a skipped line rather than silently starting a section. Only the
   * import surfaces (`ritual import`, the admin import route) opt in.
   */
  arenaDialect?: boolean
  /**
   * Read fenced code block content as deck data instead of prose.
   *
   * A pasted decklist very often arrives wrapped in a ``` fence — that is how
   * Discord, Reddit, and GitHub render one — so on the import path the fence is
   * packaging, not content: its delimiters are dropped and the lines inside are
   * parsed like any other. Off by default, because in Ritual's own list files a
   * fenced block is prose the parser must leave alone.
   */
  readFencedContent?: boolean
}

/**
 * How the import surfaces read a third-party text source. Shared so the CLI and
 * the admin import route can never disagree about which dialects they accept.
 */
export const IMPORT_TEXT_PARSE_OPTIONS: ParseDeckTextOptions = {
  arenaDialect: true,
  readFencedContent: true,
}

/** A parsed deck plus a warning for every body line the parser had to skip. */
export type DeckParseResult = {
  deck: DeckData
  warnings: string[]
  /**
   * Body lines belonging to fenced code blocks (delimiters included). Fenced
   * content is prose: it yields no cards and no warnings. See
   * {@link unreadableLines} for why the whole-file save gates still care.
   */
  fencedLines: number
  /**
   * Non-fatal per-line advisories: content the parser *did* read, but about
   * which the user deserves a word — a card name that still carries a
   * parenthesized set token (an export dialect nobody taught this parser), or an
   * `About` block line that was skipped.
   *
   * Deliberately **not** part of `warnings`: nothing was lost, so these must not
   * trip the whole-file-rewrite gates ({@link unreadableLines}) that refuse to
   * re-serialize a file whose content the parser could not read.
   */
  advisories: string[]
}

/**
 * A deck line's label override: the parsed labels (absent when the line carries
 * no token), plus the warning explaining a token that was dropped.
 */
type DeckLineLabels = { labels?: CardLabel[] } | { labels?: undefined; warning: string }

/**
 * Read a deck card line's labels token. The regex guarantees the token's shape
 * and vocabulary, so the only ways this fails are the exclusivity rule and a
 * label decks do not carry (`[keep]` in a deck file). Either way the card is
 * kept — it is perfectly usable on read surfaces — and the labels are dropped,
 * which is exactly why this is a warning and not an advisory: a whole-file
 * rewrite would lose the token, so the rewrite gates must block.
 */
function parseDeckLineLabels(
  raw: string | undefined,
  cardName: string,
  line: string,
): DeckLineLabels {
  if (raw === undefined) return {}
  const parsed = parseCardLabelsToken(raw)
  if (!parsed.ok) {
    return {
      warning:
        `Conflicting labels [${raw}] on '${cardName}' — ${parsed.message} ` +
        `The labels were ignored, and a rewrite would drop them: ${line}`,
    }
  }
  const unsupported = unsupportedLabelsFor('deck', parsed.labels)
  if (unsupported.length > 0) {
    return {
      warning:
        `Labels [${unsupported.join(',')}] on '${cardName}' are not supported on a deck. ` +
        `The labels were ignored, and a rewrite would drop them: ${line}`,
    }
  }
  return { labels: parsed.labels }
}

/**
 * Parse a deck's markdown/decklist text into structured {@link DeckData}.
 *
 * The text may carry optional YAML frontmatter (`name`, `description`,
 * `sourceUrl`, `sourceId`, `format`); `fallbackName` is used as the deck name
 * only when no frontmatter `name:` is present (e.g. an uploaded file's base name
 * or a name entered in the admin UI). `primer` is an optional markdown sidecar.
 *
 * A non-blank body line that is neither a section header nor a card line is
 * skipped and reported in `warnings` — imports of loose third-party decklists
 * may ignore these, but a caller about to re-serialize a Ritual deck file must
 * not, since re-emitting would drop the skipped lines.
 *
 * This is the shared core used both by {@link importFromTextFile} (reading from
 * disk) and by the admin import API (pasted text / uploaded file content).
 */
export function parseDeckText(
  rawText: string,
  fallbackName: string,
  primer?: string,
  options?: ParseDeckTextOptions,
): DeckParseResult {
  const parsed = matter(rawText)
  const arenaDialect = options?.arenaDialect === true
  const readFencedContent = options?.readFencedContent === true

  const frontMatterName = getString(parsed.data.name)
  let name = resolveDeckName(parsed.data.name, fallbackName)

  // Through the shared grammar after the `\n` unescape: a blank or non-text
  // `description:` says nothing on every list type, and one renderer prints all
  // three (a whitespace-only value would otherwise render an empty blurb block).
  const description = listDescriptionOrUndefined(getString(parsed.data.description))
  const sourceUrl = getString(parsed.data.sourceUrl)
  const sourceId = getString(parsed.data.sourceId)
  // An unrecognized `format:` is dropped, not carried: the deck then falls back
  // to section-name detection, and the next save rewrites the file with the
  // canonical key.
  const format = parseDeckFormat(parsed.data.format) ?? undefined

  const sections: DeckSection[] = []
  // The bucket body lines land in before any header is seen. It may legitimately
  // end up empty — every canonically-written Ritual deck opens with a header —
  // so it is exempt from the dropped-section warning below, as is the `# Title`
  // H1 that adopts it (a document title is not a section anybody lost).
  const syntheticMain: DeckSection = { name: 'Main', cards: [] }
  /** Heading level that adopted the synthetic bucket; `null` while unadopted. */
  let syntheticMainLevel: number | null = null
  let currentSection: DeckSection = syntheticMain
  sections.push(currentSection)

  const lines = parsed.content.split(/\r?\n/)
  const warnings: string[] = []
  const advisories: string[] = []
  // A `labels:` default the deck cannot carry is dropped by
  // `validateDeckFrontMatter`, so the next save deletes the key outright — the
  // same loss a refused card-line token would cause, and a warning for the same
  // reason: the whole-file-rewrite gates must see it.
  if ('labels' in parsed.data) {
    const defaultLabels = readListDefaultLabels('deck', parsed.data.labels)
    if (defaultLabels.warning) warnings.push(defaultLabels.warning)
  }
  // And the same for an unreadable `image:` cover, for the same reason: users
  // are told to hand-edit this key, so a save that silently deletes it would be
  // the worst possible outcome.
  const listImage = readListImage(parsed.data)
  if (listImage.advisory) {
    warnings.push(
      `Front matter 'image' ignored: ${listImage.advisory} A rewrite would drop the key.`,
    )
  }
  // Fenced code blocks are prose: a card-looking line or a `## Heading` inside
  // one is an example, not deck data, and must not warn either.
  const fence = createFenceTracker()
  let fencedLines = 0
  /** Inside an Arena `About` block, whose lines are deck metadata, not cards. */
  let inAboutBlock = false

  /** Start (or adopt the leading bucket as) a section, as a header or marker would. */
  const startSection = (sectionName: string, level: number): void => {
    if (currentSection.cards.length === 0 && currentSection.name === 'Main') {
      if (currentSection === syntheticMain) syntheticMainLevel = level
      currentSection.name = sectionName
    } else {
      currentSection = { name: sectionName, cards: [] }
      sections.push(currentSection)
    }
  }

  for (const line of lines) {
    const fenceState = fence.feed(line)
    if (fenceState.opaque) {
      // On the import path a fence is packaging: its delimiters are dropped and
      // the lines inside fall through to the ordinary card/section grammar.
      if (!readFencedContent) {
        fencedLines++
        continue
      }
      if (fenceState.role !== 'content') continue
    }
    const trimmed = line.trim()
    if (!trimmed) {
      // A blank line closes an `About` block; Arena separates every block with one.
      inAboutBlock = false
      continue
    }

    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headerMatch?.[2]) {
      inAboutBlock = false
      startSection(headerMatch[2].trim(), headerMatch[1]!.length)
      continue
    }

    if (arenaDialect) {
      const marker = ARENA_SECTION_MARKERS.get(trimmed.toLowerCase())
      if (marker !== undefined) {
        inAboutBlock = false
        // Level 2: a marker is a `##`-equivalent, so an empty one warns like one.
        startSection(marker, 2)
        continue
      }
      if (trimmed.toLowerCase() === 'about') {
        inAboutBlock = true
        continue
      }
      if (inAboutBlock) {
        // `Name My Deck` names the deck (frontmatter, when present, still wins);
        // anything else in the block is metadata this parser does not model.
        const aboutName = trimmed.match(/^Name\s+(.+)$/i)?.[1]?.trim()
        if (aboutName && frontMatterName === undefined) {
          name = aboutName
        } else if (!aboutName) {
          advisories.push(`Skipped About line: ${trimmed}`)
        }
        continue
      }
    }

    // An export's trailing `*F*` / `*E*` finish marker is stripped before the
    // card line is matched, so it can never end up inside the card name.
    let body = trimmed
    let markerFinish: Finish | undefined
    if (arenaDialect) {
      const marker = trimmed.match(EXPORT_FINISH_MARKER_RE)
      if (marker?.[1] && marker[2]) {
        body = marker[1]
        markerFinish = marker[2].toLowerCase() === 'f' ? 'foil' : 'etched'
      }
    }

    const quantityMatch = body.match(DECK_CARD_LINE_RE)
    if (quantityMatch?.[1] && quantityMatch?.[2]) {
      let cardName = quantityMatch[2].trim()
      let set = quantityMatch[3]?.toLowerCase()
      let collectorNumber = quantityMatch[4]

      // The canonical grammar has no `(SET) NUM` form, so such a suffix lands in
      // the card name. On the import path a *complete* one is the Arena dialect
      // and is lifted into the printing; anything short of that is an advisory,
      // never a silent rewrite of a card name the user wrote.
      if (set === undefined) {
        const suffix = matchArenaSuffix(cardName)
        if (arenaDialect && suffix.kind === 'printing') {
          cardName = suffix.name
          set = suffix.set
          collectorNumber = suffix.collectorNumber
        } else if (suffix.kind !== 'none') {
          advisories.push(
            `Card name still contains a printing token, so the line's format was not recognized: ${trimmed}`,
          )
        }
      }

      const rawLanguage = quantityMatch[DECK_LINE_LANGUAGE_GROUP]
      const labels = parseDeckLineLabels(quantityMatch[DECK_LINE_LABELS_GROUP], cardName, trimmed)
      if ('warning' in labels) warnings.push(labels.warning)
      const rawCardId = quantityMatch[DECK_LINE_ID_GROUP]
      currentSection.cards.push({
        quantity: Number.parseInt(quantityMatch[1], 10),
        name: cardName,
        // Both halves or neither: the two branches above never set one alone
        // (see `resolvePrinting` for why half a printing cannot be written).
        set,
        collectorNumber,
        finish: quantityMatch[5] && isFinish(quantityMatch[5]) ? quantityMatch[5] : markerFinish,
        condition: quantityMatch[6] && isCondition(quantityMatch[6]) ? quantityMatch[6] : undefined,
        // Set only when the token is present — a bare line means `en` and stays bare.
        language: rawLanguage && isCardLanguage(rawLanguage) ? rawLanguage : undefined,
        labels: labels.labels,
        note: quantityMatch[DECK_LINE_NOTE_GROUP],
        cardId: rawCardId ? Number.parseInt(rawCardId, 10) : undefined,
      })
      continue
    }

    // A recognizable-but-misspelled language token ([JA], [jp]) names its fix.
    warnings.push(`Skipped malformed line: ${trimmed}${malformedLanguageTokenHint(trimmed)}`)
  }

  // A section header with no card lines under it is dropped, and re-serializing
  // the deck would therefore delete it. That is a silent edit unless it is
  // reported, so it joins the malformed-line warnings — the save routes refuse a
  // baseline that carries any.
  //
  // Three shapes are emptiness rather than loss, and none of them warns:
  //
  // - **The leading bucket**, when nothing adopted it (every canonically-written
  //   Ritual deck opens with a header) or when an `#` H1 adopted it — `# My Deck`
  //   above the sections is a document title, which is how imported and
  //   hand-written decks name themselves. An `##`-or-deeper first heading with no
  //   cards under it is a genuine empty section and does warn.
  // - **A deck with no cards at all**, which is exactly what `ritual` writes for a
  //   freshly created list (`## Main` and nothing else). There is no content to
  //   lose, and warning would refuse the very first save into a new deck.
  // - **An empty extras section** (`## Maybeboard`, `## Tokens`) — see
  //   {@link isDroppedEmptySection}. It is reported as an advisory so the
  //   whole-file gates let the rewrite through and the serializer, which drops
  //   the same sections, can clear the header.
  const validSections = sections.filter((s) => s.cards.length > 0)
  if (validSections.length > 0) {
    for (const section of sections) {
      if (section.cards.length > 0) continue
      if (section === syntheticMain && (syntheticMainLevel === null || syntheticMainLevel === 1)) {
        continue
      }
      if (isDroppedEmptySection(section)) {
        advisories.push(`Dropped empty section: ${section.name}`)
        continue
      }
      warnings.push(`Skipped empty section: ${section.name}`)
    }
  }

  const deck: DeckData = {
    name,
    format,
    description,
    primer,
    sourceUrl,
    sourceId,
    sections: validSections,
  }
  return { deck, warnings, fencedLines, advisories }
}

/**
 * Read a deck file (plus its `.primer.md` sidecar) and return the parse result
 * INCLUDING `warnings` — the lines the parser could not read.
 *
 * {@link importFromTextFile} is this minus the warnings, for the many callers
 * that only want the deck; anything that re-serializes the file, or reports what
 * a load actually saw, must go through this one.
 */
export async function loadDeckFile(
  filePath: string,
  options?: ParseDeckTextOptions,
): Promise<DeckParseResult> {
  const file = Bun.file(filePath)
  if (!(await file.exists())) {
    throw new Error(`File not found: ${filePath}`)
  }

  const rawText = await file.text()

  const primerPath = filePath.replace(/\.[^.]+$/, '.primer.md')
  const primerFile = Bun.file(primerPath)
  const primer = (await primerFile.exists())
    ? (await primerFile.text()).trim() || undefined
    : undefined

  return parseDeckText(rawText, path.basename(filePath, path.extname(filePath)), primer, options)
}

/**
 * Read a deck file (and its primer sidecar) into {@link DeckData}. Skipped-line
 * warnings are dropped here — callers that re-serialize the file, or surface
 * what the load saw, use {@link loadDeckFile} instead.
 */
export async function importFromTextFile(filePath: string): Promise<DeckData> {
  return (await loadDeckFile(filePath)).deck
}
