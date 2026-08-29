import type { Card } from '../card/card'
import type { DeckData, DeckSection } from '../list/deck'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import matter from 'gray-matter'
import { malformedLanguageTokenHint } from '../card/card-language'
import { readListDefaultLabels, unsupportedLabelsFor, type CardLabel } from '../card/card-labels'
import {
  isCommentLine,
  parseCardLine,
  type CardLineDiagnostic,
  type LineTokens,
} from '../card/card-line-grammar'
import { isCardCandidate } from '../card/card-line-read'
import { createLineDiagnostics, type ListFileParseOptions } from '../list/line-diagnostics'
import { listDescriptionOrUndefined } from '../list/list-description'
import { readListImage } from '../list/list-image'
import { isDroppedEmptySection, parseDeckFormat } from '../list/deck-format'
import { createFenceTracker, frontMatterBodyStart } from '../list/markdown-fence'
import { isListMarkdownFile } from '../list/list-file-name'
import { parseHeading } from '../list/section-format'
import { listTypeLabel, type ListType } from '../list/list-type'

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

/**
 * How a text source should be read.
 *
 * There is no dialect switch: the Arena/MTGO/Moxfield export forms —
 * `N Name (SET) NUM` card lines, `*F*`/`*E*` finish markers (trailing, or
 * between the set and the collector number as Moxfield writes them), bare
 * `Deck`/`Sideboard`/`Commander`/`Companion` section markers and the `About`
 * block — are **always** recognized, because read tolerance is a property of
 * the one card-line grammar rather than of the surface that called it (see
 * `card-line-grammar.ts`: lenient in, canonical out). What still varies is
 * whether a fenced block is packaging or prose, and which list type the cards
 * are bound for.
 */
export type ParseDeckTextOptions = ListFileParseOptions & {
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
  /**
   * The list type the cards are bound for, which decides which `[label]`
   * tokens survive: `[sale]` is dropped (with a warning) from a deck but kept
   * by a collection import. Defaults to `deck`, the type this parser's own
   * grammar describes.
   */
  listType?: ListType
}

/**
 * How the import surfaces read a third-party text source. Shared so the CLI and
 * the admin import route can never disagree about how a pasted list is read.
 * The card-line dialects need no opt-in — only the fence does, because a pasted
 * decklist is very often wrapped in one.
 */
export const IMPORT_TEXT_PARSE_OPTIONS: ParseDeckTextOptions = {
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
  /**
   * Every card-line diagnostic above in structured form — code, offending
   * token, column. The strings in {@link warnings} and {@link advisories} are
   * these, rendered, alongside the front-matter and section messages this
   * parser raises about the file rather than about one line.
   */
  diagnostics: CardLineDiagnostic[]
}

/**
 * A card line's label override for the list type it is bound for: the labels
 * the destination keeps (absent when the line carries no token), plus the
 * warning explaining a token that was dropped.
 */
type DeckLineLabels = { labels?: CardLabel[] } | { labels?: undefined; warning: string }

/**
 * Narrow a card line's labels to the ones `listType` carries. The grammar has
 * already refused a malformed or self-conflicting token, so the only failure
 * left here is a *value* one: a label this type does not carry (`[keep]` in a
 * deck file). The card is kept — it is perfectly usable on read surfaces — and
 * the labels are dropped, which is exactly why this is a warning and not an
 * advisory: a whole-file rewrite would lose the token, so the rewrite gates
 * must block.
 */
function deckLineLabels(
  labels: readonly CardLabel[] | undefined,
  cardName: string,
  line: string,
  listType: ListType,
): DeckLineLabels {
  if (labels === undefined) return {}
  const unsupported = unsupportedLabelsFor(listType, labels)
  if (unsupported.length > 0) {
    return {
      warning:
        `Labels [${unsupported.join(',')}] on '${cardName}' are not supported on a ${listTypeLabel(listType)}. ` +
        `The labels were ignored, and a rewrite would drop them: ${line}`,
    }
  }
  return { labels: [...labels] }
}

/**
 * One deck card from the tokens its line carried. The grammar has already
 * resolved every read tolerance (`4x`, `(SET) CN`, `*F*`, token order), so the
 * only judgement left is the label narrowing, whose refusal is a warning the
 * caller collects rather than a lost line.
 */
function deckCard(tokens: LineTokens, line: string, listType: ListType, warnings: string[]): Card {
  const labels = deckLineLabels(tokens.labels, tokens.name, line, listType)
  if ('warning' in labels) warnings.push(labels.warning)
  return {
    quantity: tokens.quantity,
    name: tokens.name,
    // Both halves or neither — a printing is a pair (see `resolvePrinting`).
    set: tokens.printing?.set,
    collectorNumber: tokens.printing?.collectorNumber,
    finish: tokens.finish,
    condition: tokens.condition,
    // Set only when the token is present — a bare line means `en` and stays bare.
    language: tokens.language,
    labels: labels.labels,
    note: tokens.note,
    cardId: tokens.cardId,
  }
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
  const readFencedContent = options?.readFencedContent === true
  const listType: ListType = options?.listType ?? 'deck'
  // `parsed.content` starts at the first body line, so a diagnostic's file line
  // is its index in that content plus however many lines the front matter took.
  const bodyOffset = frontMatterBodyStart(rawText.split(/\r?\n/))

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
  const report = createLineDiagnostics(options?.file)
  const { warnings, advisories } = report
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

  for (const [index, line] of lines.entries()) {
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
    // A `//` comment is a recognized line kind: read-tolerated, dropped on
    // write. Decklist exports use it for section names and attribution.
    if (isCommentLine(trimmed)) {
      inAboutBlock = false
      continue
    }

    const heading = parseHeading(trimmed)
    if (heading) {
      inAboutBlock = false
      startSection(heading.text, heading.level)
      continue
    }

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

    if (isCardCandidate('deck', trimmed)) {
      // Always the deck grammar, whatever the cards are bound for: this is the
      // quantity-led decklist form, and `listType` only decides which of the
      // labels it read the destination can keep.
      const card = parseCardLine('deck', trimmed)
      if (!card.ok) {
        report.record(card, bodyOffset + index + 1)
        continue
      }
      for (const advisory of card.advisories) report.record(advisory, bodyOffset + index + 1)
      currentSection.cards.push(deckCard(card.tokens, trimmed, listType, report.warnings))
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
  return { deck, warnings, fencedLines, advisories, diagnostics: report.diagnostics }
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
