import type { MessageKey } from '../i18n/messages/en'
import { t, type ParameterlessKey } from '../i18n/t'
import { syncList, syncMessage, syncRef, type SyncMessage, type SyncText } from '../sync/message'
import { BOARDS, DEFAULT_SECTION, type Board, type DeckData, type DeckSection } from './deck'

import type { DeckFormatKey } from './deck'
export type { DeckFormatKey }

interface FormatInfo {
  /**
   * The format's display name, as a {@link ParameterlessKey} rather than rendered
   * text: this table is evaluated once at module load, so a string would freeze
   * every deck cover and format picker in the boot-time language.
   */
  label: ParameterlessKey
  /**
   * The card count expected for a "standard" deck in this format. Counts only
   * the main deck (commander/oathbreaker/signature included; sideboard,
   * maybeboard, tokens, and other extras excluded).
   */
  expectedMainboardSize: number
  /** Whether decks of this format have a command zone (commander / oathbreaker / signature spell). */
  hasCommandZone: boolean
}

const FORMAT_INFO = {
  commander: {
    label: 'domain.deckFormat.commander',
    expectedMainboardSize: 100,
    hasCommandZone: true,
  },
  oathbreaker: {
    label: 'domain.deckFormat.oathbreaker',
    expectedMainboardSize: 60,
    hasCommandZone: true,
  },
  standard: {
    label: 'domain.deckFormat.standard',
    expectedMainboardSize: 60,
    hasCommandZone: false,
  },
  modern: { label: 'domain.deckFormat.modern', expectedMainboardSize: 60, hasCommandZone: false },
  pioneer: { label: 'domain.deckFormat.pioneer', expectedMainboardSize: 60, hasCommandZone: false },
  legacy: { label: 'domain.deckFormat.legacy', expectedMainboardSize: 60, hasCommandZone: false },
  vintage: { label: 'domain.deckFormat.vintage', expectedMainboardSize: 60, hasCommandZone: false },
  pauper: { label: 'domain.deckFormat.pauper', expectedMainboardSize: 60, hasCommandZone: false },
  historic: {
    label: 'domain.deckFormat.historic',
    expectedMainboardSize: 60,
    hasCommandZone: false,
  },
  alchemy: { label: 'domain.deckFormat.alchemy', expectedMainboardSize: 60, hasCommandZone: false },
  explorer: {
    label: 'domain.deckFormat.explorer',
    expectedMainboardSize: 60,
    hasCommandZone: false,
  },
  timeless: {
    label: 'domain.deckFormat.timeless',
    expectedMainboardSize: 60,
    hasCommandZone: false,
  },
  'penny-dreadful': {
    label: 'domain.deckFormat.pennyDreadful',
    expectedMainboardSize: 60,
    hasCommandZone: false,
  },
  brawl: { label: 'domain.deckFormat.brawl', expectedMainboardSize: 60, hasCommandZone: true },
  'historic-brawl': {
    label: 'domain.deckFormat.historicBrawl',
    expectedMainboardSize: 100,
    hasCommandZone: true,
  },
  'duel-commander': {
    label: 'domain.deckFormat.duelCommander',
    expectedMainboardSize: 100,
    hasCommandZone: true,
  },
  'pauper-commander': {
    label: 'domain.deckFormat.pauperCommander',
    expectedMainboardSize: 100,
    hasCommandZone: true,
  },
  'pre-dh': { label: 'domain.deckFormat.preDh', expectedMainboardSize: 100, hasCommandZone: true },
  'pre-modern': {
    label: 'domain.deckFormat.preModern',
    expectedMainboardSize: 60,
    hasCommandZone: false,
  },
  limited: { label: 'domain.deckFormat.limited', expectedMainboardSize: 40, hasCommandZone: false },
} as const satisfies Record<DeckFormatKey, FormatInfo>

/**
 * Alternate spellings that resolve to a canonical key. Covers the names external
 * services use (Archidekt's "Commander / EDH" and "Dual Commander", Moxfield's
 * "duelCommander", "penny", "predh") as well as the shorthand a user is likely
 * to type. Keys here are already slugified by {@link parseDeckFormat}.
 */
const FORMAT_ALIASES: Record<string, DeckFormatKey> = {
  edh: 'commander',
  'commander-edh': 'commander',
  'edh-commander': 'commander',
  '1v1-commander': 'duel-commander',
  'commander-1v1': 'duel-commander',
  'dual-commander': 'duel-commander',
  penny: 'penny-dreadful',
  pdh: 'pauper-commander',
  'pauper-edh': 'pauper-commander',
  predh: 'pre-dh',
  premodern: 'pre-modern',
  draft: 'limited',
  sealed: 'limited',
}

export function getDeckFormatLabel(format: DeckFormatKey): string {
  return t(deckFormatLabelKey(format))
}

/**
 * The catalog key of a format's display name — for a message that renders the
 * name later, in its reader's locale (a sync's log line), rather than now.
 */
export function deckFormatLabelKey(format: DeckFormatKey): ParameterlessKey {
  return FORMAT_INFO[format].label
}

/** Whether decks of this format have a command zone. */
export function formatHasCommandZone(format: DeckFormatKey): boolean {
  return FORMAT_INFO[format].hasCommandZone
}

/**
 * The section name created when a card is set as commander and no
 * commander-named section exists — shared by the editor engine and the
 * line-preserving mutation path so both create the same section.
 */
export const COMMANDER_SECTION = 'Commander'

/**
 * The sections a freshly created, empty deck of `format` starts with: a
 * `Commander` section first for a format with a command zone (the one
 * {@link COMMANDER_SECTION} names, so marking a commander later fills it rather
 * than adding a second), then `Main`. Shared by every way a deck is created.
 */
export function newDeckSections(format: DeckFormatKey): DeckSection[] {
  const main: DeckSection = { name: DEFAULT_SECTION, cards: [] }
  if (!formatHasCommandZone(format)) return [main]
  return [{ name: COMMANDER_SECTION, cards: [] }, main]
}

/**
 * What a deck section *is*, decided by its name. `main` is the catch-all: every
 * name the table does not list — `Creatures`, `Ramp`, `Token Generators`,
 * `Commander Damage Notes`, `Sideboard (post-board)` — is a main-deck section.
 */
export type SectionRole =
  'commander' | 'companion' | 'oathbreaker' | 'sideboard' | 'maybeboard' | 'tokens' | 'main'

/**
 * The closed alias set for every non-`main` role, plus the spellings of `main`
 * itself. Matching is **exact** on the lowercased, trimmed name — never a
 * substring or a word-boundary test — so a user's own heading can mention
 * "commander" or "tokens" without being pulled out of the main deck.
 *
 * The first alias of each role is its canonical section name, which is what
 * the Arena-marker importer (`ARENA_SECTION_MARKERS` in
 * `src/importers/text-file.ts`) reads from this table.
 */
export const SECTION_ROLES: Readonly<Record<SectionRole, readonly string[]>> = {
  // i18n-exempt: a `## Section` heading spelling matched literally in list files, file-format vocabulary
  commander: ['commander', 'commanders', 'command zone'],
  companion: ['companion'],
  // i18n-exempt: a `## Section` heading spelling matched literally in list files, file-format vocabulary
  oathbreaker: ['oathbreaker', 'signature spell'],
  sideboard: ['sideboard'],
  maybeboard: ['maybeboard'],
  tokens: ['tokens', 'token'],
  main: ['main', 'mainboard', 'deck'],
}

const ROLE_BY_ALIAS: ReadonlyMap<string, SectionRole> = new Map(
  (Object.keys(SECTION_ROLES) as SectionRole[]).flatMap((role) =>
    SECTION_ROLES[role].map((alias): [string, SectionRole] => [alias, role]),
  ),
)

/**
 * A role's canonical section name: its first {@link SECTION_ROLES} alias, with
 * every word capitalized (`command zone` -> `Command Zone`). The one derivation
 * of that rule — the Arena-marker importer and the CSV importer's category-cell
 * board routing both read it from here, so a multi-word alias can never be
 * spelled two ways. `toUpperCase` is locale-invariant on purpose.
 */
export function canonicalSectionName(role: SectionRole): string {
  const alias = SECTION_ROLES[role][0] ?? role
  return alias.replace(/\b\p{Ll}/gu, (letter) => letter.toUpperCase())
}

/** The role of a section, by exact (lowercased, trimmed) match against {@link SECTION_ROLES}. */
export function sectionRole(name: string): SectionRole {
  return ROLE_BY_ALIAS.get(name.trim().toLowerCase()) ?? 'main'
}

export function isCommanderSection(name: string): boolean {
  return sectionRole(name) === 'commander'
}

export function isOathbreakerSection(name: string): boolean {
  return sectionRole(name) === 'oathbreaker'
}

export function isSideboardSection(name: string): boolean {
  return sectionRole(name) === 'sideboard'
}

/**
 * True only for the privileged main-board spellings (`main`, `mainboard`,
 * `deck`) — not for every free-text section `sectionRole` folds into `main`.
 */
export function isMainBoardSection(name: string): boolean {
  return SECTION_ROLES.main.includes(name.trim().toLowerCase())
}

/**
 * The companion slot. Lives here beside its siblings rather than inline in the
 * one caller that needs it (`dialectBoard` in `src/export/dialects.ts`), so this
 * module stays the single table that decides what a section *is*.
 */
export function isCompanionSection(name: string): boolean {
  return sectionRole(name) === 'companion'
}

/** Message keys naming the known deck boards. */
type BoardMessageKey = Extract<MessageKey, `domain.board.${string}`>

/**
 * The display name of each known board. Keys, not rendered text — the table is
 * evaluated once at module load. Only the four {@link Board} names: every other
 * heading (`Creatures`, `Mainboard`, `Tokens`) is the owner's own wording.
 */
const BOARD_DISPLAY_KEYS = {
  Commander: 'domain.board.commander',
  Main: 'domain.board.main',
  Sideboard: 'domain.board.sideboard',
  Maybeboard: 'domain.board.maybeboard',
} as const satisfies Record<Board, BoardMessageKey>

/** Each known board by its folded (trimmed, lowercased) spelling. */
const BOARD_BY_FOLDED_NAME: ReadonlyMap<string, Board> = new Map(
  BOARDS.map((board): [string, Board] => [board.toLowerCase(), board]),
)

/**
 * The known board a section heading is, matched the way
 * {@link resolveSectionName} matches a section (trimmed, case folded): a
 * hand-written `## sideboard` is the Sideboard. `undefined` for any other heading.
 */
export function knownBoard(section: string): Board | undefined {
  return BOARD_BY_FOLDED_NAME.get(section.trim().toLowerCase())
}

/**
 * A section's name **for a reader**: a known board ({@link knownBoard} — so
 * `sideboard` too) by its name in the UI locale; any other section is shown
 * exactly as written. Any list's section — a collection's or wanted list's
 * implicit `Main` is the same word. Display only: the file, `--output json`,
 * flags and API payloads keep the name as it is, so a section a reader picks is
 * still selected by its own name.
 */
export function sectionDisplayName(section: string): string {
  const board = knownBoard(section)
  return board === undefined ? section : t(BOARD_DISPLAY_KEYS[board])
}

/**
 * {@link sectionDisplayName} unrendered, for a heading or message param that
 * is rendered later in its reader's locale: a known board as a message
 * reference, any other section as its literal text.
 */
export function sectionNameParam(section: string): SyncText {
  const board = knownBoard(section)
  return board === undefined ? section : syncRef(BOARD_DISPLAY_KEYS[board])
}

/**
 * The labels a picker (or the Sections manager) shows for `names`, in order:
 * each {@link sectionDisplayName} — except where two or more headings would
 * read the same (`## Sideboard` beside a hand-written `## sideboard`, or a
 * custom `## Seitenboard` beside `## Sideboard` under German), where every
 * member of that group shows its raw heading instead of identical rows.
 */
export function sectionDisplayNames(names: readonly string[]): string[] {
  const displays = names.map(sectionDisplayName)
  const counts = new Map<string, number>()
  for (const display of displays) {
    const folded = display.toLowerCase()
    counts.set(folded, (counts.get(folded) ?? 0) + 1)
  }
  return names.map((name, index) => {
    const display = displays[index] ?? name
    return (counts.get(display.toLowerCase()) ?? 0) > 1 ? name : display
  })
}

/** A typed section name resolved: see {@link resolveTypedSectionName}. */
export type TypedSectionName = { name: string; existing: string | undefined }

/**
 * What a section name the reader **typed** names. `name` is the heading to
 * write and `existing` the section of `sections` it already is, when one is:
 *
 * 1. a heading the deck has, case-folded — the owner's own `## Seitenboard`
 *    is found by typing it;
 * 2. else a known board, typed as its token in any case or as its name in the
 *    UI locale (German `Seitenboard`), is the board's English token — so no
 *    translated heading reaches the file — and the deck's heading of that
 *    token, case-folded, when it has one.
 *
 * Nothing matches by display name alone: a custom `## Seitenboard` is a
 * main-board section, and typing `Sideboard` must name the Sideboard, not it.
 * Each prompt decides what an `existing` match does (refuse a duplicate, or
 * fold onto it).
 */
export function resolveTypedSectionName(
  sections: readonly string[],
  typed: string,
): TypedSectionName {
  const trimmed = typed.trim()
  const folded = trimmed.toLowerCase()
  const exact = sections.find((section) => section.trim().toLowerCase() === folded)
  if (exact !== undefined) return { name: exact, existing: exact }
  const board =
    knownBoard(trimmed) ??
    BOARDS.find((candidate) => t(BOARD_DISPLAY_KEYS[candidate]).trim().toLowerCase() === folded)
  const name = board ?? trimmed
  const existing = sections.find((section) => section.trim().toLowerCase() === name.toLowerCase())
  return { name: existing ?? name, existing }
}

/**
 * The existing section a requested section name means, else the name itself.
 * A caller naming a section to place a card in — an MCP `add`, a CLI
 * `--section`, a changelog replay — rarely spells it the way the file does:
 *
 * 1. the same name, case and surrounding space folded (`sideboard` →
 *    `## Sideboard`);
 * 2. else, for a name with a reserved role (`Commander`, `Sideboard`,
 *    `Maybeboard`, …, or a main-board spelling such as `Main`), the deck's
 *    first section of that role (`Main` → `## Creatures` in a deck whose main
 *    board is split into custom sections);
 * 3. else the requested name — a section to create — with a case variant of
 *    a known board's token canonicalized (`sideboard` → `Sideboard`).
 *
 * The one resolver behind both engines that place deck cards by section (the
 * change reducer and the on-disk line engine), so a requested section lands
 * in the same place whichever wrote it.
 */
export function resolveSectionName(existing: readonly string[], requested: string): string {
  const folded = requested.trim().toLowerCase()
  const byName = existing.find((name) => name.trim().toLowerCase() === folded)
  if (byName !== undefined) return byName
  const role = sectionRole(requested)
  if (role !== 'main' || isMainBoardSection(requested)) {
    const slot = sectionSlot(requested)
    const byRole = existing.find((name) => sectionSlot(name) === slot)
    if (byRole !== undefined) return byRole
  }
  // A case variant of a board's token is that board: `--section sideboard` on a
  // deck without one writes `## Sideboard`, as every prompt and editor does.
  // Only the token — a flag never takes a translated name.
  return knownBoard(requested) ?? requested
}

/**
 * The slot a section fills, for {@link resolveSectionName}'s role step: its
 * role, except that the oathbreaker role's two aliases name two different
 * cards — the Oathbreaker and its Signature Spell — so neither stands in for
 * the other. Every other role's aliases are synonyms.
 */
function sectionSlot(name: string): string {
  const role = sectionRole(name)
  if (role !== 'oathbreaker') return role
  const folded = name.trim().toLowerCase()
  // i18n-exempt: a `## Section` heading spelling matched literally in list files, file-format vocabulary
  return folded === 'signature spell' ? 'signature spell' : role
}

/**
 * Find the deck section a requested name means ({@link resolveSectionName}),
 * creating and appending an empty one under the requested name when the deck
 * has none.
 */
export function findOrCreateSection(sections: DeckSection[], name: string): DeckSection {
  const resolved = resolveSectionName(
    sections.map((s) => s.name),
    name,
  )
  const existing = sections.find((s) => s.name === resolved)
  if (existing) return existing
  const created: DeckSection = { name, cards: [] }
  sections.push(created)
  return created
}

/**
 * Whether an unqualified add (or a card leaving the command zone) may land in
 * this section: any main-deck section — `## Main`, `## Creatures`, `## Ramp` —
 * and none of the reserved slots: not the commander, oathbreaker / signature
 * spell or companion slot (each holds exactly the card the format puts there),
 * not the sideboard, not an extras section such as `## Maybeboard`. The one
 * rule the change reducer ({@link resolveDefaultAddSection}) and the on-disk
 * line engine share.
 */
export function isDefaultAddSection(name: string): boolean {
  return sectionRole(name) === 'main'
}

/**
 * The section an unqualified add lands in: the first section
 * {@link isDefaultAddSection} accepts, creating and appending `Main` when none
 * exists.
 */
export function resolveDefaultAddSection(sections: DeckSection[]): DeckSection {
  const existing = sections.find((s) => isDefaultAddSection(s.name))
  if (existing) return existing
  const created: DeckSection = { name: DEFAULT_SECTION, cards: [] }
  sections.push(created)
  return created
}

/** Extras — exactly the maybeboard and tokens roles. */
export function isExtraSection(name: string): boolean {
  const role = sectionRole(name)
  return role === 'maybeboard' || role === 'tokens'
}

/**
 * True for a section a whole-file rewrite drops instead of writing as a bare
 * `## Header`: an extras section (maybeboard, tokens) with no cards left in it.
 *
 * Extras count toward no total and toward no format check, so an empty one holds
 * nothing a rewrite could destroy — it is a leftover, most often from a sync that
 * removed the last card the remote held there. The parser
 * (`parseDeckText`, which reports it as an *advisory* rather than a
 * rewrite-blocking warning) and the serializer (`serializeDeckToMarkdown`, which
 * omits it) must agree on this exactly: a section one drops and the other keeps
 * is either a header that can never be cleaned up or a deletion nobody was
 * warned about. An empty *non*-extras section is kept — `## Main` with no cards
 * is what a freshly created deck is made of.
 */
export function isDroppedEmptySection(section: DeckSection): boolean {
  return section.cards.length === 0 && isExtraSection(section.name)
}

/**
 * True for sections that count toward the main deck size (commander +
 * mainboard, including oathbreaker/signature spell). Sideboard, maybeboard,
 * and token sections are excluded.
 */
export function isMainDeckSection(name: string): boolean {
  return !isSideboardSection(name) && !isExtraSection(name)
}

/**
 * Sum of card quantities across the main deck (commander/oathbreaker +
 * mainboard). Sideboard/maybeboard/token sections are excluded so a "60-card"
 * format with a sideboard still reports 60.
 */
export function getMainDeckSize(sections: DeckSection[]): number {
  let total = 0
  for (const section of sections) {
    if (!isMainDeckSection(section.name)) continue
    for (const card of section.cards) total += card.quantity
  }
  return total
}

/** Every legal deck format key, in declaration order. */
export const DECK_FORMAT_KEYS = Object.keys(FORMAT_INFO) as DeckFormatKey[]

/** Own keys only: `constructor` and friends live on every object's prototype. */
function isDeckFormatKey(value: string): value is DeckFormatKey {
  return Object.hasOwn(FORMAT_INFO, value)
}

/**
 * Parse an untrusted format value — a front matter field, a CLI flag, an admin
 * form value, an Archidekt label, a Moxfield slug — into a canonical
 * {@link DeckFormatKey}. Returns null when the value is absent, not a string, or
 * names a format Ritual does not model (e.g. Archidekt's "Custom").
 *
 * This is the single entry point for turning outside text into a format; no
 * other module should compare or lowercase format strings itself.
 */
export function parseDeckFormat(raw: unknown): DeckFormatKey | null {
  if (typeof raw !== 'string') return null
  const slug = raw
    .trim()
    // Split camelCase so Moxfield's `duelCommander` slugs to `duel-commander`.
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    // Collapse every other separator (spaces, underscores, slashes) to a dash.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return null
  if (isDeckFormatKey(slug)) return slug
  return Object.hasOwn(FORMAT_ALIASES, slug) ? (FORMAT_ALIASES[slug] ?? null) : null
}

/**
 * The message shown when {@link parseDeckFormat} rejects a user-supplied format.
 * Lives here so the CLI, the admin API, and any other caller reject a bad format
 * in the same words, listing the same keys: English plus its key, so the API
 * answers in English and the CLI renders it in its own language. The format
 * slugs are machine vocabulary, joined as a unit list in the reader's locale —
 * the same convention the custom-art extensions and unknown keys use.
 */
export function invalidDeckFormatMessage(raw: unknown): SyncMessage {
  return syncMessage('domain.list.deckFormat.invalid', {
    format: String(raw),
    formats: syncList(DECK_FORMAT_KEYS, 'unit'),
  })
}

/**
 * Resolve the format a deck should be treated as: its declared format when it
 * has (and can parse) one, otherwise a heuristic read of its section names.
 * `frontMatterFormat` is the raw front matter value, for callers that hold the
 * front matter separately from the parsed {@link DeckData}. Returns null when no
 * format can be determined.
 *
 * Every surface — the site, the editors, the CLI menus — resolves through this,
 * and `serializeDeckToMarkdown` persists what it returns, so a deck's format
 * reads the same everywhere and stops being a guess after its first save.
 */
export function resolveDeckFormat(
  deck: DeckData,
  frontMatterFormat?: unknown,
): DeckFormatKey | null {
  const declared = parseDeckFormat(deck.format ?? frontMatterFormat)
  if (declared) return declared
  if (deck.sections.some((s) => isOathbreakerSection(s.name))) return 'oathbreaker'
  if (deckHasCommandZoneSection(deck)) return 'commander'
  return null
}

/** True when any of the deck's sections is a command zone (commander / oathbreaker / signature spell). */
function deckHasCommandZoneSection(deck: DeckData): boolean {
  return deck.sections.some((s) => isCommanderSection(s.name) || isOathbreakerSection(s.name))
}

/** What a deck's card list structurally suggests about its format. */
export type DeckFormatSignalKind =
  /** A command-zone section (commander / oathbreaker / signature spell) is present. */
  | 'command-zone'
  /** No command zone, 60+ main deck cards — a 60-card constructed format. */
  | 'constructed-60'
  /** No command zone, 40–59 main deck cards — likely a limited (sealed/draft) deck. */
  | 'limited'
  /** Too few cards to suggest anything. */
  | 'none'

/** A deck's structural format hint together with the size it was derived from. */
export type DeckFormatSignal = { kind: DeckFormatSignalKind; mainDeckSize: number }

/**
 * Read what a deck's card list suggests about its format, for prompts that ask
 * the user to pick one: the signal orders (never decides) the offered formats.
 */
export function detectDeckFormatSignal(deck: DeckData): DeckFormatSignal {
  const mainDeckSize = getMainDeckSize(deck.sections)
  if (deckHasCommandZoneSection(deck)) return { kind: 'command-zone', mainDeckSize }
  // Thresholds come from the formats' own expected sizes, so they cannot drift.
  if (mainDeckSize >= FORMAT_INFO.standard.expectedMainboardSize) {
    return { kind: 'constructed-60', mainDeckSize }
  }
  if (mainDeckSize >= FORMAT_INFO.limited.expectedMainboardSize) {
    return { kind: 'limited', mainDeckSize }
  }
  return { kind: 'none', mainDeckSize }
}

/**
 * Every format key, reordered so the ones matching the signal come first (each
 * group in declaration order): command-zone formats for a `command-zone` signal,
 * the 60-card constructed formats for `constructed-60`, Limited for `limited`.
 * A `none` signal keeps plain declaration order.
 */
export function deckFormatKeysForSignal(signal: DeckFormatSignalKind): DeckFormatKey[] {
  const preferred = (key: DeckFormatKey): boolean => {
    switch (signal) {
      case 'command-zone':
        return formatHasCommandZone(key)
      case 'constructed-60':
        return !formatHasCommandZone(key) && key !== 'limited'
      case 'limited':
        return key === 'limited'
      case 'none':
        return false
    }
  }
  return [...DECK_FORMAT_KEYS.filter(preferred), ...DECK_FORMAT_KEYS.filter((k) => !preferred(k))]
}

export interface DeckCountLabel {
  /** Primary label shown in normal weight (format name, or "X cards" fallback). */
  primary: string
  /** Optional parenthetical, rendered smaller, when the size is unusual. */
  suffix?: string
}

/**
 * `1 card` / `30 cards`. A thin alias for the shared count message, kept while
 * the public site's own call sites still reach for a function rather than a
 * key; those become direct `t()` calls when that surface converts.
 */
export function pluralizeCards(count: number): string {
  return t('domain.count.cards', { count })
}

/**
 * Build the deck cover label. When a format is known, show the format name and
 * only include the card count parenthetically if it deviates from the format's
 * expected mainboard size. When no format is known, fall back to the raw card
 * count.
 */
export function getDeckCountLabel(
  format: DeckFormatKey | null,
  mainboardSize: number,
): DeckCountLabel {
  if (!format) return { primary: pluralizeCards(mainboardSize) }
  const info = FORMAT_INFO[format]
  const label = t(info.label)
  if (mainboardSize === info.expectedMainboardSize) return { primary: label }
  return {
    primary: label,
    suffix: t('domain.deckCount.unusual', { cards: pluralizeCards(mainboardSize) }),
  }
}
