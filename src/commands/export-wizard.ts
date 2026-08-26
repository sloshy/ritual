/**
 * The interactive wizard behind a bare `ritual export`. The main menu shows the
 * current export configuration (sources, filters, output shape); the user adds
 * whole lists and/or individual cards, tweaks filters and columns, and finally
 * writes the file.
 *
 * Following the card-session convention, the prompt loops are thin shells over
 * exported pure functions (header/choice formatters and the assembly pipeline)
 * so the menu logic is unit-testable without driving a terminal.
 */

import * as fs from 'node:fs/promises'
import path from 'node:path'
import type { Choice } from 'prompts'
import {
  CONDITION_FILTER_NONE,
  exportEntryKey,
  filterExportEntries,
  hasActiveExportFilters,
  loadExportEntries,
  type ConditionFilterValue,
  type ExportEntry,
  type ExportFilters,
  type LabelFilterValue,
} from '../export/entries'
import { cardLabelName, CARD_LABEL_SELECTION_NONE, CARD_LABELS } from '../card/card-labels'
import { renderExport, saveExportPreset } from '../export/output'
import {
  EXPORT_FORMAT_EXTENSIONS,
  EXPORT_FORMATS,
  exportFormatUsesColumns,
  exportPresetNames,
  findExportPreset,
  resolveExportSettings,
  type ExportFormat,
  type ExportPreset,
  type ResolvedExportSettings,
} from '../export/presets'
import {
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_PROPERTIES,
  EXPORT_PROPERTY_LABELS,
  exportPropertyLabel,
  type ExportProperty,
} from '../export/render'
import { exportPropertyHint } from '../pricing/export-hints'
import {
  conditionLabel,
  VALID_CONDITIONS,
  VALID_FINISHES,
  type Finish,
} from '../card/finish-condition'
import type { MessageKey } from '../i18n/messages/en'
import { t } from '../i18n/t'
import { LIST_TYPE_DISPLAY } from '../list/list-type'
import { listLocations, type ListLocation } from '../list/resolve-list'
import { getExportPresets } from '../config/ritual-config'
import { ask, promptTextFilter } from './prompts-helpers'
import { suggestBrowserChoices } from './price-browser'

/** Everything the wizard tracks between screens. */
export type ExportWizardState = {
  /** Whole lists selected for export, in selection order. */
  lists: ListLocation[]
  /** Individually picked entries, in pick order. */
  picked: ExportEntry[]
  filters: ExportFilters
  settings: ResolvedExportSettings
}

/** What the user picked on the wizard's main menu. */
export type ExportWizardSelection =
  | { kind: 'add-lists' }
  | { kind: 'add-cards' }
  | { kind: 'filters' }
  | { kind: 'format' }
  | { kind: 'columns' }
  | { kind: 'csv-options' }
  | { kind: 'load-preset' }
  | { kind: 'save-preset' }
  | { kind: 'review' }
  | { kind: 'export' }
  | { kind: 'exit' }

const sameList = (a: ListLocation, b: ListLocation): boolean =>
  a.type === b.type && a.name === b.name

/**
 * The assembly pipeline shared with flag mode: entries of the selected lists
 * (in selection order), then the individual picks that aren't already covered,
 * then the filters.
 */
export function assembledWizardEntries(
  state: ExportWizardState,
  allEntries: ExportEntry[],
): ExportEntry[] {
  const entries = state.lists.flatMap((list) =>
    allEntries.filter((entry) => entry.listType === list.type && entry.listName === list.name),
  )
  const seen = new Set(entries.map(exportEntryKey))
  for (const pick of state.picked) {
    const key = exportEntryKey(pick)
    if (seen.has(key)) continue
    seen.add(key)
    entries.push(pick)
  }
  return filterExportEntries(entries, state.filters)
}

/** One entry's menu/review row: qty, name, printing, finish, condition, source list. */
export function formatExportEntryChoice(entry: ExportEntry): string {
  const qty = entry.quantity > 1 ? `${entry.quantity}x ` : ''
  const printing =
    entry.set && entry.collectorNumber
      ? ` (${entry.set.toUpperCase()}:${entry.collectorNumber})`
      : ''
  const finish = entry.finish ? ` [${entry.finish}]` : ''
  const condition = entry.condition ? ` [${entry.condition}]` : ''
  const icon = LIST_TYPE_DISPLAY[entry.listType].icon
  return `${qty}${entry.name}${printing}${finish}${condition} · ${icon} ${entry.listName} / ${entry.section}`
}

/** "name "sol" · set LEA · foil · NM/none" — the active filters, or "none". */
export function formatFiltersSegment(filters: ExportFilters): string {
  if (!hasActiveExportFilters(filters)) return t('cli.exportWizard.filtersNone')
  const parts: string[] = []
  if (filters.name) parts.push(t('cli.exportWizard.filterName', { value: filters.name }))
  if (filters.set) parts.push(t('cli.exportWizard.filterSet', { value: filters.set.toUpperCase() }))
  if (filters.finish) parts.push(filters.finish)
  if (filters.conditions && filters.conditions.length > 0) {
    parts.push(filters.conditions.join('/'))
  }
  if (filters.labels && filters.labels.length > 0) {
    parts.push(t('cli.exportWizard.filterLabels', { value: filters.labels.join('/') }))
  }
  return parts.join(' · ')
}

/** The main menu's at-a-glance summary of the configured export. */
export function formatWizardHeaderLines(state: ExportWizardState, entryCount: number): string[] {
  const sources: string[] = []
  if (state.lists.length > 0) sources.push(t('domain.count.lists', { count: state.lists.length }))
  if (state.picked.length > 0)
    sources.push(t('domain.count.pickedCards', { count: state.picked.length }))
  const sourceText =
    sources.length > 0 ? sources.join(' + ') : t('cli.exportWizard.nothingSelected')
  // Text/md exports have fixed line formats, so their header omits the
  // (unused) column selection.
  let formatLine = t('cli.exportWizard.formatLine', {
    format: state.settings.format.toUpperCase(),
  })
  if (exportFormatUsesColumns(state.settings.format)) {
    formatLine += t('cli.exportWizard.columnsSegment', {
      columns: state.settings.columns
        .map((column) => exportPropertyLabel(column, state.settings.dialect))
        .join(', '),
    })
    // Only a non-default dialect is worth a line: `ritual` spellings are what
    // the list files already say.
    if (state.settings.dialect !== 'ritual') {
      formatLine += ` · ${t('cli.exportWizard.dialectValues', { dialect: state.settings.dialect })}`
    }
  }
  const lines: string[] = [
    `📤 ${t('cli.exportWizard.sourcesLine', {
      sources: sourceText,
      cards: t('domain.count.cards', { count: entryCount }),
    })}`,
    t('cli.exportWizard.filtersLine', { filters: formatFiltersSegment(state.filters) }),
    formatLine,
  ]
  if (state.settings.format === 'csv') {
    lines.push(
      t('cli.exportWizard.csvLine', {
        header: t(state.settings.header ? 'cli.exportWizard.on' : 'cli.exportWizard.off'),
        quoting: t(
          state.settings.quoteAll
            ? 'cli.exportWizard.quoteAllCells'
            : 'cli.exportWizard.minimalQuoting',
        ),
      }),
    )
  }
  return lines
}

/**
 * The wizard main menu, reflecting the current state. It reads as the pipeline
 * it is: pick what to export, narrow it, shape the output, then review and
 * export. `📂 Load preset` heads the output-shaping block because that is what
 * it overwrites — a preset carries the format, columns, and CSV options, so
 * offering it below them would invite setting them by hand only to lose them.
 */
export function buildWizardMenuChoices(
  state: ExportWizardState,
  entryCount: number,
  presetCount: number,
): Choice[] {
  const choices: Choice[] = [
    {
      title: `📋 ${t('cli.exportWizard.menuAddLists', { count: state.lists.length })}`,
      value: { kind: 'add-lists' } satisfies ExportWizardSelection,
    },
    {
      title: `🃏 ${t('cli.exportWizard.menuAddCards', { count: state.picked.length })}`,
      value: { kind: 'add-cards' } satisfies ExportWizardSelection,
    },
    {
      title: `🔍 ${t('cli.exportWizard.menuFilters', {
        filters: formatFiltersSegment(state.filters),
      })}`,
      value: { kind: 'filters' } satisfies ExportWizardSelection,
    },
  ]
  if (presetCount > 0) {
    choices.push({
      title: `📂 ${t('cli.exportWizard.menuLoadPreset', { count: presetCount })}`,
      value: { kind: 'load-preset' } satisfies ExportWizardSelection,
    })
  }
  choices.push({
    title: `📄 ${t('cli.exportWizard.menuFormat', {
      format: state.settings.format.toUpperCase(),
    })}`,
    value: { kind: 'format' } satisfies ExportWizardSelection,
  })
  // Text/md lines are fixed, so the column and CSV-option menus disappear.
  if (exportFormatUsesColumns(state.settings.format)) {
    choices.push({
      title: `🧱 ${t('cli.exportWizard.menuColumns', { count: state.settings.columns.length })}`,
      value: { kind: 'columns' } satisfies ExportWizardSelection,
    })
  }
  if (state.settings.format === 'csv') {
    choices.push({
      title: `⚙️ ${t('cli.exportWizard.menuCsvOptions', {
        header: t(state.settings.header ? 'cli.exportWizard.on' : 'cli.exportWizard.off'),
        quoting: t(
          state.settings.quoteAll ? 'cli.exportWizard.quoteAll' : 'cli.exportWizard.minimalQuoting',
        ),
      })}`,
      value: { kind: 'csv-options' } satisfies ExportWizardSelection,
    })
  }
  choices.push(
    {
      title: `📌 ${t('cli.exportWizard.menuSavePreset')}`,
      value: { kind: 'save-preset' } satisfies ExportWizardSelection,
    },
    {
      title: `👀 ${t('cli.exportWizard.menuReview', {
        cards: t('domain.count.cards', { count: entryCount }),
      })}`,
      value: { kind: 'review' } satisfies ExportWizardSelection,
    },
    {
      title: `📤 ${t('cli.exportWizard.menuExport', {
        cards: t('domain.count.cards', { count: entryCount }),
      })}`,
      value: { kind: 'export' } satisfies ExportWizardSelection,
    },
    {
      title: `🚪 ${t('cli.exportWizard.menuExit')}`,
      value: { kind: 'exit' } satisfies ExportWizardSelection,
    },
  )
  return choices
}

// ── Interactive loops ───────────────────────────────────────────────

const DONE_SENTINEL = 'done'

async function promptAddLists(
  state: ExportWizardState,
  allLocations: ListLocation[],
): Promise<void> {
  while (true) {
    const remaining = allLocations.filter(
      (location) => !state.lists.some((selected) => sameList(selected, location)),
    )
    if (remaining.length === 0) {
      console.log(t('cli.exportWizard.allListsSelected'))
      return
    }
    const pick = await ask<ListLocation | typeof DONE_SENTINEL>({
      type: 'autocomplete',
      message: t('cli.exportWizard.promptAddList', { count: state.lists.length }),
      choices: [
        { title: t('cli.exportWizard.done'), value: DONE_SENTINEL },
        ...remaining.map(
          (location): Choice => ({
            title: `${LIST_TYPE_DISPLAY[location.type].icon} ${location.name}`,
            value: location,
          }),
        ),
      ],
      limit: 14,
      suggest: async (rawInput: string, choices: Choice[]) =>
        suggestBrowserChoices(String(rawInput), choices),
    })
    if (!pick || pick === DONE_SENTINEL) return
    state.lists.push(pick)
  }
}

async function promptAddCards(state: ExportWizardState, allEntries: ExportEntry[]): Promise<void> {
  while (true) {
    const pickedKeys = new Set(state.picked.map(exportEntryKey))
    const remaining = allEntries.filter((entry) => !pickedKeys.has(exportEntryKey(entry)))
    if (remaining.length === 0) {
      console.log(t('cli.exportWizard.allCardsPicked'))
      return
    }
    const pick = await ask<ExportEntry | typeof DONE_SENTINEL>({
      type: 'autocomplete',
      message: t('cli.exportWizard.promptAddCard', { count: state.picked.length }),
      choices: [
        { title: t('cli.exportWizard.done'), value: DONE_SENTINEL },
        ...remaining.map(
          (entry): Choice => ({ title: formatExportEntryChoice(entry), value: entry }),
        ),
      ],
      limit: 15,
      suggest: async (rawInput: string, choices: Choice[]) =>
        suggestBrowserChoices(String(rawInput), choices),
    })
    if (!pick || pick === DONE_SENTINEL) return
    state.picked.push(pick)
  }
}

async function promptFinishFilter(current: Finish | undefined): Promise<Finish | undefined> {
  const pick = await ask<Finish | 'any'>({
    type: 'select',
    message: t('cli.exportWizard.promptFinish'),
    choices: [
      {
        title: `${t('cli.exportWizard.any')}${current === undefined ? t('cli.exportWizard.currentSuffix') : ''}`,
        value: 'any',
      },
      ...VALID_FINISHES.map((finish) => ({
        title: `${finish}${finish === current ? t('cli.exportWizard.currentSuffix') : ''}`,
        value: finish,
      })),
    ],
  })
  if (pick === undefined) return current
  return pick === 'any' ? undefined : pick
}

/** One toggleable row in a multi-select filter prompt (the mark is prepended). */
type ToggleFilterOption<T extends string> = { value: T; title: string }

/**
 * Toggle-loop over a fixed option set so any combination can be selected.
 * Returns the new filter value; an empty selection means "any". The shared
 * shape behind the condition and labels filters.
 */
async function promptToggleFilter<T extends string>(
  message: string,
  options: readonly ToggleFilterOption<T>[],
  current: readonly T[] | undefined,
): Promise<T[] | undefined> {
  const selected = new Set<T>(current ?? [])
  while (true) {
    const mark = (value: T): string => (selected.has(value) ? '◉' : '○')
    const pick = await ask<T | 'any' | 'done'>({
      type: 'select',
      message,
      choices: [
        { title: t('cli.exportWizard.done'), value: 'done' },
        {
          title: `${t('cli.exportWizard.anyClearFilter')}${selected.size === 0 ? t('cli.exportWizard.currentSuffix') : ''}`,
          value: 'any',
        },
        ...options.map((option) => ({
          title: `${mark(option.value)} ${option.title}`,
          value: option.value,
        })),
      ],
    })
    if (pick === undefined || pick === 'done') {
      return selected.size > 0 ? [...selected] : undefined
    }
    if (pick === 'any') {
      selected.clear()
      continue
    }
    if (selected.has(pick)) selected.delete(pick)
    else selected.add(pick)
  }
}

/** Toggle-loop over condition values (each grade plus "no condition marked"). */
async function promptConditionFilter(
  current: ConditionFilterValue[] | undefined,
): Promise<ConditionFilterValue[] | undefined> {
  return promptToggleFilter(
    t('cli.exportWizard.promptCondition'),
    [
      ...VALID_CONDITIONS.map((condition) => ({
        value: condition,
        title: `${condition} — ${conditionLabel(condition)}`,
      })),
      { value: CONDITION_FILTER_NONE, title: t('cli.exportWizard.noConditionMarked') },
    ],
    current,
  )
}

/**
 * Toggle-loop over label filter values (each label plus "unlabeled"). A
 * *filter* may combine `keep` with the others — it selects entries, it doesn't
 * declare a label — so no exclusivity rule applies here.
 */
async function promptLabelsFilter(
  current: LabelFilterValue[] | undefined,
): Promise<LabelFilterValue[] | undefined> {
  return promptToggleFilter(
    t('cli.exportWizard.promptLabels'),
    [
      ...CARD_LABELS.map((label) => ({
        value: label,
        title: `${label} — ${cardLabelName(label)}`,
      })),
      { value: CARD_LABEL_SELECTION_NONE, title: t('cli.exportWizard.noLabels') },
    ],
    current,
  )
}

async function promptFilters(state: ExportWizardState): Promise<void> {
  while (true) {
    const pick = await ask<'name' | 'set' | 'finish' | 'condition' | 'labels' | 'back'>({
      type: 'select',
      message: t('cli.exportWizard.promptFilters'),
      choices: [
        {
          title: t('cli.exportWizard.filterRowName', {
            value: state.filters.name ?? t('cli.exportWizard.anyValue'),
          }),
          value: 'name',
        },
        {
          title: t('cli.exportWizard.filterRowSet', {
            value: state.filters.set
              ? state.filters.set.toUpperCase()
              : t('cli.exportWizard.anyValue'),
          }),
          value: 'set',
        },
        {
          title: t('cli.exportWizard.filterRowFinish', {
            value: state.filters.finish ?? t('cli.exportWizard.anyValue'),
          }),
          value: 'finish',
        },
        {
          title: t('cli.exportWizard.filterRowCondition', {
            value:
              state.filters.conditions && state.filters.conditions.length > 0
                ? state.filters.conditions.join('/')
                : t('cli.exportWizard.anyValue'),
          }),
          value: 'condition',
        },
        {
          title: t('cli.exportWizard.filterRowLabels', {
            value:
              state.filters.labels && state.filters.labels.length > 0
                ? state.filters.labels.join('/')
                : t('cli.exportWizard.anyValue'),
          }),
          value: 'labels',
        },
        { title: t('cli.exportWizard.back'), value: 'back' },
      ],
    })
    if (!pick || pick === 'back') return
    switch (pick) {
      case 'name':
        state.filters.name = await promptTextFilter(
          t('cli.exportWizard.promptNameTerms'),
          state.filters.name,
        )
        break
      case 'set':
        state.filters.set = await promptTextFilter(
          t('cli.exportWizard.promptSetCode'),
          state.filters.set,
        )
        break
      case 'finish':
        state.filters.finish = await promptFinishFilter(state.filters.finish)
        break
      case 'condition':
        state.filters.conditions = await promptConditionFilter(state.filters.conditions)
        break
      case 'labels':
        state.filters.labels = await promptLabelsFilter(state.filters.labels)
        break
    }
  }
}

/** Menu labels for the format picker; the raw format key is the value. */
const FORMAT_CHOICE_LABELS = {
  csv: 'domain.exportFormat.csv',
  json: 'domain.exportFormat.json',
  text: 'domain.exportFormat.text',
  md: 'domain.exportFormat.md',
} as const satisfies Record<ExportFormat, MessageKey>

async function promptFormat(state: ExportWizardState): Promise<void> {
  const pick = await ask<ExportFormat>({
    type: 'select',
    message: t('cli.exportWizard.promptFormat'),
    choices: EXPORT_FORMATS.map(
      (format): Choice => ({
        title: `${t(FORMAT_CHOICE_LABELS[format])}${state.settings.format === format ? t('cli.exportWizard.currentSuffix') : ''}`,
        value: format,
      }),
    ),
  })
  if (pick) state.settings.format = pick
}

const KEEP_SENTINEL = 'keep'
const RESET_SENTINEL = 'reset'

/**
 * The ordered column picker: each pick appends to the new order, so inclusion
 * and ordering happen in one gesture. Returns the new order, or undefined when
 * the user cancels (keep the current columns).
 */
export async function promptColumns(
  current: ExportProperty[],
): Promise<ExportProperty[] | undefined> {
  const order: ExportProperty[] = []
  while (true) {
    const remaining = EXPORT_PROPERTIES.filter((property) => !order.includes(property))
    if (remaining.length === 0) return order
    const choices: Choice[] = []
    if (order.length === 0) {
      choices.push({
        title: t('cli.exportWizard.keepCurrent', {
          columns: current.map((c) => EXPORT_PROPERTY_LABELS[c]).join(' → '),
        }),
        value: KEEP_SENTINEL,
      })
    } else {
      choices.push({ title: t('cli.exportWizard.done'), value: DONE_SENTINEL })
    }
    choices.push({ title: t('cli.exportWizard.resetDefault'), value: RESET_SENTINEL })
    choices.push(
      ...remaining.map((property): Choice => {
        const hint = exportPropertyHint(property)
        return {
          title: `${EXPORT_PROPERTY_LABELS[property]}${hint ? ` (${hint})` : ''}`,
          value: property,
        }
      }),
    )
    const message =
      order.length > 0
        ? t('cli.exportWizard.orderSoFar', {
            columns: order.map((c) => EXPORT_PROPERTY_LABELS[c]).join(' → '),
          })
        : t('cli.exportWizard.pickColumns')
    const pick = await ask<
      ExportProperty | typeof KEEP_SENTINEL | typeof RESET_SENTINEL | typeof DONE_SENTINEL
    >({
      type: 'autocomplete',
      message,
      choices,
      limit: 14,
      suggest: async (rawInput: string, menuChoices: Choice[]) =>
        suggestBrowserChoices(String(rawInput), menuChoices),
    })
    if (pick === undefined || pick === KEEP_SENTINEL) {
      return order.length > 0 ? order : undefined
    }
    if (pick === DONE_SENTINEL) return order
    if (pick === RESET_SENTINEL) return [...DEFAULT_EXPORT_COLUMNS]
    order.push(pick)
  }
}

async function promptCsvOptions(state: ExportWizardState): Promise<void> {
  while (true) {
    const pick = await ask<'header' | 'quoting' | 'back'>({
      type: 'select',
      message: t('cli.exportWizard.promptCsvOptions'),
      choices: [
        {
          title: t('cli.exportWizard.csvHeaderRow', {
            value: t(state.settings.header ? 'cli.exportWizard.on' : 'cli.exportWizard.off'),
          }),
          value: 'header',
        },
        {
          title: t('cli.exportWizard.csvQuoting', {
            value: t(
              state.settings.quoteAll ? 'cli.exportWizard.alwaysQuote' : 'cli.exportWizard.minimal',
            ),
          }),
          value: 'quoting',
        },
        { title: t('cli.exportWizard.back'), value: 'back' },
      ],
    })
    if (!pick || pick === 'back') return
    if (pick === 'header') state.settings.header = !state.settings.header
    if (pick === 'quoting') state.settings.quoteAll = !state.settings.quoteAll
  }
}

/** "CSV · Name, Set, Quantity · no header · quote all" — a preset's menu row. */
export function formatPresetSummary(name: string, preset: ExportPreset): string {
  const parts: string[] = [
    preset.format.toUpperCase(),
    preset.columns.map((column) => exportPropertyLabel(column, preset.dialect)).join(', '),
  ]
  if (preset.header === false) parts.push(t('cli.exportWizard.presetNoHeader'))
  if (preset.quoteAll) parts.push(t('cli.exportWizard.quoteAll'))
  if (preset.dialect !== undefined && preset.dialect !== 'ritual') {
    parts.push(t('cli.exportWizard.dialectValues', { dialect: preset.dialect }))
  }
  return `${name} — ${parts.join(' · ')}`
}

async function promptLoadPreset(state: ExportWizardState): Promise<void> {
  const saved = getExportPresets()
  const names = exportPresetNames(saved)
  if (names.length === 0) return
  const pick = await ask<string>({
    type: 'select',
    message: t('cli.exportWizard.promptLoadPreset'),
    choices: names.map((name) => ({
      title: formatPresetSummary(name, findExportPreset(name, saved)!),
      value: name,
    })),
  })
  if (!pick) return
  state.settings = resolveExportSettings(findExportPreset(pick, saved), {})
  console.log(`✓ ${t('cli.exportWizard.loadedPreset', { name: pick })}`)
}

async function promptSavePreset(state: ExportWizardState): Promise<void> {
  const name = await ask<string>({
    type: 'text',
    message: t('cli.exportWizard.promptPresetName'),
    validate: (value: string) => (value.trim().length > 0 ? true : t('cli.exportWizard.enterName')),
  })
  if (!name) return
  const trimmed = name.trim()
  // Only a *saved* preset can be overwritten; naming a built-in just shadows it.
  if (getExportPresets()[trimmed]) {
    const overwrite = await ask<boolean>({
      type: 'confirm',
      message: t('cli.exportWizard.presetExists', { name: trimmed }),
      initial: false,
    })
    if (!overwrite) return
  }
  await saveExportPreset(trimmed, state.settings)
  console.log(`✓ ${t('cli.exportWizard.savedPreset', { name: trimmed })}`)
}

/** Print the assembled entries; returns to the menu. */
function showReview(entries: ExportEntry[]): void {
  console.log('')
  if (entries.length === 0) {
    console.log(t('cli.exportWizard.reviewEmpty'))
  } else {
    for (const entry of entries) console.log(`  ${formatExportEntryChoice(entry)}`)
    console.log(`  — ${t('domain.count.cards', { count: entries.length })}`)
  }
  console.log('')
}

/** Prompt for a path and write the export. Returns true when a file was written. */
async function promptExport(entries: ExportEntry[], state: ExportWizardState): Promise<boolean> {
  if (entries.length === 0) {
    console.log(t('cli.exportWizard.exportEmpty'))
    return false
  }
  const target = await ask<string>({
    type: 'text',
    message: t('cli.exportWizard.promptOutputFile'),
    initial: `export.${EXPORT_FORMAT_EXTENSIONS[state.settings.format]}`,
  })
  if (!target || !target.trim()) return false
  const resolved = path.resolve(target.trim())
  const rendered = await renderExport(entries, state.settings)
  for (const warning of rendered.warnings) console.warn(`⚠️  ${warning}`)
  await fs.mkdir(path.dirname(resolved), { recursive: true })
  await fs.writeFile(resolved, rendered.content + '\n', 'utf-8')
  console.log(
    `✓ ${t('cli.export.exportedToFile', {
      cards: t('domain.count.cards', { count: entries.length }),
      target: resolved,
    })}`,
  )
  return true
}

/** Run the interactive export wizard until the user exports or exits. */
export async function runExportWizard(): Promise<void> {
  const allLocations = await listLocations()
  if (allLocations.length === 0) {
    console.log(t('errors.resolveList.noLists'))
    return
  }
  const loaded = await loadExportEntries(allLocations)
  for (const warning of loaded.warnings) console.warn(`⚠️  ${warning}`)

  const state: ExportWizardState = {
    lists: [],
    picked: [],
    filters: {},
    settings: resolveExportSettings(undefined, {}),
  }

  while (true) {
    const entries = assembledWizardEntries(state, loaded.entries)
    console.log('')
    for (const line of formatWizardHeaderLines(state, entries.length)) console.log(line)
    console.log('')

    const presetCount = exportPresetNames(getExportPresets()).length
    const selection = await ask<ExportWizardSelection>({
      type: 'select',
      message: t('cli.exportWizard.menuTitle'),
      choices: buildWizardMenuChoices(state, entries.length, presetCount),
    })
    if (!selection || selection.kind === 'exit') {
      if (entries.length > 0) {
        const confirmed = await ask<boolean>({
          type: 'confirm',
          message: t('cli.exportWizard.confirmExit'),
          initial: false,
        })
        if (!confirmed) continue
      }
      return
    }

    switch (selection.kind) {
      case 'add-lists':
        await promptAddLists(state, allLocations)
        break
      case 'add-cards':
        await promptAddCards(state, loaded.entries)
        break
      case 'filters':
        await promptFilters(state)
        break
      case 'format':
        await promptFormat(state)
        break
      case 'columns': {
        const columns = await promptColumns(state.settings.columns)
        if (columns) state.settings.columns = columns
        break
      }
      case 'csv-options':
        await promptCsvOptions(state)
        break
      case 'load-preset':
        await promptLoadPreset(state)
        break
      case 'save-preset':
        await promptSavePreset(state)
        break
      case 'review':
        showReview(entries)
        break
      case 'export':
        if (await promptExport(entries, state)) return
        break
    }
  }
}
