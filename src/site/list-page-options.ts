import type { MessageKey } from '../i18n/messages/en'
import { SELL_GROUP_BYS, type GroupBy, type SelectOptionKey } from '../list-view/card-sorting'

/**
 * Every key a group-by dropdown label may name. Narrower than `MessageKey` so
 * `t()` can render one without params, and `Extract` turns a key that no longer
 * exists in the catalog into `never` — a compile error at the table below.
 */
export type GroupByMessageKey = Extract<
  MessageKey,
  `site.groupBy.${string}` | `domain.groupBy.${string}`
>

/**
 * A group-by choice before its label is rendered. The `value` half is a
 * persisted URL token and stays locale-independent.
 */
export type GroupByOption<T extends GroupBy = GroupBy> = SelectOptionKey<T, GroupByMessageKey>

/** Collections always have a specific printing, so 'printing' grouping does not apply. */
export type CollectionGroupBy = Exclude<GroupBy, 'printing'>

/**
 * The dropdown label for every grouping — {@link MessageKey}s, not rendered
 * text, because this table is evaluated once at module load and a rendered
 * string would freeze the dropdowns in whatever language the bundle booted in.
 * `satisfies Record<GroupBy, …>` makes the key set exactly `GroupBy`, so a new
 * grouping is a compile error here rather than four page tables to remember —
 * which is how one of them used to be missed.
 */
export const GROUP_BY_LABELS = {
  type: 'site.groupBy.type',
  section: 'site.groupBy.section',
  cmc: 'site.groupBy.cmc',
  'color-identity': 'site.groupBy.colorIdentity',
  price: 'site.groupBy.price',
  'buylist-price': 'domain.groupBy.buylistPrice',
  'on-buylist': 'domain.groupBy.onBuylist',
  printing: 'site.groupBy.printing',
  source: 'site.groupBy.source',
  tags: 'site.groupBy.tags',
  category: 'site.groupBy.category',
  categories: 'site.groupBy.categories',
  none: 'site.groupBy.none',
} as const satisfies Record<GroupBy, GroupByMessageKey>

/**
 * Every grouping, derived from the label table rather than restated — the URL
 * sync's `group=` whitelist. `satisfies Record<GroupBy, …>` above makes the key
 * set exactly `GroupBy`, so a new grouping can never be legal in a dropdown yet
 * silently dropped from a shared link (the sort side does the same with
 * `SORT_BYS`).
 */
export const GROUP_BYS = Object.keys(GROUP_BY_LABELS) as readonly GroupBy[]

/**
 * Label an ordered list of groupings from {@link GROUP_BY_LABELS}. A fresh array
 * comes back every call, so no caller holds a reference to a shared one.
 */
export function groupByOptionsFrom<T extends GroupBy>(
  values: readonly T[],
): readonly GroupByOption<T>[] {
  return values.map((value) => ({ value, label: GROUP_BY_LABELS[value] }))
}

/** Offered only once the list actually has more than one section. */
const sectionIf = (hasSections: boolean) => (hasSections ? (['section'] as const) : [])

/** The category groupings, offered on a single list and never in the combined view. */
const CATEGORY_GROUP_BYS = ['category', 'categories'] as const satisfies readonly GroupBy[]

/** Sell mode's groupings, which always come last, before "none". */
const sellIf = (sellMode: boolean) => (sellMode ? SELL_GROUP_BYS : [])

/** The groupings a flat list page offers between `section` and "none". */
const FLAT_GROUP_BYS = ['type', 'cmc', 'color-identity', 'price', 'tags'] as const

/** …plus `printing`, for lists whose lines need not name one. */
const UNPINNED_GROUP_BYS = [...FLAT_GROUP_BYS, 'printing'] as const

const DECK_GROUP_BYS = [
  'type',
  'section',
  'cmc',
  'color-identity',
  'price',
  'tags',
  'printing',
] as const

/**
 * The deck page's group-by options. Every builder here takes `sellMode` (and
 * `hasSections`) as a parameter rather than reading the live toolbar signal, so
 * the URL sync can ask for the *full* option set — what a shared link may
 * legally name — while the dropdown shows only what is currently offered.
 */
export const deckGroupByOptions = (sellMode: boolean): readonly GroupByOption[] =>
  groupByOptionsFrom([...DECK_GROUP_BYS, ...CATEGORY_GROUP_BYS, ...sellIf(sellMode), 'none'])

/** The collection page's group-by options. */
export const collectionGroupByOptions = (
  sellMode: boolean,
  hasSections: boolean,
): readonly GroupByOption<CollectionGroupBy>[] =>
  groupByOptionsFrom([
    ...sectionIf(hasSections),
    ...FLAT_GROUP_BYS,
    ...CATEGORY_GROUP_BYS,
    ...sellIf(sellMode),
    'none',
  ])

/** The wanted list page's group-by options: the collection set plus `printing`. */
export const wantedGroupByOptions = (
  sellMode: boolean,
  hasSections: boolean,
): readonly GroupByOption[] =>
  groupByOptionsFrom([
    ...sectionIf(hasSections),
    ...UNPINNED_GROUP_BYS,
    ...CATEGORY_GROUP_BYS,
    ...sellIf(sellMode),
    'none',
  ])

/**
 * The combined view's group-by options: the lowest common denominator of the
 * combined list types, plus "Source List". "Printing" only applies when no
 * collection is present (every collection card is pinned, so the distinction is
 * meaningless once one is mixed in).
 */
export const combinedGroupByOptions = (
  sellMode: boolean,
  hasSections: boolean,
  hasCollections: boolean,
): readonly GroupByOption[] =>
  groupByOptionsFrom([
    'source',
    ...sectionIf(hasSections),
    ...(hasCollections ? FLAT_GROUP_BYS : UNPINNED_GROUP_BYS),
    ...sellIf(sellMode),
    'none',
  ])
