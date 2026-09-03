/**
 * The **read** half of the card-line grammar: one tokenizer for all three list
 * types, replacing the three positional regexes (deck, collection, wanted) that
 * had drifted apart in set-code charset, inter-token whitespace, name trimming,
 * and which bracket vocabularies they accepted.
 *
 * Tokens are classified by *value-set membership* rather than by position, the
 * way the changelog parser already classified them, so the order a user writes
 * them in stops mattering and a token the list type does not accept becomes a
 * **named** refusal (`[NM] is not a wanted-list token …`) instead of a
 * mystifying "missing set code" three tokens away.
 *
 * ```
 * card-line ::= [ bullet ] [ quantity ] name { WS token } [ WS id ]
 * token     ::= printing | finish | condition | language | labels | tags | note
 * printing  ::= "(" set ":" collector ")" | "(" set ")" WS [ marker WS ] collector
 * ```
 *
 * **Lenient in, canonical out.** Reading tolerates any token order, any run of
 * whitespace, an optional `- ` bullet, `Nx` quantities, the Arena/MTGO export
 * dialect (`(SET) CN`, a trailing `*F*`/`*E*`), Moxfield's bulk-edit form
 * (`(SET) *F* CN`) and `_` in set codes; writing
 * ({@link module:card-line-tail}) always emits the one canonical form, so files
 * converge on the next save.
 *
 * English by construction — `[foil]`, `[NM]`, `[ja]`, `SET:CN` and `&N` are
 * matched literally, so this module must never import `src/i18n` (AGENTS.md,
 * "Card-line grammar is not prose"; enforced by the fence scan in
 * `test/unit/i18n-conventions.test.ts`). Browser-safe: no `node:` imports.
 */

import { type CardPrinting, resolvePrinting } from './card-line'
import { matchCardId } from './card-line-id'
import { printingLabel } from './card-line-tail'
import {
  conflictingExclusiveLabel,
  parseCardLabelsToken,
  LABEL_TOKEN_PATTERN,
  type CardLabel,
} from './card-labels'
import {
  isCardLanguage,
  malformedLanguageTokenHint,
  storedLanguage,
  type CardLanguage,
} from './card-language'
import { isCondition, isFinish, type Condition, type Finish } from './finish-condition'
import {
  CARD_TAG_SHAPE_CLAUSE,
  CARD_TAG_SIGIL,
  normalizeCardTags,
  parseCardTagsInput,
  type CardTag,
} from './card-tags'
import { listTypeLabel, type ListType } from '../list/list-type'

/**
 * Every kind of token a card line can carry. `tags` is the only *repeatable*
 * one — the writer emits one comma-separated `#a, b` token, but a reader also
 * accepts several `#a #b` tokens on one line — which is why
 * {@link GRAMMAR} is a per-kind table rather than a fixed tuple, and why
 * {@link REPEATABLE_TOKEN_KINDS} exists beside it.
 */
export type TokenKind =
  | 'quantity'
  | 'printing'
  | 'finish'
  | 'condition'
  | 'language'
  | 'labels'
  | 'tags'
  | 'note'
  | 'id'

/**
 * Which token kinds a table row names. A full `Record` rather than a set
 * literal: adding a member to {@link TokenKind} is then a compile error in
 * every {@link GRAMMAR} row rather than a silent "disallowed everywhere".
 */
export type TokenKindFlags = Record<TokenKind, boolean>

/**
 * Every token kind, in canonical write order. Built from a full `Record` so a
 * new member of {@link TokenKind} is a compile error here rather than a kind
 * silently missing from every table and every exhaustiveness test.
 */
export const TOKEN_KINDS: readonly TokenKind[] = Object.values({
  quantity: 'quantity',
  printing: 'printing',
  finish: 'finish',
  condition: 'condition',
  language: 'language',
  labels: 'labels',
  tags: 'tags',
  note: 'note',
  id: 'id',
} as const satisfies Record<TokenKind, TokenKind>)

/**
 * The kinds a line may carry more than once. Every other kind twice is a
 * `duplicate-token` refusal; a second tag token simply carries more tags (and
 * the same tag twice folds to one — nothing is lost, so it is not even an advisory).
 */
const REPEATABLE_TOKEN_KINDS: ReadonlySet<TokenKind> = new Set<TokenKind>(['tags'])

/** Everything one card line says, once the grammar has read it. */
export type LineTokens = {
  /** Copies on this line. `1` when the line carries no quantity token. */
  quantity: number
  /** The card name, trimmed, with every recognized token removed. */
  name: string
  printing?: CardPrinting
  finish?: Finish
  condition?: Condition
  /** Absent for English — a bare line always means `en`. */
  language?: CardLanguage
  /** The line's label override, absent when it carries no labels token. */
  labels?: readonly CardLabel[]
  /** The line's tags in canonical form (trimmed, deduplicated, sorted); absent when none. */
  tags?: readonly CardTag[]
  note?: string
  cardId?: number
}

/** Why a line was read differently from how it was written. */
export type CardLineAdvisoryKind =
  /** An export dialect (`(SET) CN`, `*F*`) was rewritten into canonical form. */
  | 'dialect-rewritten'
  /** A quantity on a one-line-per-copy list will be expanded into N lines on save. */
  | 'quantity-expanded'
  /** The name still carries a set-like token — a dialect nobody taught the parser. */
  | 'suspect-printing-in-name'

/** Every advisory kind, for exhaustive iteration by consumers and tests. */
export const CARD_LINE_ADVISORY_KINDS: readonly CardLineAdvisoryKind[] = Object.values({
  'dialect-rewritten': 'dialect-rewritten',
  'quantity-expanded': 'quantity-expanded',
  'suspect-printing-in-name': 'suspect-printing-in-name',
} as const satisfies Record<CardLineAdvisoryKind, CardLineAdvisoryKind>)

/**
 * A non-fatal note about a line the parser *did* read. Advisories must never be
 * promoted into the `warnings` channel: nothing was lost, so they must not trip
 * the whole-file-rewrite gates (`unreadableLines`), whose refusal promises the
 * listed content would be deleted.
 */
export type CardLineAdvisory = {
  /**
   * The {@link CardLineDiagnostic} discriminant. `CardLineError` carries
   * `severity: 'error'`; both members also have a `kind`, and they mean
   * different things, so the discriminant has to be its own field.
   */
  severity: 'advisory'
  kind: CardLineAdvisoryKind
  /** The offending token exactly as written, when there is one. */
  token?: string
  /** English by construction — the card-line grammar is not prose. */
  message: string
}

/** Refusals that always name the token they refused. */
export type TokenErrorCode =
  /** A bracket token naming no known finish, condition, language, or label. */
  | 'unknown-token'
  /** A well-formed token this list type does not carry. */
  | 'token-not-allowed'
  /** The same token kind twice on one line. */
  | 'duplicate-token'
  /** A token sitting inside the name instead of in the line's token tail. */
  | 'misplaced-token'
  /** A token written with no whitespace between it and the text beside it. */
  | 'unseparated-token'
  /** A quantity of zero, which says nothing. */
  | 'bad-quantity'
  /** A `{` the line never closes. */
  | 'malformed-note'
  /** `[keep,sale]` and friends — see `EXCLUSIVE_CARD_LABELS`. */
  | 'conflicting-labels'
  /** A `#…` token in tail position with an empty body or one that is not tag-shaped (`#`, `#a&b`). */
  | 'malformed-tag'

/** Refusals about the line as a whole, which have no one token to blame. */
export type LineErrorCode =
  /** Not a card line at all: blank, a heading, a `//` comment, a fence delimiter. */
  | 'not-a-card-line'
  /** Every character was a token; there is no card name left. */
  | 'empty-name'
  /** A collection line with no `(SET:CN)` — every stored copy names its printing. */
  | 'missing-printing'

/** Every way a card line can fail to parse. */
export type CardLineErrorCode = TokenErrorCode | LineErrorCode

/**
 * Every error code, for exhaustive iteration by consumers and tests. A full
 * `Record` for the same reason as {@link TOKEN_KINDS}: adding a code without
 * listing it here must not compile.
 */
export const CARD_LINE_ERROR_CODES: readonly CardLineErrorCode[] = Object.values({
  'not-a-card-line': 'not-a-card-line',
  'empty-name': 'empty-name',
  'unknown-token': 'unknown-token',
  'token-not-allowed': 'token-not-allowed',
  'duplicate-token': 'duplicate-token',
  'misplaced-token': 'misplaced-token',
  'unseparated-token': 'unseparated-token',
  'bad-quantity': 'bad-quantity',
  'missing-printing': 'missing-printing',
  'malformed-note': 'malformed-note',
  'conflicting-labels': 'conflicting-labels',
  'malformed-tag': 'malformed-tag',
} as const satisfies Record<CardLineErrorCode, CardLineErrorCode>)

/** What every refusal carries, whatever it blames. */
type CardLineErrorBase = {
  /** The {@link CardLineResult} discriminant. */
  ok: false
  /** The {@link CardLineDiagnostic} discriminant. */
  severity: 'error'
  listType: ListType
  /** The line as handed to the parser. */
  line: string
  /** English by construction — the card-line grammar is not prose. */
  message: string
  /** An actionable next step, e.g. `did you mean [ja]?`. */
  hint?: string
}

/**
 * A refusal that names its offender. The rule this type exists to enforce
 * (AGENTS.md, "Parsers"): no error may blame "a missing set code" when the
 * cause was an out-of-order or unsupported token. `token` and `column` are
 * *required* here so a consumer drawing an editor squiggle never has to guard
 * them.
 */
export type TokenCardLineError = CardLineErrorBase & {
  code: TokenErrorCode
  /** The offending token exactly as written, e.g. `[NM]` or `[jp]`. */
  token: string
  /** 0-based column of `token` in `line`. */
  column: number
  /** Absent only when the token named no known kind (`unknown-token`). */
  kind?: TokenKind
}

/** A refusal about the whole line, which has no one token to point at. */
export type LineCardLineError = CardLineErrorBase & {
  code: LineErrorCode
  /** The kind the line was missing (`missing-printing`); absent otherwise. */
  kind?: RequiredTokenKind
}

export type CardLineError = TokenCardLineError | LineCardLineError

/** Narrow a diagnostic to its refusal half. */
export function isCardLineError(diagnostic: CardLineDiagnostic): diagnostic is CardLineError {
  return diagnostic.severity === 'error'
}

/** Either half of the diagnostic channel: a refusal or a note about a line read. */
export type CardLineDiagnostic = CardLineError | CardLineAdvisory

/** A line the grammar read, plus everything worth saying about how. */
export type CardLineParse = {
  ok: true
  tokens: LineTokens
  advisories: readonly CardLineAdvisory[]
}

/** The result of {@link parseCardLine}: discriminate on `ok`. */
export type CardLineResult = CardLineParse | CardLineError

/**
 * The only token kind any list type *requires*. Narrower than {@link TokenKind}
 * on purpose: `missing-printing` is the one refusal code for a missing required
 * token, so widening this without adding a matching code would leave the new
 * requirement silently unenforced.
 */
export type RequiredTokenKind = Extract<TokenKind, 'printing'>

/** Which token kinds a list type accepts, and which it insists on. */
export type CardLineGrammar = {
  allowed: ReadonlySet<TokenKind>
  required: ReadonlySet<RequiredTokenKind>
}

/** Decks and collections carry the whole vocabulary. */
const EVERY_TOKEN = {
  quantity: true,
  printing: true,
  finish: true,
  condition: true,
  language: true,
  labels: true,
  tags: true,
  note: true,
  id: true,
} as const satisfies TokenKindFlags

/** A wanted list carries neither a condition nor labels — but tags, like every type. */
const WANTED_TOKENS = {
  quantity: true,
  printing: true,
  finish: true,
  condition: false,
  language: true,
  labels: false,
  tags: true,
  note: true,
  id: true,
} as const satisfies TokenKindFlags

/** The kinds a flag table marks allowed. */
function kindsOf(flags: TokenKindFlags): ReadonlySet<TokenKind> {
  return new Set(TOKEN_KINDS.filter((kind) => flags[kind]))
}

/**
 * The per-type token table — the single answer to "may this token appear
 * here?".
 *
 * `quantity` is allowed everywhere: decks write it, and a flat list tolerates a
 * pasted one and expands it into one line per copy on save. `printing` is
 * *required* on a collection, where a stored copy is a specific physical card.
 * Wanted lists carry neither a condition (you are asking for a card, not
 * grading one) nor labels (they describe cards you own).
 *
 * The label *vocabulary* per type is not repeated here: `LIST_TYPE_LABELS` in
 * `card-labels.ts` owns it, and a deck's `[sale]` is a value refusal the
 * callers make (keeping the card, dropping the labels), not a grammar refusal
 * that would cost the whole line.
 */
export const GRAMMAR = {
  deck: { allowed: kindsOf(EVERY_TOKEN), required: new Set<RequiredTokenKind>() },
  collection: { allowed: kindsOf(EVERY_TOKEN), required: new Set<RequiredTokenKind>(['printing']) },
  wanted: { allowed: kindsOf(WANTED_TOKENS), required: new Set<RequiredTokenKind>() },
} as const satisfies Record<ListType, CardLineGrammar>

/**
 * Why a type refuses a token kind, when there is more to say than "it does not
 * take one". Read into the `token-not-allowed` message so the user is told the
 * rule, not just the verdict.
 */
const REFUSAL_REASONS: Record<ListType, Partial<Record<TokenKind, string>>> = {
  deck: {},
  collection: {},
  wanted: {
    condition: 'wanted lists never carry a condition',
    labels: 'wanted lists never carry labels',
  },
}

/**
 * The set-code charset, in one place. `_` is legal: some art-series and
 * playtest sets use it (`PLST_X`). Lowercase in memory, uppercase in the file —
 * the character class covers both because a file may be hand-written either way.
 */
const SET_CHARS = '[A-Za-z0-9_]'

/**
 * The collector-number charset an *export dialect* uses. Narrower than the
 * canonical `(SET:CN)` body, which takes anything but whitespace and `)`: a
 * dialect number is lifted out of a card *name*, so it has to be shaped
 * conservatively or ordinary words would qualify. `★` and `†` appear on real
 * promo and foil-etched collector numbers.
 */
const ARENA_CN = '[A-Za-z0-9\\-★†]+'

/**
 * Matches an MTG Arena / MTGO export card line's printing suffix:
 * `Lightning Bolt (M10) 146` → name `Lightning Bolt`, set `m10`, number `146`.
 *
 * Two deliberate restrictions:
 *
 * - The set token excludes `:`, so a canonical `(LEA:161)` line can never match
 *   — the two grammars stay disjoint.
 * - **The collector number is required.** A parenthesized token alone is far too
 *   common in real card names (`Very Cryptic Command (Untap)`, `Hazmat Suit
 *   (Used)`, `Ineffable Blessing (Cardboard)`) to reinterpret as a set code, and
 *   a set with no collector number is not a printing the canonical card line can
 *   express anyway (see `resolvePrinting`) — it would be lifted out of the name
 *   only to be dropped by the serializer. Such a line keeps the name the user
 *   wrote and gets an advisory instead.
 */
const ARENA_PRINTING_RE = new RegExp(`^(.+?)\\s+\\((${SET_CHARS}{2,10})\\)\\s+(${ARENA_CN})$`)

/**
 * Matches Moxfield's bulk-edit card line, which splices the finish marker
 * *between* the set and the collector number:
 * `1 Cardname (SET) *F* 123` → name `Cardname`, set `set`, number `123`, foil.
 *
 * Moxfield's documented import grammar is
 * `<amount> <name> <set> <is foil> <is alter> <collector number> …`
 * (https://moxfield.com/help), so this is the form Ritual's own
 * `--dialect moxfield` text export writes (`src/export/dialects.ts`) and the
 * form a file downloaded from Moxfield arrives in. Reading it here is what
 * makes that export round-trip back through `ritual import`.
 *
 * Same two restrictions as {@link ARENA_PRINTING_RE}: no `:` in the set token,
 * and the collector number is required.
 */
const MOXFIELD_PRINTING_RE = new RegExp(
  `^(.+?)\\s+\\((${SET_CHARS}{2,10})\\)\\s+\\*([FEfe])\\*\\s+(${ARENA_CN})$`,
)

/**
 * A parenthesized set-like token left inside a parsed card name — the shape an
 * unrecognized export dialect leaves behind (`Lightning Bolt (M10) 146`). Used
 * for the safety-net advisory, so a dialect nobody taught the parser is never
 * silent corruption.
 *
 * Deliberately looser than the two dialect patterns: it tolerates a *run* of
 * trailing marker-or-number words, so Moxfield's optional columns
 * (`(SET) *F* *A* 284`, an alter marker Ritual does not model) still raise the
 * advisory instead of being absorbed into the card name. Matching here costs
 * only a note; not matching costs a card nobody was told about.
 */
const SUSPECT_PRINTING_IN_NAME_RE = new RegExp(
  `\\(${SET_CHARS}{2,10}\\)(?:\\s+(?:\\*[A-Za-z]\\*|${ARENA_CN}))*$`,
)

/**
 * The trailing finish marker Moxfield, Archidekt, and MTGO append to a
 * plain-text export line: `1 Sol Ring (LTC) 284 *F*` (foil) or `*E*` (etched).
 */
const EXPORT_FINISH_MARKER_RE = /\*([FEfe])\*$/

/** What each export finish marker letter means, lowercased. */
const EXPORT_FINISH_MARKERS: Record<string, Finish> = { f: 'foil', e: 'etched' }

/** An export dialect's printing suffix, lifted off the end of a card name. */
type ExportPrintingMatch = {
  /** The card name with the suffix removed. */
  name: string
  printing: CardPrinting
  /** Present only for the Moxfield form, which carries a finish marker. */
  finish?: Finish
  /** The suffix verbatim, for the advisory that reports the rewrite. */
  token: string
}

/**
 * Recognize an export dialect's printing suffix at the end of a parsed card
 * name — Arena's `(SET) CN` or Moxfield's `(SET) *F* CN` — and lift it out.
 * Returns undefined for a name that ends in neither, which is the common case
 * (a canonical line's printing was already tokenized off the end).
 *
 * Both forms in one place because they differ only by the marker: a caller that
 * tried them separately would have to decide their precedence, and the two
 * grammars are disjoint anyway (a marker is present or it is not).
 */
function matchExportPrinting(name: string): ExportPrintingMatch | undefined {
  const [, moxName, moxSet, moxMarker, moxCollector] = MOXFIELD_PRINTING_RE.exec(name) ?? []
  if (
    moxName !== undefined &&
    moxSet !== undefined &&
    moxMarker !== undefined &&
    moxCollector !== undefined
  ) {
    const printing = resolvePrinting(moxSet, moxCollector)
    const finish = EXPORT_FINISH_MARKERS[moxMarker.toLowerCase()]
    // Both are guaranteed by the regex (a non-empty set/collector pair and a
    // marker letter from `[FEfe]`); refusing the match rather than falling
    // through keeps a future loosening of the pattern from silently reaching
    // the Arena branch, which cannot match a `*F*` line anyway.
    if (printing === undefined || finish === undefined) return undefined
    return { name: moxName.trim(), printing, finish, token: name.slice(moxName.length).trim() }
  }
  const [, arenaName, arenaSet, arenaCollector] = ARENA_PRINTING_RE.exec(name) ?? []
  if (arenaName === undefined || arenaSet === undefined || arenaCollector === undefined) {
    return undefined
  }
  const printing = resolvePrinting(arenaSet, arenaCollector)
  if (printing === undefined) return undefined
  return { name: arenaName.trim(), printing, token: name.slice(arenaName.length).trim() }
}

/** The canonical `(SET:CN)` printing token body. */
const PRINTING_BODY_RE = new RegExp(`^(${SET_CHARS}+):([^)\\s]+)$`)

/**
 * A labels token body: one or more label words, comma-separated. Whitespace
 * around the commas is tolerated like every other run in the grammar —
 * `[sale, trade]` is what a person types.
 */
const LABELS_BODY_RE = new RegExp(
  `^\\s*${LABEL_TOKEN_PATTERN}(?:\\s*,\\s*${LABEL_TOKEN_PATTERN})*\\s*$`,
)

/**
 * A leading quantity: `2 `, `4x `, `10X `. Capped at three digits on purpose —
 * those are the quantities anyone actually writes, while a longer run is a real
 * card name (`1996 World Champion`) that must parse untouched. An explicit
 * `x`/`X` marker says "quantity" out loud, so it lifts the cap.
 */
const QUANTITY_RE = /^(\d+)([xX])?(\s+)/

/**
 * Line shapes that are structure or prose, never a card: an ATX heading, a `//`
 * comment, a fence delimiter, and a `---` rule (which is also how front matter
 * is delimited).
 *
 * Fence *state* is the caller's business — this function sees one line and
 * cannot know it is inside a block. Every file-level parser already drives
 * `createFenceTracker` and must keep doing so.
 */
const NOT_A_CARD_LINE_RE = /^(?:#{1,6}\s|\/\/|```|~~~|-{3,}\s*$)/

/**
 * The list bullet a card line may open with — mandatory on write, optional on
 * read. Exported because the file-level candidate rule
 * (`isCardCandidate`) must ask the same question this tokenizer answers: a
 * scanner with a narrower bullet than the parser calls a readable line prose.
 */
export const CARD_LINE_BULLET_RE = /^-\s+/

/**
 * True when a **trimmed** line is a `//` comment.
 *
 * A comment is read-tolerated and dropped on write, so a file parser must
 * recognize it *before* it decides the line is content a save would delete —
 * otherwise every `//` in a pasted decklist warns. Exported from here so the
 * three parsers and {@link parseCardLine} cannot disagree about what a comment
 * is; {@link NOT_A_CARD_LINE_RE} refuses the same shape.
 */
export function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('//')
}

/** True when the character before `start` is whitespace, or `start` opens the body. */
function isTokenBoundary(line: string, start: number, bodyStart: number): boolean {
  if (start === bodyStart) return true
  if (start < bodyStart) return false
  return /\s/.test(line.charAt(start - 1))
}

/** True when the character at `end` is whitespace, or `end` runs off the line. */
function isTokenEnd(line: string, end: number): boolean {
  return end >= line.length || /\s/.test(line.charAt(end))
}

/** What a caller supplies to build a refusal; the rest is boilerplate. */
type TokenErrorFields = Omit<TokenCardLineError, 'ok' | 'severity' | 'listType' | 'line'>
type LineErrorFields = Omit<LineCardLineError, 'ok' | 'severity' | 'listType' | 'line'>

/** Assemble a refusal that names its token. */
function failToken(type: ListType, line: string, fields: TokenErrorFields): TokenCardLineError {
  return { ok: false, severity: 'error', listType: type, line, ...fields }
}

/** Assemble a refusal about the line as a whole. */
function failLine(type: ListType, line: string, fields: LineErrorFields): LineCardLineError {
  return { ok: false, severity: 'error', listType: type, line, ...fields }
}

/**
 * The `did you mean [ja]?` hint for a line whose bracket token names a language
 * in the wrong spelling (`[JA]`, `[jp]`, `[Japanese]`), or `undefined`.
 * Normalized out of the warning-suffix form the CLI parsers already used.
 */
function languageHint(line: string): string | undefined {
  const suffix = malformedLanguageTokenHint(line)
  if (!suffix) return undefined
  return suffix.trim().replace(/^\(/, '').replace(/\)$/, '')
}

/** One token peeled off the right-hand end of a line. */
type ScannedToken = {
  kind: TokenKind
  /** The token exactly as written, e.g. `[foil]` or `(LEA:161)`. */
  text: string
  /** 0-based column of `text` in the line. */
  column: number
  /** The token's inner text: `foil`, `LEA:161`, `a note`, `12`. */
  body: string
}

/**
 * Token-shaped text left inside a card name: a complete id, a parenthesized
 * body, a bracket, or a brace pair.
 *
 * Deliberately **not** anchored to whitespace boundaries. A token glued to what
 * sits beside it (`Sol Ring(LEA:270)`, `(LEA:270)&2`) is the one shape the peel
 * loop cannot read, and leaving it out of this scan is what let a collection
 * line that visibly names a printing be refused for *missing* one. It is found
 * here and reported as the separator problem it is.
 */
const RESIDUE_TOKEN_RE = /&\d+|\([^()]*\)|\[[^\][]*\]|\{[^{}]*\}|#(?:[^&[\]{}()]*[^&[\]{}()\s])?/g

/** A token found inside the name, with where it sits and how it was spaced. */
type MisplacedToken = {
  text: string
  column: number
  kind: TokenKind
  /** Whitespace — or the start of the body — precedes the token. */
  spacedBefore: boolean
  /** Whitespace — or the end of the line — follows the token. */
  spacedAfter: boolean
}

/**
 * The token the peel loop stopped short of, if the residue holds one.
 *
 * The scan halts at the first thing that is not a token, so anything
 * token-shaped *behind* that point was written out of order and would otherwise
 * be absorbed into the card name in silence — `1 Sol Ring (LEA:161) &4 [foil]`
 * becoming a card named `Sol Ring (LEA:161) &4`, which then misses the cache,
 * Scryfall, pricing and every sync join. That is exactly the silent corruption
 * this grammar exists to end, so it is a named refusal.
 *
 * Only text that *would have been read as a token* in tail position counts: a
 * real card name's parenthesis (`Very Cryptic Command (Untap)`) and an
 * unrecognized bracket are left alone, because nothing was lost. When the
 * residue holds an id, that id is what is reported — a misplaced `&N` is nearly
 * always the actual cause, and its fix is the most specific.
 *
 * Each hit carries how it was spaced, because the two causes want two different
 * fixes: a token written out of order has to move, while one glued to its
 * neighbour only wants a space.
 */
function findMisplacedToken(
  line: string,
  bodyStart: number,
  end: number,
): MisplacedToken | undefined {
  const found: MisplacedToken[] = []
  for (const match of line.slice(bodyStart, end).matchAll(RESIDUE_TOKEN_RE)) {
    const text = match[0]
    if (match.index === undefined) continue
    const column = bodyStart + match.index
    const spacing: Pick<MisplacedToken, 'spacedBefore' | 'spacedAfter'> = {
      spacedBefore: isTokenBoundary(line, column, bodyStart),
      spacedAfter: isTokenEnd(line, column + text.length),
    }
    const inner = text.slice(1, -1)
    if (text.startsWith('&')) found.push({ text, column, kind: 'id', ...spacing })
    else if (text.startsWith(CARD_TAG_SIGIL)) {
      // No real card name contains `#` (a sweep of 38,336 names found none), so
      // a `#…` run inside the name is always a stranded tag token — glued to
      // the word before it (`Ring#ramp`), or left behind when a delimiter
      // branch stopped the peel early. The match runs to the next structural
      // character, since a tag body may hold spaces.
      found.push({ text, column, kind: 'tags', ...spacing })
    } else if (text.startsWith('(')) {
      if (PRINTING_BODY_RE.test(inner)) found.push({ text, column, kind: 'printing', ...spacing })
    } else if (text.startsWith('{')) found.push({ text, column, kind: 'note', ...spacing })
    else {
      const kind = bracketTokenKind(inner)
      if (kind !== undefined) found.push({ text, column, kind, ...spacing })
    }
  }
  // The id first (it must be last on the line); then the token that is
  // actually stuck to its neighbour, so a glued `#Ramp{note}` is blamed on
  // itself rather than on a well-spaced `(SET:CN)` earlier in the name.
  return (
    found.find((token) => token.kind === 'id') ??
    found.find((token) => !token.spacedBefore || !token.spacedAfter) ??
    found[0]
  )
}

/** Which kind a bracket token's body names, or `undefined` for nothing known. */
function bracketTokenKind(inner: string): TokenKind | undefined {
  if (isFinish(inner)) return 'finish'
  if (isCondition(inner)) return 'condition'
  if (isCardLanguage(inner)) return 'language'
  if (LABELS_BODY_RE.test(inner)) return 'labels'
  return undefined
}

/**
 * Read one card line of `type`.
 *
 * Tokens are peeled off the right-hand end — id, note, bracket, printing,
 * export finish marker, in whatever order they appear — until nothing token-
 * shaped is left; what remains is the card name. That is what makes the name
 * greedy in the right direction: `Very Cryptic Command (Untap)` keeps its
 * parenthesis (the body is no `SET:CN`), while `Sol Ring (LEA:270)` gives it up.
 *
 * **Two obligations stay with the caller**, because one line cannot answer them:
 *
 * - *Fence state.* A card-shaped line inside a ``` block is prose. Every
 *   file-level parser drives `createFenceTracker` and must keep doing so.
 * - *Which lines to offer.* The bullet and the quantity are both optional on
 *   read, so a paragraph of prose is a syntactically valid name-only line. A
 *   file parser that hands this function every body line will read its prose as
 *   cards; deciding what counts as a candidate line (a `- ` bullet on a flat
 *   list, a quantity in a deck's section) belongs to the parser that knows the
 *   surrounding document.
 */
export function parseCardLine(type: ListType, line: string): CardLineResult {
  const grammar = GRAMMAR[type]
  const advisories: CardLineAdvisory[] = []

  const bodyEndRaw = line.trimEnd().length
  const leading = line.length - line.trimStart().length
  if (bodyEndRaw <= leading) {
    return failLine(type, line, { code: 'not-a-card-line', message: 'Blank line.' })
  }
  if (NOT_A_CARD_LINE_RE.test(line.slice(leading))) {
    return failLine(type, line, {
      code: 'not-a-card-line',
      message: `Not a card line: ${line.trim()}`,
    })
  }

  let start = leading
  const bullet = CARD_LINE_BULLET_RE.exec(line.slice(start))
  if (bullet) start += bullet[0].length

  let quantity = 1
  /** The quantity token, held until `accept` exists to gate it like any other. */
  let quantityToken: ScannedToken | undefined
  const quantityMatch = QUANTITY_RE.exec(line.slice(start))
  if (quantityMatch?.[1] !== undefined) {
    const digits = quantityMatch[1]
    const explicit = quantityMatch[2] !== undefined
    // A four-digit run with no `x` is a card name (`1996 World Champion`), not
    // a quantity anybody wrote.
    if (explicit || digits.length <= 3) {
      const value = Number.parseInt(digits, 10)
      if (value === 0) {
        return failToken(type, line, {
          code: 'bad-quantity',
          kind: 'quantity',
          token: `${digits}${quantityMatch[2] ?? ''}`,
          column: start,
          message: 'A card line must name at least one copy.',
        })
      }
      quantityToken = {
        kind: 'quantity',
        text: `${digits}${quantityMatch[2] ?? ''}`,
        column: start,
        body: digits,
      }
      quantity = value
      start += quantityMatch[0].length
      // A flat list holds one line per copy, so a pasted quantity is read and
      // then written out as N lines. An advisory, not a warning: nothing is
      // lost, so it must not trip the whole-file-rewrite gates.
      if (type !== 'deck' && quantity > 1) {
        advisories.push({
          severity: 'advisory',
          kind: 'quantity-expanded',
          token: quantityMatch[0].trim(),
          message:
            `Read ${quantity} copies: a ${listTypeLabel(type)} holds one line per copy, ` +
            `so this line becomes ${quantity} lines on the next save.`,
        })
      }
    }
  }

  const bodyStart = start
  let end = bodyEndRaw
  const tokens: Omit<LineTokens, 'name'> = { quantity }
  const seen = new Map<TokenKind, ScannedToken>()
  /** Tag bodies as written, folded to canonical form once the scan is done. */
  const tags: string[] = []

  /** Record a scanned token, refusing a duplicate or one this type cannot carry. */
  const accept = (token: ScannedToken): CardLineError | undefined => {
    if (!grammar.allowed.has(token.kind)) {
      const reason = REFUSAL_REASONS[type][token.kind]
      return failToken(type, line, {
        code: 'token-not-allowed',
        kind: token.kind,
        token: token.text,
        column: token.column,
        message:
          `${token.text} is not a ${listTypeLabel(type)} token` +
          (reason === undefined ? '.' : ` — ${reason}.`),
      })
    }
    if (seen.has(token.kind) && !REPEATABLE_TOKEN_KINDS.has(token.kind)) {
      return failToken(type, line, {
        code: 'duplicate-token',
        kind: token.kind,
        token: token.text,
        column: token.column,
        message: `Duplicate ${token.kind} token ${token.text}.`,
      })
    }
    seen.set(token.kind, token)
    return undefined
  }

  if (quantityToken) {
    const refusal = accept(quantityToken)
    if (refusal) return refusal
  }

  for (;;) {
    while (end > bodyStart && /\s/.test(line.charAt(end - 1))) end -= 1
    if (end <= bodyStart) break
    const last = line.charAt(end - 1)
    const body = line.slice(bodyStart, end)

    // Branch order matters around the `#tags` probe below. The delimiter
    // branches (`}` `]` `)` `*`) run before it, because a note or bracket may
    // legitimately hold a `#word` (`{needs #upgrade}`) that the probe would
    // otherwise read as a tag. The id branch runs before it too — a tag token
    // runs from its sigil to the end of what is left, so `#ramp &5` must have
    // its `&5` peeled first — but only *peels* on a match: `#tier1` ends in a
    // digit and is not an id, and the probe still has to see it.

    if (last === '}') {
      // Greedy to the *last* `}`: `{note with } brace}` is one note. The opening
      // brace is therefore the first whitespace-preceded `{` in what is left.
      let open = -1
      for (let index = bodyStart; index < end - 1; index += 1) {
        if (line.charAt(index) === '{' && isTokenBoundary(line, index, bodyStart)) {
          open = index
          break
        }
      }
      if (open === -1) break
      const refusal = accept({
        kind: 'note',
        text: line.slice(open, end),
        column: open,
        body: line.slice(open + 1, end - 1),
      })
      if (refusal) return refusal
      // `{}` says nothing; the writer drops an empty note, so reading one as
      // `''` would give a single state two spellings.
      const note = line.slice(open + 1, end - 1)
      if (note !== '') tokens.note = note
      end = open
      continue
    }

    if (last === ']') {
      const open = line.lastIndexOf('[', end - 2)
      if (open < bodyStart || !isTokenBoundary(line, open, bodyStart)) break
      const text = line.slice(open, end)
      const inner = line.slice(open + 1, end - 1)
      const token: Omit<ScannedToken, 'kind'> = { text, column: open, body: inner }
      if (isFinish(inner)) {
        const refusal = accept({ kind: 'finish', ...token })
        if (refusal) return refusal
        tokens.finish = inner
      } else if (isCondition(inner)) {
        const refusal = accept({ kind: 'condition', ...token })
        if (refusal) return refusal
        tokens.condition = inner
      } else if (isCardLanguage(inner)) {
        const refusal = accept({ kind: 'language', ...token })
        if (refusal) return refusal
        // A bare line always means English, so an explicit `[en]` folds to
        // absent — an entry never stores `en` (see `storedLanguage`), and the
        // key is left off entirely rather than written as `undefined`.
        const language = storedLanguage(inner)
        if (language !== undefined) tokens.language = language
      } else if (LABELS_BODY_RE.test(inner)) {
        const refusal = accept({ kind: 'labels', ...token })
        if (refusal) return refusal
        const parts = inner.split(',').map((part) => part.trim())
        // Checked *before* `parseCardLabelsToken`, whose refusal prose is
        // localized for the CLI: a `CardLineError.message` is English by
        // construction, so rendering that string only to discard it would be
        // both wasted work and a fence hazard. The rule itself still lives in
        // `card-labels.ts`.
        const exclusive = conflictingExclusiveLabel(parts)
        if (exclusive !== undefined) {
          return failToken(type, line, {
            code: 'conflicting-labels',
            kind: 'labels',
            token: text,
            column: open,
            message:
              `Conflicting labels ${text} — ` +
              `[${exclusive}] cannot be combined with any other label.`,
          })
        }
        const parsed = parseCardLabelsToken(inner)
        // Unreachable: the body matched the vocabulary pattern and carries no
        // exclusivity conflict, which are the only two ways this refuses.
        if (!parsed.ok) break
        tokens.labels = parsed.labels
      } else {
        return failToken(type, line, {
          code: 'unknown-token',
          token: text,
          column: open,
          message: `Unrecognized token ${text}.`,
          hint: languageHint(text),
        })
      }
      end = open
      continue
    }

    if (last === ')') {
      const open = line.lastIndexOf('(', end - 2)
      if (open < bodyStart || !isTokenBoundary(line, open, bodyStart)) break
      const inner = line.slice(open + 1, end - 1)
      const printing = PRINTING_BODY_RE.exec(inner)
      // Not a printing: a real card name (`Very Cryptic Command (Untap)`) keeps
      // its parenthesis, and the scan stops here.
      if (printing?.[1] === undefined || printing[2] === undefined) break
      const text = line.slice(open, end)
      const refusal = accept({ kind: 'printing', text, column: open, body: inner })
      if (refusal) return refusal
      tokens.printing = resolvePrinting(printing[1], printing[2])
      end = open
      continue
    }

    if (last === '*') {
      const marker = EXPORT_FINISH_MARKER_RE.exec(body)
      if (marker?.[1] === undefined) break
      const column = end - marker[0].length
      if (!isTokenBoundary(line, column, bodyStart)) break
      const finish = EXPORT_FINISH_MARKERS[marker[1].toLowerCase()]
      if (finish === undefined) break
      const refusal = accept({ kind: 'finish', text: marker[0], column, body: marker[1] })
      if (refusal) return refusal
      tokens.finish = finish
      advisories.push({
        severity: 'advisory',
        kind: 'dialect-rewritten',
        token: marker[0],
        message: `Read the export finish marker ${marker[0]} as [${finish}].`,
      })
      end = column
      continue
    }

    if (/\d/.test(last) && end === bodyEndRaw) {
      // The id is the line's *last* token by grammar (`… { WS token } [ WS id ]`)
      // and by every writer. Reading one mid-line would make `readCardId` — which
      // anchors on the end of the line, as the id-pool seeding does — disagree
      // with this parser about which ids are in use, and a disagreement there
      // hands an id that is already on a line to the next new card.
      const id = matchCardId(body)
      if (id !== undefined) {
        const column = bodyStart + id.index
        const refusal = accept({ kind: 'id', text: id.text, column, body: id.text.slice(1) })
        if (refusal) return refusal
        tokens.cardId = id.id
        end = column
        continue
      }
    }

    // A tag token has no closing delimiter: it runs from the last
    // whitespace-preceded `#` to the end of what is left, and its body is the
    // same comma-separated list a person types (`#Ramp, Card Draw`). Taking the
    // *last* sigil is what lets a line written with one sigil per tag
    // (`#ramp #staple`, the Moxfield spelling) read as two tokens on two passes.
    // Reached only once no delimiter branch claimed the tail, so a `#` here is
    // a tag token or nothing.
    let open = -1
    for (let index = end - 1; index >= bodyStart; index -= 1) {
      if (line.charAt(index) === CARD_TAG_SIGIL && isTokenBoundary(line, index, bodyStart)) {
        open = index
        break
      }
    }
    if (open !== -1) {
      const text = line.slice(open, end)
      const parsed = parseCardTagsInput(text.slice(CARD_TAG_SIGIL.length))
      // An unclosed `{` after the sigil is a broken note, not a broken tag:
      // leave it in the name so the `malformed-note` check below names it.
      if (!parsed.ok && text.includes('{')) break
      if (!parsed.ok || parsed.tags.length === 0) {
        return failToken(type, line, {
          code: 'malformed-tag',
          kind: 'tags',
          token: text,
          column: open,
          message: `Malformed tag token ${text}: ${CARD_TAG_SHAPE_CLAUSE}.`,
        })
      }
      const refusal = accept({ kind: 'tags', text, column: open, body: text.slice(1) })
      if (refusal) return refusal
      tags.push(...parsed.tags)
      end = open
      continue
    }

    break
  }

  // Folded once the scan is done: deduplicated and sorted — the same tag
  // written twice, or in two tag tokens, is one tag.
  if (tags.length > 0) tokens.tags = normalizeCardTags(tags)

  let name = line.slice(bodyStart, end).trim()

  const openBraces = (name.match(/\{/g) ?? []).length
  const closeBraces = (name.match(/\}/g) ?? []).length
  if (openBraces > closeBraces) {
    const column = bodyStart + name.indexOf('{')
    return failToken(type, line, {
      code: 'malformed-note',
      kind: 'note',
      token: name.slice(name.indexOf('{')),
      column,
      message: 'Unclosed note: a {note} must end with a closing brace.',
    })
  }

  if (name === '') {
    return failLine(type, line, { code: 'empty-name', message: `No card name: ${line.trim()}` })
  }

  const misplaced = findMisplacedToken(line, bodyStart, end)
  if (misplaced) {
    // Two causes, two fixes. A token glued to its neighbour (`Sol Ring(LEA:270)`,
    // `(LEA:270)&2`) is only missing a separator — telling its author that "the
    // &N must be the last token" about an id that already is last helps nobody,
    // and blaming a *missing* printing on a line that visibly names one is the
    // mystifying refusal this grammar exists to end.
    if (!misplaced.spacedBefore || !misplaced.spacedAfter) {
      return failToken(type, line, {
        code: 'unseparated-token',
        kind: misplaced.kind,
        token: misplaced.text,
        column: misplaced.column,
        message: `${misplaced.text} runs into the text beside it: a card line's tokens are separated by whitespace.`,
        hint: `insert a space ${misplaced.spacedBefore ? 'after' : 'before'} ${misplaced.text}`,
      })
    }
    return failToken(type, line, {
      code: 'misplaced-token',
      kind: misplaced.kind,
      token: misplaced.text,
      column: misplaced.column,
      message: `${misplaced.text} is inside the card name: a card line's tokens all follow the name.`,
      hint:
        misplaced.kind === 'id'
          ? 'the &N id must be the last token on the line'
          : `move ${misplaced.text} after the name`,
    })
  }

  // The canonical grammar has no `(SET) CN` form, so such a suffix lands in the
  // card name. A *complete* one is the export dialect and is lifted into the
  // printing; anything short of that is an advisory, never a silent rewrite of
  // a card name the user wrote.
  if (tokens.printing === undefined) {
    const dialect = matchExportPrinting(name)
    if (dialect) {
      name = dialect.name
      tokens.printing = dialect.printing
      // A trailing `*F*` earlier in the scan already set the finish; the two
      // marker positions are alternatives, so the one actually written wins and
      // neither overwrites the other. The advisory then reports the finish that
      // was *stored*, not the one this match proposed — on a line carrying both
      // markers those differ, and naming the loser would be a lie about how the
      // line was read.
      if (dialect.finish !== undefined) tokens.finish ??= dialect.finish
      const label = printingLabel(dialect.printing.set, dialect.printing.collectorNumber)
      const applied = tokens.finish
      advisories.push({
        severity: 'advisory',
        kind: 'dialect-rewritten',
        token: dialect.token,
        message: `Read the export printing ${dialect.token} as (${label})${applied ? ` [${applied}]` : ''}.`,
      })
    } else {
      const suspect = SUSPECT_PRINTING_IN_NAME_RE.exec(name)
      if (suspect) {
        advisories.push({
          severity: 'advisory',
          kind: 'suspect-printing-in-name',
          token: suspect[0],
          message: `Card name still contains a printing token, so the line's format was not recognized: ${line.trim()}`,
        })
      }
    }
  }

  if (grammar.required.has('printing') && tokens.printing === undefined) {
    return failLine(type, line, {
      code: 'missing-printing',
      kind: 'printing',
      message: `A ${listTypeLabel(type)} line must name a printing, e.g. (LEA:161): ${line.trim()}`,
    })
  }

  return { ok: true, tokens: { ...tokens, name }, advisories }
}

/**
 * The `&N` readers, re-exported so a consumer of the grammar has one import.
 * `readCardId` answers exactly what {@link parseCardLine} reads; `readAnyCardId`
 * is the deliberately wider pool seeder. See `card-line-id.ts` for why the two
 * widths differ — and note that it is the only module that spells the pattern.
 */
export { readAnyCardId, readCardId } from './card-line-id'

/** Where a diagnostic was found. `file` is optional — pasted text has none. */
export type CardLineDiagnosticLocation = {
  file?: string
  /** 1-based line number. */
  line: number
}

/**
 * Render a parse diagnostic with its location: `decks/burn.md:12: …` when the
 * file is known, `line 12: …` when it is not. Errors append their hint.
 */
export function formatCardLineDiagnostic(
  diagnostic: CardLineDiagnostic,
  where: CardLineDiagnosticLocation,
): string {
  const prefix = where.file === undefined ? `line ${where.line}` : `${where.file}:${where.line}`
  const hint = 'ok' in diagnostic && diagnostic.hint ? ` (${diagnostic.hint})` : ''
  return `${prefix}: ${diagnostic.message}${hint}`
}
