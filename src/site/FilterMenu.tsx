import type { Component, JSX } from 'solid-js'
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
  type Accessor,
} from 'solid-js'
import { AdaptiveMenu } from '../ui/AdaptiveMenu'
import { useAnchoredToggle } from '../ui/useAnchoredToggle'
import { parseSetCodesInput, scanSetCodesInput } from '../card/set-codes'
import { colorIdentityName, WUBRG } from '../list-view/card-sorting'
import {
  COPIES_MATCH_MODES,
  parseCopiesFilter,
  parseManaValueFilter,
  parseBuylistPriceFilter,
  parsePriceFilter,
  toggleColorSelection,
  toggleBuylistFilterOption,
  toggleLabelFilterOption,
  updateShareSelection,
  type BuylistFilterOption,
  type LabelFilterOption,
  type NumericComparator,
  type NumericFilterParse,
} from './card-filters'
import { CARD_LABEL_DISPLAY_NAMES, type CardLabelSelection } from '../card/card-labels'
import { type PriceCurrency, getCurrencySymbol } from '../pricing/price-currency'
import { pricesEnabled } from '../list-view/price-view'
import { useT } from '../ui/i18n'
import type { ParameterlessKey, TranslateFn } from '../i18n/t'
import { formatCardTypeForDisplay, parseCardTypesInput, scanCardTypeInput } from './card-types'
import {
  COLOR_MATCH_MODES,
  FILTER_MATCH_MODES,
  LIST_SHARE_MATCHES,
  LIST_SHARE_MODES,
  SET_CODE_FILTER_MODES,
  type FilterMatchMode,
  type ListShareMatch,
  type ListShareMode,
} from './filter-mode'
import { listRefKey, type ListRefKey, type NamedListRef } from '../list-view/combined-list'
import { LIST_TYPE_SINGULAR } from '../list/list-type'
import { normalizeForSearch } from '../card/term-match'
import { compareDisplay } from '../i18n/collate'
import { TagsInput, type TagsInputScan } from './TagsInput'
import { foldCardCategory } from '../card/card-categories'
import { parseCardCategoryFilterInput, scanCardCategoryInput } from './card-categories-filter'
import { normalizeCardTag } from '../card/card-tags'
import { parseCardTagFilterInput, scanCardTagInput } from './card-tag-filter'
import type { CardFiltersControl } from './useCardFilters'
import { useDebouncedInput, type DebouncedInput } from './useDebouncedInput'

/**
 * Wide enough for the header row to hold all three "Hide" toggles plus Clear on
 * one line (deck pages show the most), and for the Copies row — the menu's
 * widest, carrying a label, a three-mode toggle, five comparators, and a field —
 * to stay on one line.
 *
 * Only feeds the anchored-popover placement math — `.filter-menu-panel` in
 * shared.css sets the width that actually renders, so keep the two in step.
 */
const PANEL_WIDTH = 410

/** Display name for the colorless swatch — `colorIdentityName([])` is "Colorless". */
const COLORLESS_NAME = colorIdentityName([])

/** A numeric filter value as the string its input field shows ('' when unset). */
function numericFieldText(value: number | null): string {
  return value === null ? '' : String(value)
}

/** A {@link useNumericFilterInput} field: the debounced draft plus its own error. */
type NumericFilterInput = DebouncedInput & {
  /** The current validation message, or null. */
  error: Accessor<string | null>
}

/**
 * A debounced numeric filter field (Mana Value, Price, Buylist, Copies): mirrors the store
 * value as text, and on each debounced commit parses the draft, surfaces a validation
 * error, and applies the parsed value only when it is valid.
 *
 * The error signal lives here rather than in the panel because its lifecycle is
 * this field's: it must clear when the draft parses, when the field is reset,
 * and when the store value is cleared from outside (a currency switch clears
 * `price`; leaving sell mode clears `buylistPrice`). Hoisting it made those
 * three a hand-maintained list in the panel, and the fourth field added to that
 * list was missed — leaving a stale message under a field Clear had emptied.
 */
function useNumericFilterInput(
  current: () => number | null,
  parse: (raw: string) => NumericFilterParse,
  apply: (value: number | null) => void,
): NumericFilterInput {
  const [error, setError] = createSignal<string | null>(null)
  const input = useDebouncedInput(
    () => numericFieldText(current()),
    (raw) => {
      const parsed = parse(raw)
      setError(parsed.ok ? null : parsed.error)
      if (parsed.ok) apply(parsed.value)
    },
  )

  // An externally-cleared value leaves no error to show. `defer` skips the
  // initial run so a filter restored from a shared URL keeps its state.
  createEffect(
    on(
      current,
      (value) => {
        if (value === null) setError(null)
      },
      { defer: true },
    ),
  )

  return {
    ...input,
    error,
    reset: () => {
      // A rejected draft never reached the store, so no external change will
      // fire the effect above — the reset has to clear the message itself.
      setError(null)
      input.reset()
    },
  }
}

type ComparatorOption = { value: NumericComparator; label: string }

/** Shared comparator choices for the numeric (mana value, price, buylist, copies) filters. */
const COMPARATOR_OPTIONS: ComparatorOption[] = [
  { value: '=', label: '=' },
  { value: '<', label: '<' },
  { value: '<=', label: '≤' },
  { value: '>', label: '>' },
  { value: '>=', label: '≥' },
]

/** One button in a filter's match-mode segmented control. */
type FilterModeOption<M extends string> = { value: M; label: string; title: string }

type FilterModeToggleProps<M extends string> = {
  /** Accessible name for the group, e.g. "Card type match mode". */
  ariaLabel: string
  options: readonly FilterModeOption<M>[]
  value: M
  onChange: (mode: M) => void
}

/**
 * The segmented Include / Exclude / Exact control that sits beside a filter's
 * heading. Every multi-value filter uses it, so the whole menu speaks one
 * vocabulary; Sets passes a two-option list since `exact` can't apply there.
 */
function FilterModeToggle<M extends string>(props: FilterModeToggleProps<M>): JSX.Element {
  return (
    <div class="filter-toggle-group" role="group" aria-label={props.ariaLabel}>
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            classList={{ active: props.value === option.value }}
            aria-pressed={props.value === option.value}
            title={option.title}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

/** One chip in a multi-select filter row: its value, button text, and tooltip. */
type ChipFilterOption<T extends string> = { value: T; label: string; title: string }

type ChipFilterRowProps<T extends string> = {
  /** Heading text, e.g. "Labels". */
  label: string
  /** Accessible name for the chip group, e.g. "Label filter". */
  ariaLabel: string
  options: readonly ChipFilterOption<T>[]
  selected: readonly T[]
  onToggle: (value: T) => void
}

/**
 * A multi-select chip row (Labels, Buylist), laid out like every other filter
 * heading: title on the left, buttons right-aligned beside it. Unlike
 * `FilterModeToggle` more than one chip can be active at once — each caller's
 * `onToggle` owns the combination rules for its own vocabulary.
 */
function ChipFilterRow<T extends string>(props: ChipFilterRowProps<T>): JSX.Element {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <span class="filter-label">{props.label}</span>
        <div class="filter-toggle-group" role="group" aria-label={props.ariaLabel}>
          <For each={props.options}>
            {(opt) => (
              <button
                type="button"
                classList={{ active: props.selected.includes(opt.value) }}
                aria-pressed={props.selected.includes(opt.value)}
                title={opt.title}
                onClick={() => props.onToggle(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}

/**
 * The button text and tooltip for one mode, as message *keys*.
 *
 * These tables are built once at module load, so holding rendered strings would
 * leave every filter's segmented control in the boot-time language after a
 * locale switch — the whole menu would go stale while the page around it
 * translated. The keys are resolved by {@link modeOptions} at render time, and
 * are {@link ParameterlessKey}s because a runtime lookup can't type-check a
 * message's parameters — a parameter-free key has none to miss.
 */
type FilterModeCopy = { labelKey: ParameterlessKey; titleKey: ParameterlessKey }

/**
 * Expand per-mode copy into rendered options, in the canonical mode order.
 * Keying the copy by mode means adding a mode to `FilterMatchMode` fails to
 * compile here until it is given a label, rather than silently rendering one
 * button fewer.
 */
function modeOptions<M extends string>(
  modes: readonly M[],
  copy: Record<M, FilterModeCopy>,
  t: TranslateFn,
): readonly FilterModeOption<M>[] {
  return modes.map((value) => ({
    value,
    label: t(copy[value].labelKey),
    title: t(copy[value].titleKey),
  }))
}

/**
 * Match-mode copy for a tag-style filter (types, oracle tags, art tags).
 *
 * The tooltips used to be built from one template plus a `${noun}` — which
 * reads fine in English and nowhere else, since the noun would have to be
 * declined and may not sit at the end of the sentence. Each filter now names
 * its own whole sentence.
 */
const CARD_TYPE_MODE_COPY = {
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.cardTypeInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.cardTypeExclude' },
  exact: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.cardTypeExact' },
} as const satisfies Record<FilterMatchMode, FilterModeCopy>

const ORACLE_TAG_MODE_COPY = {
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.oracleTagInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.oracleTagExclude' },
  exact: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.oracleTagExact' },
} as const satisfies Record<FilterMatchMode, FilterModeCopy>

const ART_TAG_MODE_COPY = {
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.artTagInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.artTagExclude' },
  exact: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.artTagExact' },
} as const satisfies Record<FilterMatchMode, FilterModeCopy>

const CATEGORY_MODE_COPY = {
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.categoryInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.categoryExclude' },
  exact: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.categoryExact' },
} as const satisfies Record<FilterMatchMode, FilterModeCopy>

const CARD_TAG_MODE_COPY = {
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.tagInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.tagExclude' },
  exact: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.tagExact' },
} as const satisfies Record<FilterMatchMode, FilterModeCopy>

const COLOR_MODE_COPY = {
  subset: { labelKey: 'site.filterMode.subset', titleKey: 'site.filterMode.colorSubset' },
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.colorInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.colorExclude' },
  exact: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.colorExact' },
} as const satisfies Record<(typeof COLOR_MATCH_MODES)[number], FilterModeCopy>

const SET_MODE_COPY = {
  include: { labelKey: 'site.filterMode.include', titleKey: 'site.filterMode.setInclude' },
  exclude: { labelKey: 'site.filterMode.exclude', titleKey: 'site.filterMode.setExclude' },
} as const satisfies Record<(typeof SET_CODE_FILTER_MODES)[number], FilterModeCopy>

/**
 * What the copies filter treats as the same card when it adds quantities up.
 * Sits on the Copies row itself rather than reusing the tag-filter copy: these
 * modes pick a grouping key, not an any-of/none-of/all-of relationship.
 *
 * The labels are the user's vocabulary and the values are the code's, so they
 * differ: a button reading "Number" is the `printing` mode, because "Number"
 * names what you type into a collector-number field while `printing` names what
 * the filter groups by. `title` carries the meaning either way.
 */
const COPIES_MODE_COPY = {
  name: { labelKey: 'site.filterMode.name', titleKey: 'site.filterMode.copiesName' },
  printing: { labelKey: 'site.filterMode.number', titleKey: 'site.filterMode.copiesNumber' },
  finish: { labelKey: 'site.filterMode.exact', titleKey: 'site.filterMode.copiesFinish' },
} as const satisfies Record<(typeof COPIES_MATCH_MODES)[number], FilterModeCopy>

/** Any/All combination for the "Shares Cards With" selection. */
const SHARE_MODE_COPY = {
  any: { labelKey: 'site.filterMode.any', titleKey: 'site.filterMode.sharedAny' },
  all: { labelKey: 'site.filterMode.all', titleKey: 'site.filterMode.sharedAll' },
} as const satisfies Record<ListShareMode, FilterModeCopy>

/** Name/Printing identity for the "Shares Cards With" selection. */
const SHARE_MATCH_COPY = {
  name: { labelKey: 'site.filterMode.name', titleKey: 'site.filterMode.sharedByName' },
  printing: { labelKey: 'site.filterMode.printing', titleKey: 'site.filterMode.sharedByPrinting' },
} as const satisfies Record<ListShareMatch, FilterModeCopy>

/**
 * Name/Printing identity for the exclusion row. Same buttons as
 * {@link SHARE_MATCH_COPY} but the tooltips speak of hiding, not keeping.
 */
const NOT_SHARED_MATCH_COPY = {
  name: { labelKey: 'site.filterMode.name', titleKey: 'site.filterMode.notSharedByName' },
  printing: {
    labelKey: 'site.filterMode.printing',
    titleKey: 'site.filterMode.notSharedByPrinting',
  },
} as const satisfies Record<ListShareMatch, FilterModeCopy>

export interface FilterMenuProps {
  filters: CardFiltersControl
  symbolMap: Record<string, string>
  /** Active currency, used to label and interpret the price filter. */
  currency: PriceCurrency
  /** Lowercase set codes present in the current list, for the set filter autocomplete. */
  setCodeOptions: string[]
  /** Lowercase card type tags present in the current list, for the type filter autocomplete. */
  cardTypeOptions: string[]
  /** Oracle tag slugs present in the current list, for the oracle tag filter autocomplete. */
  oracleTagOptions: string[]
  /** Art tag slugs present in the current list, for the art tag filter autocomplete. */
  artTagOptions: string[]
  /**
   * Category names present in the current list, in the list's own spelling; the
   * row is hidden when empty, which is what keeps a list with no vocabulary (and
   * the combined view) clean.
   */
  categoryOptions: string[]
  /**
   * The owner's card tags present in the current list (distinct, display-collated,
   * case kept); the row is hidden when empty, like the categories row.
   */
  tagOptions: string[]
  /** Show the "Hide Extras" toggle (deck pages only). */
  showHideExtras?: boolean
  /** Show the Labels chip row (label-bearing views only). */
  showLabelsFilter?: boolean
  /**
   * Which label chips the row offers. Omitted means all of them — a page whose
   * lists carry only part of the vocabulary (decks take `proxy` alone) names
   * its subset so the row never offers a chip that can match nothing.
   */
  availableLabels?: readonly CardLabelSelection[]
  /** Show the Buylist chip row (sell mode only). */
  showBuylistFilter?: boolean
  /**
   * The other lists the share filters can compare against (already excluding
   * the current list on single-list pages). Omitted or empty hides both share
   * rows — the Labels/Buylist gating precedent.
   */
  shareLists?: readonly NamedListRef[]
}

/** A chip's copy before it is rendered: keys, not text. See {@link FilterModeCopy}. */
type ChipCopy<T extends string> = {
  value: T
  labelKey: ParameterlessKey
  titleKey: ParameterlessKey
}

/**
 * The labels filter's chips, in canonical order. The label wording is shared
 * with every other label surface (`CARD_LABEL_DISPLAY_NAMES`), so the chips and
 * the badges on the cards can never disagree.
 *
 * `keep`, `proxy`, and `none` replace the whole selection when picked —
 * `toggleLabelFilterOption` enforces it — so the titles say so rather than
 * letting the chips silently deselect each other.
 */
const LABEL_FILTER_COPY = [
  {
    value: 'sale',
    labelKey: CARD_LABEL_DISPLAY_NAMES.sale,
    titleKey: 'site.filter.labelSaleTitle',
  },
  {
    value: 'trade',
    labelKey: CARD_LABEL_DISPLAY_NAMES.trade,
    titleKey: 'site.filter.labelTradeTitle',
  },
  {
    value: 'keep',
    labelKey: CARD_LABEL_DISPLAY_NAMES.keep,
    titleKey: 'site.filter.labelKeepTitle',
  },
  {
    value: 'proxy',
    labelKey: CARD_LABEL_DISPLAY_NAMES.proxy,
    titleKey: 'site.filter.labelProxyTitle',
  },
  { value: 'none', labelKey: 'site.filter.labelUnlabeled', titleKey: 'site.filter.labelNoneTitle' },
] as const satisfies readonly ChipCopy<LabelFilterOption>[]

/**
 * The chips a page actually offers: the whole row unless the caller names a
 * subset, which a page whose lists cannot carry every label does (a deck takes
 * `proxy` alone). Filtering the copy table rather than holding a second one
 * keeps the wording and the order in one place.
 */
function labelChipCopy(
  available: readonly CardLabelSelection[] | undefined,
): readonly ChipCopy<LabelFilterOption>[] {
  if (!available) return LABEL_FILTER_COPY
  return LABEL_FILTER_COPY.filter((chip) => available.includes(chip.value))
}

/** The buylist filter's chips, in canonical order. The two combine freely (OR). */
const BUYLIST_FILTER_COPY = [
  { value: 'on', labelKey: 'site.filter.buylistOn', titleKey: 'site.filter.buylistOnTitle' },
  { value: 'off', labelKey: 'site.filter.buylistOff', titleKey: 'site.filter.buylistOffTitle' },
] as const satisfies readonly ChipCopy<BuylistFilterOption>[]

/** Render a chip table's keys in the active locale. See {@link modeOptions}. */
function chipOptions<T extends string>(
  copy: readonly ChipCopy<T>[],
  t: TranslateFn,
): readonly ChipFilterOption<T>[] {
  return copy.map((chip) => ({
    value: chip.value,
    label: t(chip.labelKey),
    title: t(chip.titleKey),
  }))
}

type TagFilterRowProps = {
  /** Heading for the row (e.g. "Oracle Tags"). */
  label: string
  /**
   * Accessible name for the match-mode control. Passed in rather than built
   * from `label`: a `${label} match mode` template is a two-word noun phrase
   * that does not survive translation.
   */
  modeAriaLabel: string
  /** id linking the label to the input; also the e2e hook (e.g. "filter-oracle-tags"). */
  inputId: string
  placeholder: string
  suggestionsLabel: string
  options: string[]
  selected: string[]
  modeOptions: readonly FilterModeOption<FilterMatchMode>[]
  mode: FilterMatchMode
  onTags: (tags: string[]) => void
  onMode: (mode: FilterMatchMode) => void
  /** How a selected value is displayed as a chip. Default: verbatim. */
  format?: (value: string) => string
  /** How the draft text becomes a query. Default: `trim().toLowerCase()`. */
  query?: (draft: string) => string
  /** Whether an option matches the query. Default: substring. */
  matches?: (value: string, query: string) => boolean
  /** Split partial input into committed values plus a draft. Default: the card-type scanner (lowercasing). */
  scan?: (value: string) => TagsInputScan
  /** Commit the whole field. Default: the card-type parser (lowercasing). */
  parse?: (value: string) => string[]
  /** Membership key for dedupe/suggestion filtering. Default: identity. */
  key?: (value: string) => string
}

/**
 * A tag filter row (Oracle or Art): a match-mode toggle beside the heading and a
 * chip autocomplete. Tag slugs are lowercase, which is why the defaults
 * lowercase; a case-preserving vocabulary (categories, card tags) passes its own
 * scanner, parser and fold key.
 */
const TagFilterRow: Component<TagFilterRowProps> = (props) => {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <label class="filter-label" for={props.inputId}>
          {props.label}
        </label>
        <FilterModeToggle
          ariaLabel={props.modeAriaLabel}
          options={props.modeOptions}
          value={props.mode}
          onChange={props.onMode}
        />
      </div>
      <TagsInput
        selected={props.selected}
        options={props.options}
        onChange={props.onTags}
        inputId={props.inputId}
        placeholder={props.placeholder}
        suggestionsLabel={props.suggestionsLabel}
        format={props.format ?? ((tag) => tag)}
        query={props.query ?? ((draft) => draft.trim().toLowerCase())}
        matches={props.matches ?? ((tag, query) => query.length === 0 || tag.includes(query))}
        scan={props.scan ?? scanCardTypeInput}
        parse={props.parse ?? parseCardTypesInput}
        key={props.key}
      />
    </div>
  )
}

/**
 * One offered list in a share filter row: its refKey token, rendered label, and
 * the label's folded form. Folded once here rather than per comparison —
 * `matches` runs per option per keystroke and `parseShareDraft` scans every
 * option on each Enter.
 */
type ShareListOption = { key: ListRefKey; label: string; folded: string }

type ShareFilterRowProps = {
  /** Heading for the row (e.g. "Shares Cards With"). */
  label: string
  /** id linking the label to the input; also the e2e hook (e.g. "filter-shared-with"). */
  inputId: string
  placeholder: string
  suggestionsLabel: string
  /** The refKey tokens offered for selection, in display order. */
  optionKeys: ListRefKey[]
  /** Render a refKey token as its list's (possibly disambiguated) display name. */
  labelFor: (key: string) => string
  /** A refKey token's folded display name, for matching against a folded query. */
  foldedFor: (key: string) => string
  selected: ListRefKey[]
  /** Resolve a typed draft to the tokens whose folded label equals it. */
  parse: (draft: string) => ListRefKey[]
  /** Any/All control — the include row only. */
  modeToggle?: JSX.Element
  /** Name/Printing identity control. */
  matchToggle: JSX.Element
  onChange: (keys: ListRefKey[]) => void
}

/**
 * A share filter row ("Shares Cards With" / "Doesn't Share Cards With"): mode
 * toggles beside the heading and a chip autocomplete over the other lists.
 * Stored values are `type:slug` refKey tokens; the chips render display names.
 * Typing never auto-commits (list names may contain commas), so `scan` keeps
 * the whole draft and Enter/click resolves it through `parse`.
 */
const ShareFilterRow: Component<ShareFilterRowProps> = (props) => {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <label class="filter-label" for={props.inputId}>
          {props.label}
        </label>
        {props.modeToggle}
        {props.matchToggle}
      </div>
      <TagsInput
        selected={props.selected}
        options={props.optionKeys}
        // TagsInput is string-typed, but it only ever emits values drawn from
        // `options` and `parse` — both refKeys here — so the assertion holds.
        onChange={(values) => props.onChange(values as ListRefKey[])}
        inputId={props.inputId}
        placeholder={props.placeholder}
        suggestionsLabel={props.suggestionsLabel}
        format={props.labelFor}
        query={(draft) => normalizeForSearch(draft.trim())}
        matches={(key, query) => query.length === 0 || props.foldedFor(key).includes(query)}
        scan={(value) => ({ tags: [], remainder: value })}
        parse={props.parse}
        keepUnresolvedDraft
      />
    </div>
  )
}

type NumericFilterRowProps = {
  /** Heading for the row (e.g. "Mana Value"). */
  label: string
  /** id linking the label to the input; also the e2e hook (e.g. "filter-mana-value"). */
  inputId: string
  ariaLabel: string
  op: NumericComparator
  onOp: (op: NumericComparator) => void
  /** The raw draft text shown in the field (debounced from the store). */
  value: string
  /** Placeholder for the empty field, meaning "no bound — anything passes". */
  valuePlaceholder: string
  onValueInput: (raw: string) => void
  /** Commit any pending value immediately when the field loses focus. */
  onValueBlur: () => void
  error: string | null
  step: string
  inputMode: 'numeric' | 'decimal'
  /**
   * An extra segmented control shown between the label and the comparators
   * (Copies uses it for its match mode). A slot rather than three more props so
   * the row stays agnostic about which vocabulary the control speaks.
   */
  modeToggle?: JSX.Element
}

/**
 * A numeric filter row (Mana Value, Price, Buylist, or Copies): the label, an
 * optional match-mode toggle, a comparator toggle group, and a number input all
 * on one line — these are the menu's most compact rows, so keeping the field
 * beside its comparators rather than below them saves a line each. Validation
 * errors wrap underneath. The price rows
 * carry their currency in the label rather than beside the field, so every field
 * is the same width and their comparator groups line up.
 */
const NumericFilterRow: Component<NumericFilterRowProps> = (props) => {
  return (
    <div class="filter-row">
      <div class="filter-type-header">
        <label class="filter-label" for={props.inputId}>
          {props.label}
        </label>
        {props.modeToggle}
        <div class="filter-toggle-group" role="group" aria-label={props.ariaLabel}>
          <For each={COMPARATOR_OPTIONS}>
            {(opt) => (
              <button
                type="button"
                classList={{ active: props.op === opt.value }}
                aria-pressed={props.op === opt.value}
                onClick={() => props.onOp(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
        <input
          id={props.inputId}
          class="filter-input filter-input-numeric"
          type="number"
          min="0"
          step={props.step}
          inputmode={props.inputMode}
          placeholder={props.valuePlaceholder}
          aria-invalid={props.error !== null}
          value={props.value}
          onInput={(e) => props.onValueInput(e.currentTarget.value)}
          onBlur={props.onValueBlur}
        />
      </div>
      <Show when={props.error}>{(error) => <span class="filter-error">{error()}</span>}</Show>
    </div>
  )
}

/**
 * Toolbar "Filters" button + anchored dropdown panel holding every card filter:
 * hide lands/unpriced toggles, name terms, color identity, set codes, mana value.
 */
export const FilterMenu: Component<FilterMenuProps> = (props) => {
  const t = useT()
  const toggle = useAnchoredToggle()

  return (
    <div class="filter-menu">
      <button
        type="button"
        ref={toggle.setButtonRef}
        class="toolbar-toggle"
        classList={{ active: props.filters.activeCount() > 0 }}
        aria-expanded={toggle.open()}
        aria-haspopup="true"
        onClick={toggle.toggleOpen}
      >
        {t('site.filter.title')}
        <Show when={props.filters.activeCount() > 0}>
          <span class="filter-menu-badge">{props.filters.activeCount()}</span>
        </Show>
        <span aria-hidden="true">{toggle.open() ? '▴' : '▾'}</span>
      </button>
      <AdaptiveMenu
        toggle={toggle}
        width={PANEL_WIDTH}
        panelClass="filter-menu-panel"
        title={t('site.filter.title')}
        role="group"
        aria-label={t('site.filter.ariaLabel')}
      >
        <FilterPanelBody
          filters={props.filters}
          symbolMap={props.symbolMap}
          currency={props.currency}
          setCodeOptions={props.setCodeOptions}
          cardTypeOptions={props.cardTypeOptions}
          oracleTagOptions={props.oracleTagOptions}
          artTagOptions={props.artTagOptions}
          categoryOptions={props.categoryOptions}
          tagOptions={props.tagOptions}
          showHideExtras={props.showHideExtras}
          showLabelsFilter={props.showLabelsFilter}
          availableLabels={props.availableLabels}
          showBuylistFilter={props.showBuylistFilter}
          shareLists={props.shareLists}
        />
      </AdaptiveMenu>
    </div>
  )
}

const FilterPanelBody: Component<FilterMenuProps> = (props) => {
  const t = useT()
  // The free-text and numeric filters commit to the store 250ms after the user stops
  // typing, so fast typing no longer triggers a filter+re-render pass per keystroke.
  // The fields still echo keystrokes instantly via each input's `draft`.
  const nameInput = useDebouncedInput(
    () => props.filters.filters.name,
    (name) => props.filters.update({ name }),
  )

  const manaValueInput = useNumericFilterInput(
    () => props.filters.filters.manaValue,
    parseManaValueFilter,
    (manaValue) => props.filters.update({ manaValue }),
  )

  const priceInput = useNumericFilterInput(
    () => props.filters.filters.price,
    parsePriceFilter,
    (price) => props.filters.update({ price }),
  )

  const buylistPriceInput = useNumericFilterInput(
    () => props.filters.filters.buylistPrice,
    parseBuylistPriceFilter,
    (buylistPrice) => props.filters.update({ buylistPrice }),
  )

  const copiesInput = useNumericFilterInput(
    () => props.filters.filters.copies,
    parseCopiesFilter,
    (copies) => props.filters.update({ copies }),
  )

  // The share filters' option list: every offered list as a refKey token plus a
  // display label. Two offered lists with the same folded name get their list
  // type appended so the chips stay tellable apart; a selected token with no
  // matching option (a stale shared URL) renders as the raw token via the
  // `labelFor` fallback below.
  const shareListOptions = createMemo<ShareListOption[]>(() => {
    const lists = props.shareLists ?? []
    const nameCounts = new Map<string, number>()
    for (const list of lists) {
      const folded = normalizeForSearch(list.name)
      nameCounts.set(folded, (nameCounts.get(folded) ?? 0) + 1)
    }
    return lists
      .map((list) => {
        const label =
          (nameCounts.get(normalizeForSearch(list.name)) ?? 0) > 1
            ? t('site.filter.shareListWithType', {
                name: list.name,
                type: t(LIST_TYPE_SINGULAR[list.type]),
              })
            : list.name
        return { key: listRefKey(list), label, folded: normalizeForSearch(label) }
      })
      .sort((a, b) => compareDisplay(a.label, b.label))
  })
  const shareOptionKeys = createMemo(() => shareListOptions().map((option) => option.key))
  // Keyed as Map<string, ...> on purpose: `labelFor` renders whatever token is
  // stored — including a stale shared URL's — so lookups take plain strings.
  const shareLabelByKey = createMemo(
    () => new Map<string, string>(shareListOptions().map((option) => [option.key, option.label])),
  )
  const shareLabelFor = (key: string): string => shareLabelByKey().get(key) ?? key
  const shareFoldedByKey = createMemo(
    () => new Map<string, string>(shareListOptions().map((option) => [option.key, option.folded])),
  )
  // The fallback only fires for tokens outside the option list (a stale shared
  // URL's chip), which `matches` is never asked about — but stay total anyway.
  const shareFoldedFor = (key: string): string =>
    shareFoldedByKey().get(key) ?? normalizeForSearch(shareLabelFor(key))
  /**
   * Resolve a typed draft: every option whose folded label equals it, else —
   * so a partial name plus Enter still lands — the single option whose folded
   * label contains it. An ambiguous partial resolves nothing, and the input
   * keeps the draft in place (`keepUnresolvedDraft`) instead of wiping it.
   */
  const parseShareDraft = (draft: string): ListRefKey[] => {
    const query = normalizeForSearch(draft.trim())
    if (query.length === 0) return []
    const options = shareListOptions()
    const exact = options.filter((option) => option.folded === query)
    if (exact.length > 0) return exact.map((option) => option.key)
    const partial = options.filter((option) => option.folded.includes(query))
    return partial.length === 1 ? partial.map((option) => option.key) : []
  }

  // The currency lives in the label — "Price ($)" — rather than beside the field,
  // so the three numeric fields stay a uniform width. Currencies with no symbol
  // fall back to a bare "Price".
  const priceLabel = (): string => {
    const symbol = getCurrencySymbol(props.currency)
    return symbol ? t('site.filter.priceWithSymbol', { symbol }) : t('site.filter.price')
  }

  const handleClearAll = () => {
    // One reactive flush for the whole reset. Order matters: reset the store first so
    // each input's `reset()` re-seeds its draft from the new defaults, and abandons any
    // debounced value not yet committed so it can't re-apply after the reset.
    batch(() => {
      props.filters.reset()
      nameInput.reset()
      manaValueInput.reset()
      priceInput.reset()
      buylistPriceInput.reset()
      copiesInput.reset()
    })
  }

  return (
    <>
      <div class="filter-row filter-row-toggles">
        <button
          type="button"
          class="toolbar-toggle"
          classList={{ active: props.filters.filters.hideLands }}
          aria-pressed={props.filters.filters.hideLands}
          onClick={() => props.filters.update({ hideLands: !props.filters.filters.hideLands })}
        >
          {t('site.filter.hideLands')}
        </button>
        <Show when={pricesEnabled()}>
          <button
            type="button"
            class="toolbar-toggle"
            classList={{ active: props.filters.filters.hideUnpriced }}
            aria-pressed={props.filters.filters.hideUnpriced}
            onClick={() =>
              props.filters.update({ hideUnpriced: !props.filters.filters.hideUnpriced })
            }
          >
            {t('site.filter.hideUnpriced')}
          </button>
        </Show>
        <Show when={props.showHideExtras}>
          <button
            type="button"
            class="toolbar-toggle"
            classList={{ active: props.filters.filters.hideExtras }}
            aria-pressed={props.filters.filters.hideExtras}
            onClick={() => props.filters.update({ hideExtras: !props.filters.filters.hideExtras })}
          >
            {t('site.filter.hideExtras')}
          </button>
        </Show>
        {/* Rendered even with nothing active (disabled) rather than shown conditionally,
            so applying the first filter doesn't reflow the row it sits in. */}
        <button
          type="button"
          class="btn btn-primary filter-clear"
          disabled={props.filters.activeCount() === 0}
          onClick={handleClearAll}
        >
          {t('site.filter.clear')}
        </button>
      </div>
      <div class="filter-row">
        <label class="filter-label" for="filter-name">
          {t('site.filter.name')}
        </label>
        <input
          id="filter-name"
          class="filter-input"
          type="text"
          placeholder={t('site.filter.namePlaceholder')}
          value={nameInput.draft()}
          onInput={(e) => nameInput.onInput(e.currentTarget.value)}
          onBlur={nameInput.flush}
        />
      </div>
      <div class="filter-row">
        <div class="filter-type-header">
          <span class="filter-label">{t('site.filter.colorIdentity')}</span>
          <FilterModeToggle
            ariaLabel={t('site.filter.colorMode')}
            options={modeOptions(COLOR_MATCH_MODES, COLOR_MODE_COPY, t)}
            value={props.filters.filters.colorMode}
            onChange={(colorMode) => props.filters.update({ colorMode })}
          />
        </div>
        <div class="filter-colors">
          <For each={WUBRG}>
            {(color) => (
              <button
                type="button"
                class="filter-color-btn"
                classList={{ active: props.filters.filters.colors.includes(color) }}
                aria-pressed={props.filters.filters.colors.includes(color)}
                title={colorIdentityName([color])}
                onClick={() =>
                  props.filters.update({
                    colors: toggleColorSelection(props.filters.filters.colors, color),
                  })
                }
              >
                <Show
                  when={props.symbolMap[`{${color}}`]}
                  fallback={<span class="filter-color-letter">{color}</span>}
                >
                  {(src) => (
                    <img src={src()} alt={colorIdentityName([color])} class="mana-symbol" />
                  )}
                </Show>
              </button>
            )}
          </For>
          {/* Colorless sits after the five colors, as it does in Scryfall's own filters. */}
          <button
            type="button"
            class="filter-color-btn"
            classList={{ active: props.filters.filters.colorless }}
            aria-pressed={props.filters.filters.colorless}
            title={COLORLESS_NAME}
            onClick={() => props.filters.update({ colorless: !props.filters.filters.colorless })}
          >
            <Show
              when={props.symbolMap['{C}']}
              fallback={
                /* i18n-exempt: mana symbol letter (colorless), not prose */
                <span class="filter-color-letter">C</span>
              }
            >
              {(src) => <img src={src()} alt={COLORLESS_NAME} class="mana-symbol" />}
            </Show>
          </button>
        </div>
      </div>
      <Show when={props.showLabelsFilter}>
        <ChipFilterRow
          label={t('site.filter.labels')}
          ariaLabel={t('site.filter.labelMode')}
          options={chipOptions(labelChipCopy(props.availableLabels), t)}
          selected={props.filters.filters.labels}
          onToggle={(value) =>
            props.filters.update({
              labels: toggleLabelFilterOption(props.filters.filters.labels, value),
            })
          }
        />
      </Show>
      <Show when={props.showBuylistFilter}>
        <ChipFilterRow
          label={t('site.filter.buylist')}
          ariaLabel={t('site.filter.buylistMode')}
          options={chipOptions(BUYLIST_FILTER_COPY, t)}
          selected={props.filters.filters.onBuylist}
          onToggle={(value) =>
            props.filters.update({
              onBuylist: toggleBuylistFilterOption(props.filters.filters.onBuylist, value),
            })
          }
        />
      </Show>
      <Show when={(props.shareLists?.length ?? 0) > 0}>
        <ShareFilterRow
          label={t('site.filter.sharedWith')}
          inputId="filter-shared-with"
          placeholder={t('site.filter.shareListsPlaceholder')}
          suggestionsLabel={t('site.filter.sharedWithSuggestions')}
          optionKeys={shareOptionKeys()}
          labelFor={shareLabelFor}
          foldedFor={shareFoldedFor}
          selected={props.filters.filters.sharedWith}
          parse={parseShareDraft}
          modeToggle={
            <FilterModeToggle
              ariaLabel={t('site.filter.sharedWithMode')}
              options={modeOptions(LIST_SHARE_MODES, SHARE_MODE_COPY, t)}
              value={props.filters.filters.sharedWithMode}
              onChange={(sharedWithMode) => props.filters.update({ sharedWithMode })}
            />
          }
          matchToggle={
            <FilterModeToggle
              ariaLabel={t('site.filter.sharedWithMatch')}
              options={modeOptions(LIST_SHARE_MATCHES, SHARE_MATCH_COPY, t)}
              value={props.filters.filters.sharedWithMatch}
              onChange={(sharedWithMatch) => props.filters.update({ sharedWithMatch })}
            />
          }
          onChange={(keys) =>
            props.filters.update(updateShareSelection(props.filters.filters, 'sharedWith', keys))
          }
        />
        <ShareFilterRow
          label={t('site.filter.notSharedWith')}
          inputId="filter-not-shared-with"
          placeholder={t('site.filter.shareListsPlaceholder')}
          suggestionsLabel={t('site.filter.notSharedWithSuggestions')}
          optionKeys={shareOptionKeys()}
          labelFor={shareLabelFor}
          foldedFor={shareFoldedFor}
          selected={props.filters.filters.notSharedWith}
          parse={parseShareDraft}
          matchToggle={
            <FilterModeToggle
              ariaLabel={t('site.filter.notSharedWithMatch')}
              options={modeOptions(LIST_SHARE_MATCHES, NOT_SHARED_MATCH_COPY, t)}
              value={props.filters.filters.notSharedWithMatch}
              onChange={(notSharedWithMatch) => props.filters.update({ notSharedWithMatch })}
            />
          }
          onChange={(keys) =>
            props.filters.update(updateShareSelection(props.filters.filters, 'notSharedWith', keys))
          }
        />
      </Show>
      <div class="filter-row">
        <div class="filter-type-header">
          <label class="filter-label" for="filter-sets">
            {t('site.filter.sets')}
          </label>
          <FilterModeToggle
            ariaLabel={t('site.filter.setMode')}
            options={modeOptions(SET_CODE_FILTER_MODES, SET_MODE_COPY, t)}
            value={props.filters.filters.setCodeMode}
            onChange={(setCodeMode) => props.filters.update({ setCodeMode })}
          />
        </div>
        <TagsInput
          selected={props.filters.filters.setCodes}
          options={props.setCodeOptions}
          onChange={(setCodes) => props.filters.update({ setCodes })}
          inputId="filter-sets"
          placeholder={t('site.filter.setsPlaceholder')}
          suggestionsLabel={t('site.filter.setsSuggestions')}
          format={(code) => code.toUpperCase()}
          query={(draft) => draft.trim().toLowerCase()}
          matches={(code, query) => code.startsWith(query)}
          scan={scanSetCodesInput}
          parse={parseSetCodesInput}
        />
      </div>
      <div class="filter-row">
        <div class="filter-type-header">
          <label class="filter-label" for="filter-types">
            {t('site.filter.cardType')}
          </label>
          <FilterModeToggle
            ariaLabel={t('site.filter.cardTypeMode')}
            options={modeOptions(FILTER_MATCH_MODES, CARD_TYPE_MODE_COPY, t)}
            value={props.filters.filters.cardTypeMode}
            onChange={(cardTypeMode) => props.filters.update({ cardTypeMode })}
          />
        </div>
        <TagsInput
          selected={props.filters.filters.cardTypes}
          options={props.cardTypeOptions}
          onChange={(cardTypes) => props.filters.update({ cardTypes })}
          inputId="filter-types"
          placeholder={t('site.filter.cardTypePlaceholder')}
          suggestionsLabel={t('site.filter.cardTypeSuggestions')}
          format={formatCardTypeForDisplay}
          // Strip a leading open quote so suggestions still appear while typing `"Time…`.
          query={(draft) => draft.trim().toLowerCase().replace(/^"/, '')}
          // Match a prefix of the whole tag or of any word within it, so multi-word
          // types like "Time Lord" surface when typing "time" or "lord".
          matches={(type, query) =>
            query.length === 0 ||
            type.startsWith(query) ||
            type.split(' ').some((word) => word.startsWith(query))
          }
          scan={scanCardTypeInput}
          parse={parseCardTypesInput}
        />
      </div>
      <TagFilterRow
        label={t('site.filter.oracleTags')}
        modeAriaLabel={t('site.filter.oracleTagMode')}
        inputId="filter-oracle-tags"
        placeholder={t('site.filter.oracleTagsPlaceholder')}
        suggestionsLabel={t('site.filter.oracleTagsSuggestions')}
        options={props.oracleTagOptions}
        selected={props.filters.filters.oracleTags}
        modeOptions={modeOptions(FILTER_MATCH_MODES, ORACLE_TAG_MODE_COPY, t)}
        mode={props.filters.filters.oracleTagMode}
        onTags={(oracleTags) => props.filters.update({ oracleTags })}
        onMode={(oracleTagMode) => props.filters.update({ oracleTagMode })}
      />
      <TagFilterRow
        label={t('site.filter.artTags')}
        modeAriaLabel={t('site.filter.artTagMode')}
        inputId="filter-art-tags"
        placeholder={t('site.filter.artTagsPlaceholder')}
        suggestionsLabel={t('site.filter.artTagsSuggestions')}
        options={props.artTagOptions}
        selected={props.filters.filters.artTags}
        modeOptions={modeOptions(FILTER_MATCH_MODES, ART_TAG_MODE_COPY, t)}
        mode={props.filters.filters.artTagMode}
        onTags={(artTags) => props.filters.update({ artTags })}
        onMode={(artTagMode) => props.filters.update({ artTagMode })}
      />
      {/* Shown when the list has categories to offer, or when a shared link left
          chips active with none — so those chips stay individually removable. */}
      <Show
        when={props.categoryOptions.length > 0 || props.filters.filters.cardCategories.length > 0}
      >
        <TagFilterRow
          label={t('site.filter.categories')}
          modeAriaLabel={t('site.filter.categoryMode')}
          inputId="filter-categories"
          placeholder={t('site.filter.categoriesPlaceholder')}
          suggestionsLabel={t('site.filter.categoriesSuggestions')}
          options={props.categoryOptions}
          selected={props.filters.filters.cardCategories}
          modeOptions={modeOptions(FILTER_MATCH_MODES, CATEGORY_MODE_COPY, t)}
          mode={props.filters.filters.cardCategoryMode}
          onTags={(cardCategories) => props.filters.update({ cardCategories })}
          onMode={(cardCategoryMode) => props.filters.update({ cardCategoryMode })}
          query={(draft) => foldCardCategory(draft.trim())}
          matches={(value, query) => query.length === 0 || foldCardCategory(value).includes(query)}
          scan={scanCardCategoryInput}
          parse={parseCardCategoryFilterInput}
          key={foldCardCategory}
        />
      </Show>
      {/* The owner's own card tags: same visibility rule as categories. Suggestion
          search is case-insensitive for convenience; the committed identity is not. */}
      <Show when={props.tagOptions.length > 0 || props.filters.filters.cardTags.length > 0}>
        <TagFilterRow
          label={t('site.filter.tags')}
          modeAriaLabel={t('site.filter.tagMode')}
          inputId="filter-card-tags"
          placeholder={t('site.filter.tagsPlaceholder')}
          suggestionsLabel={t('site.filter.tagsSuggestions')}
          options={props.tagOptions}
          selected={props.filters.filters.cardTags}
          modeOptions={modeOptions(FILTER_MATCH_MODES, CARD_TAG_MODE_COPY, t)}
          mode={props.filters.filters.cardTagMode}
          onTags={(cardTags) => props.filters.update({ cardTags })}
          onMode={(cardTagMode) => props.filters.update({ cardTagMode })}
          query={(draft) => draft.trim().toLowerCase()}
          matches={(value, query) => query.length === 0 || value.toLowerCase().includes(query)}
          scan={scanCardTagInput}
          parse={parseCardTagFilterInput}
          key={normalizeCardTag}
        />
      </Show>
      <NumericFilterRow
        label={t('site.filter.manaValue')}
        inputId="filter-mana-value"
        ariaLabel={t('site.filter.manaValueCompare')}
        op={props.filters.filters.manaValueOp}
        onOp={(manaValueOp) => props.filters.update({ manaValueOp })}
        value={manaValueInput.draft()}
        valuePlaceholder={t('site.filter.numericPlaceholder')}
        onValueInput={manaValueInput.onInput}
        onValueBlur={manaValueInput.flush}
        error={manaValueInput.error()}
        step="1"
        inputMode="numeric"
      />
      <Show when={pricesEnabled()}>
        <NumericFilterRow
          label={priceLabel()}
          inputId="filter-price"
          ariaLabel={t('site.filter.priceCompare')}
          op={props.filters.filters.priceOp}
          onOp={(priceOp) => props.filters.update({ priceOp })}
          value={priceInput.draft()}
          valuePlaceholder={t('site.filter.numericPlaceholder')}
          onValueInput={priceInput.onInput}
          onValueBlur={priceInput.flush}
          error={priceInput.error()}
          step="0.01"
          inputMode="decimal"
        />
      </Show>
      <Show when={props.showBuylistFilter}>
        <NumericFilterRow
          // Always "$": a buyer's offer is USD whatever the page displays, so
          // labelling it with the active currency would misstate it.
          label={t('site.filter.buylistPrice')}
          inputId="filter-buylist-price"
          ariaLabel={t('site.filter.buylistPriceCompare')}
          op={props.filters.filters.buylistPriceOp}
          onOp={(buylistPriceOp) => props.filters.update({ buylistPriceOp })}
          value={buylistPriceInput.draft()}
          valuePlaceholder={t('site.filter.numericPlaceholder')}
          onValueInput={buylistPriceInput.onInput}
          onValueBlur={buylistPriceInput.flush}
          error={buylistPriceInput.error()}
          step="0.01"
          inputMode="decimal"
        />
      </Show>
      <NumericFilterRow
        label={t('site.filter.copies')}
        inputId="filter-copies"
        ariaLabel={t('site.filter.copiesCompare')}
        op={props.filters.filters.copiesOp}
        onOp={(copiesOp) => props.filters.update({ copiesOp })}
        value={copiesInput.draft()}
        valuePlaceholder={t('site.filter.numericPlaceholder')}
        onValueInput={copiesInput.onInput}
        onValueBlur={copiesInput.flush}
        error={copiesInput.error()}
        step="1"
        inputMode="numeric"
        modeToggle={
          <FilterModeToggle
            ariaLabel={t('site.filter.copiesMode')}
            options={modeOptions(COPIES_MATCH_MODES, COPIES_MODE_COPY, t)}
            value={props.filters.filters.copiesMode}
            onChange={(copiesMode) => props.filters.update({ copiesMode })}
          />
        }
      />
    </>
  )
}
