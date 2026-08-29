import type { Choice } from 'prompts'
import { compareData } from '../../i18n/collate'
import { compareCollectorNumbers, getAllPrintings } from '../../scryfall'
import { printingLabel } from '../../card/card-line-tail'
import {
  matchesCollectorQuery,
  parseCollectorQuery,
  type PrintingSearchTerms,
} from '../../card/collector-query'
import type { ScryfallCard } from '../../scryfall/types'
import { rankNameMatches } from '../../card/term-match'
import type { MessageKey } from '../../i18n/messages/en'
import { DEFAULT_LOCALE } from '../../i18n/runtime'
import { t, tIn, type TranslateArgs } from '../../i18n/t'
import { matchesChoiceTerms, type SearchableChoice } from '../../cli/menu-search'
import type { EntryMode, SessionConfig } from './config'
import type { LastAdded, SessionAddItem, SessionMode } from './strategy'

/**
 * The card-entry prompt's menu: the session-menu sentinels and their choice
 * builders, the menu layout, the collector-mode printing pool, and the
 * per-mode suggestion filters the prompt runs on every keystroke.
 */

// ── Menu sentinels ──────────────────────────────────────────────────

/**
 * The menu sentinel values (e.g. `__EXIT__`). Matched by exact membership rather
 * than a `__` prefix check, because real card names can begin with underscores
 * (e.g. the Unstable card `_____ Goblin`) and must not be mistaken for menu items.
 */
const MENU_SENTINEL_VALUES = [
  '__ADD_ANOTHER__',
  '__ADD_SIMILAR__',
  '__ADD_NOTE__',
  '__SECTION__',
  '__FORMAT__',
  '__TAGS__',
  '__LIST_LABELS__',
  '__CONFIG__',
  '__COLLECTOR_MODE__',
  '__NAME_MODE__',
  '__EDIT_MODE__',
  '__ADD_MODE__',
  '__SAVE__',
  '__SAVE_CURRENT__',
  '__SWITCH_LIST__',
  '__EXIT__',
  '__EDIT_LAST__',
  '__UNDO_LAST__',
  '__UNDO_EDIT__',
  '__CHANGES__',
] as const satisfies readonly `__${string}__`[]

/**
 * A session-menu shortcut value, as opposed to a card name. Produce menu
 * choices through {@link menuItem} and compare against a narrowed value of this
 * type, so a typo'd sentinel is a compile error rather than a string that
 * silently falls through to the card-name path at runtime.
 */
export type MenuSentinel = (typeof MENU_SENTINEL_VALUES)[number]

/** Widened to `Set<string>` so membership checks accept arbitrary prompt input. */
const MENU_SENTINELS = new Set<string>(MENU_SENTINEL_VALUES)

/** A session-menu choice, its value pinned to a real sentinel. Assignable to {@link Choice}. */
export type MenuChoice = SearchableChoice & {
  title: string
  value: MenuSentinel
  /**
   * English terms that also select this row, so the typing a user has in their
   * fingers keeps working after the menu is translated. Under English these
   * equal the title and change nothing. See `menu-search.ts`.
   */
  searchAliases: string[]
}

/** Build a session-menu choice, constraining the value to a real sentinel. */
export function menuItem(
  title: string,
  value: MenuSentinel,
  searchAliases: string[] = [],
): MenuChoice {
  return { title, value, searchAliases }
}

/**
 * Build a session-menu choice from a catalog key, rendering the label in the
 * active locale and recording its English rendering as a search alias in the
 * same call. Keeping the two together is the point: an alias derived from the
 * catalog cannot fall out of date with its label the way a hand-written list
 * would, and a new menu row gets muscle-memory search for free.
 *
 * `icon` is decoration, not text: it stays out of the catalog so it cannot be
 * translated away, and out of the `maxLen` budget, which measures the words.
 */
export function menuRow<K extends MessageKey>(
  icon: string,
  value: MenuSentinel,
  key: K,
  ...args: TranslateArgs<K>
): MenuChoice {
  return menuItem(`${icon} ${t(key, ...args)}`, value, [tIn(DEFAULT_LOCALE, key, ...args)])
}

/** Whether a prompt value is exactly a known sentinel (vs. a card name or object choice). */
export function isMenuSentinel(value: unknown): value is MenuSentinel {
  return typeof value === 'string' && MENU_SENTINELS.has(value)
}

/** A choice is a menu item (vs. a card) when its value is exactly a known sentinel. */
export const isMenuChoice = (choice: Choice): boolean => isMenuSentinel(choice.value)

/** Narrow a prompt selection to the menu sentinel it is, or null for a card/entry choice. */
export const asMenuSentinel = (value: unknown): MenuSentinel | null =>
  isMenuSentinel(value) ? value : null

/**
 * Suffix a name-mode `!` selection carries on its choice value to force the
 * option prompts. Not a {@link MenuSentinel}: it rides on a card-name value
 * rather than being a selection of its own, and is stripped before the name is
 * used. Menu items never carry it ({@link suggestNameMode} exempts them).
 */
export const FORCE_SUFFIX = '__FORCE__'

/** A collector-mode autocomplete choice value: one specific printing. */
export type CollectorChoiceValue = { type: 'card'; card: ScryfallCard }
/**
 * A collector-mode row with its match fields precomputed. The pool spans every
 * printing in the cache and `suggest` runs on every keystroke, so lowercasing
 * the set code and collector number is done once, at build time, rather than
 * over the whole pool per character typed. `prompts` hands the very choice
 * objects it was given to `suggest`, so the extra fields survive the round trip.
 */
export type CollectorChoice = PrintingSearchTerms & {
  title: string
  value: CollectorChoiceValue
}
/** An edit-mode autocomplete choice value: an existing entry, targeted by card ID. */
export type EntryChoiceValue = { type: 'entry'; cardId: number }

// ── Menu construction & suggestion filtering ────────────────────────

/**
 * Cross-list pending-change counts for the unified editor's menu labels. When
 * present, Save flushes every open list (and a separate "save current list"
 * item appears once another list also has pending changes), and a Switch List
 * item lets the user back out to the list selection menu.
 */
export type MultiListMenuInfo = {
  /** Pending changes across every open list, including the current one. */
  totalChangeCount: number
  /** How many open lists have anything unsaved (pending events or a dirty model). */
  listsWithChanges: number
  /**
   * The session edits several lists at once (a multi-list scope), so there is no
   * single "current list" to save on its own — Save always means save all.
   */
  scoped?: boolean
}

/** Inputs to {@link buildMenuChoices}. */
export type MenuBuildInput = {
  sessionMode: SessionMode
  mode: EntryMode
  lastAdded: LastAdded | null
  changeCount: number
  /** Strategy-specific entries inserted after the note shortcut. */
  extraItems: Choice[]
  /** Cards added this session, in add order (drives the Undo Last Add item). */
  sessionAdds: SessionAddItem[]
  /** Label for the Undo Last Edit item, or null when there is no edit to undo. */
  editUndoLabel: string | null
  /** Total changes this session (drives the View Session Changes item). */
  sessionChangeCount: number
  /** Card-name, collector-number, or existing-entry choices appended after the menu entries. */
  cardChoices: Choice[]
  /**
   * The list model differs from disk beyond the tracked change events (e.g. a
   * deck format change). Surfaces the Save items even at a zero change count.
   */
  dirty?: boolean
  /** Present in a unified multi-list session: cross-list counts for the save/switch items. */
  multiList?: MultiListMenuInfo
}

/** The Save label: the change count when there is one, plain otherwise (dirty-only saves). */
function saveItem(changeCount: number): MenuChoice {
  return changeCount > 0
    ? menuRow('💾', '__SAVE__', 'cli.menu.save', { count: changeCount })
    : menuRow('💾', '__SAVE__', 'cli.menu.saveDirty')
}

/** The Save/Switch List menu entries, which differ between single- and multi-list sessions. */
function buildSaveAndSwitchItems(input: MenuBuildInput): Choice[] {
  const { changeCount, multiList } = input
  const currentUnsaved = changeCount > 0 || input.dirty === true
  if (!multiList) {
    return currentUnsaved ? [saveItem(changeCount)] : []
  }

  const items: Choice[] = []
  if (multiList.listsWithChanges > 1) {
    // With only dirty models and no tracked change events, a "0 across N
    // lists" count would misread as nothing to save, so drop the count.
    const lists = t('domain.count.lists', { count: multiList.listsWithChanges })
    const scope =
      multiList.totalChangeCount > 0
        ? t('cli.menu.saveAllScope', { count: multiList.totalChangeCount, lists })
        : lists
    items.push(menuRow('💾', '__SAVE__', 'cli.menu.saveAll', { scope }))
    if (currentUnsaved && !multiList.scoped) {
      items.push(
        changeCount > 0
          ? menuRow('💾', '__SAVE_CURRENT__', 'cli.menu.saveCurrent', { count: changeCount })
          : menuRow('💾', '__SAVE_CURRENT__', 'cli.menu.saveCurrentPlain'),
      )
    }
  } else if (multiList.listsWithChanges === 1) {
    // Only one list has anything unsaved, so save-all and save-current coincide.
    items.push(saveItem(multiList.totalChangeCount))
  }
  items.push(menuRow('🔀', '__SWITCH_LIST__', 'cli.menu.switchList'))
  return items
}

/**
 * How many rows the card prompt shows at once. It must be at least as tall as
 * the longest menu {@link buildMenuChoices} can build (a deck session showing
 * every shortcut), or Save and Exit — the items at its foot — would sit below
 * the fold. A new conditional menu item therefore has to be raised here and in
 * the maximal input of the "tallest possible menu" test that guards it.
 *
 * In edit mode it is also the browsing window: with nothing typed the prompt
 * lists every entry under the menu, so this limit less the (short) edit-mode
 * menu is how many card lines are visible before the list scrolls.
 */
export const SESSION_MENU_LIMIT = 18

/**
 * Build the full autocomplete choice list (menu shortcuts first, then cards).
 *
 * The menu is ordered by how likely the user is to want an item right now:
 * everything about the card they just touched comes first (add a copy, note it,
 * edit it, take it back), then the undo shortcuts, then the session-wide
 * settings, then reviewing and saving, and finally Exit — a destination nobody
 * should hit by overshooting.
 */
export function buildMenuChoices(input: MenuBuildInput): Choice[] {
  const {
    sessionMode,
    mode,
    lastAdded,
    extraItems,
    sessionAdds,
    editUndoLabel,
    sessionChangeCount,
    cardChoices,
  } = input
  // Emoji whose glyph renders double-width carry a second space, so the labels
  // beside them still line up. That padding is layout, not text, which is why
  // the icons live here rather than in the catalog.
  // Both modes lead with the session filters: in collector mode the set filter
  // is what narrows the printing pool, so it is the set-code control too.
  const modeItems: Choice[] = [
    menuRow('⚙️ ', '__CONFIG__', 'cli.menu.configureFilters'),
    mode === 'name'
      ? menuRow('🔢', '__COLLECTOR_MODE__', 'cli.menu.collectorMode')
      : menuRow('🔤', '__NAME_MODE__', 'cli.menu.nameMode'),
  ]

  const undoItems: Choice[] = [
    ...(sessionAdds.length > 0
      ? [
          menuRow('↩️ ', '__UNDO_LAST__', 'cli.menu.undoLastAdd', {
            name: sessionAdds[sessionAdds.length - 1]!.name,
          }),
        ]
      : []),
    ...(editUndoLabel !== null
      ? [menuRow('↩️ ', '__UNDO_EDIT__', 'cli.menu.undoLastEdit', { label: editUndoLabel })]
      : []),
  ]

  // Edit mode pares the menu down to undo, mode switching, and save/exit — the
  // add-mode shortcuts (copies, notes, filters) only make sense while adding.
  const actionItems: Choice[] =
    sessionMode === 'edit'
      ? [...undoItems, menuRow('➕', '__ADD_MODE__', 'cli.menu.addMode')]
      : [
          ...(lastAdded
            ? [
                menuRow('➕', '__ADD_ANOTHER__', 'cli.menu.addExactCopy', { name: lastAdded.name }),
                menuRow('➕', '__ADD_SIMILAR__', 'cli.menu.addSimilarCopy', {
                  name: lastAdded.name,
                }),
                ...(!lastAdded.hasNote
                  ? [menuRow('📝', '__ADD_NOTE__', 'cli.menu.addNote', { name: lastAdded.name })]
                  : []),
                menuRow('✏️ ', '__EDIT_LAST__', 'cli.menu.editPrevious', { name: lastAdded.name }),
              ]
            : []),
          ...undoItems,
          ...extraItems,
          ...modeItems,
          menuRow('🛠️ ', '__EDIT_MODE__', 'cli.menu.editMode'),
        ]

  return [
    ...actionItems,
    ...(sessionChangeCount > 0
      ? [menuRow('📋', '__CHANGES__', 'cli.menu.viewChanges', { count: sessionChangeCount })]
      : []),
    ...buildSaveAndSwitchItems(input),
    menuRow('🚪', '__EXIT__', 'cli.menu.exit'),
    ...cardChoices,
  ]
}

/**
 * Build the collector-mode rows from a pool of printings: one row per printing,
 * titled `SET:CN — Card Name` (set codes uppercase in display), ordered by set
 * code and then by {@link compareCollectorNumbers} — the same natural ordering
 * the printing pickers use, so `2a` sorts right after the `2` it extends and a
 * letter-prefixed number (`A-12`) still orders by its digits.
 */
export function buildCollectorChoices(printings: ScryfallCard[]): CollectorChoice[] {
  const collectorChoices: CollectorChoice[] = printings.map((card) => ({
    title: t('cli.session.collectorChoice', {
      printing: printingLabel(card.set, card.collector_number),
      name: card.name,
    }),
    value: { type: 'card', card },
    setTerm: card.set.toLowerCase(),
    numTerm: card.collector_number.toLowerCase(),
  }))
  collectorChoices.sort((a, b) => {
    if (a.setTerm !== b.setTerm) return compareData(a.setTerm, b.setTerm)
    return compareCollectorNumbers(a.value.card.collector_number, b.value.card.collector_number)
  })
  return collectorChoices
}

/**
 * Load the session's collector-mode rows, building them once and keeping them
 * on the config. The pool is every printing in the cache under the session's
 * set filter — far too large to rebuild per prompt — and a unified session
 * shares one config across all its open lists, so this runs once per session
 * until the set filter moves.
 */
export async function ensureCollectorChoices(
  config: SessionConfig,
  excludeDigitalOnly: boolean,
): Promise<CollectorChoice[]> {
  const cached = config.collectorChoices
  if (cached) return cached
  console.log(t('cli.session.loadingPrintings'))
  const printings = await getAllPrintings({ sets: config.sets, excludeDigitalOnly })
  const choices = buildCollectorChoices(printings)
  console.log(t('cli.session.loadedPrintings', { count: choices.length }))
  config.collectorChoices = choices
  return choices
}

/**
 * Filter choices so every space-separated term of `input` appears in the title —
 * or, for a translated menu row, in the English terms it carries alongside it.
 * See `menu-search.ts` for why both are matched.
 */
function filterByTerms(input: string, choices: readonly Choice[]): Choice[] {
  return choices.filter((choice) => matchesChoiceTerms(choice, input))
}

/**
 * Order the matched cards by how directly they answer the input (see
 * {@link rankNameMatches}), leaving the menu shortcuts where they are — they
 * always lead the prompt — and leaving equally good cards in their EDHRec
 * popularity order.
 */
function rankMatchedNames(input: string, matches: Choice[]): Choice[] {
  const menuItems = matches.filter(isMenuChoice)
  const cardItems = matches.filter((choice) => !isMenuChoice(choice))
  return [...menuItems, ...rankNameMatches(cardItems, input, (choice) => choice.title)]
}

/**
 * How long an input may be before the menu rows drop out of the suggestions.
 * The menu is reached by typing a word or two of a label, so a longer query is
 * a card search — and in collector mode a `:` says so outright, whatever its
 * length.
 */
const MENU_SUGGEST_MAX_LENGTH = 3

/**
 * Whether the menu rows are still offered alongside the card matches. Past a
 * few characters (or once the input carries a `SET:CN` colon) the user is
 * searching for a card, and menu rows sitting at the top of the list would only
 * push the matches down.
 *
 * The budget is counted in code points, not UTF-16 units, so an astral
 * character (or a CJK label) spends one of the three rather than two; and the
 * input is trimmed first, so the two add modes agree on the count whether or
 * not their caller already stripped a marker or a trailing space.
 */
function menuItemsVisible(input: string): boolean {
  const trimmed = input.trim()
  return [...trimmed].length <= MENU_SUGGEST_MAX_LENGTH && !trimmed.includes(':')
}

/** Drop the menu rows from `choices` unless `input` is still short enough to want them. */
function withMenuVisibility(input: string, choices: Choice[]): Choice[] {
  return menuItemsVisible(input) ? choices : choices.filter((choice) => !isMenuChoice(choice))
}

/**
 * Name-mode suggestion filter: empty input shows the menu shortcuts; otherwise
 * all space-separated terms must appear in a title, and the cards whose name the
 * terms answer most directly come first (see {@link rankNameMatches}). A trailing
 * `!` marks the selection to force the finish/condition prompts past any session
 * defaults. Past {@link MENU_SUGGEST_MAX_LENGTH} characters (or with a `:` typed)
 * the menu rows drop out — see {@link menuItemsVisible}.
 */
export function suggestNameMode(input: string, choices: Choice[]): Choice[] {
  const isForce = input.endsWith('!')
  const cleanInput = isForce ? input.slice(0, -1) : input

  if (!cleanInput) return choices.filter(isMenuChoice)

  const pool = withMenuVisibility(cleanInput, choices)
  const matches = rankMatchedNames(cleanInput, filterByTerms(cleanInput, pool))

  if (isForce) {
    return matches.map((m) =>
      isMenuChoice(m)
        ? m
        : {
            ...m,
            title: t('cli.session.forceOptions', { title: m.title }),
            value: `${m.value}${FORCE_SUFFIX}`,
          },
    )
  }
  return matches
}

/**
 * Edit-mode suggestion filter: empty input shows the menu shortcuts followed by
 * every entry in the list, so the list can be scrolled without typing a search;
 * otherwise it term-matches the rendered entry lines. Unlike name mode there is
 * no `!` force marker — entry values are objects, not strings, so they cannot
 * carry a suffix.
 *
 * `move`'s batch mode makes the same empty-input choice through
 * `suggestCardsWithMenu`'s `emptyShows: 'all'` (see `src/cli/prompts.ts`), but
 * that helper keeps every menu row while typing; here the menu rows are
 * term-matched like the entries, because the entry lines carry colons and there
 * is no input length at which the menu should stop being offered.
 *
 * The choice list is read-only: `prompts` owns the array it passes in, so a
 * filter must never sort or splice it in place.
 */
export function suggestEditMode(input: string, choices: readonly Choice[]): Choice[] {
  if (!input) return [...choices]
  return filterByTerms(input, choices)
}

/** Whether a prompt choice value is a collector-mode printing (vs. a menu sentinel string). */
export function isCollectorChoiceValue(value: unknown): value is CollectorChoiceValue {
  return (
    typeof value === 'object' && value !== null && (value as CollectorChoiceValue).type === 'card'
  )
}

/** Whether a prompt choice value is an edit-mode entry selection. */
export function isEntryChoiceValue(value: unknown): value is EntryChoiceValue {
  return typeof value === 'object' && value !== null && (value as EntryChoiceValue).type === 'entry'
}

/**
 * Whether a choice is one of the collector-mode printing rows
 * {@link buildCollectorChoices} built. The precomputed match terms are checked
 * rather than assumed: `prompts` hands `suggest` the whole choice list, menu
 * rows included, and {@link matchesCollectorQuery} dereferences both terms.
 */
function isCollectorChoice(choice: Choice): choice is CollectorChoice {
  return (
    isCollectorChoiceValue(choice.value) &&
    'setTerm' in choice &&
    typeof choice.setTerm === 'string' &&
    'numTerm' in choice &&
    typeof choice.numTerm === 'string'
  )
}

/**
 * Collector-mode suggestion filter over every printing in the session's pool:
 * empty input shows the menu shortcuts, and anything else is a set-code and/or
 * collector-number search (see {@link parseCollectorQuery}). Card names are
 * never matched here. The menu rows drop out once the input outgrows
 * {@link menuItemsVisible}, and while they are still offered they are narrowed
 * by the same term match name mode uses — otherwise a three-letter set code
 * would fill the whole prompt window with menu rows and show no printings.
 */
export function suggestCollectorMode(input: string, choices: Choice[]): Choice[] {
  if (!input) return choices.filter(isMenuChoice)
  const query = parseCollectorQuery(input)
  return withMenuVisibility(input, choices).filter((choice) =>
    isCollectorChoice(choice)
      ? matchesCollectorQuery(query, choice)
      : matchesChoiceTerms(choice, input),
  )
}
