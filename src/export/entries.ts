import * as fs from 'node:fs/promises'
import {
  isCondition,
  VALID_CONDITIONS,
  type Condition,
  type Finish,
} from '../card/finish-condition'
import {
  CARD_LABEL_SELECTIONS,
  effectiveLabels,
  isCardLabelSelection,
  matchesCardLabelSelection,
  supportsAnyLabels,
  type CardLabel,
  type CardLabelSelection,
} from '../card/card-labels'
import type { CardLanguage } from '../card/card-language'
import type { ListType } from '../list/list-type'
import type { ListLocation } from '../list/resolve-list'
import { loadDeckFile } from '../importers/text-file'
import { parseDeckFrontMatter } from '../list/deck-file'
import { parseCollectionFile, type CollectionEntry } from '../list/collection-file'
import { parseWantedListFile, type WantedListEntry } from '../list/wanted-file'
import { matchesAllTerms } from '../card/term-match'

/**
 * One flattened card entry assembled for export, unified across deck,
 * collection, and wanted-list files. Unlike the pricing flattener this keeps
 * `condition` and `note`, and includes every deck section (a data export is
 * not a valuation, so maybeboard/token extras are in scope). Card `&N` IDs are
 * internal and deliberately not carried.
 */
export type ExportEntry = {
  listType: ListType
  listName: string
  section: string
  name: string
  quantity: number
  /** Lowercase internally, per the set-code convention. */
  set?: string
  collectorNumber?: string
  finish?: Finish
  /** Never set for wanted entries (the wanted grammar has no condition token). */
  condition?: Condition
  /** The line's language token, when present. Absent means `en` (a bare line means English). */
  language?: CardLanguage
  /**
   * The card's *effective* labels (its line's override, else the list's
   * front-matter default) — decks and collections; absent when the effective
   * set is empty, and always absent for wanted entries, which carry no labels.
   * Exports flatten away the list file, so the override/default split would be
   * meaningless here.
   */
  labels?: CardLabel[]
  note?: string
  /** Position within its list file; with listType+listName forms a stable identity. */
  fileOrder: number
  /**
   * Scryfall id of the pinned printing. Not read from the list file (no line
   * carries one) — resolved from the local Scryfall cache by
   * `resolveExportScryfallIds`, and only when the selected columns need it.
   */
  scryfallId?: string
}

export type LoadedExportEntries = { entries: ExportEntry[]; warnings: string[] }

/**
 * Stable identity of an entry within the assembled export set, used to dedupe
 * list selections against individually picked cards.
 */
export function exportEntryKey(entry: ExportEntry): string {
  return `${entry.listType}|${entry.listName}|${entry.fileOrder}`
}

/**
 * Load and flatten the given list files into export entries. Parse warnings are
 * collected (prefixed with the list name) rather than printed, so both the CLI
 * and the admin route can surface them their own way.
 */
export async function loadExportEntries(locations: ListLocation[]): Promise<LoadedExportEntries> {
  const entries: ExportEntry[] = []
  const warnings: string[] = []

  for (const location of locations) {
    if (location.type === 'deck') {
      const { deck, warnings: deckWarnings } = await loadDeckFile(location.filePath)
      warnings.push(...deckWarnings.map((w) => `${location.name}: ${w}`))
      // The deck's `labels:` default lives in front matter, which the deck
      // parser does not project onto DeckData — read separately, exactly as the
      // site's deck baker does, so an export resolves the same effective labels
      // the site displays.
      const listLabels = (await parseDeckFrontMatter(location.filePath)).labels
      let fileOrder = 0
      for (const section of deck.sections) {
        for (const card of section.cards) {
          const labels = effectiveLabels(card.labels, listLabels)
          entries.push({
            listType: 'deck',
            listName: location.name,
            section: section.name,
            name: card.name,
            quantity: card.quantity,
            set: card.set?.toLowerCase(),
            collectorNumber: card.collectorNumber,
            finish: card.finish,
            condition: card.condition,
            language: card.language,
            labels: labels.length > 0 ? labels : undefined,
            note: card.note,
            fileOrder: fileOrder++,
          })
        }
      }
      continue
    }

    const content = await fs.readFile(location.filePath, 'utf-8')
    if (location.type === 'collection') {
      const parsed = parseCollectionFile(content)
      warnings.push(...parsed.warnings.map((w) => `${location.name}: ${w}`))
      parsed.entries.forEach((entry, fileOrder) => {
        const labels = effectiveLabels(entry.labels, parsed.labels)
        entries.push(
          flatEntry(
            location,
            entry,
            entry.condition,
            labels.length > 0 ? labels : undefined,
            fileOrder,
          ),
        )
      })
      continue
    }
    const parsed = parseWantedListFile(content)
    warnings.push(...parsed.warnings.map((w) => `${location.name}: ${w}`))
    parsed.entries.forEach((entry, fileOrder) => {
      entries.push(flatEntry(location, entry, undefined, undefined, fileOrder))
    })
  }

  return { entries, warnings }
}

/** Map one parsed collection/wanted entry onto the unified export shape. */
function flatEntry(
  location: ListLocation,
  entry: CollectionEntry | WantedListEntry,
  condition: Condition | undefined,
  labels: CardLabel[] | undefined,
  fileOrder: number,
): ExportEntry {
  return {
    listType: location.type,
    listName: location.name,
    section: entry.section,
    name: entry.name,
    quantity: entry.quantity,
    set: entry.set?.toLowerCase(),
    collectorNumber: entry.collectorNumber,
    finish: entry.finish,
    condition,
    language: entry.language,
    labels,
    note: entry.note,
    fileOrder,
  }
}

/**
 * The full selection pipeline shared by the CLI and the admin route: load the
 * selected lists, resolve card-term picks against the wider scope (loaded only
 * when terms were given), assemble, and filter. Warnings collect list parse
 * warnings plus a line per card term that matched nothing.
 */
export async function buildExportSelection(
  selected: ListLocation[],
  scope: ListLocation[],
  cardTerms: string[],
  filters: ExportFilters,
): Promise<LoadedExportEntries> {
  const loaded = await loadExportEntries(selected)
  const warnings = [...loaded.warnings]
  const scopeEntries = cardTerms.length > 0 ? (await loadExportEntries(scope)).entries : []
  const assembled = assembleExportEntries(loaded.entries, scopeEntries, cardTerms)
  warnings.push(...assembled.unmatchedTerms.map((terms) => `No cards matched '${terms}'`))
  return { entries: filterExportEntries(assembled.entries, filters), warnings }
}

/** The assembled export set plus any `--card` terms that matched nothing. */
export type AssembledExportEntries = { entries: ExportEntry[]; unmatchedTerms: string[] }

/**
 * Assemble the export set: entries of the selected lists (in selection order)
 * plus card picks — each terms string adds every entry in `scopeEntries` whose
 * name matches all of its terms — deduped by entry identity with list
 * selections winning.
 */
export function assembleExportEntries(
  listEntries: ExportEntry[],
  scopeEntries: ExportEntry[],
  cardTerms: string[],
): AssembledExportEntries {
  const seen = new Set(listEntries.map(exportEntryKey))
  const entries = [...listEntries]
  const unmatchedTerms: string[] = []
  for (const terms of cardTerms) {
    const matches = scopeEntries.filter((entry) => matchesAllTerms(entry.name, terms))
    if (matches.length === 0) unmatchedTerms.push(terms)
    for (const match of matches) {
      const key = exportEntryKey(match)
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(match)
    }
  }
  return { entries, unmatchedTerms }
}

/**
 * One condition-filter value: an explicit condition grade, or `'none'` to
 * match entries with no condition marked on their line.
 */
export type ConditionFilterValue = Condition | 'none'

export const CONDITION_FILTER_NONE = 'none'

/**
 * Validate a raw condition-filter value list (from a flag or an API body), or
 * an error message. Condition grades are matched case-insensitively; `none`
 * selects entries without an explicit condition.
 */
export function parseConditionFilterValues(
  values: readonly unknown[],
): ConditionFilterValue[] | string {
  const conditions: ConditionFilterValue[] = []
  for (const value of values) {
    if (typeof value !== 'string') {
      return `Invalid condition '${String(value)}'. Use one of: ${VALID_CONDITIONS.join(', ')}, none.`
    }
    const grade = value.toUpperCase()
    const parsed: ConditionFilterValue | undefined = isCondition(grade)
      ? grade
      : value.toLowerCase() === CONDITION_FILTER_NONE
        ? CONDITION_FILTER_NONE
        : undefined
    if (parsed === undefined) {
      return `Invalid condition '${value}'. Use one of: ${VALID_CONDITIONS.join(', ')}, none.`
    }
    if (!conditions.includes(parsed)) conditions.push(parsed)
  }
  if (conditions.length === 0) {
    return `No conditions given. Use one of: ${VALID_CONDITIONS.join(', ')}, none.`
  }
  return conditions
}

/**
 * One labels-filter value: the shared selection vocabulary (`'none'` matches
 * collection entries whose effective label set is empty). The alias marks the
 * export-specific semantics: unlike the site's chips, a filter list here may
 * combine `keep` with the others — it selects, it doesn't declare.
 */
export type LabelFilterValue = CardLabelSelection

/** Every labels-filter value, in canonical order, for flag help and validation messages. */
export const LABEL_FILTER_VALUES = CARD_LABEL_SELECTIONS

/**
 * Validate a raw labels-filter value list (from a flag or an API body), or an
 * error message. Labels are matched case-insensitively; `none` selects
 * unlabeled collection entries.
 */
export function parseLabelFilterValues(values: readonly unknown[]): LabelFilterValue[] | string {
  const labels: LabelFilterValue[] = []
  for (const value of values) {
    const lower = typeof value === 'string' ? value.toLowerCase() : undefined
    if (lower === undefined || !isCardLabelSelection(lower)) {
      return `Invalid label '${String(value)}'. Use one of: ${LABEL_FILTER_VALUES.join(', ')}.`
    }
    if (!labels.includes(lower)) labels.push(lower)
  }
  if (labels.length === 0) {
    return `No labels given. Use one of: ${LABEL_FILTER_VALUES.join(', ')}.`
  }
  return labels
}

/**
 * Filters applied to the assembled export set. All present filters must match
 * (logical AND).
 */
export type ExportFilters = {
  /** Whitespace-separated terms matched against the card name via {@link matchesAllTerms}. */
  name?: string
  /** Set code, compared case-insensitively. */
  set?: string
  /** `'nonfoil'` also matches entries with no explicit finish (unmarked = nonfoil). */
  finish?: Finish
  /**
   * Conditions to match (logical OR within the list). An explicit grade
   * matches only entries with that exact condition marked; `'none'` matches
   * entries without one. Wanted entries have no condition at all and never
   * match a condition filter.
   */
  conditions?: ConditionFilterValue[]
  /**
   * Labels to match (logical OR within the list) against each entry's
   * *effective* labels; `'none'` matches label-carrying entries whose effective
   * set is empty. Wanted entries carry no labels at all, so they never match —
   * not even `'none'`, which would otherwise select every one of them.
   */
  labels?: LabelFilterValue[]
}

export function hasActiveExportFilters(filters: ExportFilters): boolean {
  return Boolean(
    filters.name ||
    filters.set ||
    filters.finish ||
    (filters.conditions?.length ?? 0) > 0 ||
    (filters.labels?.length ?? 0) > 0,
  )
}

export function filterExportEntries(entries: ExportEntry[], filters: ExportFilters): ExportEntry[] {
  const set = filters.set?.toLowerCase()
  const conditions = filters.conditions
  const labels = filters.labels
  return entries.filter((entry) => {
    if (filters.name && !matchesAllTerms(entry.name, filters.name)) return false
    if (set && entry.set?.toLowerCase() !== set) return false
    if (filters.finish && (entry.finish ?? 'nonfoil') !== filters.finish) return false
    if (conditions && conditions.length > 0) {
      if (entry.listType === 'wanted') return false
      if (!conditions.includes(entry.condition ?? CONDITION_FILTER_NONE)) return false
    }
    if (labels && labels.length > 0) {
      if (!supportsAnyLabels(entry.listType)) return false
      if (!matchesCardLabelSelection(entry.labels ?? [], labels)) return false
    }
    return true
  })
}
