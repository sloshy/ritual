import type { Card } from '../card/card'
import type { DeckData, DeckSection } from '../list/deck'
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import matter from 'gray-matter'
import { misspelledLanguage } from '../card/card-language'
import {
  listDefaultLabels,
  readListDefaultLabels,
  unsupportedLabelsFor,
  type CardLabel,
  type LabelOverride,
  type SignedCardLabel,
} from '../card/card-labels'
import {
  isCommentLine,
  parseCardLine,
  type CardLineDiagnostic,
  type LineTokens,
} from '../card/card-line-grammar'
import { isCardCandidate, readCardLine } from '../card/card-line-read'
import {
  createLineDiagnostics,
  type LineDiagnostics,
  type ListFileParseOptions,
  type ParseNotice,
} from '../list/line-diagnostics'
import { listDescriptionOrUndefined } from '../list/list-description'
import { readListImage } from '../list/list-image'
import {
  canonicalSectionName,
  isDroppedEmptySection,
  parseDeckFormat,
  type SectionRole,
} from '../list/deck-format'
import { createFenceTracker, frontMatterBodyStart } from '../list/markdown-fence'
import { isListMarkdownFile } from '../list/list-file-name'
import { parseHeading, parseTitleFromContent } from '../list/section-format'
import type { ListType } from '../list/list-type'
import { nestSync, syncMessage, SyncMessageError, type SyncMessage } from '../sync/message'

/** A deck directory entry that is a deck's own file. Decks share the one list-file predicate. */
export const isDeckFile = isListMarkdownFile

export async function listDeckFiles(decksDir: string): Promise<string[]> {
  return (await readdir(decksDir)).filter(isDeckFile)
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/\\n/g, '\n') : undefined
}

/**
 * Read just a deck file's display name without parsing its full card list: the
 * first `# Title` H1 (fence- and front-matter-aware), falling back to the file's
 * base name. Used to filter discovered decks by the site `includeDecks` selection.
 */
export async function readDeckName(filePath: string): Promise<string> {
  const rawText = await Bun.file(filePath).text()
  return parseTitleFromContent(rawText) ?? path.basename(filePath, path.extname(filePath))
}

/** The roles an Arena export writes bare marker lines for. */
const ARENA_MARKER_ROLES: readonly SectionRole[] = ['main', 'sideboard', 'commander', 'companion']
/**
 * Bare marker lines an Arena export uses in place of `##` section headers.
 *
 * A `Map` rather than an object literal: the key is arbitrary file content, and
 * an object lookup would resolve inherited keys (`constructor`, `__proto__`)
 * to something other than `undefined`.
 */
const ARENA_SECTION_MARKERS: ReadonlyMap<string, string> = new Map(
  ARENA_MARKER_ROLES.map((role): [string, string] => [
    // Arena writes `Deck`, not `Main`; the other markers are their role names.
    role === 'main' ? 'deck' : role,
    canonicalSectionName(role),
  ]),
)

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
  /**
   * Keep each line's whole label override, even labels `listType` cannot
   * carry (still warned about, for display): an import carries the line's
   * labels as its file states them and lets the destination filter them on
   * arrival (`arrivalLabels`), so narrowing first would lose what a dropped
   * label displaced — a `[sale]` line under a `proxy` default is a real card,
   * not a proxy. Workspace loads never set it: a rewrite would drop the token.
   */
  keepWholeLabels?: boolean
}

/**
 * How the import surfaces read a third-party text source. Shared so the CLI and
 * the admin import route can never disagree about how a pasted list is read.
 * The card-line dialects need no opt-in — only the fence does, because a pasted
 * decklist is very often wrapped in one.
 */
export const IMPORT_TEXT_PARSE_OPTIONS: ParseDeckTextOptions = {
  readFencedContent: true,
  keepWholeLabels: true,
}

/**
 * A {@link ParseNotice} of a deck parse, marked when it is about a card that was
 * KEPT with some or all of its labels dropped (a conflicting token, a label the
 * destination type cannot carry) rather than skipped — so a report can say
 * "imported without its labels" instead of "could not be imported".
 */
export type DeckParseNotice = ParseNotice & { labelsDropped: boolean }

/**
 * A parse warning as an import reports it: the message, marked `labelsDropped:
 * true` when its card WAS imported, only without the labels it carried — so a
 * client can tell "imported without its labels" from "skipped" without reading
 * the prose.
 */
export type ImportParseWarning = SyncMessage & { labelsDropped?: true }

/** A parse's warnings as an import surface reports them, in recording order. */
export function importParseWarnings(notices: readonly DeckParseNotice[]): ImportParseWarning[] {
  return notices
    .filter((notice) => notice.severity === 'warning')
    .map((notice) =>
      notice.labelsDropped ? { ...notice.message, labelsDropped: true } : notice.message,
    )
}

/** A parse's advisories as an import surface reports them, in recording order. */
export function importParseAdvisories(notices: readonly DeckParseNotice[]): SyncMessage[] {
  return notices.filter((notice) => notice.severity === 'advisory').map((notice) => notice.message)
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
   * The file's own front-matter `labels:` default read over the whole label
   * vocabulary (whatever list type it came from), when it declares a legal
   * one: what an *import* measures the file's card labels against, so each
   * line's meaning survives the move into a list with a different default.
   * Loads of workspace decks read their default through the deck front-matter
   * validator instead.
   */
  defaultLabels?: CardLabel[]
  /**
   * {@link warnings} and {@link advisories} again, in recording order, as
   * messages (English plus the catalog key) — what an import surface reports
   * to a reader who may not read English. See {@link DeckParseNotice} for the
   * labels-dropped mark.
   */
  notices: DeckParseNotice[]
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
type DeckLineLabels = { labels?: LabelOverride } | { labels?: undefined; warning: SyncMessage }

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
  labels: readonly SignedCardLabel[] | undefined,
  cardName: string,
  line: string,
  listType: ListType,
): DeckLineLabels {
  if (labels === undefined) return {}
  const unsupported = unsupportedLabelsFor(listType, labels)
  if (unsupported.length > 0) {
    return {
      warning: syncMessage('domain.import.text.labelsUnsupported', {
        listType,
        labels: unsupported.join(','),
        card: cardName,
        line,
      }),
    }
  }
  return { labels: [...labels] }
}

/**
 * Record a warning about a card that was kept with its labels dropped, marking
 * its notice so a report can tell it from a skipped line.
 */
function warnLabelsDropped(
  report: LineDiagnostics,
  labelsDropped: Set<ParseNotice>,
  message: SyncMessage,
): void {
  labelsDropped.add(report.warn(message))
}

/**
 * One deck card from the tokens its line carried. The grammar has already
 * resolved every read tolerance (`4x`, `(SET) CN`, `*F*`, token order), so the
 * only judgement left is the label narrowing, whose refusal is a warning the
 * caller collects rather than a lost line.
 */
function deckCard(
  tokens: LineTokens,
  line: string,
  listType: ListType,
  report: LineDiagnostics,
  labelsDropped: Set<ParseNotice>,
  keepWholeLabels: boolean,
): Card {
  const narrowed = deckLineLabels(tokens.labels, tokens.name, line, listType)
  if ('warning' in narrowed) warnLabelsDropped(report, labelsDropped, narrowed.warning)
  const labels: DeckLineLabels =
    keepWholeLabels && tokens.labels !== undefined ? { labels: [...tokens.labels] } : narrowed
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
    tags: tokens.tags === undefined ? undefined : [...tokens.tags],
    note: tokens.note,
    cardId: tokens.cardId,
  }
}

/**
 * Parse a deck's markdown/decklist text into structured {@link DeckData}.
 *
 * The text may carry optional YAML frontmatter (`description`, `sourceUrl`,
 * `sourceId`, `format`). The deck's name is its first `# Title` H1 — a title,
 * never a section; `fallbackName` is used only when there is none (e.g. an
 * uploaded file's base name or a name entered in the admin UI). `primer` is an
 * optional markdown sidecar.
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
  // The options argument is load-bearing, not decoration: `gray-matter` keeps a
  // module-level cache keyed on file content, and it stores a *partial* entry
  // even for input it threw on, so a second parse of the same broken front
  // matter quietly returns empty data instead of throwing. It only consults
  // that cache when no options are passed, so passing them makes a deck with
  // unreadable front matter fail here every time — rather than being published
  // as an empty deck depending on what parsed the file first.
  const parsed = matter(rawText, { language: 'yaml' })
  const readFencedContent = options?.readFencedContent === true
  const listType: ListType = options?.listType ?? 'deck'
  const keepWholeLabels = options?.keepWholeLabels === true
  // `parsed.content` starts at the first body line, so a diagnostic's file line
  // is its index in that content plus however many lines the front matter took.
  const bodyOffset = frontMatterBodyStart(rawText.split(/\r?\n/))

  let name = fallbackName
  /** Whether a `# Title` H1 has named the deck; a later H1 is not a second title. */
  let titled = false
  /** Whether a card line has been read; an H1 after the deck body is not a title in any dialect. */
  let sawCard = false

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
  // so it is exempt from the dropped-section warning below.
  const syntheticMain: DeckSection = { name: 'Main', cards: [] }
  /** Whether a `##`-or-deeper heading adopted the synthetic bucket as a real section. */
  let syntheticMainAdopted = false
  let currentSection: DeckSection = syntheticMain
  sections.push(currentSection)

  const lines = parsed.content.split(/\r?\n/)
  const report = createLineDiagnostics(options?.file)
  /** The notices about a card kept with its labels dropped — by identity, never by text. */
  const labelsDropped = new Set<ParseNotice>()
  // A `labels:` default the deck cannot carry is dropped by
  // `validateDeckFrontMatter`, so the next save deletes the key outright — the
  // same loss a refused card-line token would cause, and a warning for the same
  // reason: the whole-file-rewrite gates must see it.
  // Only when the cards are bound for a deck: an import into a collection or a
  // wanted list writes no deck, and reads the file's default as data instead
  // (`defaultLabels` below), against which its lines' labels are carried.
  if (listType === 'deck' && 'labels' in parsed.data) {
    const defaultLabels = readListDefaultLabels('deck', parsed.data.labels)
    if (defaultLabels.warning) report.warn(defaultLabels.warning)
  }
  // And the same for an unreadable `image:` cover, for the same reason: users
  // are told to hand-edit this key, so a save that silently deletes it would be
  // the worst possible outcome.
  const listImage = readListImage(parsed.data)
  if (listImage.advisory) {
    report.warn(
      syncMessage('domain.import.text.imageIgnored', { reason: nestSync(listImage.advisory) }),
    )
  }
  // Fenced code blocks are prose: a card-looking line or a `## Heading` inside
  // one is an example, not deck data, and must not warn either.
  const fence = createFenceTracker()
  let fencedLines = 0
  /** Inside an Arena `About` block, whose lines are deck metadata, not cards. */
  let inAboutBlock = false

  /** Start (or adopt the leading bucket as) a section, as a `##` header or marker would. */
  const startSection = (sectionName: string): void => {
    if (
      currentSection === syntheticMain &&
      !syntheticMainAdopted &&
      currentSection.cards.length === 0
    ) {
      syntheticMainAdopted = true
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
    if (heading?.level === 1) {
      inAboutBlock = false
      // The first `# Title` names the deck and is never a section. A second H1
      // is neither a title nor a section, so it is reported like any other line
      // the parser cannot read — a rewrite would drop it. An H1 after the cards
      // is not a title either: it must not rename a deck already named by an
      // `About` block or the caller.
      if (titled) {
        report.warn(syncMessage('domain.import.text.extraTitle', { line: trimmed }))
      } else if (sawCard) {
        report.warn(syncMessage('domain.import.text.malformedLine', { line: trimmed }))
      } else {
        name = heading.text
        titled = true
      }
      continue
    }
    if (heading) {
      inAboutBlock = false
      startSection(heading.text)
      continue
    }

    const marker = ARENA_SECTION_MARKERS.get(trimmed.toLowerCase())
    if (marker !== undefined) {
      inAboutBlock = false
      // A marker is a `##`-equivalent, so an empty one warns like one.
      startSection(marker)
      continue
    }
    if (trimmed.toLowerCase() === 'about') {
      inAboutBlock = true
      continue
    }
    if (inAboutBlock) {
      // `Name My Deck` names the deck (a `# Title` H1, when present, still wins);
      // anything else in the block is metadata this parser does not model.
      const aboutName = trimmed.match(/^Name\s+(.+)$/i)?.[1]?.trim()
      if (aboutName && !titled) {
        name = aboutName
      } else if (!aboutName) {
        report.advise(syncMessage('domain.import.text.aboutLineSkipped', { line: trimmed }))
      }
      continue
    }

    if (isCardCandidate('deck', trimmed)) {
      sawCard = true
      // Always the deck grammar, whatever the cards are bound for: this is the
      // quantity-led decklist form, and `listType` only decides which of the
      // labels it read the destination can keep.
      const card = parseCardLine('deck', trimmed)
      if (!card.ok) {
        const recorded = report.record(card, bodyOffset + index + 1)
        // A conflicting labels token keeps its card with the labels dropped,
        // like an unsupported `[sale]`: the warning still blocks whole-file
        // rewrites, and the line stays findable by the `set-card --label` that
        // repairs it. Every other refusal loses the line.
        const recovered =
          card.code === 'conflicting-labels' ? readCardLine('deck', trimmed) : undefined
        if (recovered !== undefined) {
          if (recorded !== undefined) labelsDropped.add(recorded)
          // The rest of the line was read, so what it has to say still counts —
          // a held quantity behind the refused token above all, which must
          // keep blocking a rewrite once the labels are fixed.
          for (const advisory of recovered.advisories) {
            report.record(advisory, bodyOffset + index + 1)
          }
          currentSection.cards.push(
            deckCard(recovered.tokens, trimmed, listType, report, labelsDropped, keepWholeLabels),
          )
        }
        continue
      }
      for (const advisory of card.advisories) report.record(advisory, bodyOffset + index + 1)
      currentSection.cards.push(
        deckCard(card.tokens, trimmed, listType, report, labelsDropped, keepWholeLabels),
      )
      continue
    }

    // A recognizable-but-misspelled language token ([JA], [jp]) names its fix.
    const language = misspelledLanguage(trimmed)
    report.warn(
      language === undefined
        ? syncMessage('domain.import.text.malformedLine', { line: trimmed })
        : syncMessage('domain.import.text.malformedLineLanguage', { line: trimmed, language }),
    )
  }

  // A section header with no card lines under it is kept, so re-serializing the
  // deck writes it back as a bare header, except in these cases:
  //
  // - **The leading bucket**, when nothing adopted it (every canonically-written
  //   Ritual deck opens with a header): an artifact of parsing, not a section.
  // - **An empty extras section** (`## Maybeboard`, `## Tokens`) — see
  //   {@link isDroppedEmptySection}. The serializer drops the same sections, so
  //   it is reported as an advisory, which the whole-file gates let through.
  //
  // Parser and serializer therefore agree on every empty section, and a removal
  // or move that empties one leaves a file the next parse reads cleanly.
  const hasCards = sections.some((s) => s.cards.length > 0)
  // A freshly created deck (`## Commander` and `## Main`, no cards) keeps its
  // sections too, so the first whole-file rewrite (an editor save, `cleanup`)
  // does not strip the scaffold `ritual new` wrote.
  const isKeptEmpty = (section: DeckSection): boolean =>
    !(section === syntheticMain && !syntheticMainAdopted) && !isDroppedEmptySection(section)
  const validSections = sections.filter((s) => s.cards.length > 0 || isKeptEmpty(s))
  if (hasCards) {
    for (const section of sections) {
      if (isDroppedEmptySection(section)) {
        report.advise(
          syncMessage('domain.import.text.emptySectionDropped', { section: section.name }),
        )
      }
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
  const defaultLabels = listDefaultLabels('collection', parsed.data)
  return {
    deck,
    warnings: [...report.warnings],
    fencedLines,
    advisories: [...report.advisories],
    ...(defaultLabels !== undefined ? { defaultLabels } : {}),
    notices: report.notices.map((notice) => ({
      ...notice,
      labelsDropped: labelsDropped.has(notice),
    })),
    diagnostics: [...report.diagnostics],
  }
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
    throw new SyncMessageError(syncMessage('domain.import.fileNotFound', { path: filePath }))
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
