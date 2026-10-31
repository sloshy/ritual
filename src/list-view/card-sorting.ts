import { compareData, compareDisplay } from '../i18n/collate'
import type { MessageKey } from '../i18n/messages/en'
import { t, type ParameterlessKey, type ParamsOf } from '../i18n/t'
import { syncPrice, syncRef, type SyncMessageRef, type SyncText } from '../sync/message'
import { BUYLIST_CURRENCY } from '../buylist'
import type { Finish } from '../card/finish-condition'
import type { ScryfallCard } from '../scryfall/types'
import type { CardLabel } from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import { formatCardTags, type CardTag } from '../card/card-tags'
import {
  cardCategorySpellings,
  foldCardCategory,
  primaryCardCategory,
  type CardCategory,
} from '../card/card-categories'
import type { PriceCurrency } from '../pricing/price-currency'
import type { ListRefKey } from './combined-list'
import { isPricelessCard } from './priceless'
import { sectionNameParam } from '../list/deck-format'

export type ViewMode = 'binder' | 'list' | 'overlap' | 'stack'
export type CardSize = 'large' | 'medium' | 'small'
export const CARD_SIZE_WIDTHS = {
  large: 190,
  medium: 140,
  small: 100,
} as const satisfies Record<CardSize, number>
export type GroupBy =
  | 'type'
  | 'section'
  | 'cmc'
  | 'color-identity'
  | 'price'
  | 'buylist-price'
  | 'on-buylist'
  | 'printing'
  | 'source'
  | 'tags'
  | 'category'
  | 'categories'
  | 'none'
export type SortBy =
  | 'name'
  | 'cmc'
  | 'price'
  | 'buylist-price'
  | 'buylist-spread'
  | 'edhrec'
  | 'file-order'
  | 'set-code'
  | 'color-identity'
  | 'tags'
  | 'category'
/**
 * One layer of an ordered, multi-level sort. Layers are applied in order: the
 * first is the primary sort, and each subsequent layer breaks ties within the
 * previous one. `reverse` flips just that layer's direction.
 */
export type SortLayer = { readonly sortBy: SortBy; readonly reverse: boolean }
export type PriceGroupStrategy = 'archidekt' | 'five' | 'ten'

/** A labeled option for a toolbar `<select>`, carrying its precise value type. */
export type SelectOption<T extends string = string> = { value: T; label: string }

/**
 * The same option before its label is rendered. Module-level option tables hold
 * this shape — a `MessageKey` rather than text — because they are evaluated once
 * at import, and a rendered string there would leave the toolbar dropdowns in
 * the boot-time language after a locale switch. The `value` half is a persisted
 * URL token and stays locale-independent.
 */
export type SelectOptionKey<T extends string = string, K extends MessageKey = MessageKey> = {
  value: T
  label: K
}

/**
 * Every key naming a toolbar sort field. Narrower than `MessageKey` so `t()`
 * can render one without params, and `Extract` turns a key that no longer
 * exists in the catalog into `never` — a compile error at the table below.
 */
export type SortByMessageKey = Extract<
  MessageKey,
  `domain.sortBy.${string}` | `site.sortBy.${string}`
>

/** Canonical display label for each sort field; the single source of truth for toolbar option labels. */
export const SORT_BY_LABELS = {
  name: 'domain.sortBy.name',
  cmc: 'domain.sortBy.cmc',
  price: 'domain.sortBy.price',
  'buylist-price': 'domain.sortBy.buylistPrice',
  'buylist-spread': 'domain.sortBy.buylistSpread',
  edhrec: 'domain.sortBy.edhrec',
  'file-order': 'domain.sortBy.fileOrder',
  'set-code': 'domain.sortBy.setCode',
  'color-identity': 'domain.sortBy.colorIdentity',
  tags: 'site.sortBy.tags',
  category: 'site.sortBy.category',
} as const satisfies Record<SortBy, SortByMessageKey>

/**
 * Every sort field, derived from the labels rather than restated. `satisfies
 * Record<SortBy, SortByMessageKey>` above makes the key set exactly `SortBy`, so a new
 * member is a compile error there instead of a shared link whose `sort=` value
 * silently fails to parse.
 */
export const SORT_BYS = Object.keys(SORT_BY_LABELS) as readonly SortBy[]

/**
 * The groupings sell mode adds, in the order they appear after the ordinary
 * ones. Shared so every list page's dropdown — and the URL whitelist that
 * validates a shared link's `group=` — offer exactly the same set. Values, not
 * labelled options: the labels live in one `GroupBy`-total table beside the
 * pages that build the dropdowns.
 */
export const SELL_GROUP_BYS = ['buylist-price', 'on-buylist'] as const satisfies readonly GroupBy[]

/**
 * The groupings that nest inside a deck's boards. One table,
 * compile-checked against `GroupBy`, shared by the page dropdowns and by the
 * deck nesting leaf so the two halves can never disagree.
 */
export const CATEGORY_GROUP_BYS = ['category', 'categories'] as const satisfies readonly GroupBy[]

/** The group-by values that nest inside a deck's boards. */
export type CategoryGroupBy = (typeof CATEGORY_GROUP_BYS)[number]

/** The sort fields sell mode adds. */
export const SELL_SORT_BYS = [
  'buylist-price',
  'buylist-spread',
] as const satisfies readonly SortBy[]

/**
 * A page's sort fields, with sell mode's appended when the page offers them.
 * One helper so a page's toolbar dropdown and its URL-sync whitelist can never
 * be given different answers — they were, and a collection page's sort dropdown
 * silently lacked an option its shared links accepted.
 */
export function sortByValuesFor(
  base: readonly SortBy[],
  sellMode: boolean | undefined,
): readonly SortBy[] {
  return sellMode ? [...base, ...SELL_SORT_BYS] : base
}

/**
 * Build the toolbar's sort dropdown options from an ordered list of sort fields,
 * labeling each from {@link SORT_BY_LABELS}. Pages pass the subset and order they
 * offer; `overrides` lets a page relabel a field in context (e.g. the combined
 * view calls `file-order` "List Order").
 */
export function sortByOptions(
  values: readonly SortBy[],
  overrides?: Partial<Record<SortBy, SortByMessageKey>>,
): SelectOption<SortBy>[] {
  return values.map((value) => ({ value, label: t(overrides?.[value] ?? SORT_BY_LABELS[value]) }))
}

export interface CardData {
  name: string
  quantity: number
  cmc: number
  edhrec: number
  price: number
  /**
   * The selected buyer's active per-copy offer (USD), or 0 when there is none:
   * the card is not on the buylist, the buyer has paused it, or sell mode is
   * off. 0 is the same "no price" sentinel `price` uses, so buylist prices flow
   * through the existing filter/group/sort machinery unchanged.
   */
  buylistPrice: number
  /**
   * The buyer's offer minus the card's USD retail price. Positive means they
   * pay at or above retail. Always computed in USD on both sides — the display
   * currency would make the subtraction meaningless.
   *
   * A missing offer or a missing USD retail price counts as 0, so this is
   * always a number: a card with no offer is just the worst deal on its retail
   * price. Sorts ascending like every other numeric field, so the cards the
   * buyer pays the most for relative to retail come last.
   */
  buylistSpread: number
  /**
   * Whether the buyer is actively buying this printing — false for a paused
   * offer, so this is true exactly when `buylistPrice > 0`. Drives the
   * on-buylist filter and grouping. Always false while sell mode is off.
   */
  onBuylist: boolean
  type: string
  section: string
  fileOrder: number
  setCode: string
  colorIdentity: string[]
  /** Whether this entry is pinned to a specific printing (has both set and collector number). */
  hasPrinting: boolean
  /**
   * The entry's own `set:cn` pin (via `printingKey`), independent of which
   * printing the tile displays. Present exactly when the entry carries both a
   * set and a collector number. `card` can be re-targeted by the Lowest Price
   * toggle or a per-store printing pick, so identity checks that mean "the
   * printing this line declares" (the share filters) must read this, not the
   * displayed card.
   */
  pinnedPrintingKey?: string
  /**
   * Finish of the copy this tile represents. Undefined on entries that do not
   * state one (deck and wanted lines default to nonfoil wherever it matters).
   */
  finish?: Finish
  /**
   * The entry's `[ja]`-style language token. Absent means `en` (a bare line).
   * Comes from the ENTRY, not the resolved Scryfall card — under the default
   * `en` cache no `@lang` object is baked, so the resolved card cannot say.
   */
  language?: CardLanguage
  /** Oracle (functional) tag slugs, shared across printings. Empty when untagged. */
  oracleTags: string[]
  /** Art (illustration) tag slugs for this printing. Empty when untagged. */
  artTags: string[]
  /**
   * Effective card labels (the entry's override applied to its list's default).
   * Always empty for wanted cards, which carry no labels; a deck card carries
   * `proxy` alone (see `LIST_TYPE_LABELS`).
   */
  labels: CardLabel[]
  /**
   * The entry's own `#tag` tokens in canonical form (see `card-tags.ts`).
   * Absent when the line carries none — the same value file data holds, so
   * "no tags" never has two spellings. Drives the tags grouping and sort.
   */
  tags?: CardTag[]
  /**
   * This card's categories in its list, primary first (see
   * `card-categories-sidecar.cardCategoriesOf`). Absent when it has none — the
   * same value the sidecar reports, so "uncategorized" never has two spellings.
   * Drives the two category groupings and the category sort. `readonly` because
   * the loaded record's own array is shared by every card of that name.
   */
  categories?: readonly CardCategory[]
  /**
   * The entry's custom art, as baked into the list detail: `art/<relpath>` for
   * a local file or a verbatim URL. Absent for the overwhelming majority of
   * cards, which show their printing's own image.
   */
  customArt?: string
  /**
   * Whether the source list's art sidecar gives this entry art at all — the
   * fact the "no price, no quote, no sale" rule reads, which
   * {@link CardData.customArt} cannot answer on its own: a reference whose file
   * the build could not deploy bakes no display URL and is priceless all the
   * same. Absent (never `false`) for cards wearing their own printing.
   */
  hasCustomArt?: boolean
  card: ScryfallCard | null
  /**
   * Display name of the list this card came from. Only set in the combined
   * multi-list view, where it drives the "Source List" grouping. Undefined on
   * single-list pages.
   */
  sourceName?: string
  /**
   * The source list's `type:slug` identity, beside {@link CardData.sourceName}:
   * what the "Source List" grouping keys on, so two lists that share a name
   * (a deck and a collection both called "Red") stay two groups.
   */
  sourceKey?: ListRefKey
}

/**
 * What a group's heading says, held unrendered: plain text when the heading
 * *is* the cards' own data (a deck section, a tag set, a category, a price
 * bracket, a source list's name, a mana value, a card type), or a catalog
 * message (a color identity, "Specific Printing", "Uncategorized") that the
 * renderer words in the reader's language with `renderSyncMessage`. Never
 * rendered here: the grouper runs once per change to the cards, and a heading
 * rendered at that moment would stay in that language after a switch.
 */
export type GroupHeading = SyncText

export interface CardGroup<T extends CardData = CardData> {
  /**
   * The group's identity — the same in every language, and never the heading:
   * `<kind>:<value>`, the value being the cards' own data (`section:Main`,
   * `tags:ramp, staple`, `category:ramp`, folded) or a fixed code
   * (`printing:any`, `buylist:on`, `price:none`, `color:WU`). The empty value
   * is the "has none" bucket (`tags:`, `category:`, `source:`), which no data
   * value can collide with. The DOM's `data-section` and anchor id are built
   * from it, so a test or a style hook never has to know the language.
   */
  key: GroupKey
  /** What the section heading says. See {@link GroupHeading}. */
  heading: GroupHeading
  cards: T[]
  /**
   * The category this group *is*, for the `'categories'` grouping — where one
   * card appears in every category it holds and the renderer dims the
   * appearances whose primary differs. Absent for every other grouping and for
   * the Uncategorized group.
   */
  category?: CardCategory
}

export { BUYLIST_CURRENCY }

/** One of the five colors of mana, by its letter. */
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G'

// WUBRG canonical order
export const WUBRG: readonly ManaColor[] = ['W', 'U', 'B', 'R', 'G']

/** The ten two-color identities, by their WUBRG-ordered letters. */
type GuildLetters = 'WU' | 'WB' | 'WR' | 'WG' | 'UB' | 'UR' | 'UG' | 'BR' | 'BG' | 'RG'

/** The ten three-color identities, by their WUBRG-ordered letters. */
type ShardLetters = 'WUB' | 'WUR' | 'WUG' | 'WBR' | 'WBG' | 'WRG' | 'UBR' | 'UBG' | 'URG' | 'BRG'

/** A key naming a color identity in the catalog. */
type ColorIdentityMessageKey = Extract<MessageKey, `site.colorIdentity.${string}`>

/** A color identity name that takes no params — the mono colors. */
type PlainColorKey = {
  [K in ColorIdentityMessageKey]: [ParamsOf<K>] extends [never] ? K : never
}[ColorIdentityMessageKey]

/**
 * A color identity name whose one placeholder is `{colors}`. A table entry
 * whose message lost or renamed it fails to compile rather than rendering a
 * literal `{colors}`.
 */
type LetteredColorKey = {
  [K in ColorIdentityMessageKey]: [ParamsOf<K>] extends ['colors']
    ? ['colors'] extends [ParamsOf<K>]
      ? K
      : never
    : never
}[ColorIdentityMessageKey]

/** The five mono-color names, by mana letter. */
const MONO_COLOR_NAMES = {
  W: 'site.colorIdentity.white',
  U: 'site.colorIdentity.blue',
  B: 'site.colorIdentity.black',
  R: 'site.colorIdentity.red',
  G: 'site.colorIdentity.green',
} as const satisfies Record<ManaColor, PlainColorKey>

/**
 * The guilds (two colors) and the shards and wedges (three), by their
 * WUBRG-ordered letters. Each name is a proper noun the official card
 * translations translate too, so it is a catalog key; the letters are mana
 * symbols, interpolated as the key's `{colors}` so the translator places them.
 * `satisfies` a record over every combination, so a missing entry is a compile
 * error rather than a pair or triple mislabelled by a fallback.
 */
const NAMED_COLOR_COMBOS = {
  WU: 'site.colorIdentity.azorius',
  WB: 'site.colorIdentity.orzhov',
  WR: 'site.colorIdentity.boros',
  WG: 'site.colorIdentity.selesnya',
  UB: 'site.colorIdentity.dimir',
  UR: 'site.colorIdentity.izzet',
  UG: 'site.colorIdentity.simic',
  BR: 'site.colorIdentity.rakdos',
  BG: 'site.colorIdentity.golgari',
  RG: 'site.colorIdentity.gruul',
  WUB: 'site.colorIdentity.esper',
  WUR: 'site.colorIdentity.jeskai',
  WUG: 'site.colorIdentity.bant',
  WBR: 'site.colorIdentity.mardu',
  WBG: 'site.colorIdentity.abzan',
  WRG: 'site.colorIdentity.naya',
  UBR: 'site.colorIdentity.grixis',
  UBG: 'site.colorIdentity.sultai',
  URG: 'site.colorIdentity.temur',
  BRG: 'site.colorIdentity.jund',
} as const satisfies Record<GuildLetters | ShardLetters, LetteredColorKey>

/** Normalize a color identity array to a canonical WUBRG-ordered key string */
export function colorIdentityKey(colors: readonly string[]): string {
  return WUBRG.filter((c) => colors.includes(c)).join('')
}

/**
 * A color identity's name, unrendered: `Colorless`, a mono color, a guild,
 * shard or wedge (`Azorius (WU)`), or the four- and five-color names
 * (`WUBG (Four Color)`). Every one of the 32 identities has an entry.
 */
export function colorIdentityHeading(colors: readonly string[]): SyncMessageRef {
  const letters = colorIdentityKey(colors)
  switch (letters.length) {
    case 0:
      return syncRef('site.colorIdentity.colorless')
    case 1:
      // One letter of `WUBRG` is a mana color.
      return { messageKey: MONO_COLOR_NAMES[letters as ManaColor] }
    case 4:
      return syncRef('site.colorIdentity.fourColor', { colors: letters })
    case 5:
      return syncRef('site.colorIdentity.fiveColor', { colors: letters })
    default:
      // Two or three distinct letters in WUBRG order: exactly the table's keys.
      return {
        messageKey: NAMED_COLOR_COMBOS[letters as GuildLetters | ShardLetters],
        messageParams: { colors: letters },
      }
  }
}

/**
 * Compute a numeric sort value for a color identity in WUBRG order.
 * Mono colors sort first (W=1..G=5), then pairs, triples, etc.
 * Within the same count, combos are ordered by their constituent colors in WUBRG order.
 */
export function colorIdentitySortValue(colors: readonly string[]): number {
  return colorLettersSortValue(colorIdentityKey(colors))
}

/** {@link colorIdentitySortValue} for letters already in WUBRG order. */
function colorLettersSortValue(key: string): number {
  if (key === '') return 0 // Colorless first

  // Group by color count, then order within group
  const count = key.length
  let value = count * 100 // base offset per color count

  // Within the same count, compute positional value from WUBRG indices
  for (let i = 0; i < key.length; i++) {
    value += WUBRG.indexOf(key[i] as ManaColor) * Math.pow(5, key.length - 1 - i)
  }
  return value
}

/** Archidekt's price brackets, as `[low, high)` bounds. The last is open-ended. */
const ARCHIDEKT_BRACKETS: readonly (readonly [number, number])[] = [
  [0, 0.5],
  [0.5, 1],
  [1, 5],
  [5, 10],
  [10, 20],
  [20, 50],
  [50, 100],
  [100, Infinity],
]

/**
 * A group's identity: `all`, or `<kind>:<value>` — see {@link CardGroup.key}.
 * A deck board's own section adds `board:<name>` (`boardSectionKey`).
 */
export type GroupKey = 'all' | `${string}:${string}`

/**
 * Where one card lands in a grouping: the group's {@link CardGroup.key}, its
 * heading, and its place in the group order. Groups sort by `rank`, then — for
 * the groupings whose order is the reader's own (tags, the categories the
 * vocabulary does not name) — by `collate` under display collation, which does
 * follow the locale (`ä` sorts after `z` in Swedish). Never by the heading, so
 * a translated heading can neither merge two groups nor move one.
 */
export type GroupSlot = {
  key: GroupKey
  heading: GroupHeading
  rank: number
  collate?: string
  /** The category the group *is* — set by the two category groupings only. */
  category?: CardCategory
}

/** The rank of a "has none" group — No Price Data, Untagged, Uncategorized — which sorts last. */
const LAST_RANK = Infinity

/** The rank of a category or section the page's order does not name: after the named ones, before {@link LAST_RANK}. */
const UNNAMED_RANK = Number.MAX_SAFE_INTEGER

/** The two kinds of price grouping: the card's price, or the buyer's offer for it. */
export type PriceGroupKind = 'price' | 'buylist-price'

/**
 * A price grouping's slot for one price: its bracket, keyed by the bracket's
 * lower bound (`price:0.5`, `buylist-price:0.5`) and headed by the bracket's
 * bounds as prices in `currency`, or the No Price Data group — last — for no
 * price at all.
 */
export function priceGroupSlot(
  price: number,
  strategy: PriceGroupStrategy,
  currency: PriceCurrency = 'usd',
  kind: PriceGroupKind = 'price',
): GroupSlot {
  if (price <= 0) {
    return { key: `${kind}:none`, heading: syncRef('site.group.price.none'), rank: LAST_RANK }
  }
  const [low, high] =
    strategy === 'archidekt'
      ? (ARCHIDEKT_BRACKETS.find(([lo, hi]) => price >= lo && price < hi) ?? [100, Infinity])
      : stepBracket(price, strategy === 'five' ? 5 : 10)
  const heading =
    high === Infinity
      ? syncRef('site.group.price.atLeast', { low: syncPrice(low, currency) })
      : syncRef('site.group.price.range', {
          low: syncPrice(low, currency),
          high: syncPrice(high, currency),
        })
  return { key: `${kind}:${low}`, heading, rank: low }
}

/** The fixed-width bracket holding `price`. */
function stepBracket(price: number, increment: number): readonly [number, number] {
  const lower = Math.floor(price / increment) * increment
  return [lower, lower + increment]
}

/** Compute the total price for a group of cards */
export function groupTotalPrice(cards: CardData[]): number {
  return cards.reduce((sum, c) => sum + c.price * c.quantity, 0)
}

/**
 * Whether a card's contribution to a total is an estimate: it pins no printing
 * (so it is priced at a representative one), or the active store lists no price
 * for its printing. A copy priceless by rule — a proxy, custom art — is an exact
 * zero, not an estimate.
 */
export function isEstimatedPrice(card: CardData): boolean {
  return !isPricelessCard(card) && (!card.hasPrinting || card.price <= 0)
}

/** Whether a group's {@link groupTotalPrice} contains any {@link isEstimatedPrice} card. */
export function groupHasEstimatedPrice(cards: CardData[]): boolean {
  return cards.some(isEstimatedPrice)
}

/**
 * A card's tag-set key — `formatCardTags`, memoized per tag array. Every tag
 * set in `CardData` is already canonical, so the key is stable for the life of
 * the array, and a sort's `O(n log n)` comparisons must not re-canonicalize
 * (Set + sort + join) both operands each time. `''` for no tags.
 */
const TAG_SET_KEYS = new WeakMap<readonly CardTag[], string>()
function tagSetKey(tags: readonly CardTag[] | undefined): string {
  if (tags === undefined) return ''
  let key = TAG_SET_KEYS.get(tags)
  if (key === undefined) {
    key = formatCardTags(tags)
    TAG_SET_KEYS.set(tags, key)
  }
  return key
}

/**
 * The one ordering rule for tag sets and category names, shared by the tags
 * and category sorts: display order, with `''` — "no tags", "no category" —
 * last. Locale-aware (`compareDisplay`) because the strings are what the reader
 * sees; the order of tags *within* one set is the file's pinned data collation
 * (`normalizeCardTags`), which is why `#ä` can sit one way inside a line and
 * another between lines.
 */
function compareGroupKeys(left: string, right: string): number {
  if (left === right) return 0
  if (left === '') return 1
  if (right === '') return -1
  return compareDisplay(left, right)
}

/** Order two cards' tag sets for the tags sort, untagged cards last. */
function compareTagSets(
  a: readonly CardTag[] | undefined,
  b: readonly CardTag[] | undefined,
): number {
  return compareGroupKeys(tagSetKey(a), tagSetKey(b))
}

/** A card's primary category, or `''` for none — the sort's and grouping's key. */
function primaryCategoryKey(categories: readonly CardCategory[] | undefined): string {
  return primaryCardCategory(categories) ?? ''
}

/**
 * Order two cards by primary category, uncategorized last. Display collation:
 * the comparator has no access to the list's vocabulary, so the *sort* orders
 * primary-category strings the way the reader reads them, while the *group
 * heading* order is the sidecar's own `order`.
 */
function compareCategories(
  a: readonly CardCategory[] | undefined,
  b: readonly CardCategory[] | undefined,
): number {
  return compareGroupKeys(primaryCategoryKey(a), primaryCategoryKey(b))
}

/**
 * Bucket key → the spelling shown in the heading. The shared
 * {@link cardCategorySpellings} table, which the filter row's options are built
 * from too, so a heading and a chip can never spell one category two ways.
 */
type CategoryHeadings = ReadonlyMap<string, CardCategory>

function categoryHeadings(
  cards: readonly CardData[],
  categoryOrder: readonly CardCategory[],
): CategoryHeadings {
  return cardCategorySpellings(
    cards.map((card) => card.categories),
    categoryOrder,
  ).spelling
}

/**
 * Compare two cards by a single field, with no tiebreaker. Always ascending;
 * returns 0 when the field is equal, so callers can chain to the next sort
 * layer.
 */
function compareByField(a: CardData, b: CardData, sortBy: SortBy): number {
  switch (sortBy) {
    case 'name':
      return compareDisplay(a.name, b.name)
    case 'file-order':
      return a.fileOrder - b.fileOrder
    case 'set-code':
      return compareData(a.setCode, b.setCode)
    case 'color-identity':
      return colorIdentitySortValue(a.colorIdentity) - colorIdentitySortValue(b.colorIdentity)
    // Spelled out because the field name differs from the sort key; the default
    // branch below only works for keys that are themselves numeric CardData fields.
    case 'buylist-price':
      return a.buylistPrice - b.buylistPrice
    case 'buylist-spread':
      return a.buylistSpread - b.buylistSpread
    case 'tags':
      return compareTagSets(a.tags, b.tags)
    case 'category':
      return compareCategories(a.categories, b.categories)
    default:
      return a[sortBy] - b[sortBy]
  }
}

/**
 * Compare two cards across an ordered list of sort layers. Each layer is applied
 * in turn — the first layer that yields a non-zero comparison decides the order,
 * so later layers act as tiebreakers within the previous ones. As a final,
 * always-ascending tiebreaker (and to keep the overall sort stable), cards that
 * compare equal on every layer fall back to their name. An empty layer list
 * therefore sorts purely by name.
 */
export function compareBySortLayers(
  a: CardData,
  b: CardData,
  layers: readonly SortLayer[],
): number {
  for (const layer of layers) {
    const result = compareByField(a, b, layer.sortBy)
    if (result !== 0) return layer.reverse ? -result : result
  }
  return compareDisplay(a.name, b.name)
}

/**
 * The type grouping's buckets, in heading order. Ritual's own categories, not
 * the type line's words: a card goes under the first of these its front face's
 * type line names, and `other` holds everything else (a battle, a bare
 * kindred spell).
 */
export const CARD_TYPE_CATEGORIES = [
  'creature',
  'planeswalker',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'land',
  'other',
] as const

/** One of {@link CARD_TYPE_CATEGORIES}. */
export type CardTypeCategory = (typeof CARD_TYPE_CATEGORIES)[number]

/** The English type-line word each category is recognized by. */
const CARD_TYPE_WORDS = {
  creature: 'Creature',
  planeswalker: 'Planeswalker',
  instant: 'Instant',
  sorcery: 'Sorcery',
  artifact: 'Artifact',
  enchantment: 'Enchantment',
  land: 'Land',
} as const satisfies Record<Exclude<CardTypeCategory, 'other'>, string>

/** Each category's heading. */
const CARD_TYPE_HEADINGS = {
  creature: 'site.group.type.creature',
  planeswalker: 'site.group.type.planeswalker',
  instant: 'site.group.type.instant',
  sorcery: 'site.group.type.sorcery',
  artifact: 'site.group.type.artifact',
  enchantment: 'site.group.type.enchantment',
  land: 'site.group.type.land',
  other: 'site.group.type.other',
} as const satisfies Record<CardTypeCategory, ParameterlessKey>

export function getCardTypeCategory(typeLine: string): CardTypeCategory {
  // For double-faced / multi-faced cards, Scryfall's combined type line is
  // "Front // Back". Categorize by the front face only, so e.g. a Creature
  // front with a Land back groups under Creature. Scryfall's type lines are
  // English whatever the printing's language, so the words are matched as data.
  const frontType = typeLine.split(' // ')[0] ?? typeLine
  for (const category of CARD_TYPE_CATEGORIES) {
    if (category !== 'other' && frontType.includes(CARD_TYPE_WORDS[category])) return category
  }
  return 'other'
}

/** The one group of the `'none'` grouping. */
const ALL_CARDS: GroupSlot = { key: 'all', heading: syncRef('site.group.all'), rank: 0 }

// The 'printing' grouping's two groups, specific first. A card is "specific"
// when it is pinned to a single printing (has both set and collector number);
// otherwise it accepts any printing.
const PRINTING_SPECIFIC: GroupSlot = {
  key: 'printing:specific',
  heading: syncRef('site.group.printing.specific'),
  rank: 0,
}
const PRINTING_ANY: GroupSlot = {
  key: 'printing:any',
  heading: syncRef('site.group.printing.any'),
  rank: 1,
}

// The 'on-buylist' grouping's two groups. "On" means the buyer is currently
// buying the printing; a paused offer groups under "Not on Buylist".
const BUYLIST_ON: GroupSlot = {
  key: 'buylist:on',
  heading: syncRef('site.group.buylist.on'),
  rank: 0,
}
const BUYLIST_OFF: GroupSlot = {
  key: 'buylist:off',
  heading: syncRef('site.group.buylist.off'),
  rank: 1,
}

/** Cards with no tags, after every tag set. */
const UNTAGGED: GroupSlot = {
  key: 'tags:',
  heading: syncRef('site.groupBy.untagged'),
  rank: LAST_RANK,
}

/** Cards with no category, after every category. */
const UNCATEGORIZED: GroupSlot = {
  key: 'category:',
  heading: syncRef('site.groupBy.uncategorized'),
  rank: LAST_RANK,
}

/** What {@link groupSlotsFor} reads besides the cards. */
type GroupSlotOptions = {
  sectionOrder: readonly string[]
  priceGroupStrategy: PriceGroupStrategy
  currency: PriceCurrency
  categoryOrder: readonly CardCategory[]
}

/** Where one card lands in a grouping — several groups only for `'categories'`. */
type SlotsOf = (card: CardData, index: number) => readonly GroupSlot[]

/** A rank from a page-supplied order: its position, or {@link UNNAMED_RANK} for a name it lacks. */
function rankIn(position: number): number {
  return position === -1 ? UNNAMED_RANK : position
}

/** The slot function for one grouping over `cards`. */
function groupSlotsFor(
  cards: readonly CardData[],
  groupBy: GroupBy,
  options: GroupSlotOptions,
): SlotsOf {
  switch (groupBy) {
    case 'none':
      return () => [ALL_CARDS]
    case 'cmc':
      return (c) => [{ key: `cmc:${c.cmc}`, heading: String(c.cmc), rank: c.cmc }]
    case 'type':
      return (c) => {
        const type = getCardTypeCategory(c.type)
        return [
          {
            key: `type:${type}`,
            heading: syncRef(CARD_TYPE_HEADINGS[type]),
            rank: CARD_TYPE_CATEGORIES.indexOf(type),
          },
        ]
      }
    case 'section':
      // The page's section order, and any section it does not name after it,
      // in the order those first appear.
      return (c) => [
        {
          key: `section:${c.section}`,
          heading: sectionNameParam(c.section),
          rank: rankIn(options.sectionOrder.indexOf(c.section)),
        },
      ]
    case 'color-identity':
      return (c) => {
        const letters = colorIdentityKey(c.colorIdentity)
        return [
          {
            // `C`, the colorless mana symbol, so the key never ends empty.
            key: `color:${letters === '' ? 'C' : letters}`,
            heading: colorIdentityHeading(c.colorIdentity),
            rank: colorLettersSortValue(letters),
          },
        ]
      }
    case 'price':
      return (c) => [priceGroupSlot(c.price, options.priceGroupStrategy, options.currency)]
    case 'buylist-price':
      // Buylist quotes are the buyer's own currency, never the page's.
      return (c) => [
        priceGroupSlot(
          c.buylistPrice,
          options.priceGroupStrategy,
          BUYLIST_CURRENCY,
          'buylist-price',
        ),
      ]
    case 'on-buylist':
      return (c) => [c.onBuylist ? BUYLIST_ON : BUYLIST_OFF]
    case 'printing':
      return (c) => [c.hasPrinting ? PRINTING_SPECIFIC : PRINTING_ANY]
    case 'source':
      // Keyed by the list's `type:slug`, so a deck and a collection that share
      // a name stay two groups; headed by the name. Ranked by the first card's
      // position, so source groups keep the order their lists first appear in
      // the card list — the order the lists were selected for the combined view.
      return (c, index) =>
        c.sourceKey === undefined
          ? [{ key: 'source:', heading: syncRef('site.group.source.unknown'), rank: index }]
          : [{ key: `source:${c.sourceKey}`, heading: c.sourceName ?? c.sourceKey, rank: index }]
    case 'tags':
      // One group per distinct *set* rather than one per tag: a card lands in
      // exactly one group, like every other grouping, so group totals never
      // count a two-tag card twice. Sets in display order, untagged last.
      return (c) => {
        const set = tagSetKey(c.tags)
        return set === ''
          ? [UNTAGGED]
          : [{ key: `tags:${set}`, heading: set, rank: 0, collate: set }]
      }
    case 'category':
    case 'categories': {
      // The list's own vocabulary order, anything it does not name after it
      // (in display order), and Uncategorized last. Keyed and ranked by the
      // fold, so two spellings of one category are one group, headed by the
      // shared spelling table's choice.
      const headings = categoryHeadings(cards, options.categoryOrder)
      const ranks = new Map(
        options.categoryOrder.map((name, i) => [foldCardCategory(name), i] as const),
      )
      const slotOf = (name: CardCategory): GroupSlot => {
        const fold = foldCardCategory(name)
        const spelling = headings.get(fold) ?? name
        return {
          key: `category:${fold}`,
          heading: spelling,
          rank: ranks.get(fold) ?? UNNAMED_RANK,
          collate: spelling,
          category: spelling,
        }
      }
      if (groupBy === 'category') {
        return (c) => {
          const primary = primaryCardCategory(c.categories)
          return [primary === undefined ? UNCATEGORIZED : slotOf(primary)]
        }
      }
      // Deliberately breaks the one-card-one-group invariant: a card appears
      // under every category it holds, so group totals overlap and the section
      // heading says so.
      return (c) => {
        const own = c.categories ?? []
        return own.length === 0 ? [UNCATEGORIZED] : own.map(slotOf)
      }
    }
  }
}

/** One group while it is being collected: the slot that opened it, and its cards. */
type GroupBucket<T extends CardData> = { slot: GroupSlot; cards: T[] }

/** Group order: by rank, then by display collation where the grouping asks for it. */
function compareSlots(a: GroupSlot, b: GroupSlot): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  return a.collate !== undefined && b.collate !== undefined
    ? compareDisplay(a.collate, b.collate)
    : 0
}

export function groupAndSortCards<T extends CardData>(
  cards: T[],
  groupBy: GroupBy,
  sortLayers: readonly SortLayer[],
  sectionOrder: string[],
  priceGroupStrategy?: PriceGroupStrategy,
  currency: PriceCurrency = 'usd',
  reverseGroups: boolean = false,
  /**
   * The list's category vocabulary, in its sidecar order — the heading order for
   * the two category groupings. Empty for every other grouping.
   */
  categoryOrder: readonly CardCategory[] = [],
): CardGroup<T>[] {
  const sortFn = (a: CardData, b: CardData) => compareBySortLayers(a, b, sortLayers)
  const slotsOf = groupSlotsFor(cards, groupBy, {
    sectionOrder,
    priceGroupStrategy: priceGroupStrategy ?? 'archidekt',
    currency,
    categoryOrder,
  })

  // Insertion-ordered, and `Array.sort` is stable, so groups that tie on rank
  // (sections the page's order does not name, every source list) keep the
  // order they first appear.
  const buckets = new Map<GroupKey, GroupBucket<T>>()
  cards.forEach((card, index) => {
    for (const slot of slotsOf(card, index)) {
      const bucket = buckets.get(slot.key)
      if (bucket) bucket.cards.push(card)
      else buckets.set(slot.key, { slot, cards: [card] })
    }
  })

  const ordered = [...buckets.values()].sort((a, b) => compareSlots(a.slot, b.slot))
  // Whole-order reversal, the "has none" group included: it leads a reversed
  // page, the way it trails an unreversed one.
  if (reverseGroups) ordered.reverse()

  return ordered.map(({ slot, cards: members }) => ({
    key: slot.key,
    heading: slot.heading,
    cards: members.sort(sortFn),
    ...(groupBy === 'categories' && slot.category !== undefined ? { category: slot.category } : {}),
  }))
}
