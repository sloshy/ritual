/**
 * Staged list files for cross-list moves: a list read into memory, card lines
 * removed from and added to it (deck quantity merges, `&N` reuse, dropped
 * notes), and written back with its hash sidecar. Both move engines —
 * `move-commit.ts` and the admin editor saves — apply their moves through
 * these before anything reaches disk.
 */

import * as fs from 'node:fs/promises'
import { hashPath, writeFileWithHash } from '../changes/content-hash'
import { findOrCreateSection, resolveDefaultAddSection } from './deck-format'
import { loadDeckFile } from '../importers/text-file'
import { formatCollectionLine, resolvePrinting, type CardPrinting } from '../card/card-line'
import { formatWantedListLine } from './wanted-file'
import { serializeDeckToMarkdown, parseDeckFrontMatter, type DeckFrontMatter } from './deck-file'
import {
  allocateId,
  allocateNextIdFromContent,
  collectDeckCardIds,
  createIdPool,
  parseCardIdsFromContent,
} from '../card/card-id'
import {
  endsInsideOpenFence,
  frontMatterBodyStart,
  markFencedLines,
  unreadableContentMessage,
  unreadableLines,
} from './markdown-fence'
import type { Card } from '../card/card'
import type { DeckData } from './deck'
import { type ListRef, type MovedCopyFields, type PrintingTuple } from '../changes/change-event'
import { displayLanguage } from '../card/card-language'
import { findMatchKey } from '../card/find-search'
import { t } from '../i18n/t'
import { isCardCandidate, readCardLine } from '../card/card-line-read'
import { foldCategoryCardName } from '../card/card-categories'
import { deckCardNameSet } from './card-names'
import { commitCategoryChanges } from './card-categories-sidecar'
import { loadDefaultCategories } from '../config/ritual-config'
import {
  arrivalLabels,
  effectiveLabels,
  listDefaultLabels,
  sameCardLabels,
  type CardLabel,
} from '../card/card-labels'
import { normalizedTags, sameCardTags, type CardTag } from '../card/card-tags'
import { findDeckMergeLine, type DeckAdd } from '../changes/deck-changes'
import { parseFlatListFrontMatter } from './flat-list-front-matter'
import type { ListEntry } from './list-info'
import { readCardId } from '../card/card-line-grammar'

/**
 * A single movable card. For deck entries with quantity > 1, multiple PhysicalCards
 * are created (one per copy), keyed by `filePath:cardId:copyIndex`.
 *
 * Its {@link MovedCopyFields} are the source LINE's: `labels` is the line's own
 * override (what a removal record names). What a move carries is the copy's
 * effective labels, {@link movingLabels} — that override, else `listLabels`.
 */
export type PhysicalCard = PrintingTuple &
  MovedCopyFields & {
    /** Stable unique key within the session (used to look up VirtualCard). */
    key: string
    name: string
    /** The source list's front-matter default labels, which a line without an override inherits. */
    listLabels?: CardLabel[]
    /**
     * The source line's `&N`. Names the copy in a dropped-note report; the
     * destination always allocates (or merges onto) a line id of its own.
     */
    cardId?: number
    listEntry: ListEntry
    /** Only set for deck cards: the copy index when quantity > 1. */
    copyIndex?: number
  }

/**
 * The labels a physical card carries across a move: its effective labels in
 * its source list (the line's override, else the list's default). Every move
 * path carries these, and the destination writes the minimal override for what
 * its type accepts (`arrivalLabels`).
 */
export function movingLabels(card: PhysicalCard): CardLabel[] {
  return effectiveLabels(card.labels, card.listLabels)
}

/**
 * A copy a move adds to a staged list. `carriedLabels` are the labels the copy
 * carries — its effective labels in its source — stated apart from any line's
 * override, so no caller can fold a list default in twice; the destination
 * writes the minimal override for them (`arrivalLabels`). Every payload field is
 * required-but-nullable, so a caller states each one. `sourceCardId` is the
 * source line's `&N`, naming the copy in a dropped-note report; the destination
 * always allocates (or merges onto) a line id of its own.
 */
export type ArrivingCopy = PrintingTuple & {
  name: string
  tags: CardTag[] | undefined
  note: string | undefined
  carriedLabels: CardLabel[] | undefined
  sourceCardId: number | undefined
}

/** The {@link ArrivingCopy} a physical card makes: its printing, payload and effective labels. */
export function arrivingCopyOf(card: PhysicalCard): ArrivingCopy {
  return {
    name: card.name,
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    language: card.language,
    tags: card.tags,
    note: card.note,
    carriedLabels: movingLabels(card),
    sourceCardId: card.cardId,
  }
}

/**
 * A staged list's own front-matter default labels (`listDefaultLabels`): what
 * an arriving copy's labels are measured against (`arrivalLabels`), and what a
 * departing line without an override inherits. Wanted lists carry no labels.
 */
export function stagedDefaultLabels(staged: StagedFile): CardLabel[] | undefined {
  if (staged.kind === 'deck') return staged.data.frontMatter.labels
  const lines = staged.content.split('\n')
  return listDefaultLabels(
    staged.type,
    parseFlatListFrontMatter(lines, { validateLabels: false }).frontMatter?.data,
  )
}

export type DeckWithFrontMatter = {
  deck: DeckData
  /** Validated on load (`parseDeckFrontMatter`), so its `labels` is already the deck's default. */
  frontMatter: DeckFrontMatter
}

type StagedDeckFile = { kind: 'deck'; data: DeckWithFrontMatter }
/**
 * A staged flat list. It carries its own `type` because the card-line grammar
 * differs between the two: a collection line always names a printing and may
 * carry a condition and labels, a wanted line may do neither. Reading a wanted
 * file through the collection grammar (as one shared regex used to) refuses
 * every name-only bullet in it.
 */
type StagedTextFile = { kind: 'text'; type: 'collection' | 'wanted'; content: string }
export type StagedFile = StagedDeckFile | StagedTextFile

/**
 * The outcome of staging a file for a move: the staged state, or the reason the
 * move must not touch this file at all.
 */
export type LoadStagedResult =
  | { ok: true; file: StagedFile }
  | { ok: false; reason: 'unreadable-file' | 'unreadable-lines'; message: string }

export async function readDeckAndFrontMatter(
  filePath: string,
): Promise<DeckWithFrontMatter | null> {
  const result = await loadStagedDeck(filePath)
  return result.ok && result.file.kind === 'deck' ? result.file.data : null
}

async function loadStagedDeck(filePath: string): Promise<LoadStagedResult> {
  const fm = await parseDeckFrontMatter(filePath).catch(() => null)
  const parsed = await loadDeckFile(filePath).catch(() => null)
  if (fm === null || parsed === null) {
    return {
      ok: false,
      reason: 'unreadable-file',
      message: t('cli.move.cannotReadDeck', { file: filePath }),
    }
  }
  // A deck side of a move is written back by re-serializing the whole file, so
  // anything the parse could not carry — a skipped line, a fenced code block —
  // would be deleted by the write. Refuse the move instead.
  const lost = unreadableLines(parsed)
  if (lost.length > 0) {
    return {
      ok: false,
      reason: 'unreadable-lines',
      message: unreadableContentMessage(filePath, lost, 'moving'),
    }
  }
  return { ok: true, file: { kind: 'deck', data: { deck: parsed.deck, frontMatter: fm } } }
}

/** Load a file into staged in-memory state. */
export async function loadStagedFile(
  filePath: string,
  type: ListRef['type'],
): Promise<LoadStagedResult> {
  if (type === 'deck') return loadStagedDeck(filePath)
  const content = await fs.readFile(filePath, 'utf-8').catch(() => null)
  if (content === null) {
    return {
      ok: false,
      reason: 'unreadable-file',
      message: t('cli.move.cannotReadFile', { file: filePath }),
    }
  }
  return { ok: true, file: { kind: 'text', type, content } }
}

/**
 * How a move aborts when a list it needs cannot be staged: `missingKey` names
 * the unreadable file, `abortKey` carries the staging refusal's own message
 * (e.g. a deck with lines the write would lose).
 */
export type StagedAbortKeys = {
  missingKey:
    | 'cli.move.abortDestinationMissing'
    | 'cli.move.abortSourceUnreadable'
    | 'cli.move.abortRemoveSourceUnreadable'
  abortKey: 'cli.move.abortMove' | 'cli.move.abortRemove'
}

/**
 * {@link loadStagedFile} for a commit that must not touch any file unless every
 * file stages: an unreadable list throws with the caller's wording instead of
 * returning a refusal to thread through.
 */
export async function loadStagedOrThrow(
  entry: ListEntry,
  keys: StagedAbortKeys,
): Promise<StagedFile> {
  const loaded = await loadStagedFile(entry.filePath, entry.ref.type)
  if (loaded.ok) return loaded.file
  throw new Error(
    loaded.reason === 'unreadable-file'
      ? t(keys.missingKey, { file: entry.filePath })
      : t(keys.abortKey, { reason: loaded.message }),
  )
}

/**
 * Write every staged file back in one pass, returning each list path and its
 * hash sidecar so the caller can stage them.
 */
export async function writeStagedFiles(
  staged: Iterable<readonly [string, StagedFile]>,
): Promise<string[]> {
  const written: string[] = []
  for (const [filePath, file] of staged) {
    await writeStagedFile(filePath, file)
    written.push(filePath, hashPath(filePath))
  }
  return written
}

/**
 * Every `&N` the staged file still carries.
 *
 * What a caller reconciling the list's art sidecar checks against: a deck
 * removal decrements a line's quantity and only deletes the line at zero, so
 * "the card was removed" and "the id is gone" are different questions, and only
 * the second one releases the id to the reuse pool.
 *
 * Flat lists are scanned with `parseCardIdsFromContent`, the same reader
 * `allocateNextIdFromContent` allocates against — so this answer and the
 * allocator's cannot disagree about whether an id inside front matter or a
 * fenced example is taken.
 */
export function stagedCardIds(staged: StagedFile): Set<number> {
  if (staged.kind === 'deck') return new Set(collectDeckCardIds(staged.data.deck))
  return new Set(parseCardIdsFromContent(staged.content))
}

/**
 * The card names a staged file still holds, and whether that answer is complete.
 *
 * `names` are folded through {@link foldCategoryCardName} — the categories
 * sidecar's key space — and are read after this move's removals and adds, so
 * they answer "which names does this list have once this move is written".
 *
 * `complete` is false when the file holds a body bullet the card-line grammar
 * could not read. It matters because the two questions are not symmetric: the
 * move itself only has to FIND one line, while pruning needs EVERY name — a
 * bullet this could not parse holds a card that is still in the file, and
 * dropping its categories would destroy assignments the list still backs. A
 * staged deck is always complete: {@link loadStagedFile} refuses to stage a deck
 * with lines a re-serialize would lose.
 */
export type StagedCardNames = {
  names: Set<string>
  complete: boolean
}

export function stagedCardNames(staged: StagedFile): StagedCardNames {
  if (staged.kind === 'deck') return { names: deckCardNameSet(staged.data.deck), complete: true }
  const names = new Set<string>()
  let complete = true
  for (const { trimmed } of cardBullets(staged)) {
    const fields = textLineFields(staged, trimmed)
    // Keep walking rather than returning early: the flag is the answer, and
    // the names read so far stay useful to a caller that only reports them.
    if (fields === undefined) complete = false
    else names.add(foldCategoryCardName(fields.name))
  }
  return { names, complete }
}

/** One card-line candidate in a staged flat list: its index and its trimmed text. */
type CardBullet = { index: number; trimmed: string }

/**
 * Every body line of a staged flat list the card-line grammar would offer to
 * its tokenizer, in file order.
 *
 * The candidate rule is {@link isCardCandidate}, the grammar's own — a scanner
 * that demanded `"- "` where the parser accepts `-\t` would call a line the
 * parser reads perfectly well prose. Fenced lines and front-matter list items
 * are skipped: a bullet inside a fenced example is the user's prose, and a
 * `- keep` under `---` is YAML.
 *
 * Written once because both readers of a staged file ask the same question:
 * {@link stagedCardNames}, which needs every name, and `removeTextLine`, which
 * needs the first match.
 */
function* cardBullets(staged: StagedTextFile): Generator<CardBullet> {
  const lines = staged.content.split('\n')
  const fenced = markFencedLines(lines)
  const bodyStart = frontMatterBodyStart(lines)
  for (const [index, line] of lines.entries()) {
    if (index < bodyStart || fenced[index]) continue
    const trimmed = line.trim()
    if (!isCardCandidate(staged.type, trimmed)) continue
    yield { index, trimmed }
  }
}

/**
 * Prune every staged list's categories sidecar to the names it still holds, and
 * return the files that changed. Design §2's "the entry is pruned on that save"
 * applied to the move write path, where a source list can lose its last copy of
 * a name and a destination can gain one.
 *
 * A file whose staged read is not complete ({@link StagedCardNames}) is skipped
 * entirely — no prune, no canonicalize, nothing written — the same gate
 * `ritual cleanup` applies through its `rewriteBlocked` check. Its sidecar keeps
 * every entry, including ones that may now be stale; a later clean parse prunes
 * them.
 */
/** What a move's categories prune did: the files it wrote, and the assignments it dropped. */
export type StagedCategoryPrunes = {
  writtenFiles: string[]
  /**
   * Stored names whose categories entry the prune removed. Reported rather than
   * swallowed: dropping an assignment the user made is an effect of the save,
   * and design §2 asks every save surface to list it.
   */
  pruned: string[]
}

export async function commitStagedCategoryPrunes(
  staged: Iterable<readonly [string, StagedFile]>,
): Promise<StagedCategoryPrunes> {
  const defaultCategories = await loadDefaultCategories()
  const writtenFiles: string[] = []
  const pruned: string[] = []
  for (const [filePath, file] of staged) {
    const { names, complete } = stagedCardNames(file)
    if (!complete) continue
    // A sidecar this cannot read keeps its own contents untouched: the move
    // itself is complete either way, and every read path already reports an
    // unreadable sidecar — the same choice `commitArtReconciles` makes here.
    const result = await commitCategoryChanges(filePath, [], {
      knownCardNames: names,
      defaultCategories,
    })
    writtenFiles.push(...result.writtenFiles)
    pruned.push(...result.pruned)
  }
  return { writtenFiles, pruned }
}

/** Write a staged file back to disk. */
export async function writeStagedFile(filePath: string, staged: StagedFile): Promise<void> {
  if (staged.kind === 'deck') {
    const content = serializeDeckToMarkdown(staged.data.deck, staged.data.frontMatter)
    await writeFileWithHash(filePath, content)
  } else {
    await writeFileWithHash(filePath, staged.content)
  }
}

/**
 * Apply an in-memory removal to a staged file.
 * Returns true if the card was found and removed.
 *
 * For text files, also matches set/collectorNumber in the name-based fallback
 * to avoid removing the wrong card when duplicate names exist.
 */
export function applyRemoveFromStaged(staged: StagedFile, card: PhysicalCard): boolean {
  if (staged.kind === 'deck') {
    return applyRemoveFromDeck(staged, card)
  }
  return applyRemoveFromText(staged, card)
}

function applyRemoveFromDeck(staged: StagedDeckFile, card: PhysicalCard): boolean {
  const match =
    card.cardId !== undefined
      ? (c: Card): boolean => c.cardId === card.cardId
      : (c: Card): boolean =>
          c.name === card.name &&
          (card.set === undefined || c.set?.toLowerCase() === card.set.toLowerCase()) &&
          (card.collectorNumber === undefined || c.collectorNumber === card.collectorNumber)
  return removeDeckCopy(staged, match) !== null
}

/**
 * Take one copy off the first deck line satisfying `match`: the line's quantity
 * drops by one and the line goes at zero. A section it empties stays, as it
 * does for any other removal; the serializer decides which empty sections
 * reach the file (`isDroppedEmptySection`). Returns the line's id, or `null`
 * when nothing matched.
 */
function removeDeckCopy(
  staged: StagedDeckFile,
  match: (card: Card) => boolean,
): RemovedCopy | null {
  const { deck } = staged.data
  for (const section of deck.sections) {
    const idx = section.cards.findIndex(match)
    if (idx === -1) continue
    const c = section.cards[idx]!
    c.quantity -= 1
    if (c.quantity <= 0) section.cards.splice(idx, 1)
    return {
      name: c.name,
      tags: c.tags,
      labels: c.labels,
      note: c.note,
      cardId: c.cardId,
      set: c.set?.toLowerCase(),
      collectorNumber: c.collectorNumber,
      finish: c.finish,
      condition: c.condition,
      language: c.language,
      section: section.name,
    }
  }
  return null
}

/**
 * What a flat-list bullet says about its card, read through the one card-line
 * grammar for the staged file's own type. Set code lowercased, as every
 * in-memory representation is.
 */
type TextLineFields = PrintingTuple &
  MovedCopyFields & {
    name: string
    cardId?: number
  }

/** The parse of a flat-list bullet, or `undefined` when the line is not one. */
function textLineFields(staged: StagedTextFile, trimmed: string): TextLineFields | undefined {
  const read = readCardLine(staged.type, trimmed)
  if (read === undefined) return undefined
  const { name, printing, finish, condition, language, labels, tags, note, cardId } = read.tokens
  return {
    name,
    set: printing?.set,
    collectorNumber: printing?.collectorNumber,
    finish,
    condition,
    language,
    tags: tags === undefined ? undefined : [...tags],
    labels: labels === undefined ? undefined : [...labels],
    note,
    cardId,
  }
}

/**
 * Remove the first unfenced bullet line satisfying `match`. Returns the line's
 * id, or `null` when nothing matched.
 */
function removeTextLine(
  staged: StagedTextFile,
  match: (trimmed: string) => boolean,
): RemovedCopy | null {
  const lines = staged.content.split('\n')
  let targetIdx = -1
  for (const bullet of cardBullets(staged)) {
    if (match(bullet.trimmed)) {
      targetIdx = bullet.index
      break
    }
  }
  if (targetIdx === -1) return null
  const trimmed = lines[targetIdx]!.trim()
  // Precondition: every caller that persists the returned copy (the incoming
  // matcher, whose `RemovedCopy.name` becomes a changelog line) matches
  // through `textLineFields`, so a line it removes always parses. Only the
  // id-only path of `applyRemoveFromText` — which discards the copy — can
  // remove a line the canonical grammar cannot read; that copy reports its
  // `&N` and an empty name, never the raw line text, so a future caller
  // could not write the bullet itself into a changelog.
  const removed: RemovedCopy = textLineFields(staged, trimmed) ?? {
    name: '',
    cardId: readCardId(trimmed),
  }
  lines.splice(targetIdx, 1)
  staged.content = collapseBlankRuns(lines)
  return removed
}

function applyRemoveFromText(staged: StagedTextFile, card: PhysicalCard): boolean {
  // An ID is authoritative (mirrors the deck removal path): falling through
  // to the name match on an ID miss could remove a sibling line that shares
  // the printing but differs in finish or condition.
  if (card.cardId !== undefined) {
    return removeTextLine(staged, (trimmed) => readCardId(trimmed) === card.cardId) !== null
  }
  // Fallback: match by name, also using set/collectorNumber when available
  const removed = removeTextLine(staged, (trimmed) => {
    const line = textLineFields(staged, trimmed)
    if (line === undefined || line.name !== card.name) return false
    if (card.set !== undefined && card.collectorNumber !== undefined && line.set !== undefined) {
      return (
        line.set === card.set.toLowerCase() &&
        line.collectorNumber?.toLowerCase() === card.collectorNumber.toLowerCase()
      )
    }
    return true
  })
  return removed !== null
}

/**
 * The copy an incoming move takes out of its source list, as the `move-to`
 * event describes it. `cardId` is the event's `sourceCardId` hint; the printing
 * tuple is the one the copy arrives with — which a printing-less source line (a
 * wanted entry, a name-only deck line) never carried. `tags` are the copy's, so
 * two source lines differing only in tags are told apart; `labels` are its
 * effective labels, a preference that picks a `[proxy]` line over the real one
 * of the same printing (see {@link applyRemoveIncomingFromStaged}).
 */
export type IncomingCopy = PrintingTuple &
  Pick<MovedCopyFields, 'tags' | 'labels'> & {
    name: string
    cardId?: number
  }

/**
 * What a removal took out, as the line was written: its own name spelling,
 * printing tuple (bare tokens left absent), `&N`, tags, note and label
 * override (the line's own — its list's default is the caller's to fold in).
 * The source changelog describes the line, not the event that asked for it.
 */
export type RemovedCopy = PrintingTuple &
  MovedCopyFields & {
    name: string
    cardId?: number
    /** The deck section the line sat in (absent for a flat-list bullet). */
    section?: string
  }

/** The line-side view the incoming tiers compare against, for a deck card or a flat-list bullet. */
type LineView = RemovedCopy

/** Whether two lines pin the same `SET:CN` (both lowercased), ignoring finish, condition and language. */
function sameSetAndNumber(line: PrintingTuple, copy: CardPrinting): boolean {
  return (
    line.set?.toLowerCase() === copy.set &&
    line.collectorNumber?.toLowerCase() === copy.collectorNumber.toLowerCase()
  )
}

/**
 * Whether a written line is the physical copy a `move-to` describes, printing
 * included. A line with no finish token is "the printing's default finish" —
 * which is exactly what the planner resolved the copy to (a bare line pinning
 * a foil-only printing arrives as `finish: 'foil'`), so it matches an event of
 * any finish; a tokened line still needs the exact finish. Condition and
 * language fold to their bare-line defaults on both sides.
 */
function sameCopy(line: LineView, copy: IncomingCopy, printing: CardPrinting): boolean {
  return (
    sameSetAndNumber(line, printing) &&
    (line.finish === undefined || line.finish === (copy.finish ?? 'nonfoil')) &&
    (line.condition ?? 'NM') === (copy.condition ?? 'NM') &&
    displayLanguage(line.language) === displayLanguage(copy.language) &&
    sameCardTags(line.tags, copy.tags)
  )
}

/**
 * The ordered matchers of {@link applyRemoveIncomingFromStaged}, shared by the
 * deck and flat-list halves so both state one rule. Names compare the way the
 * planner matched them — front face, case- and diacritic-folded — so a
 * double-faced event finds its front-face line.
 */
function incomingTiers(
  copy: IncomingCopy,
  sourceDefault: readonly CardLabel[] | undefined,
): ((line: LineView) => boolean)[] {
  const printing: CardPrinting | undefined = resolvePrinting(copy.set, copy.collectorNumber)
  const nameKey = findMatchKey(copy.name)
  const sameName = (line: LineView): boolean => findMatchKey(line.name) === nameKey
  const printingless = (line: LineView): boolean =>
    resolvePrinting(line.set, line.collectorNumber) === undefined
  type Tier = (line: LineView) => boolean
  const tiers: Tier[] = []
  if (copy.cardId !== undefined) {
    // The id disambiguates sibling lines (same tuple, different `&N`) and is
    // trusted regardless of finish; it is still guarded by name and, when the
    // line pins a printing, by `SET:CN` — a freed `&N` is handed straight to
    // the next card added, so a stale hint may sit on a same-named line that
    // pins another printing.
    tiers.push(
      (line) =>
        line.cardId === copy.cardId &&
        sameName(line) &&
        (printing === undefined || printingless(line) || sameSetAndNumber(line, printing)),
    )
  }
  // The fallbacks, in levels of printing confidence.
  const levels: Tier[][] = []
  if (printing !== undefined) {
    // The copy's printing: the exact copy first — a line whose finish token
    // states this finish — and only then a bare line of the printing (the
    // printing's default finish, which matches any finish the planner resolved
    // the copy to), so a `[foil]` line is taken for a foil copy however the
    // file orders them.
    levels.push([
      (line) => line.finish !== undefined && sameName(line) && sameCopy(line, copy, printing),
      (line) => line.finish === undefined && sameName(line) && sameCopy(line, copy, printing),
    ])
  }
  levels.push([(line) => sameName(line) && printingless(line)])
  if (printing === undefined) levels.push([(line) => sameName(line)])
  // Labels are a preference within a level, never a filter and never above
  // printing confidence: each level is tried first among the lines whose
  // effective labels are the copy's — so a `[proxy]` copy takes the proxy line
  // of its printing over the real one (a bare proxy line over a `[foil]` real
  // one too, the two finish tiers sharing a level), and a plain copy the real
  // one — then among all of that level's lines, and only then does the search
  // fall to the next level. A move that carries no labels (a swap) still finds
  // its copy.
  const sameLabels = (line: LineView): boolean =>
    sameCardLabels(effectiveLabels(line.labels, sourceDefault), copy.labels)
  for (const level of levels) {
    for (const tier of level) tiers.push((line) => tier(line) && sameLabels(line))
    tiers.push(...level)
  }
  return tiers
}

/**
 * Remove one copy for an incoming move (`move-to {from}` saved on the
 * destination), resolving the source line in order of confidence:
 *
 * Within each of tiers 2–4 the lines whose effective labels equal the copy's
 * `labels` are tried first, then the whole tier (see `incomingTiers`). Accepted
 * consequence: a fallback tier can take a differently labelled line when none
 * of that printing carries the copy's labels — a stale bundle with no
 * `sourceCardId`, say — while the destination has already landed the event's
 * own labels. The move still takes a real copy of the card it names.
 *
 * 1. the line carrying `cardId`, provided it names the same card and either
 *    pins no printing or pins this `SET:CN` (finish is not consulted: the id
 *    already tells sibling lines apart) — the hint is authoritative while it
 *    is current, and guarded because a stale id (the source list was edited
 *    since the move was staged) may now sit on an unrelated line;
 * 2. the line that is this copy — same `SET:CN`, language and condition, and
 *    the same finish unless the line carries no finish token at all (see
 *    `sameCopy`);
 * 3. a printing-less line of that name — the source never had a printing and
 *    the event carries the one chosen on the way in (the wanted-list flow);
 * 4. for an event that carries no printing at all, any line of that name.
 *
 * A line pinning a *different* printing — or a tokened line in another finish
 * or language — is never taken: that would move a card the user did not
 * choose. Returns the removed line as written, or `null` when no tier matched
 * (the caller treats that as a failed, non-writing save).
 */
export function applyRemoveIncomingFromStaged(
  staged: StagedFile,
  copy: IncomingCopy,
): RemovedCopy | null {
  const tiers = incomingTiers(copy, stagedDefaultLabels(staged))
  if (staged.kind === 'deck') {
    for (const match of tiers) {
      const removed = removeDeckCopy(staged, match)
      if (removed !== null) return removed
    }
    return null
  }
  for (const match of tiers) {
    const removed = removeTextLine(staged, (trimmed) => {
      const line = textLineFields(staged, trimmed)
      return line !== undefined && match(line)
    })
    if (removed !== null) return removed
  }
  return null
}

/**
 * Join lines back into content, collapsing runs of blank lines left behind by
 * the removal — but only outside fenced code blocks, whose blank lines are the
 * user's snippet and must survive byte-for-byte.
 */
function collapseBlankRuns(lines: readonly string[]): string {
  const fenced = markFencedLines(lines)
  // Split into runs of same-fencedness, collapse only within the unfenced ones,
  // then rejoin — the run boundaries reproduce the original newlines exactly.
  const chunks: string[] = []
  let i = 0
  while (i < lines.length) {
    const isFenced = fenced[i]!
    const start = i
    while (i < lines.length && fenced[i] === isFenced) i++
    const text = lines.slice(start, i).join('\n')
    chunks.push(isFenced ? text : text.replace(/\n{3,}/g, '\n\n'))
  }
  const joined = chunks.join('\n')
  return joined.endsWith('\n') ? joined : joined + '\n'
}

/**
 * A note discarded by a deck quantity-merge: the incoming card carried a note,
 * but it merged onto an existing line whose single note slot already holds a
 * different value (or none). Reported rather than merged — merging would
 * fabricate text and could not round-trip through changelogs.
 */
export type DroppedNote = {
  cardName: string
  /** The incoming card's ID in its source list, when it has one. */
  cardId?: number
  note: string
}

/**
 * `notes` with repeats removed, first occurrence kept. Moving N copies of one
 * deck line onto a line with a different note drops the same note N times;
 * the copies share a name, a source line id and a note, so they are reported
 * once. Every surface that reports dropped notes reports them through this.
 */
export function dedupeDroppedNotes(notes: readonly DroppedNote[]): DroppedNote[] {
  const seen = new Set<string>()
  const out: DroppedNote[] = []
  for (const note of notes) {
    const key = JSON.stringify([note.cardName, note.cardId ?? null, note.note])
    if (seen.has(key)) continue
    seen.add(key)
    out.push(note)
  }
  return out
}

/**
 * What one staged addition did, beyond mutating the file.
 *
 * `cardId` is the whole reason this is a record rather than a bare dropped
 * note: the destination allocates a fresh `&N`, and a caller carrying per-card
 * sidecar data across the move (custom art) has no other way to learn it.
 */
export type StagedAddResult = {
  /**
   * The `&N` the card's line carries in the destination. Absent only when the
   * copy merged onto a deck line that has no id of its own — a hand edit the
   * backfill has not been through yet, whose id the write assigns.
   */
  cardId?: number
  /** True when the copy landed on a line the destination already had. */
  merged: boolean
  /** Set when a deck quantity-merge discarded the incoming card's note. */
  droppedNote?: DroppedNote
}

/**
 * The destination `&N` a moved card's per-line sidecar data (its custom art)
 * should follow onto, or `undefined` when nothing should follow.
 *
 * A quantity merge lands on a line that already stands for the card and may
 * carry art of its own; only a line this move created adopts the incoming
 * reference. Written once here, beside the result it interrogates, so the two
 * move engines cannot state the rule in opposite polarities and drift.
 */
export function adoptedCardId(added: StagedAddResult): number | undefined {
  return added.merged ? undefined : added.cardId
}

/**
 * Apply an in-memory addition to a staged file.
 * For collection destinations, throws if the card lacks set/collectorNumber.
 *
 * `section` (deck destinations only) targets the named deck section by exact
 * name match, creating it when missing; when omitted, the default section is
 * used (first non-commander/sideboard section, creating `Main` if none).
 */
export function applyAddToStaged(
  staged: StagedFile,
  card: ArrivingCopy,
  listType: ListRef['type'],
  section?: string,
): StagedAddResult {
  if (staged.kind === 'deck') {
    return applyAddToDeck(staged, card, section)
  }
  if (listType === 'collection') {
    if (!card.set || !card.collectorNumber) {
      throw new Error(t('cli.move.collectionNeedsPrinting', { name: card.name }))
    }
    const added = applyAddCollectionLine(staged.content, card, stagedDefaultLabels(staged))
    staged.content = added.content
    return { cardId: added.cardId, merged: false }
  }
  const added = applyAddWantedLine(staged.content, card)
  staged.content = added.content
  return { cardId: added.cardId, merged: false }
}

function applyAddToDeck(
  staged: StagedDeckFile,
  card: ArrivingCopy,
  section?: string,
): StagedAddResult {
  const { deck } = staged.data
  const listLabels = stagedDefaultLabels(staged)
  // What the moved card's override becomes here, which is what a merge target
  // must match: a `sale` copy arriving from a collection carries no override
  // into a deck, so it belongs on the plain line, not beside it; a `proxy` one
  // arriving in a `proxy`-default deck needs none of its own either.
  const labels = arrivalLabels('deck', card.carriedLabels, listLabels)
  const copy: DeckAdd = {
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    language: card.language,
    labels,
    tags: card.tags,
  }
  // The reducer's own merge rule and scope (`findDeckMergeLine`): the named
  // section alone when the move names one, else every section — so `ritual
  // move`, a save's replay and a `ritual edit` destination write the same bytes.
  const existing = findDeckMergeLine(deck.sections, card.name, copy, { listLabels, section })?.card

  if (existing) {
    // Quantity merge into an existing line: multiple copies share a single line
    // and a single note slot, so the destination line's existing note wins. An
    // incoming note not already on the line is discarded — reported so callers
    // can surface the loss.
    existing.quantity += 1
    const droppedNote: DroppedNote | undefined =
      card.note && card.note !== existing.note
        ? { cardName: card.name, cardId: card.sourceCardId, note: card.note }
        : undefined
    return { cardId: existing.cardId, merged: true, droppedNote }
  }
  const targetSection =
    section !== undefined
      ? findOrCreateSection(deck.sections, section)
      : resolveDefaultAddSection(deck.sections)
  // Allocate from a pool seeded by the deck's existing IDs so released IDs (gaps)
  // are reused, matching the collection/wanted add paths instead of always taking
  // the next-highest number.
  const pool = createIdPool(collectDeckCardIds(deck))
  const cardId = allocateId(pool)
  targetSection.cards.push({
    quantity: 1,
    name: card.name,
    set: card.set,
    collectorNumber: card.collectorNumber,
    finish: card.finish,
    condition: card.condition,
    language: card.language,
    // Only what a deck line can express survives the move: a `proxy` copy
    // stays a proxy, a `sale` override is dropped rather than written into a
    // grammar that has no room for it.
    labels,
    tags: normalizedTags(card.tags),
    note: card.note,
    cardId,
  })
  return { cardId, merged: false }
}

/**
 * Refuse to append when the file ends inside an unclosed fence: the appended
 * card line would land in the opaque region, so it would be written, reported,
 * and logged — and then be invisible to every subsequent parse.
 */
function assertAppendable(content: string, cardName: string): void {
  if (endsInsideOpenFence(content)) {
    throw new Error(t('cli.move.appendIntoOpenFence', { name: cardName }))
  }
}

/** A flat-list line appended, with the `&N` it was given. */
type AppendedLine = { content: string; cardId: number }

function applyAddCollectionLine(
  content: string,
  card: ArrivingCopy,
  listLabels: readonly CardLabel[] | undefined,
): AppendedLine {
  assertAppendable(content, card.name)
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const line = formatCollectionLine({
    cardName: card.name,
    set: card.set!,
    collectorNumber: card.collectorNumber!,
    finish: card.finish ?? 'nonfoil',
    condition: card.condition,
    language: card.language,
    labels: arrivalLabels('collection', card.carriedLabels, listLabels),
    tags: normalizedTags(card.tags),
    note: card.note,
    cardId,
  })
  return { content: content.trimEnd() + '\n' + line, cardId }
}

function applyAddWantedLine(content: string, card: ArrivingCopy): AppendedLine {
  assertAppendable(content, card.name)
  const { nextId: cardId } = allocateNextIdFromContent(content)
  const printing = resolvePrinting(card.set, card.collectorNumber)
  const line = formatWantedListLine({
    name: card.name,
    printing,
    finish: card.finish,
    language: card.language,
    tags: normalizedTags(card.tags),
    note: card.note,
    cardId,
  })
  return { content: content.trimEnd() + '\n' + line, cardId }
}
